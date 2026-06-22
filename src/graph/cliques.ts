import type { Clique, CollapseStyle, GraphEdge, PaperMeta } from '../types';
import { guessYears } from './columns';
import { rainbow } from '../viz/colors';

const STOPWORDS = new Set([
  'for',
  'to',
  'from',
  'and',
  'or',
  'in',
  'the',
  'a',
  'an',
  'of',
  'with',
  'where',
  'on',
  'by',
  'as',
  'what',
  'who',
  'which',
  'whom',
  'when',
  'at',
  'is',
  'are',
  'via',
  'using',
  'we',
  'this',
]);
const PUNCT = /[!$&()/\n,:.'´|`[\]*^?"#{}<>;]/g;

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

/** Build a directed adjacency map restricted to the given node set. */
function directedAdjacency(nodes: string[], edges: GraphEdge[]): Map<string, Set<string>> {
  const present = new Set(nodes);
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    if (present.has(e.source) && present.has(e.target)) adj.get(e.source)!.add(e.target);
  }
  return adj;
}

/**
 * Drop back edges via DFS coloring so the graph becomes acyclic, then return
 * its topological order. Ports the cycle removal + topologicalSort from the
 * original (jsnetworkx) without the library dependency.
 */
function acyclicTopoOrder(nodes: string[], adj: Map<string, Set<string>>): string[] {
  const color = new Map<string, 0 | 1 | 2>(); // white / gray / black
  const dag = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));

  const visit = (root: string): void => {
    // Iterative DFS to avoid stack overflow on long citation chains.
    const stack: Array<{ node: string; iter: Iterator<string> }> = [];
    color.set(root, 1);
    stack.push({ node: root, iter: (adj.get(root) ?? new Set()).values() });
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = top.iter.next();
      if (next.done) {
        color.set(top.node, 2);
        stack.pop();
        continue;
      }
      const v = next.value;
      const c = color.get(v) ?? 0;
      if (c === 1) continue; // back edge → drop to break the cycle
      dag.get(top.node)!.add(v);
      if (c === 0) {
        color.set(v, 1);
        stack.push({ node: v, iter: (adj.get(v) ?? new Set()).values() });
      }
    }
  };
  for (const n of nodes) if ((color.get(n) ?? 0) === 0) visit(n);

  // Kahn's algorithm on the DAG.
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  for (const [, outs] of dag) for (const v of outs) indeg.set(v, (indeg.get(v) ?? 0) + 1);
  const queue = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const v of dag.get(n) ?? []) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  for (const n of nodes) if (!order.includes(n)) order.push(n);
  return order;
}

/** Maximal cliques via Bron–Kerbosch with pivoting on an undirected graph. */
function bronKerbosch(adj: Map<string, Set<string>>): string[][] {
  const cliques: string[][] = [];
  const expand = (r: Set<string>, p: Set<string>, x: Set<string>): void => {
    if (p.size === 0 && x.size === 0) {
      if (r.size >= 2) cliques.push([...r]);
      return;
    }
    // Pivot maximizing neighbors in P (Tomita) to prune branches.
    let pivot: string | undefined;
    let best = -1;
    for (const u of [...p, ...x]) {
      const nb = adj.get(u) ?? new Set();
      let c = 0;
      for (const v of p) if (nb.has(v)) c++;
      if (c > best) {
        best = c;
        pivot = u;
      }
    }
    const pivotN = pivot ? (adj.get(pivot) ?? new Set()) : new Set<string>();
    for (const v of [...p].filter((n) => !pivotN.has(n))) {
      const nv = adj.get(v) ?? new Set();
      expand(new Set(r).add(v), intersect(p, nv), intersect(x, nv));
      p.delete(v);
      x.add(v);
    }
  };
  expand(new Set(), new Set(adj.keys()), new Set());
  return cliques;
}

/**
 * Order a chain's nodes oldest-first so the drawn chain line only ever moves
 * forward along the year-column axis. The primary key is effective year (real year,
 * or the guessed year for an undated paper — the same value the layout positions by,
 * see effYearOf in detectCliques); ties fall to dated-before-undated, then the
 * global topological `orderIndex`.
 *
 * Citations are only a *secondary* constraint, and only when chronological (the
 * citer is no older than the paper it cites): such an edge keeps the cited paper
 * ahead of its citer, which within one year reproduces the layout's same-year
 * citation depth. An ANTI-chronological citation (an older paper citing a newer one
 * — these survive cycle-breaking when they aren't part of a cycle) is deliberately
 * NOT a constraint: honouring it would force the newer cited paper ahead of the
 * older citer and make the chain run backward in time. With those edges dropped,
 * the order is provably non-decreasing in effective year, so it matches the layout's
 * left→right column order and the path never zig-zags back in time.
 */
