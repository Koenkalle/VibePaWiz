import type { Clique, GraphEdge, PaperMeta } from '../types';
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

/** Merge overlapping long chains within the collapse tolerance (ported behavior). */
function collapseCliques(cliques: string[][], collapse: number): string[][] {
  if (collapse <= 0) return cliques;
  const long = cliques.filter((c) => c.length > 2);
  const small = cliques.filter((c) => c.length <= 2);
  for (let i = 0; i < long.length; i++) {
    const a = long[i]!;
    if (a.length === 0) continue;
    for (let j = i + 1; j < long.length; j++) {
      const b = long[j]!;
      if (b.length === 0) continue;
      const overlap = a.filter((e) => b.includes(e)).length;
      if (overlap !== 0 && a.length - overlap <= collapse && b.length - overlap <= collapse) {
        long[i] = [...new Set([...a, ...b])];
        long[j] = [];
      }
    }
  }
  return long.filter((c) => c.length > 0).concat(small);
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
): Clique[] {
  if (nodes.length === 0) return [];
  const directed = directedAdjacency(nodes, edges);
  const order = acyclicTopoOrder(nodes, directed);
  const orderIndex = new Map(order.map((id, i) => [id, i]));

  // Undirected projection for clique finding.
  const undirected = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  for (const [s, outs] of directed) {
    for (const t of outs) {
      undirected.get(s)!.add(t);
      undirected.get(t)!.add(s);
    }
  }

  let cliqueNodes = bronKerbosch(undirected);
  const byOrder = (a: string, b: string) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
  cliqueNodes.forEach((c) => c.sort(byOrder));
  cliqueNodes = collapseCliques(cliqueNodes, collapse);
  cliqueNodes.forEach((c) => c.sort(byOrder));
  cliqueNodes.sort((a, b) => b.length - a.length);

  return cliqueNodes.map((nodeIds, i): Clique => {
    const years = nodeIds
      .map((id) => meta(id)?.year)
      .filter((y): y is number => typeof y === 'number')
      .sort((a, b) => a - b);
    const clique: Clique = {
      nodes: nodeIds,
      color: rainbow(cliqueNodes.length, i),
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
