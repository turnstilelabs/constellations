# Constellations

Transform mathematical papers into interactive visualizations that illuminate the logical structure underpinning the research.

Each paper is rendered as a **constellation**:
- theorems, lemmas, definitions, and remarks are the **stars**
- logical dependencies are the **edges** between them

> Status: **research prototype / experimental**

## Demo

- Landing page: `http://localhost:3000/`
- Example constellation: `http://localhost:3000/1705.03104/`

## Features

- **Interactive graph** (D3): pan/zoom and drag nodes
- **Dynamic node sizing** based on connectivity
- **Typed dependency edges** (normalized for readability)
- **Focus mode**: select a node to isolate its neighborhood
- **Info panel**: read an artifact’s preview and prerequisites
- **Legend filters**: toggle node types to declutter
- **Proof Path Explorer**: expand/collapse prerequisite depth
- **Review mode** (prototype): guided review of theorems

## Quickstart

### Prerequisites

- Node.js (LTS recommended)

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

Then open `http://localhost:3000/`.

## Project layout

- `index.html` – landing page
- `1705.03104/` – an example constellation (static page + embedded data)
- `assets/style.css` – shared site styling
- `assets/modules/` – graph rendering, interactions, UI, and proof/review logic

## How the visualizations are made (high level)

The interactive constellations are generated from an analysis pipeline (developed as part of ongoing research) that:

1. identifies logical artifacts (theorems, lemmas, definitions, …)
2. extracts/normalizes definitions and prerequisites for richer tooltips
3. infers citations and dependency types from context, then normalizes edges for visualization

Because this is a research system, extractions and inferred relationships may be incomplete or imperfect.

## Data format (in this repo)

The included example constellation page (`1705.03104/index.html`) defines `window.graphData`:

- `nodes`: `{ id, type, display_name, content_preview, prerequisites_preview, ... }`
- `edges`: `{ source, target, dependency_type, context, ... }`

## License

MIT © Turnstile Labs — see [LICENSE](LICENSE).
