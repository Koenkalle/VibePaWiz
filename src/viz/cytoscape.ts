import cytoscape from 'cytoscape';
import type { Core, EdgeSingular, ElementDefinition, EventObject } from 'cytoscape';
import dagre from '@dagrejs/dagre';
import fcose from 'cytoscape-fcose';
import { columnAnchors, computeYearColumns, guessYears } from '../graph/columns';
import type { GraphModel } from '../graph/model';
import type { Clique, GraphEdge, Settings } from '../types';

cytoscape.use(fcose);

const NODE_FILL = '#d6dbe0';
const NODE_STROKE = '#2b2f33';
const EDGE_GREY = '#9aa3ab';
/** Neutral color for chain edges when "Color chains" is off. */
const EDGE_NEUTRAL = '#444a50';
/**
 * Per-chain dagre edge-weight bonus when "Prioritize chains" is on. weight =
 * 1 + chains*CHAIN_EDGE_WEIGHT, so a 0-chain dotted edge stays at 1 while chain
 * edges are kept straighter and crossed less (and multi-chain edges most of all).
 */
const CHAIN_EDGE_WEIGHT = 200;

export interface GraphViewCallbacks {
  /** Plain click on a node — expand the network from it. */
  onExpandNode: (id: string) => void;
  /** Ctrl/⌘-click on a node — start a fresh graph rooted there. */
  onRerootNode: (id: string) => void;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Convert a dagre-routed edge path into Cytoscape `unbundled-bezier`
 * control points. Cytoscape places each control point at
 * `M + d·N`, where `M` is the point at weight `w` along source→target and
 * `N = (-dy, dx)/len` (see cytoscape edge-control-points.mjs). Inverting that
 * for each interior bend point `P` gives the weight/distance pair below.
 */
export function bendControlPoints(
  src: Pt,
  tgt: Pt,
  points: Pt[],
): { weights: number[]; distances: number[] } {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const len2 = dx * dx + dy * dy;
  const len = Math.sqrt(len2);
  const weights: number[] = [];
  const distances: number[] = [];
  if (len > 0) {
    // Each (weight, distance) is correct relative to the src→tgt line regardless
    // of point order; sort by weight so the control points always run source→
    // target, even when dagre routed the edge in the opposite (hi→lo) direction.
    const pairs: Array<{ w: number; d: number }> = [];
    for (const p of points.slice(1, -1)) {
      const ex = p.x - src.x;
      const ey = p.y - src.y;
      const w = (ex * dx + ey * dy) / len2;
      if (w <= 0 || w >= 1) continue; // outside the segment → skip
      pairs.push({ w: Number(w.toFixed(4)), d: Number(((-ex * dy + ey * dx) / len).toFixed(2)) });
    }
    pairs.sort((a, b) => a.w - b.w);
    for (const { w, d } of pairs) {
      weights.push(w);
      distances.push(d);
    }
  }
  // A single midpoint with zero offset renders as a straight line.
  if (weights.length === 0) return { weights: [0.5], distances: [0] };
  return { weights, distances };
}

/**
 * Turn per-year x-extents (already in chronological order) into non-overlapping,
 * forward-tiling band `[left, right]` rects. Boundaries are forced monotonic:
 * each band starts where the previous ended, and the shared edge is the midpoint
 * between adjacent years' extents — but clamped so a later year whose nodes
 * drifted left of an earlier one can never invert or overlap the bands. The
 * chronological order of the input is authoritative; positions only refine
 * boundary placement.
 */
export function yearBandRects(
  ext: Array<{ x1: number; x2: number }>,
  pad: number,
): Array<{ left: number; right: number }> {
  const n = ext.length;
  if (n === 0) return [];
  const rects: Array<{ left: number; right: number }> = [];
  let left = ext[0]!.x1 - pad;
  let runningMax = -Infinity; // furthest-right node extent seen so far
  for (let i = 0; i < n; i++) {
    runningMax = Math.max(runningMax, ext[i]!.x2);
    let right =
      i === n - 1 ? runningMax + pad : Math.max((ext[i]!.x2 + ext[i + 1]!.x1) / 2, runningMax); // midpoint, forced forward
    right = Math.max(right, left + 1); // never zero/negative width
    rects.push({ left, right });
    left = right; // next band starts where this one ends
  }
  return rects;
}

/** Per-edge presentation derived from clique membership. */
interface EdgeStyle {
  id: string;
  /** Model orientation (citing → cited). */
  source: string;
  target: string;
  color: string;
  width: number;
  lineStyle: 'solid' | 'dashed';
  /** How many chains (size ≥ 3) this edge is part of; drives dagre layout priority. */
  priority: number;
  /** Anti-chronological citation: an older paper cites a newer one (year(citer) < year(cited)). */
  backward?: boolean;
  /** Two or more chain colors → render as a blended gradient. */
  gradient?: string[];
}

/**
 * Cytoscape-based renderer. Reproduces the original SciPaWiz visual encoding:
 * origin/oldest on the left, node radius + centered number = citer count,
 * arrowless edges, citation chains colored by hue with non-chain edges dashed,
 * multi-chain edges blended, plus hover-to-highlight and an optional year axis.
 */
export class GraphView {
  private cy: Core;
  private tooltip: HTMLElement;
  /** clique index → ids of its consecutive-pair edges (for highlight). */
  private cliqueEdges = new Map<number, string[]>();
  /** edge id → indices of cliques that contain it (for edge-hover highlight). */
  private edgeCliques = new Map<string, number[]>();
  /** SVG overlay (and its transformed group) drawing the year background bands. */
  private bandLayer: SVGElement;
  private bandGroup: SVGElement;
  /** True once the user has manually panned/zoomed; suppresses auto-fit. */
  private viewportTouched = false;
  /** Guards viewport events fired by our own fit() so they aren't seen as user input. */
  private programmaticView = false;
  /** Last layout name rendered, to detect layout switches (force a relayout). */
  private prevLayout: string | null = null;

