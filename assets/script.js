// This script assumes 'graphData' is loaded globally before this script runs.

// =============================================================================
// 1. SETUP & CONFIGURATION
// =============================================================================

// Normalize dependency semantics so arrows always point prerequisite -> dependent
graphData.edges = graphData.edges.map(e => {
  const dep = e.dependency_type || "internal";
  // Collapse to 'used_in' where appropriate and enforce prereq -> dependent
  if (dep === 'uses_result') {
    // A uses_result B  =>  B used_in A
    return { ...e, dependency_type: 'used_in', source: e.target, target: e.source };
  }
  if (dep === 'uses_definition') {
    // A uses_definition B  =>  B used_in A
    return { ...e, dependency_type: 'used_in', source: e.target, target: e.source };
  }
  if (dep === 'is_corollary_of') {
    // A is_corollary_of B  =>  B used_in A (base result is prerequisite of corollary)
    return { ...e, dependency_type: 'used_in', source: e.target, target: e.source };
  }
  if (dep === 'is_generalization_of') {
    // A is_generalization_of B  =>  B generalized_by A
    return { ...e, dependency_type: 'generalized_by', source: e.target, target: e.source };
  }
  if (dep === 'provides_remark') {
    // Drop remark edges from the graph entirely
    return null;
  }
  return e;
}).filter(Boolean);

const nodeTypes = [...new Set(graphData.nodes.map(d => d.type))];
const edgeTypes = [...new Set(graphData.edges.map(d => d.dependency_type || "internal"))];

// Color Scales
const nodeColorScale = d3.scaleOrdinal(d3.schemeCategory10);
const edgeColorScale = d3.scaleOrdinal(["#999", "#d62728", "#2ca02c", "#1f77b4", "#ff7f0e", "#9467bd"]);

const nodeColors = nodeTypes.reduce((acc, type) => {
  acc[type] = nodeColorScale(type);
  return acc;
}, {});

const edgeColors = edgeTypes.reduce((acc, type) => {
  acc[type] = edgeColorScale(type);
  return acc;
}, {});

// UI Elements
const infoPanel = d3.select("#info-panel");
const infoTitle = d3.select("#info-title");
const infoBody = d3.select("#info-body");
const tooltip = d3.select("#tooltip");

// State Variables
let pinned = false;
let pinnedNode = null;
const hiddenTypes = new Set();

// Proof Path state
let proofMode = false;
let proofTargetId = null;
let proofDepth = 1;
let proofVisibleNodes = new Set();
let proofVisibleEdges = new Set(); // keys "sourceId=>targetId" in original direction


// Quick lookup maps
const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));
const outgoingEdgesBySource = new Map();
const incomingEdgesByTarget = new Map();
graphData.edges.forEach(e => {
  const s = typeof e.source === 'object' ? e.source.id : e.source;
  const t = typeof e.target === 'object' ? e.target.id : e.target;
  const dep = e.dependency_type || 'internal';
  if (!outgoingEdgesBySource.has(s)) outgoingEdgesBySource.set(s, []);
  outgoingEdgesBySource.get(s).push({ s, t, dep });
  if (!incomingEdgesByTarget.has(t)) incomingEdgesByTarget.set(t, []);
  incomingEdgesByTarget.get(t).push({ s, t, dep });
});
function edgeKey(s, t) { return `${s}=>${t}`; }

// =============================================================================
// 2. SVG INITIALIZATION
// =============================================================================

const svg = d3.select("#graph");
const width = svg.node().getBoundingClientRect().width;
const height = svg.node().getBoundingClientRect().height;

// Proof Path Controls (hidden by default; shown in Proof Path mode)
const proofControlsBar = d3.select(".graph-container")
  .insert("div", "svg")
  .attr("class", "proof-controls")
  .style("display", "none");

proofControlsBar.append("button").attr("id", "unfold-less").attr("class", "depth-btn").text("< Unfold Less");
proofControlsBar.append("button").attr("id", "unfold-more").attr("class", "depth-btn").text("Unfold More >");


// --- ADDED BACK: Define Arrowhead Markers ---
const defs = svg.append("defs");
edgeTypes.forEach(type => {
  defs.append("marker")
    .attr("id", `arrowhead-${type}`)
    .attr("viewBox", "-0 -5 10 10")
    .attr("refX", 10) // The tip of the arrow
    .attr("refY", 0)
    .attr("orient", "auto")
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", edgeColors[type]);
});

// Zoom Behavior
const zoom = d3.zoom()
  .scaleExtent([0.1, 8])
  .on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom);

// Main Group for Graph Elements
const g = svg.append("g");

// =============================================================================
// 3. FORCE SIMULATION SETUP
// =============================================================================

const nodeDegrees = new Map();
graphData.edges.forEach(edge => {
  const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
  const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
  nodeDegrees.set(sourceId, (nodeDegrees.get(sourceId) || 0) + 1);
  nodeDegrees.set(targetId, (nodeDegrees.get(targetId) || 0) + 1);
});

const radiusScale = d3.scaleSqrt()
  .domain([0, d3.max(nodeDegrees.values()) || 1])
  .range([8, 20]);

const simulation = d3.forceSimulation(graphData.nodes)
  .force("link", d3.forceLink(graphData.edges).id(d => d.id).distance(120))
  .force("charge", d3.forceManyBody().strength(-600))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(d => radiusScale(nodeDegrees.get(d.id) || 1) + 5));

// =============================================================================
// 4. RENDER GRAPH ELEMENTS
// =============================================================================

const link = g.append("g")
  .selectAll("line")
  .data(graphData.edges)
  .enter().append("line")
  .attr("class", "link")
  .attr("stroke", d => edgeColors[d.dependency_type || "internal"])
  // --- ADDED BACK: Apply the correct arrowhead to each link ---
  .attr("marker-end", d => `url(#arrowhead-${d.dependency_type || "internal"})`);

const node = g.append("g")
  .selectAll("circle")
  .data(graphData.nodes)
  .enter().append("circle")
  .attr("class", "node")
  .attr("r", d => radiusScale(nodeDegrees.get(d.id) || 1))
  .attr("fill", d => nodeColors[d.type] || '#ccc')
  .call(d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended));

