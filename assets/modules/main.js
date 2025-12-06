import { processGraphData } from './data.js';
import { initializeGraph, renderElements } from './graph.js';
import { setupSimulation, updateSimulationTick } from './simulation.js';
import { setupDrag, setupInteractions } from './interaction.js';
import { setupLegends, renderNodeTooltip, hideTooltip, updateInfoPanel, hideInfoPanel, setupProofControls } from './ui.js';
import { getMaxPrereqDepth, recomputeProofSubgraph, applyProofVisibility } from './proof.js';
import { buildDistillModel, renderDistilledWindow } from './distiller.js';
import { createReviewController } from './review.js';

// Global State
const state = {
    pinned: false,
    pinnedNode: null,
    hiddenTypes: new Set(),
    proofMode: false,
    proofTargetId: null,
    proofDepth: 1,
    proofVisibleNodes: new Set(),
    proofVisibleEdges: new Set(),
    graphData: null, // Will be set after processing
    reviewCtl: null
};

// DOM Elements
const infoPanel = d3.select("#info-panel");
const infoTitle = d3.select("#info-title");
const infoBody = d3.select("#info-body");
const tooltip = d3.select("#tooltip");

// Actions object to pass around
const actions = {
    updateVisibility: () => {
        const { node, label, link, simulation, graphData } = state.refs;
        node.style("display", d => state.hiddenTypes.has(d.type) ? "none" : null);
        label.style("display", d => state.hiddenTypes.has(d.type) ? "none" : null);
        link.style("display", d => {
            const sType = typeof d.source === 'object' ? d.source.type : graphData.nodes.find(n => n.id === d.source).type;
            const tType = typeof d.target === 'object' ? d.target.type : graphData.nodes.find(n => n.id === d.target).type;
            const sourceVisible = !state.hiddenTypes.has(sType);
            const targetVisible = !state.hiddenTypes.has(tType);
            return sourceVisible && targetVisible ? null : "none";
        });
        if (!state.pinned) simulation.alpha(0.3).restart();
    },

    renderNodeTooltip: (event, d) => renderNodeTooltip(tooltip, event, d),
    hideTooltip: () => hideTooltip(tooltip),

    updateInfoPanel: (d) => updateInfoPanel(infoPanel, infoTitle, infoBody, d, state, actions),
    hideInfoPanel: () => hideInfoPanel(infoPanel),

    enterProofMode: (targetId) => {
        state.proofMode = true;
        state.proofTargetId = targetId;
        state.proofDepth = 1;
        state.pinned = true;
        state.pinnedNode = state.refs.nodeById.get(targetId) || null;

        actions.hideTooltip();
        state.refs.node.classed("selected", n => n.id === targetId);
        d3.select(".proof-controls").style("display", "none"); // Hide global controls initially? Or show? Original code hid them then recomputed.
        // Actually original code: d3.select(".proof-controls").style("display", "none");
        // But then recomputeProofSubgraph calls applyProofVisibility.
        // Wait, where are controls shown? Ah, they are inline in the panel, or global bar?
        // The original code had a global bar that was hidden by default, and shown... wait.
        // Original: proofControlsBar...style("display", "none");
        // It seems the global bar might be unused or hidden in favor of inline controls? 
        // Let's check original code... 
        // "Proof Path Controls (hidden by default; shown in Proof Path mode)"
        // But enterProofMode hides it: d3.select(".proof-controls").style("display", "none");
        // Maybe it was intended to be shown? Let's stick to original behavior for now.

        actions.recomputeProofSubgraph();
        if (state.refs.nodeById.has(targetId)) actions.updateInfoPanel(state.refs.nodeById.get(targetId));
    },

    exitProofMode: () => {
        state.proofMode = false;
        state.proofTargetId = null;
        state.proofVisibleNodes = new Set();
        state.proofVisibleEdges = new Set();

        d3.select(".proof-controls").style("display", "none");
        state.pinned = false;
        state.pinnedNode = null;
        state.refs.node.classed("selected", false);
        actions.hideInfoPanel();
        actions.clearDistillUrlState();
        actions.updateVisibility();
    },

    recomputeProofSubgraph: () => {
        recomputeProofSubgraph(state, state.refs.incomingEdgesByTarget);
        applyProofVisibility(state, state.refs.node, state.refs.label, state.refs.link, state.refs.simulation);
    },

    unfoldLess: () => {
        if (!state.proofMode) return;
        state.proofDepth = Math.max(1, state.proofDepth - 1);
        actions.recomputeProofSubgraph();
        if (state.proofTargetId) actions.updateInfoPanel(state.refs.nodeById.get(state.proofTargetId));
    },

    unfoldMore: () => {
        if (!state.proofMode) return;
        state.proofDepth = Math.min(getMaxPrereqDepth(state.proofTargetId, state.refs.outgoingEdgesBySource), state.proofDepth + 1);
        actions.recomputeProofSubgraph();
        if (state.proofTargetId) actions.updateInfoPanel(state.refs.nodeById.get(state.proofTargetId));
    },

    generateDistilledProof: () => {
        if (!state.proofMode) return;
        actions.setDistillUrlState(state.proofTargetId, state.proofDepth);
        const model = buildDistillModel(state, state.refs.nodeById, state.refs.incomingEdgesByTarget, state.graphData);
        renderDistilledWindow(model);
    },

    setDistillUrlState: (targetId, depth) => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('distilled', '1');
            if (targetId) url.searchParams.set('target', String(targetId));
            if (typeof depth !== 'undefined') url.searchParams.set('depth', String(depth));
            history.pushState({ distilled: true, targetId, depth }, '', url);
        } catch (e) { /* no-op */ }
    },

    clearDistillUrlState: () => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('distilled');
            url.searchParams.delete('target');
            url.searchParams.delete('depth');
            history.pushState({}, '', url);
        } catch (e) { /* no-op */ }
    },

    enterReviewMode: (startId) => {
        // Lazily create review controller with the data structures we already have
        if (!state.reviewCtl) {
            const processedForReview = {
                nodes: state.graphData && state.graphData.nodes ? state.graphData.nodes : [],
                incomingEdgesByTarget: state.refs && state.refs.incomingEdgesByTarget ? state.refs.incomingEdgesByTarget : new Map(),
                nodeById: state.refs && state.refs.nodeById ? state.refs.nodeById : new Map()
            };
            state.reviewCtl = createReviewController(state, processedForReview);
        }
        state.reviewCtl.enter(startId);
    },

    exitReviewMode: () => {
        if (state.reviewCtl) state.reviewCtl.exit();
    }
};

