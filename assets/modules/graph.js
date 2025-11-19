import { COLORS, ZOOM_EXTENT } from './config.js';

export function initializeGraph(containerId, edgeTypes, edgeColors) {
    const svg = d3.select(containerId);
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;

    // Define Arrowhead Markers
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

    const g = svg.append("g");

    // Zoom Behavior
    const zoom = d3.zoom()
        .scaleExtent(ZOOM_EXTENT)
        .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    return { svg, g, width, height };
}

export function renderElements(g, nodes, edges, nodeColors, edgeColors, radiusScale, nodeDegrees) {
    const link = g.append("g")
        .selectAll("line")
        .data(edges)
        .enter().append("line")
        .attr("class", "link")
        .attr("stroke", d => edgeColors[d.dependency_type || "internal"])
        .attr("marker-end", d => `url(#arrowhead-${d.dependency_type || "internal"})`);

    const node = g.append("g")
        .selectAll("circle")
        .data(nodes)
        .enter().append("circle")
        .attr("class", "node")
        .attr("r", d => radiusScale(nodeDegrees.get(d.id) || 1))
        .attr("fill", d => nodeColors[d.type] || '#ccc');

    const label = g.append("g")
        .selectAll("text")
        .data(nodes)
        .enter().append("text")
        .attr("class", "node-label")
        .attr("dy", d => radiusScale(nodeDegrees.get(d.id) || 1) + 12)
        .text(d => d.display_name);

    return { link, node, label };
}
