// Configuration constants

export const COLORS = {
  nodes: d3.scaleOrdinal(d3.schemeCategory10),
  edges: d3.scaleOrdinal(["#999", "#d62728", "#2ca02c", "#1f77b4", "#ff7f0e", "#9467bd"]),
};

export const DIMENSIONS = {
  nodeRadiusRange: [8, 20],
  linkDistance: 120,
  chargeStrength: -600,
  collisionPadding: 5,
};

export const ZOOM_EXTENT = [0.1, 8];
