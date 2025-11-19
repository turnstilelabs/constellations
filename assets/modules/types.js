/**
 * @typedef {Object} Node
 * @property {string} id
 * @property {string} type
 * @property {string} display_name
 * @property {string} [content_preview]
 * @property {string} [prerequisites_preview]
 * @property {string} [label]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [fx]
 * @property {number} [fy]
 */

/**
 * @typedef {Object} Edge
 * @property {string|Node} source
 * @property {string|Node} target
 * @property {string} [dependency_type]
 * @property {string} [type]
 * @property {string} [context]
 */

/**
 * @typedef {Object} GraphData
 * @property {Node[]} nodes
 * @property {Edge[]} edges
 */
