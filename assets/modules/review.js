// Review Mode controller: builds an overlay to step through theorems, auto-generates AI reviews,
// shows inline proof outline snippets, and produces a final report.
// No external dependencies beyond D3 (for selectors optional) and MathJax for typesetting.

function getApiKey() {
    try { return localStorage.getItem('openai_api_key') || ''; } catch (_) { return ''; }
}

function splitPrereqItems(text) {
    if (!text) return [];
    const t = String(text).replace(/\r\n/g, '\n').trim();
    if (!t) return [];
    const paragraphs = t.split(/\n\s*\n+/);
    const items = [];
    paragraphs.forEach(para => {
        const lines = para.split('\n');
        let current = '';
        const pushCurrent = () => {
            const cleaned = current.replace(/\\label\{[^}]*\}/g, '').trim();
            if (cleaned) items.push(cleaned);
            current = '';
        };
        for (const line of lines) {
            const isHeaderish = /^\s*(?:\$[^$]{0,80}\$|[A-Za-z\\][^:\n\r]{0,80}):/.test(line);
            if (isHeaderish && current.trim()) { pushCurrent(); current = line; }
            else { current = current ? current + '\n' + line : line; }
        }
        pushCurrent();
    });
    return items;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function sanitizeFilename(s) {
    return String(s || 'review-report').replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 120);
}

function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function typesetMath(root) {
    try { if (window.MathJax && window.MathJax.typesetPromise) return window.MathJax.typesetPromise([root]); } catch (_) { }
    return Promise.resolve();
}

function inferPaperId() {
    // Use pathname (stable per paper folder) as paperId
    let p = (location && location.pathname) ? location.pathname : 'paper';
    // Collapse trailing slash
    if (p.endsWith('/')) p = p.slice(0, -1);
    return p || 'paper';
}

function loadSavedReview(paperId) {
    try { return JSON.parse(localStorage.getItem('review:' + paperId) || 'null'); } catch { return null; }
}
function saveReview(paperId, data) {
    try { localStorage.setItem('review:' + paperId, JSON.stringify(data)); } catch (_) { }
}

function buildItemsFromData(processedData) {
    const items = processedData.nodes
        .filter(n => n.type === 'theorem')
        .map(n => ({
            nodeId: n.id,
            title: n.display_name || n.label || n.id,
            statement: (n.content_preview || '').replace(/\\label\{[^}]*\}/g, '').trim(),
            prerequisites: n.prerequisites_preview || '',
            status: 'pending',
            clarity: '',
            soundness: '',
            suggestions: '',
            includeInReport: true,
            selectedForReport: false
        }));
    // Sort by paper order inferred from display_name (simple lexical fallback)
    items.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true }));
    return items;
}

function buildProofOutline(nodeId, processedData, depth = 2) {
    // Walk prerequisite edges inward using incomingEdgesByTarget
    const incoming = processedData.incomingEdgesByTarget;
    const nodeById = processedData.nodeById;
    const visited = new Set([nodeId]);
    let frontier = [nodeId];
    let level = 0;
    const supporting = [];
    const defSet = new Set();
    const definitions = [];

    while (level < depth && frontier.length) {
        const next = [];
        for (const id of frontier) {
            const ins = incoming.get(id) || [];
            for (const { s, dep } of ins) {
                if (dep === 'generalized_by') continue;
                if (!visited.has(s)) {
                    visited.add(s);
                    next.push(s);
                }
                const n = nodeById.get(s);
                if (!n) continue;
                if (['theorem', 'lemma', 'proposition', 'corollary', 'claim'].includes(n.type)) {
                    const content = (n.content_preview || '').replace(/\\label\{[^}]*\}/g, '').trim();
                    const title = n.display_name || n.label || n.id;
                    supporting.push({ id: n.id, title, content });
                }
                const items = splitPrereqItems(n.prerequisites_preview || '');
                for (const it of items) {
                    const key = it.replace(/\s+/g, ' ').trim().toLowerCase();
                    if (key && !defSet.has(key)) { defSet.add(key); definitions.push(it); }
                }
            }
        }
        level += 1;
        frontier = next;
    }
    return { definitions, supporting };
}