const label = g.append("g")
  .selectAll("text")
  .data(graphData.nodes)
  .enter().append("text")
  .attr("class", "node-label")
  .attr("dy", d => radiusScale(nodeDegrees.get(d.id) || 1) + 12)
  .text(d => d.display_name);

// =============================================================================
// 5. EVENT HANDLERS & SIMULATION TICK
// =============================================================================

// --- Node Context Menu (PROOF PATH MODE) ---
node.on("contextmenu", (event, d) => {
  event.preventDefault();
  enterProofMode(d.id);
});

// --- Node Click (FOCUS MODE) ---
node.on("click", (event, d) => {
  event.stopPropagation();

  // In Proof Path mode, clicking nodes should NOT change graph visibility.
  // Only update the right panel (and selection ring) while keeping the current proof subgraph as-is.
  if (proofMode) {
    pinned = true;
    pinnedNode = d;
    tooltip.style("display", "none");
    node.classed("selected", n => n.id === d.id);
    updateInfoPanel(d);
    return;
  }

  pinned = true;
  pinnedNode = d;
  tooltip.style("display", "none");
  node.classed("selected", n => n.id === d.id);

  const subgraphNodes = new Set([d.id]);
  graphData.edges.forEach(edge => {
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    if (sourceId === d.id) subgraphNodes.add(targetId);
    if (targetId === d.id) subgraphNodes.add(sourceId);
  });

  node.style("display", n => subgraphNodes.has(n.id) ? null : "none");
  label.style("display", n => subgraphNodes.has(n.id) ? null : "none");
  link.style("display", l => {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    return subgraphNodes.has(sourceId) && subgraphNodes.has(targetId) ? null : "none";
  });

  updateInfoPanel(d);
});

// --- SVG Background Click (RESET MODE) ---
svg.on("click", () => {
  if (proofMode) {
    exitProofMode();
    return;
  }
  if (pinned) {
    pinned = false;
    pinnedNode = null;
    node.classed("selected", false);
    hideInfoPanel();
    updateVisibility();
  }
});

// --- Tooltip Events ---
node.on("mouseover", (event, d) => { /* ... (unchanged) ... */ });
link.on("mouseover", (event, d) => { /* ... (unchanged) ... */ });
node.on("mouseout", () => { if (!pinned) hideTooltipIfNotPinned(); });
link.on("mouseout", () => { if (!pinned) hideTooltipIfNotPinned(); });


// --- Simulation Tick (UPDATED FOR ARROWS) ---
simulation.on("tick", () => {
  // Shorten links to stop at edge of target node circle.
  link.each(function (d) {
    const sId = typeof d.source === 'object' ? d.source.id : d.source;
    const tId = typeof d.target === 'object' ? d.target.id : d.target;
    let from = d.source;
    let to = d.target;



    const targetNodeRadius = radiusScale(nodeDegrees.get(to.id) || 1);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return;

    const newX2 = to.x - (dx / distance) * (targetNodeRadius + 2); // +2 for a small gap
    const newY2 = to.y - (dy / distance) * (targetNodeRadius + 2);

    d3.select(this)
      .attr("x1", from.x)
      .attr("y1", from.y)
      .attr("x2", newX2)
      .attr("y2", newY2);
  });

  node.attr("cx", d => d.x).attr("cy", d => d.y);
  label.attr("x", d => d.x).attr("y", d => d.y);
});


// =============================================================================
// 6. LEGEND & VISIBILITY LOGIC
// =============================================================================
// (This section is unchanged and correct)

const nodeLegendContainer = d3.select("#node-legend-container");
nodeTypes.forEach(type => {
  const item = nodeLegendContainer.append("div").attr("class", "legend-item").attr("id", `legend-item-${type}`);
  item.append("div").attr("class", "legend-color").style("background-color", nodeColors[type]);
  item.append("span").text(type.charAt(0).toUpperCase() + type.slice(1));

  item.on("click", () => {
    if (pinned) return;
    if (hiddenTypes.has(type)) {
      hiddenTypes.delete(type);
      item.classed("inactive", false);
    } else {
      hiddenTypes.add(type);
      item.classed("inactive", true);
    }
    updateVisibility();
  });
});

const edgeLegendContainer = d3.select("#edge-legend-container");
edgeTypes.forEach(type => {
  const item = edgeLegendContainer.append("div").attr("class", "legend-item");
  item.append("div").attr("class", "edge-legend-line").style("background-color", edgeColors[type]);
  item.append("span").text(type.replace(/_/g, ' '));
});

function updateVisibility() {
  node.style("display", d => hiddenTypes.has(d.type) ? "none" : null);
  label.style("display", d => hiddenTypes.has(d.type) ? "none" : null);
  link.style("display", d => {
    const sType = typeof d.source === 'object' ? d.source.type : graphData.nodes.find(n => n.id === d.source).type;
    const tType = typeof d.target === 'object' ? d.target.type : graphData.nodes.find(n => n.id === d.target).type;
    const sourceVisible = !hiddenTypes.has(sType);
    const targetVisible = !hiddenTypes.has(tType);
    return sourceVisible && targetVisible ? null : "none";
  });
  if (!pinned) simulation.alpha(0.3).restart();
}


// =============================================================================
// 7. HELPER FUNCTIONS
// =============================================================================
// (This section is unchanged and correct)

function cleanLatexForDisplay(content) { /* ... */ }
function renderNodeTooltip(event, d) { /* ... */ }
function hideTooltipIfNotPinned() { /* ... */ }
function hideInfoPanel() { /* ... */ }
function updateInfoPanel(d) { /* ... */ }

// Re-add full function bodies to avoid being omitted
function cleanLatexForDisplay(content) {
  if (!content) return '';
  return content.replace(/\\label\{[^}]*\}/g, '').trim();
}

