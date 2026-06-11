# VibePaWiz — Explorative Visualization of Scientific Citation Networks

VibePaWiz builds an interactive graph of how scientific papers cite each other.
Search for an author, pick one of their papers, and expand outward through the
citation network layer by layer.

It is a from-scratch rewrite of the 2020 **SciPaWiz** project. The original
depended on a custom proxy (`kristoffer-strube.dk`) wrapping the DBLP and
OpenCitations APIs, which broke whenever those upstream APIs changed. VibePaWiz
talks to a stable, no-auth API directly and is built around a **swappable data
provider** abstraction so a single upstream change can never take the tool down.

The original code is preserved under [`legacy/`](legacy/) for reference.

## Data sources

Sources implement a single [`CitationProvider`](src/providers/types.ts) interface
(`searchAuthors`, `worksByAuthor`, `getPaper`, `getCiters`, `getReferences`), so
they are fully interchangeable — pick one from the **Source** dropdown.

| Provider                                                            | Default | Notes                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[OpenAlex](https://openalex.org)**                                | ✅      | Free, no auth, all fields. Author search, metadata, citers (`cites:`) and references (`referenced_works`) come from one stable API. Replaces both DBLP and OpenCitations.                                       |
| **[Semantic Scholar](https://www.semanticscholar.org/product/api)** |         | Free, strong CS coverage (a legal "Google-Scholar-like" alternative). The keyless pool is rate-limited; set an API key in [`src/providers/semanticscholar.ts`](src/providers/semanticscholar.ts) for heavy use. |

Adding a source is just one new file implementing `CitationProvider`, registered
in [`src/providers/registry.ts`](src/providers/registry.ts).

### Why not Google Scholar?

Google Scholar has **no official API** and its terms prohibit scraping, and
NotebookLM is a document-Q&A tool, not a citation-graph API — so neither can be a
data provider here. For Scholar-like coverage, use the **Semantic Scholar**
provider. A paid [SerpAPI Google Scholar](https://serpapi.com/google-scholar-api)
adapter (which shoulders the scraping/ToS) could be added later as another
`CitationProvider` using a user-supplied key.

## Features

- **Author → paper → network** exploration, expanding _N_ layers deep.
- **Direction toggle**: follow citers (incoming), references (outgoing), or both.
- **Chain/clique analysis**: detects citation chains, colors them, and lists each
  one's keywords, year range and lead authors in the sidebar.
- **Interactive graph** (Cytoscape.js): zoom/pan, hover tooltips, click a node to
  expand, ⌘/Ctrl-click to re-root.
- **History/undo**: every expansion is snapshotted; click a chip to step back.
- **Import / export / share**: download the graph as JSON, re-import it, or copy a
  self-contained `?g=…` share link (compressed). Legacy `?data=<url>` links still load.
- **Resilient loading**: a single cancellable run (Stop button), concurrency
  limiting, retry-with-backoff, and a size-guarded localStorage cache.

## Tech stack

[Vite](https://vite.dev) · TypeScript (strict) · [Cytoscape.js](https://js.cytoscape.org)
(Sugiyama-style hierarchical layout via [`@dagrejs/dagre`](https://github.com/dagrejs/dagre) run
directly, with edges drawn as smooth curves routed through dagre's layered bend points;
[`cytoscape-fcose`](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) for the force layout) ·
[Vitest](https://vitest.dev). No jQuery, Bootstrap, dagre-d3 or jsnetworkx.

```
src/
  providers/   CitationProvider interface + OpenAlex / Semantic Scholar adapters
  graph/       in-memory model, BFS expansion, clique detection
  viz/         Cytoscape view + color palette
  ui/          sidebar, history, import/export
  main.ts      app orchestration
```

## Development

```bash
npm install
npm run dev        # local dev server (http://localhost:5173/VibePaWiz/)
npm test           # unit tests (providers, graph, cliques, colors, import/export)
npm run typecheck  # tsc --noEmit
npm run build      # type-check + production build to dist/
npm run preview     # preview the production build
```

## Deployment

`npm run build` produces a static `dist/` deployable anywhere. The included
[GitHub Pages workflow](.github/workflows/deploy.yml) builds and deploys on every
push to `master`. The Vite `base` defaults to `/VibePaWiz/` (the project-pages
path); override it with `VPW_BASE=/ npm run build` for a custom domain or root.

## Credits

Original SciPaWiz by [@MARATVE](https://github.com/MARATVE),
[@Koenkalle](https://github.com/Koenkalle) and
[@KristofferStrube](https://github.com/KristofferStrube), for the Data
Visualization course (2020) at Aarhus University.
