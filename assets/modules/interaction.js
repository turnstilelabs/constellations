export function setupDrag(simulation) {
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

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

export function setupInteractions(node, link, svg, state, actions) {
    // Node Context Menu (PROOF PATH MODE)
    node.on("contextmenu", (event, d) => {
        event.preventDefault();
        actions.enterProofMode(d.id);
    });

    // Node Click (FOCUS MODE)
    node.on("click", (event, d) => {
        event.stopPropagation();

        if (state.proofMode) {
            state.pinned = true;
            state.pinnedNode = d;
            actions.hideTooltip();
            node.classed("selected", n => n.id === d.id);
            actions.updateInfoPanel(d);
            return;
        }

        state.pinned = true;
        state.pinnedNode = d;
        actions.hideTooltip();
        node.classed("selected", n => n.id === d.id);

        const subgraphNodes = new Set([d.id]);
        state.graphData.edges.forEach(edge => {
            const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
            const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
            if (sourceId === d.id) subgraphNodes.add(targetId);
            if (targetId === d.id) subgraphNodes.add(sourceId);
        });

        node.style("display", n => subgraphNodes.has(n.id) ? null : "none");
        // Ensure label visibility matches node visibility logic
        d3.selectAll(".node-label").style("display", n => subgraphNodes.has(n.id) ? null : "none");

        link.style("display", l => {
            const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;
            return subgraphNodes.has(sourceId) && subgraphNodes.has(targetId) ? null : "none";
        });

        actions.updateInfoPanel(d);
    });

    // SVG Background Click (RESET MODE)
    svg.on("click", () => {
        if (state.proofMode) {
            actions.exitProofMode();
            return;
        }
        if (state.pinned) {
            state.pinned = false;
            state.pinnedNode = null;
            node.classed("selected", false);
            actions.hideInfoPanel();
            actions.updateVisibility();
        }
    });

    // Tooltip Events
    node.on("mouseover", (event, d) => actions.renderNodeTooltip(event, d));
    // link.on("mouseover", ...) // If needed
    node.on("mouseout", () => { if (!state.pinned) actions.hideTooltip(); });
    link.on("mouseout", () => { if (!state.pinned) actions.hideTooltip(); });
}