function buildSummaryTxt(paperTitle, items) {
    const lines = [];
    lines.push(paperTitle);
    lines.push('');
    for (const it of items) {
        lines.push('=== ' + it.title + ' ===');
        lines.push('Clarity:'); lines.push(it.clarity || '');
        lines.push('');
        lines.push('Soundness:'); lines.push(it.soundness || '');
        lines.push('');
        lines.push('Suggestions for Improvement:'); lines.push(it.suggestions || '');
        lines.push('\n');
    }
    return lines.join('\n');
}

function buildSummaryLatex(paperTitle, items) {
    const esc = (s) => (s == null ? '' : String(s));
    const lines = [];
    lines.push('\\documentclass[11pt]{article}');
    lines.push('\\usepackage{amsmath,amssymb,amsthm}');
    lines.push('\\usepackage[margin=1in]{geometry}');
    lines.push('\\title{Review for: ' + esc(paperTitle).replace(/[\\{}]/g, ' ') + '}');
    lines.push('\\begin{document}');
    lines.push('\\maketitle');
    items.forEach((it) => {
        lines.push('\\section*{' + esc(it.title).replace(/[\\{}]/g, ' ') + '}');
        lines.push('\\subsection*{Clarity}');
        lines.push(esc(it.clarity || ''));
        lines.push('');
        lines.push('\\subsection*{Soundness}');
        lines.push(esc(it.soundness || ''));
        lines.push('');
        lines.push('\\subsection*{Suggestions for Improvement}');
        lines.push(esc(it.suggestions || ''));
    });
    lines.push('\\end{document}');
    return lines.join('\\n');
}

function aiReviewPrompt(theoremTitle, statement, outline, paperTitle) {
    const defs = outline.definitions.slice(0, 6).map(d => '- ' + d).join('\n');
    const supp = outline.supporting.slice(0, 5).map(r => '- ' + (r.title || r.id) + ': ' + (r.content || '')).join('\n');
    return [
        'You are assisting a referee reviewing a mathematical paper.',
        'Return three labeled sections in this exact order with clear, concise paragraphs:',
        '1) Clarity — comment on exposition, notation, readability; reference definitions or notations from the outline if helpful.',
        '2) Soundness — discuss correctness as far as can be judged using the statement and outline; when making a claim, briefly cite which supporting result/definition it depends on.',
        '3) Suggestions for Improvement — concrete, actionable recommendations to improve clarity, rigor, or structure.',
        '',
        'Paper: ' + paperTitle,
        'Theorem: ' + theoremTitle,
        'Statement: ' + statement,
        defs ? ('Key definitions/notations (subset):\n' + defs) : '',
        supp ? ('Supporting results (subset):\n' + supp) : ''
    ].filter(Boolean).join('\n\n');
}

function callOpenAI(prompt) {
    const apiKey = getApiKey();
    if (!apiKey) return Promise.reject(new Error('Missing API key. Click the AI Key button (in distilled view) to set it, then return.'));
    return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            messages: [
                { role: 'system', content: 'You are a careful, conservative mathematical assistant. Be precise, avoid speculation; if unsure, say so explicitly. Use brief LaTeX inline when appropriate.' },
                { role: 'user', content: prompt }
            ]
        })
    }).then(resp => {
        if (!resp.ok) return resp.json().then(err => { throw new Error('HTTP ' + resp.status + ' ' + (err && err.error && err.error.message || resp.statusText)); });
        return resp.json();
    }).then(data => String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim());
}

function parseAIReplyToSections(text) {
    // very lightweight parser that looks for section keywords
    const result = { clarity: '', soundness: '', suggestions: '' };
    const lines = String(text || '').split(/\n+/);
    let current = 'clarity';
    function push(acc, line) { acc[current] = (acc[current] ? acc[current] + '\n' : '') + line; }
    for (const raw of lines) {
        const line = raw.trim();
        const l = line.toLowerCase();
        if (/^\d?\s*clarity/.test(l) || /^clarity/.test(l)) { current = 'clarity'; continue; }
        if (/^\d?\s*soundness/.test(l) || /^soundness/.test(l)) { current = 'soundness'; continue; }
        if (/^\d?\s*suggestions/.test(l) || /^suggestions/.test(l)) { current = 'suggestions'; continue; }
        push(result, raw);
    }
    // Trim
    Object.keys(result).forEach(k => { result[k] = (result[k] || '').trim(); });
    return result;
}

