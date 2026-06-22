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

## Display settings

The **Display** panel controls how the loaded network is laid out and drawn.
Everything here restyles the _current_ graph instantly — no re-fetch — and is
saved into snapshots, JSON exports and share links. Year order and Prioritize
chains apply only to the two hierarchical layouts and are disabled for
Force-directed.

### Layout

Where the nodes are placed. Origin/oldest paper on the left in the hierarchical
layouts.

| Layout (UI label)          | Value           | What it does                                                                                            |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| **Hierarchical (compact)** | `dagre-compact` | Sugiyama-style layered layout using dagre's `network-simplex` ranker, which minimizes total edge length for a tighter result. |
| **Hierarchical (wide)**    | `dagre`         | Same layered layout with the `tight-tree` ranker — a wider, more spread-out spacing of the ranks.       |
| **Force-directed**         | `fcose`         | Physics-style [fcose](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) layout. No year axis; positions are remembered across restyles so toggling a flag doesn't reshuffle the graph. |

### Toggles

- **Color chains** — give each detected chain its own rainbow hue; edges shared by
  several chains blend into a gradient. When off, chain edges are drawn a neutral
  dark grey so the structure still reads without colour.
- **Year order (left→right)** — position nodes horizontally by publication year
  (oldest left), with a labelled background band per year. Papers with no year get
  a dashed border and sit just right of the newest paper they cite (an educated
  guess). _Hierarchical layouts only._
- **Prioritize chains (fewer chain crossings)** — weight chain edges in the layout
  so coloured chains stay straighter and are crossed/lengthened less, letting the
  unimportant dotted non-chain edges absorb the crossings instead. _Hierarchical
  layouts only._
- **Simplify chains (hide redundant edges)** — draw each chain as a single forward
  path and hide the redundant edges inside it (the original SciPaWiz chain
  simplification). When off, those redundant intra-chain edges are shown dashed.

### Chain collapsing

Three controls work together to fuse overlapping chains into bigger groups. They
have **no effect at Collapse 0** (every chain stays separate).

**Collapse chains** (slider, 0–20) — how aggressively to fuse chains that share
papers. 0 keeps every chain distinct; higher values fuse chains that overlap more
loosely.

**Collapse style** — the metric deciding whether two overlapping chains fuse at the
current Collapse level (`overlap` = shared papers, `a`/`b` = chain lengths):

| Style (UI label)    | Value        | Fuses two chains when…                                                                                                                   |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Overlap ratio**   | `ratio`      | their shared fraction `overlap / union ≥ 1/(collapse+1)`. Scales with chain size, so a single shared "hub" paper won't fuse chains until the slider is very loose. |
| **Node difference** | `difference` | the total number of differing papers across both chains is `≤ collapse`.                                                                |
| **Shared edge**     | `bridge`     | each chain's count of unique (non-shared) papers is `≤ collapse`, **and** they share at least an edge (≥ 2 papers) — so a lone shared paper never bridges. |

**Merge style** — what fusing actually does to each grouped set of chains:

| Style (UI label) | Value      | Effect                                                                                                                                      |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Split**        | `split`    | recolour the related chains the same hue but leave the layout untouched — the member chains stay drawn separately.                           |
| **Abridged**     | `abridged` | combine each group into one forward, citation-ordered path; synthetic connectors fill any gaps so the merged chain reads as one continuous line. |

### Reading the graph

A few cues are always on, independent of the settings above:

- **Node size & number** — both encode the paper's citer count _within the loaded
  graph_ (bigger = cited by more loaded papers).
- **Red-bordered node** — the seed/origin paper the graph was rooted on.
- **Purple dotted arrow** — a backward-in-time citation (an older paper citing a
  newer one); the arrow points at the newer paper.
- **Red dashed arrow** — an edge dropped to break a citation cycle; drawn so the
  anomaly stays visible but excluded from all layout and chain calculations.

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

`npm run build` produces a static `dist/` deployable anywhere. Asset paths are
**relative** (`base: './'`), so the build works at a user/org page
(`https://<user>.github.io/`), a project page (`…/VibePaWiz/`), or a custom domain
without configuration.

**GitHub Pages:** the included [workflow](.github/workflows/deploy.yml) builds and
deploys `dist/` on every push to `main`/`master`. For it to take effect you must set
the Pages source to GitHub Actions — **Settings → Pages → Build and deployment →
Source: “GitHub Actions”**. If it's left on “Deploy from a branch”, Pages serves the
repo's source `index.html` (which points at the dev entry `/src/main.ts`) and the
page fails with a `text/html` MIME error — that's the symptom of this misconfiguration,
not a build problem.

## Credits

Original SciPaWiz by [@MARATVE](https://github.com/MARATVE),
[@Koenkalle](https://github.com/Koenkalle) and
[@KristofferStrube](https://github.com/KristofferStrube), for the Data
Visualization course (2020) at Aarhus University.