function renderNodeTooltip(event, d) {
  const finalPreview = cleanLatexForDisplay(d.content_preview || 'N/A');
  tooltip.style("display", "block")
    .html(`<h4>${d.display_name}</h4><div class="math-content">${finalPreview}</div>`)
    .style("left", (event.pageX + 15) + "px")
    .style("top", (event.pageY - 28) + "px");

  if (window.MathJax) {
    MathJax.typesetPromise([tooltip.node()]).catch(err => console.error('MathJax typesetting failed:', err));
  }
}

function hideTooltipIfNotPinned() {
  if (!pinned) {
    tooltip.style("display", "none");
  }
}

function hideInfoPanel() {
  infoPanel.classed("visible", false);
}

function updateInfoPanel(d) {
  // Title
  infoTitle.text(d.display_name);

  // Centered Explore button below the title
  const actionHTML = `
        <div class="proof-action">
            <button id="explore-proof-btn" class="depth-btn depth-btn--primary">Explore Proof Path</button>
        </div>`;

  // Unfold controls directly below when in proof mode for this node
  let controlsHTML = '';
  if (proofMode && proofTargetId === d.id) {
    controlsHTML = `
        <div class="proof-controls-inline">
            <button id="unfold-less-inline" class="depth-btn">< Unfold Less</button>
            <button id="unfold-more-inline" class="depth-btn">Unfold More ></button>
        </div>`;
  }
  // Distiller activation button (only in Proof Path mode for this target)
  let distillHTML = '';
  if (proofMode && proofTargetId === d.id) {
    distillHTML = `
        <div class="proof-action">
            <button id="generate-distill-btn" class="depth-btn depth-btn--primary">Generate Distilled Proof</button>
        </div>`;
  }

  let infoHTML = `${actionHTML}${controlsHTML}${distillHTML}<h4>Preview</h4><p class="math-content">${cleanLatexForDisplay(d.content_preview || 'N/A')}</p>`;
  if (d.prerequisites_preview) {
    infoHTML += `<h4>Prerequisites</h4><p class="math-content">${cleanLatexForDisplay(d.prerequisites_preview)}</p>`;
  }

  infoBody.html(infoHTML);
  infoPanel.classed('visible', true);

  // Wire explore button
  d3.select('#explore-proof-btn').on('click', () => enterProofMode(d.id));

  // Wire inline controls if present
  if (document.getElementById('unfold-less-inline')) {
    d3.select('#unfold-less-inline').on('click', () => { if (!proofMode) return; proofDepth = Math.max(1, proofDepth - 1); recomputeProofSubgraph(); updateInfoPanel(nodeById.get(proofTargetId)); });
    d3.select('#unfold-more-inline').on('click', () => { if (!proofMode) return; proofDepth = Math.min(getMaxPrereqDepth(proofTargetId), proofDepth + 1); recomputeProofSubgraph(); updateInfoPanel(nodeById.get(proofTargetId)); });

  }

  // Wire Distiller button if present
  if (document.getElementById('generate-distill-btn')) {
    d3.select('#generate-distill-btn').on('click', () => {
      if (!proofMode) return;
      // Update the URL to reflect distilled view context
      setDistillUrlState(proofTargetId, proofDepth);
      const model = buildDistillModel();
      renderDistilledWindow(model);
    });
  }

  if (window.MathJax) {
    MathJax.typesetPromise([infoBody.node()]).catch(err => console.error(err));
  }
}

d3.select("#close-info-panel").on("click", hideInfoPanel);

function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// =============================================================================
// 8. PROOF PATH MODE FUNCTIONS
// =============================================================================

function getMaxPrereqDepth(startId) {
  const visited = new Set([startId]);
  let frontier = [startId];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      const outs = outgoingEdgesBySource.get(id) || [];
      for (const { t } of outs) {
        if (!visited.has(t)) {
          visited.add(t);
          next.push(t);
        }
      }
    }
    if (next.length === 0) break;
    depth += 1;
    frontier = next;
  }
  return depth;
}

function recomputeProofSubgraph() {
  proofVisibleNodes = new Set([proofTargetId]);
  proofVisibleEdges = new Set();

  let frontier = [proofTargetId];
  let level = 0;
  while (level < proofDepth && frontier.length) {
    const next = [];
    for (const id of frontier) {
      const ins = incomingEdgesByTarget.get(id) || [];
      for (const { s, t, dep } of ins) {
        // Exclude 'generalized_by' from Proof Path
        if (dep === 'generalized_by') continue;
        proofVisibleNodes.add(s);
        const key = edgeKey(s, t);
        proofVisibleEdges.add(key);
        next.push(s);
      }
    }
    level += 1;
    frontier = next;
  }
  applyProofVisibility();
}

function applyProofVisibility() {
  node.style("display", d => proofVisibleNodes.has(d.id) ? null : "none");
  label.style("display", d => proofVisibleNodes.has(d.id) ? null : "none");
  link.style("display", l => {
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    return proofVisibleEdges.has(edgeKey(sId, tId)) ? null : "none";
  });
  simulation.alpha(0.3).restart();
}

function enterProofMode(targetId) {
  proofMode = true;
  proofTargetId = targetId;
  proofDepth = 1;
  pinned = true;
  pinnedNode = nodeById.get(targetId) || null;
  hideTooltipIfNotPinned();
  node.classed("selected", n => n.id === targetId);
  d3.select(".proof-controls").style("display", "none");
  recomputeProofSubgraph();
  if (nodeById.has(targetId)) updateInfoPanel(nodeById.get(targetId));
}

function exitProofMode() {
  proofMode = false;
  proofTargetId = null;
  proofVisibleNodes = new Set();
  proofVisibleEdges = new Set();

  d3.select(".proof-controls").style("display", "none");
  pinned = false;
  pinnedNode = null;
  node.classed("selected", false);
  hideInfoPanel();
  // Clear distilled state from URL when leaving proof mode
  clearDistillUrlState();
  updateVisibility();
}