  constructor(container: HTMLElement, cb: GraphViewCallbacks) {
    this.cy = cytoscape({
      container,
      wheelSensitivity: 0.3,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': NODE_FILL,
            'border-color': NODE_STROKE,
            'border-width': 2,
            label: 'data(label)',
            'font-size': 12,
            color: '#222',
            'text-valign': 'center',
            'text-halign': 'center',
            width: 'data(size)',
            height: 'data(size)',
          },
        },
        // Paper with no publication year: dashed border marks that its year-column
        // position is approximated (placed just right of the newest paper it cites)
        // rather than derived from a real year. Only set in the year-ordered layout.
        {
          selector: 'node.no-year',
          style: { 'border-style': 'dashed' },
        },
        // The origin/seed paper: thick red border so it's easy to spot.
        {
          selector: 'node.seed',
          style: { 'border-color': '#d9534f', 'border-width': 5 },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-shape': 'none',
            // Smooth edges routed through dagre's layered bend points.
            'curve-style': 'unbundled-bezier',
            opacity: 0.95,
          },
        },
        // Non-chain / lone-pair edges: dashed and de-emphasized.
        {
          selector: 'edge.dashed',
          style: { 'line-style': 'dashed', opacity: 0.4 },
        },
        // Backward-in-time citation (older paper cites a newer one). The Cytoscape
        // edge runs cited→citing, so its `source` is the newer paper: a source-arrow
        // points at the newer paper, marking the anomalous forward-in-time direction.
        {
          selector: 'edge.backward',
          style: {
            'line-style': 'dotted',
            'line-color': '#c026d3',
            'source-arrow-shape': 'triangle',
            'source-arrow-color': '#c026d3',
            'arrow-scale': 0.8,
            opacity: 0.95,
          },
        },
        // An edge dropped to break a citation cycle: shown so the anomaly is visible
        // (red, dashed, arrow from citer → cited) but excluded from every layout and
        // calculation. Drawn straight since it never enters dagre's routing.
        {
          selector: 'edge.cycle-removed',
          style: {
            'curve-style': 'straight',
            'line-style': 'dashed',
            'line-color': '#dc2626',
            'line-dash-pattern': [6, 3],
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#dc2626',
            'arrow-scale': 0.9,
            width: 2.5,
            opacity: 0.85,
            'z-index': 5,
          },
        },
        {
          selector: 'edge.highlight',
          style: { width: 10, opacity: 1, 'line-style': 'solid', 'z-index': 20 },
        },
      ],
    });

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'cy-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);

    // Year-band overlay: an SVG laid over the graph (pointer-events disabled) whose
    // group is transformed to match the Cytoscape viewport, so bands drawn in model
    // coordinates track pan/zoom.
    const svgNs = 'http://www.w3.org/2000/svg';
    this.bandLayer = document.createElementNS(svgNs, 'svg');
    this.bandLayer.setAttribute('class', 'cy-year-bands');
    this.bandGroup = document.createElementNS(svgNs, 'g');
    this.bandLayer.appendChild(this.bandGroup);
    // Behind the (transparent) Cytoscape canvas so bands read as a background.
    container.insertBefore(this.bandLayer, container.firstChild);
    this.cy.on('pan zoom resize', () => this.syncBands());
    // Any pan/zoom not triggered by our own fit() means the user moved the view.
    this.cy.on('pan zoom', () => {
      if (!this.programmaticView) this.viewportTouched = true;
    });

    this.cy.on('tap', 'node', (evt: EventObject) => {
      const orig = evt.originalEvent as MouseEvent | undefined;
      const id = evt.target.id();
      if (orig && (orig.ctrlKey || orig.metaKey)) cb.onRerootNode(id);
      else cb.onExpandNode(id);
    });

    this.cy.on('mouseover', 'node', (evt: EventObject) => this.showTooltip(evt));
    this.cy.on('mouseout', 'node', () => this.hideTooltip());
    this.cy.on('pan zoom drag', () => this.hideTooltip());

    // Hovering an edge lights up every chain it belongs to (no zoom).
    this.cy.on('mouseover', 'edge', (evt: EventObject) => {
      const indices = this.edgeCliques.get(evt.target.id());
      if (indices) this.highlightChains(indices, false);
    });
    this.cy.on('mouseout', 'edge', () => this.clearHighlight());
  }

  private showTooltip(evt: EventObject): void {
    const d = evt.target.data();
    const authors = (d.authors as string[] | undefined)?.slice(0, 4).join(', ') ?? '';
    const cited = d.citedByCount != null ? `${d.citedByCount} citations (global)` : '';
    this.tooltip.innerHTML = `
      <div class="tt-title">${escapeHtml(d.title ?? '')}</div>
      <div class="tt-meta">${escapeHtml(authors)}</div>
      <div class="tt-meta">${[d.year, escapeHtml(d.venue ?? '')].filter(Boolean).join(' · ')}</div>
      <div class="tt-meta">${cited}</div>`;
    const box = (evt.target.renderedBoundingBox?.() ?? null) as { x2?: number; y1?: number } | null;
    const rect = (this.cy.container() as HTMLElement).getBoundingClientRect();
    const x = rect.left + window.scrollX + (box?.x2 ?? 0) + 8;
    const y = rect.top + window.scrollY + (box?.y1 ?? 0);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
    this.tooltip.style.display = 'block';
  }

  private hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }

  /**
   * Rebuild the canvas from the model + detected cliques and run the layout.
   * `visible` is the set of node ids that pass the rendering rule (see
   * graph/visibility.ts); nodes and edges outside it are not drawn. `fit`
   * controls whether the viewport is re-centered — false preserves the user's
   * current pan/zoom (e.g. when expanding by clicking a node).
   */
  render(
    model: GraphModel,
    cliques: Clique[],
    settings: Settings,
    visible: Set<string>,
    fit: boolean,
    seedId: string | null,
    removed: GraphEdge[] = [],
  ): void {
    const citerCounts = model.inDegrees();
    const maxCiters = Math.max(1, ...citerCounts.values());
    const removedKeys = new Set(removed.map((e) => e.source + ' ' + e.target));
    const { styles, cliqueEdges, edgeCliques } = buildEdgeStyles(
      model,
      cliques,
      settings.colors,
      visible,
      settings.simplifyChains,
      removedKeys,
    );
    this.cliqueEdges = cliqueEdges;
    this.edgeCliques = edgeCliques;

    const hierarchical = settings.layout !== 'fcose';
    // Flag undated papers only where their position is actually year-approximated:
    // the year-ordered layout places them just right of the newest paper they cite.
    const markNoYear = hierarchical && settings.yearOrder;

    // Educated-guess year for undated papers: the newest year among the papers
    // they cite (propagated through chains of undated citers), from the real
    // citation edges so it's identical in Split and Abridged. Stored as `effYear`
    // and used for the column placement and year bands below, so an undated node
    // sits inside the year belt of the newest paper it cites instead of drifting
    // into the gaps between belts. `year` stays the real value (tooltip + marker).
    const guessYear = guessYears(
      model
        .getNodes()
        .filter((n) => visible.has(n.id))
        .map((n) => ({ id: n.id, year: n.year })),
      model
        .getEdges()
        .filter((e) => visible.has(e.source) && visible.has(e.target))
        .map((e) => ({ source: e.target, target: e.source })), // model is citer→cited; flip to cited→citing
    );

    const elements: ElementDefinition[] = [];
    for (const node of model.getNodes()) {
      if (!visible.has(node.id)) continue;
      const citers = citerCounts.get(node.id) ?? 0;
      const classes =
        [
          node.id === seedId ? 'seed' : '',
          markNoYear && typeof node.year !== 'number' ? 'no-year' : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined;
      elements.push({
        data: {
          id: node.id,
          label: String(citers),
          // Diameter scaled to citer count (ported from r = 60·c/max + 20).
          size: 28 + 64 * (citers / maxCiters),
          title: node.title,
          authors: node.authors,
          year: node.year,
          // Real year, or the educated guess for undated papers (layout + bands only).
          effYear: node.year ?? guessYear.get(node.id),
          venue: node.venue,
          citedByCount: node.citedByCount,
        },
        classes,
      });
    }

    const gradientEdges: Array<{ id: string; colors: string[] }> = [];
    for (const s of styles) {
      const classes = [s.lineStyle === 'dashed' ? 'dashed' : '', s.backward ? 'backward' : '']
        .filter(Boolean)
        .join(' ');
      // Orient cited→citing so dagre puts the origin/oldest paper on the left.
      elements.push({
        data: {
          id: s.id,
          source: s.target,
          target: s.source,
          color: s.color,
          width: s.width,
          priority: s.priority,
        },
        classes: classes || undefined,
      });
      if (s.gradient) gradientEdges.push({ id: s.id, colors: s.gradient });
    }

    // Cycle-removed edges: drawn (citer → cited) only when both papers are on
    // screen, and tagged so the layouts below skip them entirely.
    for (const e of removed) {
      if (!visible.has(e.source) || !visible.has(e.target)) continue;
      elements.push({
        data: { id: `cyc:${e.source}__${e.target}`, source: e.source, target: e.target },
        classes: 'cycle-removed',
      });
    }

    // Remember positions so the force layout can stay put across re-renders.
    const prevPos = new Map<string, { x: number; y: number }>();
    this.cy.nodes().forEach((n) => {
      prevPos.set(n.id(), { x: n.position('x'), y: n.position('y') });
    });

    this.cy.elements().remove();
    this.cy.add(elements);

    // Inline gradient styling for multi-chain edges (can't be expressed via data mappers).
    for (const { id, colors } of gradientEdges) {
      const stops = colors.map((_, i) => Math.round((i / (colors.length - 1)) * 100)).join(' ');
      this.cy.getElementById(id).style({
        'line-fill': 'linear-gradient',
        'line-gradient-stop-colors': colors.join(' '),
        'line-gradient-stop-positions': stops,
      });
    }

    // Auto-fit only when requested AND the user hasn't taken over the viewport.
    const shouldFit = fit && !this.viewportTouched;
    const layoutChanged = this.prevLayout !== null && this.prevLayout !== settings.layout;
    this.prevLayout = settings.layout;

    if (hierarchical) {
      // network-simplex minimizes total edge length (compact); tight-tree spreads wider.
      const ranker = settings.layout === 'dagre-compact' ? 'network-simplex' : 'tight-tree';
      this.applyHierarchicalLayout(ranker, settings.yearOrder, settings.prioritizeChains);
      if (shouldFit) this.fitView();
    } else {
      this.applyForceLayout(prevPos, layoutChanged, shouldFit);
    }

    this.updateYearBands(hierarchical && settings.yearOrder);
  }

  /** Fit the viewport, flagged so the resulting pan/zoom isn't seen as user input. */
  private fitView(): void {
    this.programmaticView = true;
    this.cy.fit(undefined, 40);
    // Reset after the event loop tick so any async viewport events are still guarded.
    setTimeout(() => {
      this.programmaticView = false;
    }, 0);
  }

  /** Clear the "user moved the view" flag, re-enabling auto-fit (on a fresh Build). */
  resetViewportTracking(): void {
    this.viewportTouched = false;
  }

  /**
   * Force-directed (fcose) layout. Restores prior node positions so changing a
   * display flag doesn't reshuffle (or break) the view. Runs fcose only when
   * needed — first layout, layout switch, or new nodes — and randomizes only on
   * a genuinely fresh layout; a pure restyle keeps positions untouched.
   */
  private applyForceLayout(
    prevPos: Map<string, { x: number; y: number }>,
    layoutChanged: boolean,
    shouldFit: boolean,
  ): void {
    this.cy.edges().style('curve-style', 'straight');

    let hasNew = false;
    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => {
        const p = prevPos.get(n.id());
        if (p) n.position(p);
        else hasNew = true;
      });
    });

    const fresh = prevPos.size === 0 || layoutChanged;
    if (!fresh && !hasNew) {
      // Pure restyle: positions already restored, nothing to lay out.
      if (shouldFit) this.fitView();
      return;
    }

    // Seed any new nodes inside the existing spread so a non-randomized fcose
    // settles them without flinging the rest around.
    if (!fresh && hasNew) {
      const xs = [...prevPos.values()];
      const minX = Math.min(...xs.map((p) => p.x));
      const maxX = Math.max(...xs.map((p) => p.x));
      const minY = Math.min(...xs.map((p) => p.y));
      const maxY = Math.max(...xs.map((p) => p.y));
      this.cy.batch(() => {
        this.cy.nodes().forEach((n) => {
          if (prevPos.has(n.id())) return;
          n.position({
            x: minX + Math.random() * Math.max(1, maxX - minX),
            y: minY + Math.random() * Math.max(1, maxY - minY),
          });
        });
      });
    }

    // Lay out over everything except cycle-removed edges so they exert no force
    // (all nodes are still included, so every node is positioned).
    const layout = this.cy
      .elements()
      .not('.cycle-removed')
      .layout({
        name: 'fcose',
        animate: false,
        fit: false,
        randomize: fresh,
      } as never);
    if (shouldFit) layout.one('layoutstop', () => this.fitView());
    layout.run();
  }

  /**
   * Sugiyama-style layered layout via dagre, run directly (not through
   * cytoscape-dagre) so we can read each edge's routed bend points and render
   * them as smooth `unbundled-bezier` curves — the layered routing the original
   * SciPaWiz got from dagre-d3 + d3.curveBasis. `ranker` selects dagre's
   * layer-assignment heuristic (network-simplex = shorter edges).
   *
   * When `yearOrder` is on, each node's column is computed separately
   * (graph/columns) from year + intra-year depth and encoded as per-edge `minlen`
   * constraints, so dagre's own Sugiyama pipeline lays the graph out on the
   * year-column ranks (no post-hoc x override). Because `minlen` only ties
   * *connected* nodes to each other, every node that no edge points at (a source —
   * incl. isolated singletons and the leftmost node of a disconnected later-year
   * component) would otherwise rank at the global origin and drift out of its year
   * band. To prevent that we add an invisible per-column "spine" to the dagre graph
   * (never to Cytoscape, never read back) and anchor each source to its column, so
   * every component's absolute rank is pinned to its true year (see columnAnchors).
   */
  private applyHierarchicalLayout(ranker: string, yearOrder: boolean, prioritize: boolean): void {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'LR', ranker, nodesep: 30, edgesep: 30, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeYears: Array<{ id: string; year?: number }> = [];
    this.cy.nodes().forEach((n) => {
      g.setNode(n.id(), { width: n.outerWidth(), height: n.outerHeight() });
      // effYear = real year, or the educated guess for undated papers, so an
      // undated node is laid out in the year column of the newest paper it cites.
      const y = n.data('effYear');
      nodeYears.push({ id: n.id(), year: typeof y === 'number' ? y : undefined });
    });

    // Cycle-removed edges are display-only: keep them out of the layout entirely.
    const layoutEdges = this.cy.edges().filter((e: EdgeSingular) => !e.hasClass('cycle-removed'));

    const distinctYears = new Set(
      nodeYears.map((n) => n.year).filter((y): y is number => y !== undefined),
    ).size;
    const colEdges = layoutEdges.map((e: EdgeSingular) => ({
      source: e.source().id(),
      target: e.target().id(),
    }));
    // Year columns are encoded as per-edge minlen, so dagre's own (complete,
    // iterated) Sugiyama pipeline lays the graph out *on* the year-column ranks
    // — no post-hoc x override. minlen = the column difference is the
    // minimum-length feasible ranking, which dagre reproduces exactly, and it
    // still routes edges (smooth bend points) through intervening columns.
    const columns =
      yearOrder && distinctYears >= 2 ? computeYearColumns(nodeYears, colEdges) : null;

    // When year columns are active, orient every dagre edge from its lower-column
    // to its higher-column endpoint, so a backward-in-time citation (an older
    // paper citing a newer one) can't drag the older paper rightward out of its
    // year band. Forward and same-column edges keep their stored source→target
    // order. The same orientation is reused on read-back to find each edge.
    const dagreEnds = (sId: string, tId: string): [string, string] => {
      if (!columns) return [sId, tId];
      const cs = columns.get(sId) ?? 0;
      const ct = columns.get(tId) ?? 0;
      return ct >= cs ? [sId, tId] : [tId, sId];
    };

    layoutEdges.forEach((e) => {
      const sId = e.source().id();
      const tId = e.target().id();
      const [lo, hi] = dagreEnds(sId, tId);
      const minlen = columns
        ? Math.max(1, Math.abs((columns.get(tId) ?? 0) - (columns.get(sId) ?? 0)))
        : 1;
      // Weight chain edges above non-chain dotted edges (and multi-chain above
      // single-chain), so dagre keeps higher-priority edges straighter and crosses
      // them less — letting unimportant dotted edges absorb crossings instead.
      const priority = (e.data('priority') as number | undefined) ?? 0;
      const weight = prioritize ? 1 + priority * CHAIN_EDGE_WEIGHT : 1;
      g.setEdge(lo, hi, { minlen, weight }, e.id());
    });

    if (columns) {
      // Invisible per-column spine that pins every component's absolute rank to
      // its true year column. anchor_i sits at rank i (a length-1 chain); each
      // anchored node is one rank past its column's anchor, so its rank is its
      // global column (a uniform offset across all components). These helper
      // nodes/edges never enter Cytoscape and are skipped on read-back below.
      const { maxColumn, anchors } = columnAnchors(columns, colEdges);
      const anchorId = (i: number): string => `__yearcol_anchor_${i}`;
      for (let i = 0; i <= maxColumn; i++) {
        g.setNode(anchorId(i), { width: 1, height: 1 });
        if (i > 0) g.setEdge(anchorId(i - 1), anchorId(i), { minlen: 1 }, `__yearcol_spine_${i}`);
      }
      for (const { id, column } of anchors) {
        g.setEdge(anchorId(column), id, { minlen: 1 }, `__yearcol_anchor_edge_${id}`);
      }
    }

    dagre.layout(g);

    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => {
        const dn = g.node(n.id());
        if (dn) n.position({ x: dn.x, y: dn.y });
      });
      layoutEdges.forEach((e) => {
        const sId = e.source().id();
        const tId = e.target().id();
        // Look up the dagre edge with the same orientation we inserted it under,
        // but project its routed points onto this edge's own source→target line
        // (bendControlPoints sorts by weight, so dagre's point order is moot).
        const [lo, hi] = dagreEnds(sId, tId);
        const de = g.edge(lo, hi, e.id());
        const src = g.node(sId);
        const tgt = g.node(tId);
        if (!de || !src || !tgt) return;
        const { weights, distances } = bendControlPoints(src, tgt, de.points);
        e.style({
          'control-point-weights': weights.join(' '),
          'control-point-distances': distances.join(' '),
        });
      });
    });
  }

  /** Glow the edges of the given cliques; optionally zoom to fit them. */
  highlightChains(indices: number[], fit: boolean): void {
    this.cy.edges().removeClass('highlight');
    const ids = new Set<string>();
    for (const i of indices) for (const id of this.cliqueEdges.get(i) ?? []) ids.add(id);
    if (ids.size === 0) return;
    const collection = this.cy.edges().filter((e: EdgeSingular) => ids.has(e.id()));
    collection.addClass('highlight');
    if (fit) {
      const nodes = collection.connectedNodes();
      if (nodes.length) this.cy.animate({ fit: { eles: nodes, padding: 60 }, duration: 500 });
    }
  }

  clearHighlight(): void {
    this.cy.edges().removeClass('highlight');
  }

  fit(): void {
    this.cy.fit(undefined, 40);
  }

  /**
   * Draw a background band per publication year (contiguous, tiled at the
   * midpoints between adjacent year columns) with the year labelled at the top.
   * Bands are drawn in model coordinates inside an SVG group that tracks the
   * Cytoscape viewport. Cleared when not in year-ordered hierarchical mode.
   */
  private updateYearBands(enabled: boolean): void {
    while (this.bandGroup.firstChild) this.bandGroup.removeChild(this.bandGroup.firstChild);
    if (!enabled) return;

    const byYear = new Map<number, { x1: number; x2: number }>();
    let top = Infinity;
    let bottom = -Infinity;
    this.cy.nodes().forEach((n) => {
      const bb = n.boundingBox();
      top = Math.min(top, bb.y1);
      bottom = Math.max(bottom, bb.y2);
      // effYear lets an undated node join the belt of the newest paper it cites.
      const y = n.data('effYear');
      if (typeof y !== 'number') return;
      const ex = byYear.get(y);
      if (ex) {
        ex.x1 = Math.min(ex.x1, bb.x1);
        ex.x2 = Math.max(ex.x2, bb.x2);
      } else {
        byYear.set(y, { x1: bb.x1, x2: bb.x2 });
      }
    });
    const years = [...byYear.keys()].sort((a, b) => a - b);
    if (years.length === 0 || !Number.isFinite(top)) return;

    const ns = 'http://www.w3.org/2000/svg';
    const PAD = 40;
    const HEAD = 36;
    const rectY = top - HEAD;
    const rectH = bottom - top + HEAD + PAD;
    const ext = years.map((y) => byYear.get(y)!);
    const rects = yearBandRects(ext, PAD);
    years.forEach((year, i) => {
      const { left, right } = rects[i]!;

      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(left));
      rect.setAttribute('y', String(rectY));
      rect.setAttribute('width', String(Math.max(1, right - left)));
      rect.setAttribute('height', String(Math.max(1, rectH)));
      rect.setAttribute('fill', i % 2 === 0 ? 'rgba(47,111,237,0.06)' : 'rgba(47,111,237,0.12)');
      this.bandGroup.appendChild(rect);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', String((left + right) / 2));
      label.setAttribute('y', String(top - HEAD / 2));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#5a6675');
      label.setAttribute('font-size', '18');
      label.setAttribute('font-weight', '700');
      label.textContent = String(year);
      this.bandGroup.appendChild(label);
    });
    this.syncBands();
  }

  /** Match the band overlay's transform to the current Cytoscape pan/zoom. */
  private syncBands(): void {
    const z = this.cy.zoom();
    const p = this.cy.pan();
    this.bandGroup.setAttribute('transform', `translate(${p.x},${p.y}) scale(${z})`);
  }

  destroy(): void {
    this.tooltip.remove();
    this.bandLayer.remove();
    this.cy.destroy();
  }
}

