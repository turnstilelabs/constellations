import { COLORS } from './config.js';

/**
 * Normalizes the graph data by processing edge dependencies and setting up color maps.
 * @param {import('./types').GraphData} graphData
 * @returns {{
 *   nodes: import('./types').Node[],
 *   edges: import('./types').Edge[],
 *   nodeTypes: string[],
 *   edgeTypes: string[],
 *   nodeColors: Object<string, string>,
 *   edgeColors: Object<string, string>,
 *   nodeById: Map<string, import('./types').Node>,
 *   outgoingEdgesBySource: Map<string, import('./types').Edge[]>,
 *   incomingEdgesByTarget: Map<string, import('./types').Edge[]>
 * }}
 */
export function processGraphData(graphData) {
    // Normalize dependency semantics so arrows always point prerequisite -> dependent
    const edges = graphData.edges.map(e => {
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

    const nodes = graphData.nodes;
    const nodeTypes = [...new Set(nodes.map(d => d.type))];
    const edgeTypes = [...new Set(edges.map(d => d.dependency_type || "internal"))];

    const nodeColors = nodeTypes.reduce((acc, type) => {
        acc[type] = COLORS.nodes(type);
        return acc;
    }, {});

    const edgeColors = edgeTypes.reduce((acc, type) => {
        acc[type] = COLORS.edges(type);
        return acc;
    }, {});

    // Quick lookup maps
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const outgoingEdgesBySource = new Map();
    const incomingEdgesByTarget = new Map();

    edges.forEach(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const dep = e.dependency_type || 'internal';
        if (!outgoingEdgesBySource.has(s)) outgoingEdgesBySource.set(s, []);
        outgoingEdgesBySource.get(s).push({ s, t, dep });
        if (!incomingEdgesByTarget.has(t)) incomingEdgesByTarget.set(t, []);
        incomingEdgesByTarget.get(t).push({ s, t, dep });
    });

    return {
        nodes,
        edges,
        nodeTypes,
        edgeTypes,
        nodeColors,
        edgeColors,
        nodeById,
        outgoingEdgesBySource,
        incomingEdgesByTarget
    };
}

export function edgeKey(s, t) { return `${s}=>${t}`; }