function citationOrder(
  nodes: string[],
  directed: Map<string, Set<string>>,
  effYearOf: (id: string) => number | undefined,
  orderIndex: Map<string, number>,
): string[] {
  const inSet = new Set(nodes);
  // Per node, the in-chain papers it cites that are not yet placed — but only its
  // chronological (forward) citations. An anti-chronological citation (citer older
  // than the cited paper) is left out, so it can't force the newer cited paper ahead
  // of the older citer; effective year alone orders that pair (see earlier()).
  const waiting = new Map<string, Set<string>>();
  for (const n of nodes) {
    const yc = effYearOf(n);
    const refs = new Set<string>();
    for (const t of directed.get(n) ?? []) {
      if (!inSet.has(t)) continue;
      const yt = effYearOf(t);
      if (yc !== undefined && yt !== undefined && yc < yt) continue; // backward → not a constraint
      refs.add(t);
    }
    waiting.set(n, refs);
  }
  // True when `a` should be placed before `b` among ready (citation-unordered) nodes.
  const earlier = (a: string, b: string): boolean => {
    const ya = effYearOf(a);
    const yb = effYearOf(b);
    if (ya !== undefined && yb !== undefined && ya !== yb) return ya < yb;
    if (ya !== undefined && yb === undefined) return true;
    if (ya === undefined && yb !== undefined) return false;
    // orderIndex is newest-first, so an older paper has the higher index.
    return (orderIndex.get(a) ?? 0) > (orderIndex.get(b) ?? 0);
  };

  const remaining = new Set(nodes);
  const out: string[] = [];
  while (remaining.size) {
    let ready = [...remaining].filter((n) => waiting.get(n)!.size === 0);
    if (ready.length === 0) ready = [...remaining]; // cycle: break by the same key
    let pick = ready[0]!;
    for (const c of ready) if (earlier(c, pick)) pick = c;
    out.push(pick);
    remaining.delete(pick);
    for (const n of remaining) waiting.get(n)!.delete(pick);
  }
  return out;
}

/**
 * Decide whether two overlapping chains fuse at the given collapse level. `collapse`
 * is the slider value (> 0 here); `overlap` is the count of shared nodes (≥ 1),
 * `a`/`b` the chain lengths. The `collapseStyle` picks the metric (see CollapseStyle):
 * - `ratio`: shared fraction `overlap/union ≥ 1/(collapse+1)` (size-aware).
 * - `difference`: total differing nodes `uniqueA + uniqueB ≤ collapse`.
 * - `bridge`: per-side difference `≤ collapse`, but only when they share an edge
 *   (`overlap ≥ 2`) so a single shared paper never bridges.
 */
function chainsMerge(
  collapse: number,
  collapseStyle: CollapseStyle,
  overlap: number,
  a: number,
  b: number,
): boolean {
  const uniqueA = a - overlap;
  const uniqueB = b - overlap;
  switch (collapseStyle) {
    case 'difference':
      return uniqueA + uniqueB <= collapse;
    case 'bridge':
      return overlap >= 2 && uniqueA <= collapse && uniqueB <= collapse;
    case 'ratio':
    default:
      // overlap / union ≥ 1/(collapse+1), rearranged to stay integer-only.
      return overlap * (collapse + 1) >= a + b - overlap;
  }
}

/**
 * Group long (size ≥ 3) chains for collapsing: single-linkage union-find where two
 * chains merge when they share a node AND satisfy the `collapseStyle` metric for the
 * given `collapse` level (see chainsMerge). Returns the group root index per chain
 * (collapse ≤ 0 → every chain is its own group). Whether a group is then combined
 * into one path (Abridged) or just recoloured together (Split) is decided by the
 * caller.
 */
function mergeGroupIds(long: string[][], collapse: number, collapseStyle: CollapseStyle): number[] {
  const parent = long.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  if (collapse > 0) {
    for (let i = 0; i < long.length; i++) {
      const aSet = new Set(long[i]!);
      for (let j = i + 1; j < long.length; j++) {
        const b = long[j]!;
        let overlap = 0;
        for (const e of b) if (aSet.has(e)) overlap++;
        if (
          overlap !== 0 &&
          chainsMerge(collapse, collapseStyle, overlap, long[i]!.length, b.length)
        ) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) parent[rj] = ri;
        }
      }
    }
  }
  return long.map((_, i) => find(i));
}

