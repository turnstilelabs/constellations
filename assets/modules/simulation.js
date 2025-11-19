import { DIMENSIONS } from './config.js';

export function setupSimulation(nodes, edges, width, height) {
    const nodeDegrees = new Map();
    edges.forEach(edge => {
        const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
        nodeDegrees.set(sourceId, (nodeDegrees.get(sourceId) || 0) + 1);
        nodeDegrees.set(targetId, (nodeDegrees.get(targetId) || 0) + 1);
    });

    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(nodeDegrees.values()) || 1])
        .range(DIMENSIONS.nodeRadiusRange);

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(edges).id(d => d.id).distance(DIMENSIONS.linkDistance))
        .force("charge", d3.forceManyBody().strength(DIMENSIONS.chargeStrength))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => radiusScale(nodeDegrees.get(d.id) || 1) + DIMENSIONS.collisionPadding));

    return { simulation, radiusScale, nodeDegrees };
}

export function updateSimulationTick(simulation, link, node, label, radiusScale, nodeDegrees) {
    simulation.on("tick", () => {
        link.each(function (d) {
            const from = d.source;
            const to = d.target;

            const targetNodeRadius = radiusScale(nodeDegrees.get(to.id) || 1);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance === 0) return;

            const newX2 = to.x - (dx / distance) * (targetNodeRadius + 2);
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
}
