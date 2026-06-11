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

  // Nodes without a year: place just right of their predecessors (few iterations
  // to propagate through short chains of undated nodes).
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
