interface ColNode {
  id: string;
  year?: number;
}
interface ColEdge {
  source: string;
  target: string;
}

/**
 * Assign each node a column index for the year-ordered hierarchical layout,
 * computed purely from the visible nodes and real edges (no helper nodes).
 *
 * Edges are in cited→citing orientation (`source` is cited, `target` builds on
 * it). Each publication year forms a contiguous block of columns; within a year,
 * a paper that cites an earlier same-year paper sits one column deeper (the
 * longest same-year citation chain sets the block's width). Year blocks are laid
 * out chronologically, so every paper of a later year is right of the entire
 * earlier block — even nodes with no cross-year edge.
 */
export function computeYearColumns(nodes: ColNode[], edges: ColEdge[]): Map<string, number> {
  const yearOf = new Map<string, number>();
  for (const n of nodes) if (typeof n.year === 'number') yearOf.set(n.id, n.year);

  // Same-year predecessors: for a target, the same-year nodes it cites.
  const sameYearPreds = new Map<string, string[]>();
  for (const e of edges) {
    const ys = yearOf.get(e.source);
    if (ys !== undefined && ys === yearOf.get(e.target)) {
      (sameYearPreds.get(e.target) ?? sameYearPreds.set(e.target, []).get(e.target)!).push(
        e.source,
      );
    }
  }

  // Longest same-year citation chain ending at each node (cycle-guarded DFS).
  const depth = new Map<string, number>();
  const active = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (active.has(id)) return 0; // cycle
    active.add(id);
    let d = 0;
    for (const p of sameYearPreds.get(id) ?? []) d = Math.max(d, depthOf(p) + 1);
    active.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of yearOf.keys()) depthOf(id);

  // Chronological block layout: each year occupies (maxDepth + 1) columns.
  const years = [...new Set(yearOf.values())].sort((a, b) => a - b);
  const maxDepth = new Map<number, number>();
  for (const [id, y] of yearOf) maxDepth.set(y, Math.max(maxDepth.get(y) ?? 0, depth.get(id)!));
  const blockStart = new Map<number, number>();
  let acc = 0;
  for (const y of years) {
    blockStart.set(y, acc);
    acc += (maxDepth.get(y) ?? 0) + 1;
  }

  const columns = new Map<string, number>();
  for (const [id, y] of yearOf) columns.set(id, blockStart.get(y)! + depth.get(id)!);

  // Nodes without a year: place just right of the newest paper they cite (their
  // highest-column predecessor), iterating a few times to propagate through short
  // chains of undated nodes. The view marks these with a dashed border to flag
  // that the position is approximated rather than derived from a real year.
  const undated = nodes.filter((n) => !yearOf.has(n.id)).map((n) => n.id);
  if (undated.length) {
    const preds = new Map<string, string[]>();
    for (const e of edges) {
      (preds.get(e.target) ?? preds.set(e.target, []).get(e.target)!).push(e.source);
    }
    for (let i = 0; i <= undated.length; i++) {
      for (const id of undated) {
        let c = 0;
        for (const p of preds.get(id) ?? []) c = Math.max(c, (columns.get(p) ?? 0) + 1);
        columns.set(id, c);
      }
    }
  }
  return columns;
}

/**
 * Educated-guess publication year for each undated node: the newest year among
 * the papers it cites (real or already-guessed), propagated through chains of
 * undated citers. Edges are cited→citing (`source` cited, `target` citing), so a
 * node's cited papers are the sources of edges pointing at it. Meant to be fed the
 * real citation edges (not the display-filtered ones), so the guess — and the
 * year-column/year-band placement derived from it — is identical in Split and
 * Abridged. A node that cites nothing dated gets no guess and stays truly undated.
 */
export function guessYears(nodes: ColNode[], edges: ColEdge[]): Map<string, number> {
  const guess = new Map<string, number>();
  const real = new Map<string, number>();
  for (const n of nodes) if (typeof n.year === 'number') real.set(n.id, n.year);
  const undated = nodes.filter((n) => typeof n.year !== 'number').map((n) => n.id);
  if (!undated.length) return guess;

  const cites = new Map<string, string[]>();
  for (const e of edges) {
    (cites.get(e.target) ?? cites.set(e.target, []).get(e.target)!).push(e.source);
  }
  // Iterate so a guess can flow through a short chain of undated citers.
  for (let i = 0; i <= undated.length; i++) {
    for (const id of undated) {
      let best: number | undefined;
      for (const p of cites.get(id) ?? []) {
        const y = real.get(p) ?? guess.get(p);
        if (y !== undefined && (best === undefined || y > best)) best = y;
      }
      if (best !== undefined) guess.set(id, best);
    }
  }
  return guess;
}

/**
 * Pick which nodes to pin to the year-column "spine" in the hierarchical layout,
 * and how wide that spine must be. dagre's `minlen` only ties *connected* nodes
 * to each other, so a node that is no edge's head (a source — including isolated
 * singletons and the leftmost node of a disconnected later-year component) gets
 * ranked at the global origin and drifts out of its year band. Anchoring every
 * source to its own column pins every component's absolute rank: in an acyclic
 * layered graph every node is reachable from a source, so once all sources sit on
 * their column the rest follow via their real edges.
 *
 * The layout orients every edge from its lower-column to its higher-column
 * endpoint (so a backward-in-time citation can't drag the older paper rightward),
 * so a node is a "head" — and thus not a source — only when it is the
 * higher-column endpoint of some edge. We mirror that orientation here from the
 * columns map rather than trusting each edge's stored direction.
 *
 * `maxColumn` is the highest column index present (the spine spans `0..maxColumn`).
 * Pass `allNodes` to anchor *every* node instead of just sources — unconditionally
 * correct, at the cost of one extra (short) layout edge per node.
 */
export function columnAnchors(
  columns: Map<string, number>,
  edges: ColEdge[],
  opts: { allNodes?: boolean } = {},
): { maxColumn: number; anchors: Array<{ id: string; column: number }> } {
  let maxColumn = -1;
  for (const c of columns.values()) maxColumn = Math.max(maxColumn, c);

  const heads = new Set<string>();
  if (!opts.allNodes) {
    for (const e of edges) {
      const cs = columns.get(e.source) ?? 0;
      const ct = columns.get(e.target) ?? 0;
      heads.add(ct >= cs ? e.target : e.source); // the higher-column endpoint
    }
  }

  const anchors: Array<{ id: string; column: number }> = [];
  for (const [id, column] of columns) {
    if (opts.allNodes || !heads.has(id)) anchors.push({ id, column });
  }
  return { maxColumn, anchors };
}