// Wire up proof control buttons
if (document.getElementById('unfold-less')) {
  d3.select('#unfold-less').on('click', () => { if (!proofMode) return; proofDepth = Math.max(1, proofDepth - 1); recomputeProofSubgraph(); });
  d3.select('#unfold-more').on('click', () => { if (!proofMode) return; proofDepth = Math.min(getMaxPrereqDepth(proofTargetId), proofDepth + 1); recomputeProofSubgraph(); });

}

// Initialize distilled state from URL on load and on history navigation
function initFromUrl() {
  try {
    const url = new URL(window.location.href);
    const distilled = url.searchParams.get('distilled');
    const target = url.searchParams.get('target');
    const depthStr = url.searchParams.get('depth');
    if (distilled === '1' && target && nodeById.has(target)) {
      enterProofMode(target);
      let depth = parseInt(depthStr || '1', 10);
      if (!Number.isFinite(depth) || depth < 1) depth = 1;
      depth = Math.min(getMaxPrereqDepth(target), depth);
      proofDepth = depth;
      recomputeProofSubgraph();
      if (nodeById.has(target)) updateInfoPanel(nodeById.get(target));
      const model = buildDistillModel();
      renderDistilledWindow(model);
    }
  } catch (e) { /* no-op */ }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFromUrl);
} else {
  initFromUrl();
}
window.addEventListener('popstate', initFromUrl);

// =============================================================================
// 9. THE DISTILLER: BUILD MODEL, SORT, AND RENDER NEW TAB
// =============================================================================

function normalizeTextForDedupe(str) {
  if (!str) return '';
  return cleanLatexForDisplay(str)
    .replace(/\label\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function topoSort(nodeIds, edges) {
  const adj = new Map(nodeIds.map(id => [id, []]));
  const indeg = new Map(nodeIds.map(id => [id, 0]));

  edges.forEach(([u, v]) => {
    if (!adj.has(u) || !indeg.has(v)) return;
    adj.get(u).push(v);
    indeg.set(v, (indeg.get(v) || 0) + 1);
  });

  const queue = [];
  indeg.forEach((deg, id) => { if (deg === 0) queue.push(id); });

  const order = [];
  while (queue.length) {
    const u = queue.shift();
    order.push(u);
    for (const v of adj.get(u) || []) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }

  if (order.length !== nodeIds.length) {
    // Fallback: append any missing nodes preserving initial order
    const seen = new Set(order);
    for (const id of nodeIds) if (!seen.has(id)) order.push(id);
  }
  return order;
}

// Reflect distilled context in the URL (non-reloading)
function setDistillUrlState(targetId, depth) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('distilled', '1');
    if (targetId) url.searchParams.set('target', String(targetId));
    if (typeof depth !== 'undefined') url.searchParams.set('depth', String(depth));
    history.pushState({ distilled: true, targetId, depth }, '', url);
  } catch (e) { /* no-op */ }
}

function clearDistillUrlState() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('distilled');
    url.searchParams.delete('target');
    url.searchParams.delete('depth');
    history.pushState({}, '', url);
  } catch (e) { /* no-op */ }
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
      const cleaned = cleanLatexForDisplay(current).replace(/\s+\n/g, '\n').trim();
      if (cleaned) items.push(cleaned);
      current = '';
    };
    for (const line of lines) {
      const isHeaderish = /^\s*(?:\$[^$]{0,80}\$|[A-Za-z\\][^:\n\r]{0,80}):/.test(line);
      if (isHeaderish && current.trim()) {
        pushCurrent();
        current = line;
      } else {
        current = current ? current + '\n' + line : line;
      }
    }
    pushCurrent();
  });

  return items;
}

function buildDistillModel() {
  if (!proofMode || !proofTargetId) return null;

  const excludeTypes = new Set(['remark', 'unknown']);
  const allowedResultTypes = new Set(['theorem', 'lemma', 'proposition', 'corollary', 'claim']);

  const allIds = Array.from(proofVisibleNodes || []);
  const keptIds = allIds.filter(id => {
    const n = nodeById.get(id);
    if (!n) return false;
    if (excludeTypes.has(n.type)) return false;
    return true;
  });
  const keptSet = new Set(keptIds);

  // Induced edges over kept nodes and in the current proof subgraph
  const edges = [];
  graphData.edges.forEach(e => {
    const sId = typeof e.source === 'object' ? e.source.id : e.source;
    const tId = typeof e.target === 'object' ? e.target.id : e.target;
    if (!keptSet.has(sId) || !keptSet.has(tId)) return;
    const key = edgeKey(sId, tId);
    if (!proofVisibleEdges.has(key)) return;
    const dep = e.dependency_type || 'internal';
    if (dep !== 'used_in') return; // only true prerequisite relations
    edges.push([sId, tId]);
  });

  const topo = topoSort(keptIds, edges);

  // Aggregate definitions/notations from prerequisites_preview in topo order (dedupe per item)
  const defSet = new Set();
  const definitions = [];
  for (const id of topo) {
    const n = nodeById.get(id);
    const items = splitPrereqItems(n && n.prerequisites_preview || '');
    for (const item of items) {
      const key = normalizeTextForDedupe(item);
      if (key && !defSet.has(key)) {
        defSet.add(key);
        definitions.push(item);
      }
    }
  }

  // Supporting results (all results along the path except the target)
  const supporting = [];
  for (const id of topo) {
    if (id === proofTargetId) continue;
    const n = nodeById.get(id);
    if (!n || !allowedResultTypes.has(n.type)) continue;
    const content = cleanLatexForDisplay(n.content_preview || '').trim();
    if (!content) continue;
    supporting.push({ id, title: n.display_name || n.label || n.id, content });
  }

  const target = nodeById.get(proofTargetId) || {};

  // Build adjacency and node data for inline unfolding from any artifact
  const adj = {};
  const graphNodes = {};
  (function buildAdj(startId) {
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      const ins = incomingEdgesByTarget.get(id) || [];
      for (const { s, t, dep } of ins) {
        if (dep === 'generalized_by') continue;
        const n = nodeById.get(s);
        if (!n || !allowedResultTypes.has(n.type)) continue;
        if (!adj[id]) adj[id] = [];
        if (adj[id].indexOf(s) === -1) adj[id].push(s);
        if (!visited.has(s)) { visited.add(s); queue.push(s); }
      }
    }
    // capture basic node data for all visited (excluding the root if desired)
    visited.forEach((id) => {
      const n = nodeById.get(id);
      if (!n) return;
      const content = cleanLatexForDisplay(n.content_preview || '').trim();
      graphNodes[id] = { id, title: n.display_name || n.label || n.id, content };
    });
  })(proofTargetId);

  // Build children map (prerequisites for each node inside current proof subgraph)
  const childrenMap = new Map();
  graphData.edges.forEach(e => {
    const sId = typeof e.source === 'object' ? e.source.id : e.source;
    const tId = typeof e.target === 'object' ? e.target.id : e.target;
    if (!keptSet.has(sId) || !keptSet.has(tId)) return;
    const key = edgeKey(sId, tId);
    const dep = e.dependency_type || 'internal';
    if (dep !== 'used_in') return;
    if (!proofVisibleEdges.has(key)) return;
    if (!childrenMap.has(tId)) childrenMap.set(tId, []);
    childrenMap.get(tId).push(sId);
  });
  function buildTree(id, level) {
    if (level >= proofDepth) return { id: id, children: [] };
    const kids = (childrenMap.get(id) || []).map(cid => buildTree(cid, level + 1));
    return { id: id, children: kids };
  }
  const tree = buildTree(proofTargetId, 0);

  return {
    title: target.display_name || target.label || String(proofTargetId),
    depth: proofDepth,
    target: {
      id: proofTargetId,
      title: target.display_name || target.label || String(proofTargetId),
      content: cleanLatexForDisplay(target.content_preview || '').trim()
    },
    definitions,
    supporting,
    adj,
    graphNodes,
    tree
  };
}