function renderProgressDots(container, items, currentIndex) {
    const dots = items.map((it, i) => {
        const cls = ['rv-dot'];
        if (i === currentIndex) cls.push('active');
        if (it.status === 'done') cls.push('done');
        if (it.status === 'skipped') cls.push('skipped');
        if (it.selectedForReport) cls.push('selected');
        return `<span class="${cls.join(' ')}" data-index="${i}" title="${it.title}"></span>`;
    }).join('');
    container.innerHTML = dots;
}

export function createReviewController(state, processedData) {
    const paperTitle = document.querySelector('.header h1')?.textContent || document.title || 'Paper';
    const paperId = inferPaperId();
    let review = loadSavedReview(paperId);
    if (!review) {
        review = { items: buildItemsFromData(processedData), currentIndex: 0, filters: { types: ['theorem'] }, report: { tone: 'balanced', length: 'medium', template: 'generic', narrative: '', appendix: [] } };
    } else {
        // normalize defaults
        review.items = (review.items || []).map(it => Object.assign({ includeInReport: true, selectedForReport: false }, it));
        review.report = Object.assign({ tone: 'balanced', length: 'medium', template: 'generic', narrative: '', appendix: [] }, review.report || {});
    }

    // Overlay root (created on demand)
    let overlay = null;

    function closeOverlay() {
        if (overlay) { overlay.remove(); overlay = null; }
    }

    function persist() { saveReview(paperId, review); }

    function goto(index) {
        review.currentIndex = clamp(index, 0, review.items.length - 1);
        persist();
        renderStep();
    }

    function markStatus(status) {
        const it = review.items[review.currentIndex];
        it.status = status;
        it.editedAt = Date.now();
        persist();
    }

    function setField(field, value) {
        const it = review.items[review.currentIndex];
        it[field] = value;
        it.editedAt = Date.now();
        persist();
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'review-overlay';
        overlay.innerHTML = `
      <div class="rv-wrap">
        <header class="rv-header">
          <div class="rv-left">
            <h2 class="rv-title">Review: ${paperTitle}</h2>
          </div>
          <div class="rv-center"><div id="rv-progress"></div><button class="rv-btn rv-primary" id="rv-open-report-top">Report</button></div>
          <div class="rv-right">
            <button class="rv-btn" id="rv-exit">Exit</button>
          </div>
        </header>
        <main class="rv-main">
          <div id="rv-content"></div>
        </main>
      </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#rv-exit').addEventListener('click', () => { api.exit(); });
        const reportTopBtn = overlay.querySelector('#rv-open-report-top');
        if (reportTopBtn) reportTopBtn.addEventListener('click', () => { renderSummary(); });
        return overlay;
    }

    // ===================== Composer (3-pane) =====================
    function renderComposer() {
        ensureOverlay();
        const content = overlay.querySelector('#rv-content');
        // Ensure header controls visible on Composer
        const prog = overlay.querySelector('#rv-progress');
        const reportTopBtn = overlay.querySelector('#rv-open-report-top');
        if (reportTopBtn) reportTopBtn.style.display = '';
        if (prog) {
            prog.style.display = '';
            renderProgressDots(prog, review.items, review.currentIndex);
            prog.addEventListener('click', (e) => {
                const t = e.target.closest && e.target.closest('.rv-dot');
                if (!t) return;
                const i = parseInt(t.getAttribute('data-index'), 10);
                if (Number.isFinite(i)) goto(i);
            }, { once: true });
        }

        // Build list items HTML
        const itemsHtml = review.items.map((it, idx) => `
          <div class="rv-compose-item" data-index="${idx}">
            <button type="button" class="rv-item-btn" data-index="${idx}">${it.title}</button>
            <label class="rv-inc-wrap"><input type="checkbox" class="rv-inc" data-index="${idx}" ${it.includeInReport !== false ? 'checked' : ''}/> Include</label>
          </div>`).join('');

        const headerHtml = `
          <div class="rv-compose-header">
            <div class="left">
              <strong>Composer</strong> — ${review.items.filter(i => i.includeInReport !== false).length} included
            </div>
            <div class="right">
              <button class="rv-btn rv-primary" id="rv-compose-ai">Compose report</button>
              <button class="rv-btn" id="rv-back-summary">Back to Summary</button>
            </div>
          </div>`;

        content.innerHTML = `
          <section class="rv-composer">
            ${headerHtml}
            <div class="rv-compose-grid">
              <aside class="rv-compose-left" id="rv-compose-left">${itemsHtml || '<div class="rv-muted">No items</div>'}</aside>
              <main class="rv-compose-editor" id="rv-report-editor" contenteditable="true">${review.report.narrative || '<p class=\'rv-muted\'>Click Compose report to draft a narrative from your notes, or start typing…</p>'}</main>
              <aside class="rv-compose-right" id="rv-compose-right"><div class="rv-muted">Select a theorem on the left to view its notes here.</div></aside>
            </div>
          </section>`;

        // Wire controls
        const q = sel => content.querySelector(sel);
        q('#rv-back-summary').addEventListener('click', () => renderSummary());
        q('#rv-compose-left').addEventListener('change', (e) => {
            const t = e.target.closest && e.target.closest('.rv-inc');
            if (!t) return;
            const i = Number(t.getAttribute('data-index'));
            if (!Number.isFinite(i)) return;
            review.items[i].includeInReport = t.checked;
            persist();
        });
        q('#rv-compose-left').addEventListener('click', (e) => {
            // ignore clicks on include checkbox
            if (e.target.closest && e.target.closest('.rv-inc')) return;
            const btn = e.target.closest && (e.target.closest('.rv-item-btn') || e.target.closest('.rv-compose-item'));
            if (!btn) return;
            const idx = Number(btn.getAttribute('data-index') || (btn.closest('.rv-compose-item') && btn.closest('.rv-compose-item').getAttribute('data-index')));
            if (!Number.isFinite(idx)) return;
            const it = review.items[idx];
            const right = q('#rv-compose-right');
            right.innerHTML = `
              <div class="rv-note-block"><h4>${it.title}</h4>
                <div><strong>Clarity</strong><div class="rv-note">${it.clarity || '<em class=\'rv-muted\'>—</em>'}</div></div>
                <div><strong>Soundness</strong><div class="rv-note">${it.soundness || '<em class=\'rv-muted\'>—</em>'}</div></div>
                <div><strong>Suggestions</strong><div class="rv-note">${it.suggestions || '<em class=\'rv-muted\'>—</em>'}</div></div>
              </div>`;
            // mark active
            content.querySelectorAll('.rv-compose-item').forEach(el => el.classList.remove('active'));
            const row = content.querySelector(`.rv-compose-item[data-index='${idx}']`);
            if (row) row.classList.add('active');
        });

        q('#rv-report-editor').addEventListener('input', () => { review.report.narrative = q('#rv-report-editor').innerHTML; persist(); });
        q('#rv-compose-ai').addEventListener('click', () => composeReport());
    }

    function composeReport() {
        // If API key set, ask AI; else local composition fallback
        if (getApiKey()) return composeReportAI();
        return composeReportLocal();
    }

    function composeReportLocal() {
        const included = review.items.filter(it => it.includeInReport !== false);
        const parts = [];
        parts.push(`<p><strong>Summary.</strong> This report addresses ${included.length} results in the paper. The remarks below aggregate clarity, soundness, and suggestions gathered during theorem-by-theorem review.</p>`);
        included.forEach(it => {
            const lines = [];
            if (it.clarity) lines.push(`<em>Clarity:</em> ${it.clarity}`);
            if (it.soundness) lines.push(`<em>Soundness:</em> ${it.soundness}`);
            if (it.suggestions) lines.push(`<em>Suggestions:</em> ${it.suggestions}`);
            if (lines.length) parts.push(`<p><strong>${it.title}.</strong> ${lines.join(' ')}</p>`);
        });
        review.report.narrative = parts.join('\n');
        persist();
        const editor = overlay.querySelector('#rv-report-editor');
        if (editor) editor.innerHTML = review.report.narrative;
    }

    function composeReportAI() {
        const included = review.items.filter(it => it.includeInReport !== false);
        const bullet = included.map(it => `- ${it.title}\n  Clarity: ${it.clarity || '-'}\n  Soundness: ${it.soundness || '-'}\n  Suggestions: ${it.suggestions || '-'}`).join('\n');
        const ask = [
            'You are drafting a concise, professional referee report.',
            `Tone: ${review.report.tone}. Length: ${review.report.length}. Template: ${review.report.template}.`,
            'Write a coherent narrative that synthesizes the points below (do not restate theorem statements).',
            'Close with an overall assessment and concrete recommendations. Use cautious language when appropriate.',
            'Per-theorem notes:',
            bullet
        ].join('\n\n');
        const content = overlay.querySelector('#rv-content');
        const spinner = document.createElement('div'); spinner.className = 'rv-spinner'; spinner.textContent = 'Composing…'; content.appendChild(spinner);
        callOpenAI(ask).then(text => {
            review.report.narrative = text || '';
            persist();
            const editor = overlay.querySelector('#rv-report-editor');
            if (editor) editor.innerHTML = review.report.narrative.replace(/\n/g, '<br>');
        }).catch(e => alert(e.message || String(e))).finally(() => spinner.remove());
    }

    function renderStep() {
        ensureOverlay();
        const content = overlay.querySelector('#rv-content');
        const prog = overlay.querySelector('#rv-progress');
        const reportTopBtn = overlay.querySelector('#rv-open-report-top');
        if (reportTopBtn) reportTopBtn.style.display = '';
        if (prog) {
            prog.style.display = '';
            renderProgressDots(prog, review.items, review.currentIndex);
            prog.addEventListener('click', (e) => {
                const t = e.target.closest && e.target.closest('.rv-dot');
                if (!t) return;
                const i = parseInt(t.getAttribute('data-index'), 10);
                if (Number.isFinite(i)) goto(i);
            }, { once: true });
        }

        const it = review.items[review.currentIndex];
        const outline = buildProofOutline(it.nodeId, processedData, 2);

        const aiButtons = getApiKey() ? '' : '<div class="rv-warn">No API key set. Open the Distilled view and click AI Key to set it.</div>';

        content.innerHTML = `
      <section class="rv-step">
        <div class="rv-step-header" style="justify-content:center;">
          <div class="rv-step-center" style="display:flex; align-items:center; gap:12px;">
            <button class="rv-btn" id="rv-prev-theorem">◀</button>
            <div class="rv-step-title">${it.title}</div>
            <button class="rv-btn" id="rv-toggle-report">Add to report</button>
            <button class="rv-btn rv-primary" id="rv-next-theorem">▶</button>
          </div>
        </div>
        <div class="rv-panels">
          <div class="rv-col">
            <div class="rv-left-scroll">
              <h3>Statement</h3>
              <div class="math-content rv-statement">${it.statement || '<em>No statement available.</em>'}</div>
              <h3>Proof outline</h3>
              <div class="rv-outline">
                ${outline.definitions && outline.definitions.length ? `<h4>Key definitions/notations</h4><ul class="rv-list">${outline.definitions.map(d => `<li class="math-content">${d}</li>`).join('')}</ul>` : '<p class="rv-muted">No explicit definitions found in prerequisites.</p>'}
                ${outline.supporting && outline.supporting.length ? `<h4>Supporting results</h4>${outline.supporting.map(r => `<div class="rv-support"><div class="rv-support-title">${r.title}</div><div class="math-content rv-support-content">${r.content}</div></div>`).join('')}` : '<p class="rv-muted">No immediate supporting results found.</p>'}
              </div>
            </div>
          </div>
          <div class="rv-col">
            <h3>Clarity</h3>
            <div class="rv-edit" contenteditable="true" id="rv-clarity">${it.clarity || ''}</div>
            <h3>Soundness</h3>
            <div class="rv-edit" contenteditable="true" id="rv-soundness">${it.soundness || ''}</div>
            <h3>Suggestions for Improvement</h3>
            <div class="rv-edit" contenteditable="true" id="rv-suggestions">${it.suggestions || ''}</div>
            <div class="rv-ai-controls">
              ${aiButtons}
            </div>
          </div>
        </div>
      </section>`;

        function bindEdits(id, field) {
            const el = content.querySelector(id);
            if (!el) return;
            el.addEventListener('input', () => setField(field, el.innerHTML));
        }
        bindEdits('#rv-clarity', 'clarity');
        bindEdits('#rv-soundness', 'soundness');
        bindEdits('#rv-suggestions', 'suggestions');

        const prevBtn = content.querySelector('#rv-prev-theorem');
        if (prevBtn) prevBtn.onclick = () => { markStatus('done'); goto(review.currentIndex - 1); };
        const nextBtn = content.querySelector('#rv-next-theorem');
        if (nextBtn) nextBtn.onclick = () => { markStatus('done'); goto(review.currentIndex + 1); };

        // Toggle add/remove to report
        const toggleBtn = content.querySelector('#rv-toggle-report');
        if (toggleBtn) {
            const refresh = () => { toggleBtn.textContent = it.selectedForReport ? 'Remove from report' : 'Add to report'; };
            refresh();
            toggleBtn.onclick = () => { it.selectedForReport = !it.selectedForReport; persist(); refresh(); };
        }

        // Auto-generate if empty and key present
        if (getApiKey() && (!it.clarity && !it.soundness && !it.suggestions)) {
            doGenerateAll(it, outline);
        }

        typesetMath(content);
    }

    function aiSectionPrompt(mode, theoremTitle, statement, outline, paperTitle) {
        const defs = outline.definitions.slice(0, 6).map(d => '- ' + d).join('\n');
        const supp = outline.supporting.slice(0, 5).map(r => '- ' + (r.title || r.id) + ': ' + (r.content || '')).join('\n');
        const header = [
            'Paper: ' + paperTitle,
            'Theorem: ' + theoremTitle,
            'Statement: ' + statement,
            defs ? ('Key definitions/notations (subset):\n' + defs) : '',
            supp ? ('Supporting results (subset):\n' + supp) : ''
        ].filter(Boolean).join('\n');
        if (mode === 'clarity') {
            return header + '\n\nTask: Provide a concise referee comment on CLARITY (exposition, notation, readability). Use 3–6 sentences; reference definitions/notations from the outline if helpful. Output plain text only.';
        }
        if (mode === 'soundness') {
            return header + '\n\nTask: Provide a concise referee comment on SOUNDNESS (correctness/rigor as can be judged from the statement and outline). Use 3–6 sentences; where appropriate, cite which supporting result/definition your claim relies on. Output plain text only.';
        }
        // suggestions
        return header + '\n\nTask: Provide concrete, actionable SUGGESTIONS FOR IMPROVEMENT (clarity, rigor, structure). Use bullet-like short paragraphs (but output as plain text lines). Output plain text only.';
    }

    function generateSection(mode, item, outline) {
        const prompt = aiSectionPrompt(mode, item.title, item.statement, outline, paperTitle);
        return callOpenAI(prompt).then(text => String(text || '').trim());
    }

    function doGenerateAll(item, outline) {
        const content = overlay && overlay.querySelector('#rv-content');
        const spinner = document.createElement('div');
        spinner.className = 'rv-spinner'; spinner.textContent = 'Getting AI review…';
        content && content.appendChild(spinner);

        // Parallelize the three sections; update each as it completes.
        const pClarity = generateSection('clarity', item, outline).then(text => {
            item.clarity = text || item.clarity;
            const el = overlay.querySelector('#rv-clarity'); if (el) el.innerHTML = item.clarity;
            persist();
        });
        const pSound = generateSection('soundness', item, outline).then(text => {
            item.soundness = text || item.soundness;
            const el = overlay.querySelector('#rv-soundness'); if (el) el.innerHTML = item.soundness;
            persist();
        });
        const pSug = generateSection('suggestions', item, outline).then(text => {
            item.suggestions = text || item.suggestions;
            const el = overlay.querySelector('#rv-suggestions'); if (el) el.innerHTML = item.suggestions;
            persist();
        });

        Promise.allSettled([pClarity, pSound, pSug])
            .then(() => {
                item.status = 'done';
                try { typesetMath(overlay.querySelector('#rv-content')); } catch (_) { }
            })
            .catch((e) => { alert(e.message || String(e)); })
            .finally(() => { spinner.remove(); });
    }

    function renderSummary() {
        ensureOverlay();
        const content = overlay.querySelector('#rv-content');
        const prog = overlay.querySelector('#rv-progress');
        const reportTopBtn = overlay.querySelector('#rv-open-report-top');
        if (prog) { prog.style.display = 'none'; prog.innerHTML = ''; }
        if (reportTopBtn) { reportTopBtn.style.display = 'none'; }

        const selectedItems = review.items.filter(it => it.selectedForReport);
        const txt = buildSummaryTxt(paperTitle, selectedItems);
        const tex = buildSummaryLatex(paperTitle, selectedItems);

        content.innerHTML = `
      <section class="rv-summary">
        <div class="rv-step-header">
          <div class="rv-step-title">Report</div>
          <div class="rv-step-actions">
            <button class="rv-btn" id="rv-back-to-first">Back to Theorems</button>
            <button class="rv-btn" id="rv-reset">Reset review</button>
          </div>
        </div>
        <div class="rv-summary-actions">
          <button class="rv-btn rv-primary" id="rv-add-summary">Add summary</button>
          <button class="rv-btn" id="rv-copy">Copy to clipboard</button>
          <button class="rv-btn" id="rv-dl-txt">Download .txt</button>
          <button class="rv-btn" id="rv-dl-tex">Download .tex</button>
        </div>
        <div class="rv-muted">Selected theorems: ${selectedItems.length}</div>
        <div class="rv-edit" id="rv-summary-editor" contenteditable="true">${txt.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/\n/g, '<br>')}</div>
      </section>`;

        const toText = () => {
            const html = content.querySelector('#rv-summary-editor').innerHTML || '';
            const div = document.createElement('div'); div.innerHTML = html;
            const text = div.innerText.replace(/\u00A0/g, ' ');
            return text;
        };

        // Add summary: prepend AI narrative based on selected items
        const genBtn = content.querySelector('#rv-add-summary');
        if (genBtn) genBtn.onclick = () => {
            const included = review.items.filter(it => it.selectedForReport);
            const notes = included.map(it => ({ title: it.title, clarity: it.clarity, soundness: it.soundness, suggestions: it.suggestions }));
            const editorEl = content.querySelector('#rv-summary-editor');
            const spinner = document.createElement('div'); spinner.className = 'rv-spinner'; spinner.textContent = 'Generating summary…'; content.appendChild(spinner);

            function setEditor(narrative) {
                const current = editorEl.innerHTML || '';
                const summary = `<p>${(narrative || '').replace(/\n/g, '<br>')}</p><hr>`;
                editorEl.innerHTML = summary + current;
            }

            const prompt = [
                'You are drafting the opening paragraphs of a referee report that synthesizes the notes below. Do not restate theorem statements; provide a coherent, high-level assessment and key recommendations. Keep it concise and professional.',
                'Notes:',
                notes.map(n => `- ${n.title}\n  Clarity: ${n.clarity || '-'}\n  Soundness: ${n.soundness || '-'}\n  Suggestions: ${n.suggestions || '-'}`).join('\n')
            ].join('\n\n');

            if (getApiKey()) {
                callOpenAI(prompt).then(text => setEditor(text || '')).catch(e => alert(e.message || String(e))).finally(() => spinner.remove());
            } else {
                const first = notes.slice(0, 3).map(n => n.title).join(', ');
                const narrative = `This report summarizes findings across ${notes.length} results (e.g., ${first}). Overall clarity and soundness are discussed below.`;
                setEditor(narrative);
                spinner.remove();
            }
        };

        content.querySelector('#rv-dl-txt').onclick = () => downloadBlob(toText(), 'text/plain', sanitizeFilename(paperTitle) + '-review.txt');
        content.querySelector('#rv-dl-tex').onclick = () => downloadBlob(buildSummaryLatex(paperTitle, review.items), 'text/x-tex', sanitizeFilename(paperTitle) + '-review.tex');
        content.querySelector('#rv-copy').onclick = async () => { try { await navigator.clipboard.writeText(toText()); } catch (_) { } };
        content.querySelector('#rv-back-to-first').onclick = () => { goto(0); };
        content.querySelector('#rv-reset').onclick = () => {
            if (!confirm('Reset the current review? This will clear all AI text and edits.')) return;
            review = { items: buildItemsFromData(processedData), currentIndex: 0, filters: { types: ['theorem'] } };
            persist();
            renderStep();
        };
    }

    const api = {
        enter(startId) {
            ensureOverlay();
            // If a startId is provided, go to that theorem index
            if (startId) {
                const idx = review.items.findIndex(it => it.nodeId === startId);
                if (idx >= 0) review.currentIndex = idx;
            }
            persist();
            renderStep();
            // Shortcuts
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); goto(review.currentIndex - 1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); goto(review.currentIndex + 1); }
                if (e.key.toLowerCase() === 's') { e.preventDefault(); markStatus('skipped'); goto(review.currentIndex + 1); }
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); markStatus('done'); goto(review.currentIndex + 1); }
            }, { once: true });
        },
        exit() {
            closeOverlay();
        },
        get state() { return review; }
    };

    return api;
}
