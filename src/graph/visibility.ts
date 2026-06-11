import type { Clique } from '../types';
import type { GraphModel } from './model';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Decide which nodes to render. Ports the original SciPaWiz pruning rule
 * (the `cliques.filter(c => c.nodes.length == 2)` + `ExclusionSet` block): a
 * node is shown only if it is part of a citation chain (clique of size ≥ 3),
 * is connected to at least two other nodes, or is a neighbor of a node the user
 * explicitly clicked to expand (so a leaf appears once you expand the paper it
 * cites). The seed is always shown.
 */
export function visibleNodes(
  model: GraphModel,
  cliques: Clique[],
  expanded: Set<string>,
  seedId: string | null,
): Set<string> {
  const chainMembers = new Set<string>();
  for (const c of cliques) {
    if (c.nodes.length >= 3) for (const n of c.nodes) chainMembers.add(n);
  }

  // Distinct undirected neighbors per node.
  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let set = neighbors.get(a);
    if (!set) neighbors.set(a, (set = new Set()));
    set.add(b);
  };
  for (const e of model.getEdges()) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const visible = new Set<string>();
  for (const node of model.getNodes()) {
    const nb = neighbors.get(node.id) ?? EMPTY;
    if (
      node.id === seedId ||
      chainMembers.has(node.id) ||
      nb.size >= 2 ||
      [...nb].some((m) => expanded.has(m))
    ) {
      visible.add(node.id);
    }
  }
  return visible;
}