function edgeId(source: string, target: string): string {
  return `e:${source}__${target}`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/**
 * Classify each model edge by chain membership and produce its style:
 * solid colored for chains (clique size ≥ 3), blended gradient for edges shared
 * by several chains, and dashed/de-emphasized for lone pairs or non-chain edges.
 *
 * Each chain is drawn as its citation-ordered consecutive-pair path, so a plain
 * clique (and everything at Collapse 0) is a clean forward single line. When
 * `simplify` is on and an Abridged-merged chain's path has gaps (consecutive nodes
 * with no real edge), each gap is bridged by a forward synthetic connector so the
 * chain stays one continuous forward line. When `simplify` is off, only the path
 * is coloured and the redundant edges are shown dashed (no connectors). Also
 * returns the maps for hover highlighting in both directions.
 */
function buildEdgeStyles(
  model: GraphModel,
  cliques: Clique[],
  useColors: boolean,
  visible: Set<string>,
  simplify: boolean,
  removed: Set<string> = new Set(),
): {
  styles: EdgeStyle[];
  cliqueEdges: Map<number, string[]>;
  edgeCliques: Map<string, number[]>;
} {
  // Only edges between two visible nodes are drawn; cycle-removed edges are styled
  // separately by the caller, so leave them out of the normal pipeline.
  const shown = model
    .getEdges()
    .filter(
      (e) =>
        visible.has(e.source) && visible.has(e.target) && !removed.has(e.source + ' ' + e.target),
    );
  const present = new Set(shown.map((e) => e.source + ' ' + e.target));
  const cliqueEdges = new Map<number, string[]>();
  const edgeCliques = new Map<string, number[]>();
  // Per edge key → colors from chains of size ≥ 3 (drives solid/gradient coloring).
  const chainColors = new Map<string, string[]>();
  // Node → indices of the size ≥ 3 chains it belongs to (for redundant-edge hiding).
  const bigChainOf = new Map<string, Set<number>>();
  // Forward connectors bridging gaps in an Abridged-merged chain (consecutive
  // citation-ordered nodes with no real edge): deduped by unordered node-pair and
  // emitted as extra styles after the loop.
  const spineConnectors: Array<{ id: string; older: string; newer: string; color: string }> = [];
  const spineSeen = new Set<string>();

  cliques.forEach((clique, index) => {
    const isChain = clique.nodes.length >= 3;
    if (isChain) {
      for (const n of clique.nodes) {
        let set = bigChainOf.get(n);
        if (!set) bigChainOf.set(n, (set = new Set()));
        set.add(index);
      }
    }

    // `clique.nodes` is in citation order (oldest first, forward in time).
    const parent = new Map<string, string>(clique.nodes.map((n) => [n, n]));
    const find = (x: string): string => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    };
    const ids: string[] = [];
    const keep = (a: string, b: string): void => {
      const fwd = a + ' ' + b;
      const rev = b + ' ' + a;
      const key = present.has(fwd) ? fwd : present.has(rev) ? rev : null;
      if (!key) return;
      const id = edgeId(...(key.split(' ') as [string, string]));
      ids.push(id);
      edgeCliques.set(id, [...(edgeCliques.get(id) ?? []), index]);
      if (isChain) chainColors.set(key, [...(chainColors.get(key) ?? []), clique.color]);
      parent.set(find(b), find(a));
    };

    // Pass A — the citation-ordered consecutive-pair path. For a true clique every
    // pair has a real edge, so this alone draws a clean forward line.
    for (let i = 0; i + 1 < clique.nodes.length; i++) keep(clique.nodes[i]!, clique.nodes[i + 1]!);

    // Pass B — when simplifying, bridge each remaining consecutive gap with a
    // forward synthetic connector so an Abridged-merged chain reads as one
    // continuous forward line. Gaps only occur in Abridged unions; Split and
    // Collapse-0 cliques are fully linked, so this adds nothing for them.
    // Only chains (size ≥ 3) get connectors: their nodes are always visible, so a
    // connector never points at a node that isn't drawn. Lone pairs (size 2) may
    // include a hidden node and must not be bridged.
    if (simplify && isChain) {
      for (let i = 0; i + 1 < clique.nodes.length; i++) {
        const older = clique.nodes[i]!;
        const newer = clique.nodes[i + 1]!;
        if (find(older) === find(newer)) continue;
        if (!visible.has(older) || !visible.has(newer)) continue;
        parent.set(find(newer), find(older));
        const seenKey = older + '|' + newer;
        if (spineSeen.has(seenKey)) continue;
        spineSeen.add(seenKey);
        const id = `syn:${older}__${newer}`;
        spineConnectors.push({ id, older, newer, color: useColors ? clique.color : EDGE_NEUTRAL });
        ids.push(id);
        edgeCliques.set(id, [...(edgeCliques.get(id) ?? []), index]);
      }
    }
    if (ids.length) cliqueEdges.set(index, ids);
  });

  // Both endpoints share a size ≥ 3 chain (an intra-chain edge).
  const sharesChain = (u: string, v: string): boolean => {
    const cu = bigChainOf.get(u);
    const cv = bigChainOf.get(v);
    return !!cu && !!cv && [...cu].some((i) => cv.has(i));
  };

  const styles: EdgeStyle[] = [];
  for (const e of shown) {
    const key = e.source + ' ' + e.target;
    const colors = chainColors.get(key) ?? [];
    const id = edgeId(e.source, e.target);
    // e.source cites e.target; flag the anomaly where the citer predates the cited.
    const yCiter = model.getNode(e.source)?.year;
    const yCited = model.getNode(e.target)?.year;
    const backward = typeof yCiter === 'number' && typeof yCited === 'number' && yCiter < yCited;
    const base = { id, source: e.source, target: e.target, backward };

    if (colors.length === 0) {
      // Redundant intra-chain edge (not on any chain path): hide when simplifying.
      if (simplify && sharesChain(e.source, e.target)) continue;
      // Non-chain / lone pair: dashed and de-emphasized.
      styles.push({ ...base, color: EDGE_GREY, width: 1.5, lineStyle: 'dashed', priority: 0 });
    } else if (!useColors) {
      styles.push({
        ...base,
        color: EDGE_NEUTRAL,
        width: 4,
        lineStyle: 'solid',
        priority: colors.length,
      });
    } else if (colors.length === 1) {
      styles.push({ ...base, color: colors[0]!, width: 4, lineStyle: 'solid', priority: 1 });
    } else {
      // Multi-chain: thicker, blended gradient of the chains' colors.
      styles.push({
        ...base,
        color: colors[0]!,
        width: 4 + 2 * (colors.length - 1),
        lineStyle: 'solid',
        gradient: colors,
        priority: colors.length,
      });
    }
  }

  // Spine connectors are not real edges, so emit them directly (citer→cited
  // orientation: newer → older, matching real edges so the layout reads them the
  // same way).
  for (const c of spineConnectors) {
    styles.push({
      id: c.id,
      source: c.newer,
      target: c.older,
      color: c.color,
      width: 4,
      lineStyle: 'solid',
      priority: 1,
    });
  }

  return { styles, cliqueEdges, edgeCliques };
}

// Exposed for unit tests.
export const __test = { buildEdgeStyles, EDGE_GREY, EDGE_NEUTRAL, yearBandRects };