// Initialization
function init() {
    // Assume graphData is loaded globally as before
    if (typeof window.graphData === 'undefined') {
        console.error("graphData is not defined");
        return;
    }

    const processedData = processGraphData(window.graphData);
    state.graphData = { nodes: processedData.nodes, edges: processedData.edges };

    const { svg, g, width, height } = initializeGraph("#graph", processedData.edgeTypes, processedData.edgeColors);

    const { simulation, radiusScale, nodeDegrees } = setupSimulation(processedData.nodes, processedData.edges, width, height);

    const { link, node, label } = renderElements(g, processedData.nodes, processedData.edges, processedData.nodeColors, processedData.edgeColors, radiusScale, nodeDegrees);

    // Store refs in state for actions to access
    state.refs = {
        svg, g, simulation, link, node, label,
        nodeById: processedData.nodeById,
        outgoingEdgesBySource: processedData.outgoingEdgesBySource,
        incomingEdgesByTarget: processedData.incomingEdgesByTarget,
        graphData: state.graphData
    };

    updateSimulationTick(simulation, link, node, label, radiusScale, nodeDegrees);

    const dragBehavior = setupDrag(simulation);
    node.call(dragBehavior);

    setupInteractions(node, link, svg, state, actions);
    setupLegends(processedData.nodeTypes, processedData.edgeTypes, processedData.nodeColors, processedData.edgeColors, state, actions);

    // Close button for info panel
    d3.select("#close-info-panel").on("click", actions.hideInfoPanel);

    // Header "Review this Paper" button if present
    const reviewBtn = document.getElementById('btn-review-paper');
    if (reviewBtn) reviewBtn.addEventListener('click', () => actions.enterReviewMode());

    // Keyboard shortcut: R to open Review Mode (when graph has focus)
    window.addEventListener('keydown', (e) => {
        if ((e.key === 'r' || e.key === 'R') && !state.proofMode) {
            // Avoid stealing focus from inputs
            const active = document.activeElement;
            const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
            if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !active?.isContentEditable) {
                actions.enterReviewMode();
            }
        }
    });

    // URL State handling
    function initFromUrl() {
        try {
            const url = new URL(window.location.href);
            const distilled = url.searchParams.get('distilled');
            const target = url.searchParams.get('target');
            const depthStr = url.searchParams.get('depth');
            if (distilled === '1' && target && processedData.nodeById.has(target)) {
                actions.enterProofMode(target);
                let depth = parseInt(depthStr || '1', 10);
                if (!Number.isFinite(depth) || depth < 1) depth = 1;
                depth = Math.min(getMaxPrereqDepth(target, processedData.outgoingEdgesBySource), depth);
                state.proofDepth = depth;
                actions.recomputeProofSubgraph();
                if (processedData.nodeById.has(target)) actions.updateInfoPanel(processedData.nodeById.get(target));
                // no auto-open distilled window
            }

            // Review Mode deep link
            const review = url.searchParams.get('review');
            const start = url.searchParams.get('start');
            if (review === '1') {
                actions.enterReviewMode(start || undefined);
            }
        } catch (e) { /* no-op */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFromUrl);
    } else {
        initFromUrl();
    }
    window.addEventListener('popstate', initFromUrl);
}

init();