function topKeywords(nodes: string[], meta: (id: string) => PaperMeta | undefined): string[] {
  const counts = new Map<string, number>();
  for (const id of nodes) {
    const title = meta(id)?.title?.toLowerCase() ?? '';
    for (const word of title.replace(PUNCT, '').split(/\s+/)) {
      if (word.length > 2 && !STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

function topAuthors(
  nodes: string[],
  meta: (id: string) => PaperMeta | undefined,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const id of nodes) {
    for (const author of meta(id)?.authors ?? []) {
      counts.set(author, (counts.get(author) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Detect citation chains/cliques and derive their presentation data
 * (keywords, year range, top authors, color). Mirrors the original SciPaWiz
 * "Chains" pipeline but as a single self-contained, dependency-free function.
 */
export function detectCliques(
  nodes: string[],
  edges: GraphEdge[],
  meta: (id: string) => PaperMeta | undefined,
  collapse = 0,
  mergeStyle: 'split' | 'abridged' = 'split',
  collapseStyle: CollapseStyle = 'ratio',
): Clique[] {
  if (nodes.length === 0) return [];
  const directed = directedAdjacency(nodes, edges);
  const order = acyclicTopoOrder(nodes, directed);
  const orderIndex = new Map(order.map((id, i) => [id, i]));

  // Effective year per node: the real year, or the educated guess for an undated
  // paper (the newest paper it cites). This is the SAME key the year-column layout
  // positions by (graph/columns guessYears + cytoscape `effYear`), so ordering each
  // chain by it keeps the drawn path's left→right order in step with the layout.
  // `edges` are citer→cited; guessYears wants cited→citing, so flip them.
  const guess = guessYears(
    nodes.map((id) => ({ id, year: meta(id)?.year })),
    edges.map((e) => ({ source: e.target, target: e.source })),
  );
  const effYearOf = (id: string): number | undefined => meta(id)?.year ?? guess.get(id);
  const orderNodes = (ns: string[]): string[] => citationOrder(ns, directed, effYearOf, orderIndex);

  // Undirected projection for clique finding.
  const undirected = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  for (const [s, outs] of directed) {
    for (const t of outs) {
      undirected.get(s)!.add(t);
      undirected.get(t)!.add(s);
    }
  }

  // Each chain's nodes in citation order (forward in time; see citationOrder).
  const raw = bronKerbosch(undirected).map(orderNodes);
  const long = raw.filter((c) => c.length >= 3);
  const small = raw.filter((c) => c.length < 3);
  const groupRoot = mergeGroupIds(long, collapse, collapseStyle);

  // Decide the drawn chains and a group key per chain. Abridged combines each group
  // into one citation-ordered path; Split keeps the member chains separate.
  let chains: string[][];
  let chainGroupKey: number[];
  if (mergeStyle === 'abridged') {
    const byGroup = new Map<number, Set<string>>();
    long.forEach((c, i) => {
      const g = groupRoot[i]!;
      let set = byGroup.get(g);
      if (!set) byGroup.set(g, (set = new Set()));
      for (const n of c) set.add(n);
    });
    const entries = [...byGroup.entries()];
    chains = entries.map(([, set]) => orderNodes([...set]));
    chainGroupKey = entries.map(([g]) => g);
  } else {
    chains = long;
    chainGroupKey = groupRoot;
  }

  // Colour by group: each distinct group gets a rainbow hue by its earliest
  // (highest-index) topological position, so members of a merge share a colour.
  const minOrder = (c: string[]) => Math.min(...c.map((id) => orderIndex.get(id) ?? 0));
  const groupMin = new Map<number, number>();
  chains.forEach((c, i) => {
    const g = chainGroupKey[i]!;
    groupMin.set(g, Math.min(groupMin.get(g) ?? Infinity, minOrder(c)));
  });
  const rankedGroups = [...groupMin.keys()].sort((a, b) => groupMin.get(a)! - groupMin.get(b)!);
  const groupColor = new Map<number, string>();
  rankedGroups.forEach((g, rank) => groupColor.set(g, rainbow(rankedGroups.length, rank)));
  const colorOf = new Map<string[], string>();
  chains.forEach((c, i) => colorOf.set(c, groupColor.get(chainGroupKey[i]!) ?? '#9aa3ab'));

  const cliqueNodes = chains.concat(small).sort((a, b) => b.length - a.length);

  return cliqueNodes.map((nodeIds): Clique => {
    const years = nodeIds
      .map((id) => meta(id)?.year)
      .filter((y): y is number => typeof y === 'number')
      .sort((a, b) => a - b);
    const clique: Clique = {
      nodes: nodeIds,
      color: colorOf.get(nodeIds) ?? '#9aa3ab',
      keywords: topKeywords(nodeIds, meta).slice(0, 3),
      topAuthors: topAuthors(nodeIds, meta).slice(0, 3),
    };
    if (years.length) {
      clique.earliestYear = years[0];
      clique.latestYear = years[years.length - 1];
    }
    return clique;
  });
}
