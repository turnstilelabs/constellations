This project transforms mathematical papers into interactive visualizations, illuminating the intricate logical structure that underpins the research. Each paper is rendered as a "constellation," where theorems, lemmas, and remarks are the stars, and their dependencies are the lines that connect them.
The goal is to provide a new way to explore, understand, and appreciate the architecture of mathematical papers.

## Features

This graph visualization tool is built with D3.js and packed with features to make exploring a paper's structure intuitive and insightful:

- Interactive Graph: Pan and zoom the graph, and drag nodes to rearrange the layout.

- Dynamic Node Sizing: Nodes are sized based on their number of connections, highlighting the most central and influential artifacts in the paper.

- Colored Dependency Edges: Edges are colored by their logical type. We intentionally collapse all prerequisite relationships into “used in”; we keep “generalized by” as the only other relation.

- Focus Mode: Click a node to fade out everything else, instantly isolating its direct dependencies (what it relies on) and dependents (what relies on it).

- Detailed Info Panel: Click a node to open a persistent side panel with its full content, perfect for careful reading.

- Interactive Filtering: Click on node types in the legend to toggle their visibility, allowing you to declutter the graph and focus on the core logical flow.

## How These Visualizations Are Made

The visualization are the automated output of a dedicated analysis engine developed as part of our research into the structure of mathematical documents. The engine parses the LaTeX source of a paper:

1. Identify core logical artifacts (theorems, lemmas, definitions, etc.).

2. Resolve and extract the definitions of all mathematical notations and objects to enrich each artifact with its necessary prerequisites.
   
3. Trace the dependency network by analyzing citations in their original context, then normalize edges for visualization: collapse to `used_in` except for `generalized_by`. All edges point prerequisite → dependent.

## Proof Path Explorer

Explore the proof structure of any artifact with a depth-controlled view.

How to open:
- Right-click a node in the graph and choose "Explore Proof Path"; or
- Click a node to open the info panel, then press the "Explore Proof Path" button.

Initial State (Depth 1):
- Shows only the selected target node and the artifacts it directly cites (its immediate prerequisites).
- Arrows point from prerequisites to the dependent result for all views (e.g., A used_in B means “A is used in B”).

Interactive Controls (rendered in the info panel while exploring a proof path):
- < Unfold Less: Collapse one layer of prerequisites.
- Unfold More >: Reveal the next layer of prerequisites (prerequisites of the prerequisites).

Exit proof mode:
- Click on the background (anywhere on the SVG) or press the Reset View button.

Notes:
- Explore Proof Path shows only “used in” edges (no “generalized by” edges are included).
- While in proof mode, the legend filters are disabled for the pinned view to preserve context.
- The depth expansion uses the paper's dependency edges; if a node has no cited prerequisites, Unfold More will not add new nodes.
