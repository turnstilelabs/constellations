
// Actually, let's duplicate cleanLatexForDisplay here or create a utils module.
// For simplicity, I'll redefine it here as it's small.

function cleanLatex(content) {
    if (!content) return '';
    return content.replace(/\\label\{[^}]*\}/g, '').trim();
}

export function setupLegends(nodeTypes, edgeTypes, nodeColors, edgeColors, state, actions) {
    const nodeLegendContainer = d3.select("#node-legend-container");
    nodeTypes.forEach(type => {
        const item = nodeLegendContainer.append("div").attr("class", "legend-item").attr("id", `legend-item-${type}`);
        item.append("div").attr("class", "legend-color").style("background-color", nodeColors[type]);
        item.append("span").text(type.charAt(0).toUpperCase() + type.slice(1));

        item.on("click", () => {
            if (state.pinned) return;
            if (state.hiddenTypes.has(type)) {
                state.hiddenTypes.delete(type);
                item.classed("inactive", false);
            } else {
                state.hiddenTypes.add(type);
                item.classed("inactive", true);
            }
            actions.updateVisibility();
        });
    });

    const edgeLegendContainer = d3.select("#edge-legend-container");
    edgeTypes.forEach(type => {
        const item = edgeLegendContainer.append("div").attr("class", "legend-item");
        item.append("div").attr("class", "edge-legend-line").style("background-color", edgeColors[type]);
        item.append("span").text(type.replace(/_/g, ' '));
    });
}

export function renderNodeTooltip(tooltip, event, d) {
    const finalPreview = cleanLatex(d.content_preview || 'N/A');
    tooltip.style("display", "block")
        .html(`<h4>${d.display_name}</h4><div class="math-content">${finalPreview}</div>`)
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 28) + "px");

    if (window.MathJax) {
        MathJax.typesetPromise([tooltip.node()]).catch(err => console.error('MathJax typesetting failed:', err));
    }
}

export function hideTooltip(tooltip) {
    tooltip.style("display", "none");
}

export function updateInfoPanel(infoPanel, infoTitle, infoBody, d, state, actions) {
    // Title
    infoTitle.text(d.display_name);

    // Review button for theorems
    const reviewBtnHTML = (d.type === 'theorem') ? `<button id="review-theorem-btn" class="depth-btn">Review this Theorem</button>` : '';
    const actionHTML = reviewBtnHTML ? `<div class="proof-action" style="gap:8px">${reviewBtnHTML}</div>` : '';

    let infoHTML = `${actionHTML}<h4>Preview</h4><p class="math-content">${cleanLatex(d.content_preview || 'N/A')}</p>`;
    if (d.prerequisites_preview) {
        infoHTML += `<h4>Prerequisites</h4><p class="math-content">${cleanLatex(d.prerequisites_preview)}</p>`;
    }

    infoBody.html(infoHTML);
    infoPanel.classed('visible', true);

    // Wire review button
    if (document.getElementById('review-theorem-btn')) {
        d3.select('#review-theorem-btn').on('click', () => actions.enterReviewMode(d.id));
    }

    if (window.MathJax) {
        MathJax.typesetPromise([infoBody.node()]).catch(err => console.error(err));
    }
}

export function hideInfoPanel(infoPanel) {
    infoPanel.classed("visible", false);
}

export function setupProofControls(container, actions) {
    const proofControlsBar = d3.select(container)
        .insert("div", "svg")
        .attr("class", "proof-controls")
        .style("display", "none");

    proofControlsBar.append("button").attr("id", "unfold-less").attr("class", "depth-btn").text("< Unfold Less")
        .on("click", actions.unfoldLess);
    proofControlsBar.append("button").attr("id", "unfold-more").attr("class", "depth-btn").text("Unfold More >")
        .on("click", actions.unfoldMore);

    return proofControlsBar;
}

export function setupFloatingControls(container, actions) {
    const floatingControls = d3.select(container)
        .append("div")
        .attr("class", "floating-controls")
        .style("display", "none");

    floatingControls.append("button")
        .attr("id", "floating-explore-btn")
        .attr("class", "depth-btn depth-btn--primary")
        .text("Explore Proof Path")
        .on("click", function() {
            const nodeId = d3.select(this).attr("data-node-id");
            if (nodeId) actions.enterProofMode(nodeId);
        });

    floatingControls.append("button")
        .attr("id", "floating-unfold-less")
        .attr("class", "depth-btn")
        .text("< Unfold Less")
        .on("click", actions.unfoldLess);

    floatingControls.append("button")
        .attr("id", "floating-unfold-more")
        .attr("class", "depth-btn")
        .text("Unfold More >")
        .on("click", actions.unfoldMore);

    floatingControls.append("button")
        .attr("id", "floating-distill-btn")
        .attr("class", "depth-btn depth-btn--primary")
        .text("Generate Distilled Proof")
        .on("click", actions.generateDistilledProof);

    return floatingControls;
}

export function updateFloatingControls(floatingControls, state) {
    if (state.proofMode) {
        // In proof mode: show unfold and distill buttons
        floatingControls.style("display", "flex");
        floatingControls.select("#floating-explore-btn").style("display", "none");
        floatingControls.select("#floating-unfold-less").style("display", "block");
        floatingControls.select("#floating-unfold-more").style("display", "block");
        floatingControls.select("#floating-distill-btn").style("display", "block");
    } else if (state.pinnedNode) {
        // Node selected but not in proof mode: show explore button
        floatingControls.style("display", "flex");
        floatingControls.select("#floating-explore-btn")
            .style("display", "block")
            .attr("data-node-id", state.pinnedNode.id);
        floatingControls.select("#floating-unfold-less").style("display", "none");
        floatingControls.select("#floating-unfold-more").style("display", "none");
        floatingControls.select("#floating-distill-btn").style("display", "none");
    } else {
        // Nothing selected: hide everything
        floatingControls.style("display", "none");
    }
}
