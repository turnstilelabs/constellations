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

    let infoHTML = `${actionHTML}${controlsHTML}<h4>Preview</h4><p class="math-content">${cleanLatexForDisplay(d.content_preview || 'N/A')}</p>`;
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

    if (window.MathJax) {
        MathJax.typesetPromise([infoBody.node()]).catch(err => console.error(err));
    }
}

d3.select("#close-info-panel").on("click", hideInfoPanel);
d3.select("#center").on("click", () => {
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
});

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
    updateVisibility();
}

// Wire up proof control buttons
if (document.getElementById('unfold-less')) {
    d3.select('#unfold-less').on('click', () => { if (!proofMode) return; proofDepth = Math.max(1, proofDepth - 1); recomputeProofSubgraph(); });
    d3.select('#unfold-more').on('click', () => { if (!proofMode) return; proofDepth = Math.min(getMaxPrereqDepth(proofTargetId), proofDepth + 1); recomputeProofSubgraph(); });

}
