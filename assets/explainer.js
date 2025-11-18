(function () {
    try { console.log('[Explainer] script loaded'); } catch (_) { }
    // Parse model data embedded as JSON in the page
    var model = null;
    try {
        var dataEl = document.getElementById('distill-data');
        if (dataEl) model = JSON.parse(dataEl.textContent || '{}');
    } catch (e) { console.error('[Explainer] Failed to parse model JSON:', e); }

    // Elements
    var menu = document.getElementById('explainer-menu');
    var setKeyBtn = document.getElementById('set-api-key');

    // Ensure menu is attached to body and positioned fixed
    try {
        if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
        if (menu && window.getComputedStyle(menu).position !== 'fixed') menu.style.position = 'fixed';
    } catch (e) { }

    function getApiKey() {
        try { return localStorage.getItem('openai_api_key') || ''; } catch (_) { return ''; }
    }
    function setApiKey(k) {
        try {
            if (!k) localStorage.removeItem('openai_api_key');
            else localStorage.setItem('openai_api_key', String(k).trim());
        } catch (_) { }
    }

    // API key modal helpers (modal markup is provided by the page)
    window.showKeyModal = function () {
        try {
            var modal = document.getElementById('key-modal');
            var input = document.getElementById('key-input');
            if (!modal || !input) return;
            input.value = getApiKey();
            modal.style.display = 'flex';
            setTimeout(function () { try { input.focus(); } catch (_) { } }, 0);
        } catch (e) { console.error(e); }
    };
    window.hideKeyModal = function () {
        var modal = document.getElementById('key-modal');
        if (modal) modal.style.display = 'none';
    };
    function keySave() {
        var input = document.getElementById('key-input');
        var v = input && input.value ? input.value.trim() : '';
        setApiKey(v);
        var btn = document.getElementById('set-api-key');
        if (btn) btn.title = v ? 'API key saved' : 'Set OpenAI API key';
        window.hideKeyModal();
    }
    (function wireKeyModal() {
        var elSave = document.getElementById('key-save'); if (elSave) elSave.addEventListener('click', keySave);
        var elCancel = document.getElementById('key-cancel'); if (elCancel) elCancel.addEventListener('click', window.hideKeyModal);
        var elInput = document.getElementById('key-input'); if (elInput) elInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') keySave(); if (e.key === 'Escape') window.hideKeyModal(); });
        if (setKeyBtn) setKeyBtn.addEventListener('click', window.showKeyModal);
    })();

    function hideMenu() { if (menu) { menu.style.display = 'none'; menu.innerHTML = ''; } }

    function buildMenu(x, y, onPick) {
        try { console.log('[Explainer] buildMenu at', x, y); } catch (_) { }
        if (!menu) return;
        var items = [
            { mode: 'simplify', label: 'Explain this in simpler terms' },
            { mode: 'intuition', label: 'What is the key intuition here?' },
            { mode: 'expand', label: 'Expand this step' }
        ];
        var html = '';
        for (var i = 0; i < items.length; i++) html += '<button data-mode="' + items[i].mode + '">' + items[i].label + '</button>';
        menu.innerHTML = html;
        var left = Math.max(8, Math.min(window.innerWidth - 260, x));
        // Show first so offsetHeight is available, then clamp Y within viewport
        menu.style.display = 'block';
        var mh = menu.offsetHeight || 140; // fallback
        var top = Math.max(8, Math.min(window.innerHeight - mh - 8, y));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        var buttons = menu.querySelectorAll('button');
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].addEventListener('click', function () { var m = this.getAttribute('data-mode'); hideMenu(); onPick(m); });
        }
    }

    function getSelectionInfo() {
        var sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.isCollapsed) return null;
        var text = String(sel.toString()).trim();
        if (!text || text.length < 2) return null;
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        if ((!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) && typeof range.getClientRects === 'function') {
            var list = range.getClientRects(); if (list && list.length) rect = list[0];
        }
        return { sel: sel, range: range, rect: rect, text: text };
    }

    function findBlockElement(node) {
        function isBlock(el) {
            if (!el) return false;
            if (el.classList && (el.classList.contains('math-content') || el.classList.contains('result-item') || el.classList.contains('def-item') || el.classList.contains('target-item'))) return true;
            var tag = el.tagName || '';
            return ['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'LI', 'OL', 'UL'].indexOf(tag) !== -1;
        }
        var el = node;
        while (el && el !== document.body && !isBlock(el)) el = el.parentElement;
        return el || document.body;
    }

    function nearestInsertionPoint(range) {
        var container = range.commonAncestorContainer && range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        return findBlockElement(container);
    }

    function insertExplainerCard(blockEl, title) {
        var card = document.createElement('div');
        card.className = 'explainer-card';
        card.innerHTML = ''
            + '<header>'
            + '<div class="title">AI explanation — ' + title + '</div>'
            + '<div class="actions">'
            + '<button data-act="copy">Copy</button>'
            + '<button data-act="regen">Regenerate</button>'
            + '<button data-act="remove">Remove</button>'
            + '</div>'
            + '</header>'
            + '<div class="content math-content"><em>Working…</em></div>';
        blockEl.insertAdjacentElement('afterend', card);
        return card;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&', '<': '<', '>': '>' })[c]; });
    }

    function typesetMath(el) { try { if (window.MathJax && window.MathJax.typesetPromise) return window.MathJax.typesetPromise([el]); } catch (e) { } return Promise.resolve(); }

    function openaiExplain(payload) {
        return new Promise(function (resolve, reject) {
            var apiKey = getApiKey();
            if (!apiKey) { reject(new Error('Missing API key. Click the gear button to set it.')); return; }
            var sys = 'You are The Explainer for mathematical content. Be precise and correct; preserve meaning; include small LaTeX where helpful; avoid fabrications; if unsure, say so.';
            var parts = [];
            parts.push('Mode: ' + payload.mode);
            parts.push('Selection: ' + payload.selection);
            if (payload.localContext) parts.push('Local context: ' + payload.localContext);
            if (payload.target) parts.push('Target: ' + (payload.target.title || '') + ': ' + (payload.target.content || ''));
            if (payload.definitions && payload.definitions.length) parts.push('Definitions (subset):\n- ' + payload.definitions.slice(0, 6).join('\n- '));
            if (payload.supporting && payload.supporting.length) parts.push('Supporting (subset):\n- ' + payload.supporting.slice(0, 3).map(function (r) { return (r.title || '') + ': ' + (r.content || ''); }).join('\n- '));
            var prompt = parts.join('\n\n');

            fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.2,
                    messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }]
                })
            }).then(function (resp) {
                if (!resp.ok) return resp.json().then(function (err) { throw new Error('HTTP ' + resp.status + ' ' + (err && err.error && err.error.message || resp.statusText)); });
                return resp.json();
            }).then(function (data) {
                var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
                resolve(String(text).trim());
            }).catch(reject);
        });
    }

    function handleAction(mode, selInfo) {
        var block = nearestInsertionPoint(selInfo.range);
        var card = insertExplainerCard(block, mode === 'simplify' ? 'Simpler terms' : (mode === 'intuition' ? 'Key intuition' : 'Expanded step'));
        var contentEl = card.querySelector('.content');
        var ctxEl = findBlockElement(selInfo.range.commonAncestorContainer);
        var ctxText = (ctxEl && typeof ctxEl.innerText === 'string') ? ctxEl.innerText : '';
        var localContext = ctxText ? ctxText.trim().slice(0, 4000) : '';

        var defs = (model && model.definitions) ? model.definitions.slice(0, 6) : [];
        var supp = (model && model.supporting) ? model.supporting.slice(0, 3) : [];
        var payload = { mode: mode, selection: selInfo.text.slice(0, 4000), localContext: localContext, target: model && model.target, definitions: defs, supporting: supp };

        function doExplain() {
            contentEl.innerHTML = '<em>Working…</em>';
            openaiExplain(payload).then(function (reply) {
                contentEl.innerHTML = '<div>' + reply + '</div>';
                return typesetMath(contentEl);
            }).catch(function (e) {
                contentEl.innerHTML = '<span style="color:#c00">' + escapeHtml(e.message || String(e)) + '</span>';
            });
        }

        doExplain();

        var actions = card.querySelector('.actions');
        actions.addEventListener('click', function (evt) {
            var act = evt.target.getAttribute('data-act');
            if (act === 'remove') card.remove();
            if (act === 'regen') doExplain();
            if (act === 'copy') {
                var tmp = document.createElement('textarea');
                tmp.value = contentEl.innerText || '';
                document.body.appendChild(tmp); tmp.select();
                try { document.execCommand('copy'); } catch (_) { }
                tmp.remove();
            }
        });
    }

    function onSelectionEvent() {
        var info = getSelectionInfo();
        if (!info) { hideMenu(); return; }
        var x = info.rect.left + info.rect.width / 2;
        var y = Math.max(8, info.rect.top - 10);
        buildMenu(x, y, function (mode) { handleAction(mode, info); });
    }

    // Global triggers
    document.addEventListener('mouseup', function () { setTimeout(onSelectionEvent, 30); });

    document.addEventListener('scroll', hideMenu, true);
    document.addEventListener('click', function (e) { if (menu && !menu.contains(e.target)) hideMenu(); });


    // Right-click opens the explainer for any existing selection
    window.addEventListener('contextmenu', function (e) {
        var sel = window.getSelection && window.getSelection().toString().trim();
        if (sel && sel.length >= 2) {
            e.preventDefault();
            buildMenu(e.clientX, e.clientY - 10, function (mode) { var info = getSelectionInfo(); if (info) handleAction(mode, info); });
        }
    }, { capture: true });

    // Ctrl/Cmd+E opens menu for current selection
    window.addEventListener('keydown', function (e) {
        var isShortcut = (e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.metaKey);
        if (!isShortcut) return;
        var sel = window.getSelection && window.getSelection().toString().trim();
        if (!sel || sel.length < 2) return;
        e.preventDefault();
        var info = getSelectionInfo();
        if (info) buildMenu(info.rect.left + info.rect.width / 2, Math.max(8, info.rect.top - 10), function (mode) { handleAction(mode, info); });
    });


})();
