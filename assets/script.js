const nodeTypes = [...new Set(graphData.nodes.map(d => d.type))];
const edgeTypes = [...new Set(graphData.edges.map(d => d.dependency_type || "internal"))];

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

const svg = d3.select("#graph");
const width = svg.node().getBoundingClientRect().width;
const height = svg.node().getBoundingClientRect().height;

const defs = svg.append("defs");
edgeTypes.forEach(type => {
    defs.append("marker")
        .attr("id", `arrowhead-${type}`)
        .attr("viewBox", "-0 -5 10 10")
        .attr("refX", 8) 
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", edgeColors[type]);
});

const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom);
const g = svg.append("g");

const infoPanel = d3.select("#info-panel");
const infoTitle = d3.select("#info-title");
const infoBody = d3.select("#info-body");

function hideInfoPanel() { infoPanel.classed("visible", false); }
d3.select("#close-info-panel").on("click", hideInfoPanel);

svg.on("click", () => {
    if (pinned) {
        pinned = false;
        pinnedNode = null;
        node.classed("faded", false);
        link.classed("faded", false);
        label.classed("faded", false);
        hideInfoPanel();
    }
});

const nodeDegrees = new Map();
graphData.edges.forEach(edge => {
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    nodeDegrees.set(sourceId, (nodeDegrees.get(sourceId) || 0) + 1);
    nodeDegrees.set(targetId, (nodeDegrees.get(targetId) || 0) + 1);
});

const radiusScale = d3.scaleSqrt().domain([0, d3.max(nodeDegrees.values()) || 1]).range([8, 20]);

const simulation = d3.forceSimulation(graphData.nodes)
    .force("link", d3.forceLink(graphData.edges).id(d => d.id).distance(120))
    .force("charge", d3.forceManyBody().strength(-600))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => radiusScale(nodeDegrees.get(d.id) || 1) + 5));

const link = g.append("g").selectAll("line")
    .data(graphData.edges).enter().append("line").attr("class", "link")
    .attr("stroke", d => edgeColors[d.dependency_type || "internal"])
    .attr("marker-end", d => `url(#arrowhead-${d.dependency_type || "internal"})`);

const node = g.append("g").selectAll("circle")
    .data(graphData.nodes).enter().append("circle").attr("class", "node")
    .attr("r", d => radiusScale(nodeDegrees.get(d.id) || 1))
    .attr("fill", d => nodeColors[d.type] || '#ccc')
    .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));

const label = g.append("g").selectAll("text")
    .data(graphData.nodes).enter().append("text").attr("class", "node-label")
    .attr("dy", d => radiusScale(nodeDegrees.get(d.id) || 1) + 12)
    .text(d => d.display_name);

const tooltip = d3.select("#tooltip");
let pinned = false;
let pinnedNode = null;

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

    MathJax.typesetPromise([tooltip.node()]).catch(err => console.error('MathJax typesetting failed:', err));
}

function hideTooltipIfNotPinned() {
    if (!pinned) {
        tooltip.style("display", "none");
    }
}

const neighboring = (a, b) => {
    return graphData.edges.some(edge => {
        const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
        return (sourceId === a.id && targetId === b.id) || (sourceId === b.id && targetId === a.id);
    });
};

node.on("mouseover", (event, d) => {
    if (!pinned) renderNodeTooltip(event, d);
}).on("mouseout", () => {
    if (!pinned) hideTooltipIfNotPinned();
}).on("click", (event, d) => {
    event.stopPropagation();
    tooltip.style("display", "none"); 
    pinned = true;
    pinnedNode = d;

    node.classed("faded", n => n.id !== d.id && !neighboring(d, n));
    link.classed("faded", l => {
        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.id : l.target;
        return sourceId !== d.id && targetId !== d.id;
    });
    label.classed("faded", n => n.id !== d.id && !neighboring(d, n));

    infoTitle.text(d.display_name);
    let infoHTML = `<h4>Preview</h4><p class="math-content">${cleanLatexForDisplay(d.content_preview || 'N/A')}</p>`;
    if (d.prerequisites_preview) {
        infoHTML += `<h4>Prerequisites</h4><p class="math-content">${cleanLatexForDisplay(d.prerequisites_preview)}</p>`;
    }
    infoBody.html(infoHTML);
    infoPanel.classed("visible", true);
    MathJax.typesetPromise([infoBody.node()]).catch(err => console.error(err));
});

link.on("mouseover", (event, d) => {
    const dependencyType = (d.dependency_type || 'INTERNAL').replace(/_/g, ' ').toUpperCase();
    let tooltipHTML = `<h4>Dependency Link</h4>
                       <p>${d.source.display_name} <br>
                          <span class="edge-type">→ ${dependencyType} →</span> <br>
                          ${d.target.display_name}</p>`;
    if (d.context) {
        tooltipHTML += `<p><strong>Context:</strong></p><div class="math-content">${cleanLatexForDisplay(d.context)}</div>`;
    }
    if (d.dependency) {
        tooltipHTML += `<p><strong>Justification:</strong></p><div class="math-content">${cleanLatexForDisplay(d.dependency)}</div>`;
    }
    tooltip.style("display", "block")
        .html(tooltipHTML)
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 28) + "px");

    MathJax.typesetPromise([tooltip.node()]).catch(err => console.error(err));
}).on("mouseout", hideTooltipIfNotPinned);


simulation.on("tick", () => {
    link.attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

    node.attr("cx", d => d.x).attr("cy", d => d.y);
    label.attr("x", d => d.x).attr("y", d => d.y);
});

const nodeLegendContainer = d3.select("#node-legend-container");
const hiddenTypes = new Set();
nodeTypes.forEach(type => {
    const item = nodeLegendContainer.append("div").attr("class", "legend-item").attr("id", `legend-item-${type}`);
    item.append("div").attr("class", "legend-color").style("background-color", nodeColors[type]);
    item.append("span").text(type.charAt(0).toUpperCase() + type.slice(1));
    
    item.on("click", () => {
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
    node.style("display", d => hiddenTypes.has(d.type) ? "none" : "");
    label.style("display", d => hiddenTypes.has(d.type) ? "none" : "");
    link.style("display", d => {
        const sourceVisible = !hiddenTypes.has(typeof d.source === 'object' ? d.source.type : graphData.nodes.find(n => n.id === d.source).type);
        const targetVisible = !hiddenTypes.has(typeof d.target === 'object' ? d.target.type : graphData.nodes.find(n => n.id === d.target).type);
        return sourceVisible && targetVisible ? "" : "none";
    });
    simulation.alpha(0.3).restart();
}

d3.select("#center").on("click", () => {
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
});

function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }