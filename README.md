# Constellations

This project transforms mathematical papers into interactive visualizations, illuminating the intricate logical structure that underpins the research. Each paper is rendered as a "constellation," where theorems, lemmas, and remarks are the stars, and their dependencies are the lines that connect them.
The goal is to provide a new way to explore, understand, and appreciate the architecture of mathematical papers.

## Features

This graph visualization tool is built with D3.js and packed with features to make exploring a paper's structure intuitive and insightful:

- Interactive Graph: Pan and zoom the graph, and drag nodes to rearrange the layout.

- Dynamic Node Sizing: Nodes are sized based on their number of connections, highlighting the most central and influential artifacts in the paper.

- Colored Dependency Edges: Edges are colored by their logical type (uses_result, is_generalization_of, etc.) to show why two artifacts are connected.

- Focus Mode: Click a node to fade out everything else, instantly isolating its direct dependencies (what it relies on) and dependents (what relies on it).

- Detailed Info Panel: Click a node to open a persistent side panel with its full content, perfect for careful reading.

- Interactive Filtering: Click on node types in the legend to toggle their visibility, allowing you to declutter the graph and focus on the core logical flow.

## How These Visualizations Are Made

The visualization are the automated output of a dedicated analysis engine developed as part of our research into the structure of mathematical documents. The engine parses the LaTeX source of a paper:

1. Identify core logical artifacts (theorems, lemmas, definitions, etc.).

2. Resolve and extract the definitions of all mathematical notations and objects to enrich each artifact with its necessary prerequisites.
   
3. Trace the dependency network by analyzing citations in their original context, allowing the engine to infer the semantic type of each link (e.g., `uses_result`, `is_generalization_of`,...).


