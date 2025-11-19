import { edgeKey } from './data.js';

export function getMaxPrereqDepth(startId, outgoingEdgesBySource) {
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

export function recomputeProofSubgraph(state, incomingEdgesByTarget) {
    state.proofVisibleNodes = new Set([state.proofTargetId]);
    state.proofVisibleEdges = new Set();

    let frontier = [state.proofTargetId];
    let level = 0;
    while (level < state.proofDepth && frontier.length) {
        const next = [];
        for (const id of frontier) {
            const ins = incomingEdgesByTarget.get(id) || [];
            for (const { s, t, dep } of ins) {
                // Exclude 'generalized_by' from Proof Path
                if (dep === 'generalized_by') continue;
                state.proofVisibleNodes.add(s);
                const key = edgeKey(s, t);
                state.proofVisibleEdges.add(key);
                next.push(s);
            }
        }
        level += 1;
        frontier = next;
    }
}

export function applyProofVisibility(state, node, label, link, simulation) {
    node.style("display", d => state.proofVisibleNodes.has(d.id) ? null : "none");
    label.style("display", d => state.proofVisibleNodes.has(d.id) ? null : "none");
    link.style("display", l => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        return state.proofVisibleEdges.has(edgeKey(sId, tId)) ? null : "none";
    });
    simulation.alpha(0.3).restart();
}