function renderDistilledWindow(model) {
  if (!model) return;
  const { title, target, definitions, supporting } = model;
  const graphNodesModel = model.graphNodes || {};
  const tree = model.tree;
  function renderTreeNode(node) {
    const info = graphNodesModel[node.id] || { id: node.id, title: node.id, content: '' };
    const childrenHtml = (node.children || []).map(renderTreeNode).join('\n');
    return `
            <div class="result-item" data-id="${info.id}">
                <h3>${info.title} <span class="artifact-controls" data-id="${info.id}">
                  <button class="fold-btn" data-act="less" title="Unfold less">−</button>
                  <button class="fold-btn" data-act="more" title="Unfold more">+</button>
                </span></h3>
                <div class="math-content">${info.content || '<em>No statement available.</em>'}</div>
                <div class="child-results" data-parent="${info.id}">${childrenHtml}</div>
            </div>`;
  }

  const defsSection = definitions && definitions.length
    ? definitions.map((d, i) => `<div class="def-item"><div class="math-content">${d}</div></div>`).join('\n')
    : '<p class="muted">No explicit definitions or notations were required beyond the visible path.</p>';

  const suppSection = (tree && tree.children && tree.children.length)
    ? tree.children.map(renderTreeNode).join('\n')
    : (supporting && supporting.length
      ? supporting.map((r) => `
            <div class="result-item" data-id="${r.id}">
                <h3>${r.title} <span class="artifact-controls" data-id="${r.id}">
                  <button class="fold-btn" data-act="less" title="Unfold less">−</button>
                  <button class="fold-btn" data-act="more" title="Unfold more">+</button>
                </span></h3>
                <div class="math-content">${r.content}</div>
                <div class="child-results" data-parent="${r.id}"></div>
            </div>`).join('\n')
      : '<p class="muted">No intermediate results are required at the current unfolding depth.</p>');

  const targetSection = `
        <div class="target-item">
            <h2>${target.title}</h2>
            <div class="math-content">${target.content || '<em>No statement available.</em>'}</div>
        </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Distilled Proof for: ${title}</title>
<style>
  :root {
    --ink: #111;
    --paper: #fff;
    --muted: #666;
    --accent: #0a6efd;
  }
  html, body { background: var(--paper); color: var(--ink); margin: 0; padding: 0; font-family: 'Source Serif 4', Georgia, serif; }
  .doc { max-width: 900px; margin: 24px auto; padding: 0 18px 60px; }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #ddd; padding-bottom: 12px; margin-bottom: 20px; }
  header h1 { font-family: 'Inter', system-ui, sans-serif; font-size: 20px; margin: 0; }
  header .actions { display: flex; gap: 10px; }
  .download-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--accent); color: #fff; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-family: 'Inter', system-ui, sans-serif; font-weight: 600; }
  .download-btn:hover { filter: brightness(0.95); }
  .download-btn .icon svg { width: 18px; height: 18px; display: block; }
  section { margin: 26px 0; }
  section h2 { font-family: 'Inter', system-ui, sans-serif; font-size: 18px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  h3 { font-family: 'Inter', system-ui, sans-serif; font-size: 16px; margin-bottom: 6px; }
  .muted { color: var(--muted); font-style: italic; }
  .result-item, .def-item, .target-item { margin: 14px 0; }
  .math-content { line-height: 1.6; }
  @media print {
    header .actions { display: none; }
    a { color: inherit; text-decoration: none; }
  }
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<script>
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      packages: {'[+]': ['ams']},
      macros: { bbE: '\\mathbb{E}', bbP: '\\mathbb{P}', bbZ: '\\mathbb{Z}', bbR: '\\mathbb{R}', bbG: '\\mathbb{G}', bbH: '\\mathbb{H}', bbV: '\\mathbb{V}', mathbbm: ['{\\mathbf{#1}}', 1], mathbbm1: '\\mathbf{1}', llbracket: '\\mathopen{[\\![}', rrbracket: '\\mathclose{]\\!]}' }
    },
    options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
    svg: { fontCache: 'global' }
  };
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
</head>
<body>
  <div class="doc">
    <header>
      <h1>Distilled Proof for: ${title}</h1>
      <div class="actions">
        <button id="set-api-key" class="download-btn" title="Set OpenAI API key" onclick="(function(){var m=document.getElementById('key-modal');var i=document.getElementById('key-input');try{i.value=localStorage.getItem('openai_api_key')||'';}catch(e){};if(m){m.style.display='flex';setTimeout(function(){try{i.focus();}catch(_){}} ,0);}})()">
          <span class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.62 4H8.7a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08c0 .65.26 1.28.72 1.74.46.46 1.09.72 1.74.72H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </span>
        </button>
        <button id="download-tex" class="download-btn" title="Download LaTeX (.tex)">
          <span class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 17h16v4H4z"/></svg>
          </span>
        </button>
      </div>
    </header>

    <style>
      /* Explainer (The Explainer) UI */
      .explainer-menu { position: fixed; z-index: 9999; background: #fff; color: #111; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,0.15); padding: 6px; font-family: 'Inter', system-ui, sans-serif; min-width: 240px; }
      .explainer-menu button { width: 100%; display: block; text-align: left; background: #fff; border: none; padding: 8px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; }
      .explainer-menu button:hover { background: #f2f2f2; }
      .explainer-card { border: 1px solid #e6e6e6; border-left: 4px solid #0a6efd; background: #fafcff; border-radius: 6px; padding: 10px 12px; margin: 12px 0; }
      .explainer-card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-family: 'Inter', system-ui, sans-serif; }
      .explainer-card header .title { font-weight: 600; color: #0a6efd; font-size: 14px; }
      .explainer-card .actions { display: flex; gap: 8px; }
      .explainer-card .actions button { font-family: 'Inter', system-ui, sans-serif; font-size: 12px; border: 1px solid #ddd; background: #fff; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
      .explainer-card .actions button:hover { background: #f9f9f9; }
      .explainer-card .content { margin-top: 8px; }
      /* API Key Modal */
      .key-modal{position:fixed;left:0;top:0;width:100%;height:100%;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:10000;}
      .key-modal .card{background:#fff;color:#111;padding:16px 16px 12px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:420px;width:92%;font-family:'Inter',system-ui,sans-serif;}
      .key-modal label{display:block;font-size:13px;margin-bottom:6px;color:#333;}
      .key-modal input{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;}
      .key-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;}
      .key-modal .row button{border:1px solid #ddd;background:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px;}
      .key-modal .row button.primary{background:var(--accent);color:#fff;border-color:var(--accent);} 
      /* Artifact unfold controls */
      .artifact-controls{display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle}
      .artifact-controls .fold-btn{border:1px solid #ddd;background:#fff;border-radius:4px;width:22px;height:22px;line-height:20px;padding:0;cursor:pointer;font-family:'Inter',system-ui,sans-serif;font-size:14px}
      .artifact-controls .fold-btn:hover{background:#f2f2f2}
      .result-item.collapsed .math-content{display:none}
      .result-item.collapsed{opacity:.98}
      .result-item.collapsed > .child-results{display:none}
      .child-results{margin-left:16px;border-left:2px solid #eee;padding-left:10px;margin-top:8px}
    </style>
    <div id="explainer-menu" class="explainer-menu" style="display:none"></div>
    <div id="key-modal" class="key-modal" style="display:none">
      <div class="card">
        <label for="key-input">OpenAI API key</label>
        <input id="key-input" type="password" placeholder="sk-..." />
        <div class="row">
          <button id="key-cancel" type="button" onclick="(function(){var m=document.getElementById('key-modal'); if(m) m.style.display='none';})()">Cancel</button>
          <button id="key-save" type="button" class="primary" onclick="(function(){var v=(document.getElementById('key-input').value||'').trim();try{if(v){localStorage.setItem('openai_api_key', v);}else{localStorage.removeItem('openai_api_key');}}catch(e){};var m=document.getElementById('key-modal'); if(m) m.style.display='none'; var b=document.getElementById('set-api-key'); if(b) b.title = v ? 'API key saved' : 'Set OpenAI API key'; })()">Save</button>
        </div>
      </div>
    </div>


    <section id="definitions">
      <h2>1. Definitions and Notations</h2>
      ${defsSection}
    </section>

    <section id="supporting">
      <h2>2. Supporting Results</h2>
      ${suppSection}
    </section>

    <section id="target">
      <h2>3. Target Theorem and Proof</h2>
      ${targetSection}
    </section>
  </div>
  <script id="distill-data" type="application/json">${JSON.stringify(model).replace(/</g, '\\u003c')}</script>

  <script src="../assets/distilled_boot.js"></script>
  <script type="text/javascript" id="distilled-inline">

    (function() {
      function sanitizeFilename(s) {
        return String(s || 'distilled-proof').replace(/[^a-z0-9\-_]+/gi,'_').slice(0,120);
      }
      function downloadBlob(content, type, filename) {
        const blob = new Blob([content], {type});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 0);
      }
      function buildLatexFromModel(model) {
        const esc = s => s == null ? '' : String(s);
        const lines = [];
        lines.push('\\\\documentclass[11pt]{article}');
        lines.push('\\\\usepackage{amsmath,amssymb,amsthm}');
        lines.push('\\\\usepackage[margin=1in]{geometry}');
        lines.push('\\\\title{Distilled Proof for: ' + esc(model.title).replace(/[\\\\{}]/g,' ') + '}');
        lines.push('\\\\begin{document}');
        lines.push('\\\\maketitle');
        if (model.definitions && model.definitions.length) {
          lines.push('\\\\section*{Definitions and Notations}');
          model.definitions.forEach(d => { lines.push(esc(d)); lines.push(''); });
        }
        if (model.supporting && model.supporting.length) {
          lines.push('\\\\section*{Supporting Results}');
          model.supporting.forEach(r => { lines.push('\\\\subsection*{' + esc(r.title).replace(/[\\\\{}]/g,' ') + '}'); lines.push(esc(r.content)); lines.push(''); });
        }
        lines.push('\\\\section*{Target Theorem and Proof}');
        lines.push('\\\\subsection*{' + esc(model.target.title).replace(/[\\\\{}]/g,' ') + '}');
        lines.push(esc(model.target.content || ''));
        lines.push('\\\\end{document}');
        return lines.join('\\n');
      }
      const model = JSON.parse(document.getElementById('distill-data').textContent);
      const base = 'Distilled-' + sanitizeFilename(model.title || model.target.title);
      // Reflect doc state in URL for sharing/bookmarking
      (function setDocUrl(){
        try {
          const openerHref = (window.opener && window.opener.location && window.opener.location.href) || window.location.href;
          const url = new URL(openerHref);
          url.searchParams.set('distilled_doc', '1');
          if (model && model.target && model.target.id) url.searchParams.set('target', String(model.target.id));
          if (typeof model.depth !== 'undefined') url.searchParams.set('depth', String(model.depth));
          var __tgt = (model && model.target) ? model.target.id : null;
          var __dep = (model) ? model.depth : null;
          history.replaceState({ distilled_doc: true, target: __tgt, depth: __dep }, '', url);
        } catch (e) { /* no-op */ }
      })();

      const texBtn = document.getElementById('download-tex');
      if (texBtn){
        texBtn.addEventListener('click', () => {
          const tex = buildLatexFromModel(model);
          downloadBlob(tex, 'text/x-tex', base + '.tex');
        });
      }



      // =============================
      // The Explainer (Client-side)
      // =============================
      const menu = document.getElementById('explainer-menu');
      // Ensure menu is attached to body to avoid stacking/positioning issues
      try {
        if (menu && menu.parentElement !== document.body) {
          document.body.appendChild(menu);
        }
        if (menu && getComputedStyle(menu).position !== 'fixed') {
          menu.style.position = 'fixed';
        }
      } catch(e) { /* no-op */ }
      const setKeyBtn = document.getElementById('set-api-key');

      function getApiKey(){
        try { return localStorage.getItem('openai_api_key') || ''; } catch(e){ return ''; }
      }
      function setApiKey(k){
        try {
          if (!k) { localStorage.removeItem('openai_api_key'); }
          else { localStorage.setItem('openai_api_key', k.trim()); }
        } catch(e) { /* ignore */ }
      }

      // Simple in-document modal for entering the API key (no window.prompt dependency)
      window.showKeyModal = function(){
        try {
          var modal = document.getElementById('key-modal');
          var input = document.getElementById('key-input');
          if (!modal || !input) return;
          input.value = getApiKey() || '';
          modal.style.display = 'flex';
          setTimeout(function(){ try { input.focus(); } catch(_){} }, 0);
        } catch(e){ console.error(e); }
      };
      window.hideKeyModal = function(){
        var modal = document.getElementById('key-modal');
        if (modal) modal.style.display = 'none';
      };
      function keySave(){
        var input = document.getElementById('key-input');
        var val = (input && input.value) ? input.value.trim() : '';
        setApiKey(val);
        var btn = document.getElementById('set-api-key');
        if (btn) btn.title = val ? 'API key saved' : 'Set OpenAI API key';
        window.hideKeyModal();
      }
      var elSave = document.getElementById('key-save'); if (elSave) elSave.addEventListener('click', keySave);
      var elCancel = document.getElementById('key-cancel'); if (elCancel) elCancel.addEventListener('click', window.hideKeyModal);
      var elInput = document.getElementById('key-input'); if (elInput) elInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') keySave(); if (e.key === 'Escape') window.hideKeyModal(); });

      if (setKeyBtn){ setKeyBtn.addEventListener('click', window.showKeyModal); }

      function hideMenu(){ menu.style.display = 'none'; menu.innerHTML = ''; }

      function buildMenu(x, y, onPick){
        const html = [
          { mode: 'simplify', label: 'Explain this in simpler terms' },
          { mode: 'intuition', label: 'What is the key intuition here?' },
          { mode: 'expand', label: 'Expand this step' }
        ].map(function(i){ return '<button data-mode="'+i.mode+'">'+i.label+'</button>'; }).join('');
        menu.innerHTML = html;
        const left = Math.max(8, Math.min(window.innerWidth - 260, x));
        const top = Math.max(8, y);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.display = 'block';
        try { console.log('[Explainer] menu open at', {left, top}); } catch(_){}
        [...menu.querySelectorAll('button')].forEach(btn => {
          btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-mode');
            hideMenu();
            onPick(mode);
          });
        });
      }

      function getSelectionInfo(){
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return null;
        const text = sel.toString().trim();
        // Accept shorter selections; some math fragments can be 2 chars
        if (!text || text.length < 2) return null;
        const range = sel.getRangeAt(0);
        let rect = range.getBoundingClientRect();
        if ((!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) && typeof range.getClientRects === 'function') {
          const rlist = range.getClientRects();
          if (rlist && rlist.length) rect = rlist[0];
        }
        return { sel, range, rect, text };
      }

      function findBlockElement(node){
        const isBlock = (el) => !el ? false : ['P','DIV','SECTION','ARTICLE','H1','H2','H3','LI','OL','UL'].includes(el.tagName) || el.classList.contains('math-content') || el.classList.contains('result-item') || el.classList.contains('def-item') || el.classList.contains('target-item');
        let el = node;
        while (el && el !== document.body && !isBlock(el)) el = el.parentElement;
        return el || document.body;
      }

      function nearestInsertionPoint(range){
        const container = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        const block = findBlockElement(container);
        return block;
      }

      function insertExplainerCard(blockEl, title){
        const card = document.createElement('div');
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

      async function openaiExplain({mode, selection, localContext, target, definitions, supporting}){
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Missing API key. Click the gear button to set it.');
        const sys = 'You are The Explainer for mathematical content. Be precise and correct; preserve meaning; include small LaTeX where helpful; avoid fabrications; if unsure, say so.';
        const promptParts = [];
        promptParts.push('Mode: ' + mode);
        promptParts.push('Selection: ' + selection);
        if (localContext) promptParts.push('Local context: ' + localContext);
        if (target) promptParts.push('Target: ' + ((target && target.title) || '') + ': ' + ((target && target.content) || ''));
        if (definitions && definitions.length) promptParts.push('Definitions (subset):\n- ' + definitions.slice(0, 6).join('\n- '));
        if (supporting && supporting.length) promptParts.push('Supporting (subset):\n- ' + supporting.slice(0, 3).map(function(r){ return ((r.title || '') + ': ' + (r.content || '')); }).join('\n- '));
        const prompt = promptParts.join('\n\n');

        // Direct REST call (no dynamic import) for maximum compatibility
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: prompt }
            ]
          })
        });
        if (!resp.ok) {
          let msg = 'HTTP ' + resp.status + ' ' + resp.statusText;
          try {
            const err = await resp.json();
            if (err && err.error && err.error.message) msg += ': ' + err.error.message;
          } catch(_) {}
          throw new Error(msg);
        }
        const data = await resp.json();
        const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : '';
        return (text || '').trim();
      }

      function typesetMath(el){
        try { if (window.MathJax) return MathJax.typesetPromise([el]); } catch(e) {}
        return Promise.resolve();
      }

      function escapeHtml(s){
        return String(s).replace(/[&<>]/g, c => ({'&':'&','<':'<','>':'>'}[c]));
      }

      function handleAction(mode, selInfo){
        const block = nearestInsertionPoint(selInfo.range);
        const card = insertExplainerCard(block, mode === 'simplify' ? 'Simpler terms' : mode === 'intuition' ? 'Key intuition' : 'Expanded step');
        const contentEl = card.querySelector('.content');
        var __ctxEl = findBlockElement(selInfo.range.commonAncestorContainer);
        var __ctxText = (__ctxEl && typeof __ctxEl.innerText === 'string') ? __ctxEl.innerText : '';
        const localContext = __ctxText ? __ctxText.trim().slice(0, 4000) : '';

        const defs = (model.definitions || []).slice(0, 6);
        const supp = (model.supporting || []).slice(0, 3);
        const payload = { mode, selection: selInfo.text.slice(0, 4000), localContext, target: model.target, definitions: defs, supporting: supp };

        const doExplain = async () => {
          try {
            contentEl.innerHTML = '<em>Working…</em>';
            const reply = await openaiExplain(payload);
            contentEl.innerHTML = '<div>' + reply + '</div>';
            await typesetMath(contentEl);
          } catch (e){
            contentEl.innerHTML = '<span style="color:#c00">' + escapeHtml(e.message || String(e)) + '</span>';
}
        };
doExplain();

const actions = card.querySelector('.actions');
actions.addEventListener('click', (evt) => {
  const act = evt.target.getAttribute('data-act');
  if (act === 'remove') card.remove();
  if (act === 'regen') doExplain();
  if (act === 'copy') {
    const tmp = document.createElement('textarea');
    tmp.value = contentEl.innerText || '';
    document.body.appendChild(tmp); tmp.select();
    try { document.execCommand('copy'); } catch (e) { }
    tmp.remove();
  }
});
      }

function onSelectionEvent() {
  const info = getSelectionInfo();
  if (!info) { hideMenu(); return; }
  const x = info.rect.left + info.rect.width / 2;
  // Menu is position: fixed; use viewport coordinates (no scroll offset)
  const y = Math.max(8, info.rect.top - 10);
  buildMenu(x, y, (mode) => handleAction(mode, info));
}

document.addEventListener('mouseup', () => setTimeout(onSelectionEvent, 30));
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') setTimeout(onSelectionEvent, 0); });
document.addEventListener('scroll', hideMenu, true);
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) hideMenu(); });

// Open menu immediately when selection changes (slight delay for DOM to settle)
document.addEventListener('selectionchange', () => { try { console.log('[Explainer] selectionchange'); } catch(_){} setTimeout(onSelectionEvent, 30); });

// Helper: open menu for current selection at given coordinates (fallback to rect center)
function openMenuForSelectionAt(x, y){
  const info = getSelectionInfo();
  if (!info) return;
  const cx = (typeof x === 'number' ? x : (info.rect.left + info.rect.width/2));
  const cy = (typeof y === 'number' ? y : Math.max(8, info.rect.top - 10));
  buildMenu(cx, cy, (mode) => handleAction(mode, info));
}

// Context menu (right click) also opens the explainer if a selection exists
window.addEventListener('contextmenu', (e) => {
  const hasSel = window.getSelection && window.getSelection().toString().trim().length >= 2;
  if (hasSel) {
    e.preventDefault();
    openMenuForSelectionAt(e.clientX, e.clientY - 10);
  }
}, { capture: true });

// Keyboard shortcut: Ctrl/Cmd+E opens the menu for the current selection
window.addEventListener('keydown', (e) => {
  const isShortcut = (e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.metaKey);
  if (!isShortcut) return;
  const sel = window.getSelection && window.getSelection().toString().trim();
  if (!sel || sel.length < 2) return;
  e.preventDefault();
  const info = getSelectionInfo();
  if (!info) return;
  openMenuForSelectionAt();
});

// Floating button: if no selection, auto-select target paragraph and open menu
(function(){
  var fab = document.getElementById('explainer-fab');
  if (!fab) return;
  fab.addEventListener('click', function(){
    try { console.log('[Explainer] FAB clicked'); } catch(_){}
    var info = getSelectionInfo();
    if (info) { openMenuForSelectionAt(); return; }
    try {
      var para = document.querySelector('#target .math-content') || document.querySelector('#definitions .math-content') || document.querySelector('#supporting .math-content');
      if (para) {
        var r = document.createRange();
        r.selectNodeContents(para);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        setTimeout(() => openMenuForSelectionAt(), 60);
      } else {
        alert('Select some text in the document, then right-click or press Ctrl/Cmd+E to open The Explainer.');
      }
    } catch(e){ console.error(e); }
  });
})();

    }) ();

  </script >
</body >
</html > `;

  // Always open distilled document in the same tab for reliability (avoids popup blockers
  // and ensures automated tests can see the new content)
  document.open();
  document.write(html);
  document.close();
}

function renderDistilledProofFromCurrentPath() {
  const model = buildDistillModel();
  renderDistilledWindow(model);
}
