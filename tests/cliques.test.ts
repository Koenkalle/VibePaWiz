import { describe, expect, it } from 'vitest';
import { detectCliques } from '../src/graph/cliques';
import type { CollapseStyle, GraphEdge, PaperMeta } from '../src/types';

const papers: Record<string, PaperMeta> = {
  A: { id: 'A', title: 'deep learning networks', authors: ['Ada'], year: 2019 },
  B: { id: 'B', title: 'deep learning models', authors: ['Ada', 'Bob'], year: 2020 },
  C: { id: 'C', title: 'learning deep representations', authors: ['Ada'], year: 2021 },
  D: { id: 'D', title: 'unrelated topic entirely', authors: ['Zed'], year: 2022 },
};
const meta = (id: string) => papers[id];

describe('detectCliques', () => {
  it('finds a triangle as one size-3 chain with derived stats', () => {
    const edges: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'A', target: 'C' },
    ];
    const cliques = detectCliques(['A', 'B', 'C'], edges, meta);
    expect(cliques).toHaveLength(1);
    const clique = cliques[0]!;
    expect(clique.nodes.sort()).toEqual(['A', 'B', 'C']);
    expect(clique.keywords).toContain('deep');
    expect(clique.keywords).toContain('learning');
    expect(clique.earliestYear).toBe(2019);
    expect(clique.latestYear).toBe(2021);
    expect(clique.topAuthors[0]).toEqual(['Ada', 3]);
  });

  it('treats a simple path as two size-2 chains', () => {
    const edges: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    const cliques = detectCliques(['A', 'B', 'C'], edges, meta);
    expect(cliques).toHaveLength(2);
    expect(cliques.every((c) => c.nodes.length === 2)).toBe(true);
  });

  it('ignores isolated nodes (no singleton cliques)', () => {
    const edges: GraphEdge[] = [{ source: 'A', target: 'B' }];
    const cliques = detectCliques(['A', 'B', 'D'], edges, meta);
    expect(cliques).toHaveLength(1);
    expect(cliques[0]!.nodes.sort()).toEqual(['A', 'B']);
  });

  it('breaks cycles without crashing', () => {
    const edges: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'A' },
    ];
    const cliques = detectCliques(['A', 'B', 'C'], edges, meta);
    expect(cliques[0]!.nodes).toHaveLength(3);
  });

  it('gives few chains maximally distinct hues regardless of lone-pair noise', () => {
    // Two separate triangles (2 chains) plus lone-pair noise. The hue spread must
    // be driven by the number of chains (2 → red & cyan), not the total clique
    // count, which previously crowded every chain into the red end.
    const m = (id: string): PaperMeta => ({ id, title: id, authors: [] });
    const tri = (x: string, y: string, z: string): GraphEdge[] => [
      { source: x, target: y },
      { source: y, target: z },
      { source: x, target: z },
    ];
    const edges: GraphEdge[] = [
      ...tri('A', 'B', 'C'),
      ...tri('D', 'E', 'F'),
      { source: 'G', target: 'H' }, // lone pairs
      { source: 'I', target: 'J' },
    ];
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const chainColors = detectCliques(nodes, edges, m)
      .filter((c) => c.nodes.length >= 3)
      .map((c) => c.color);

    expect(chainColors).toHaveLength(2);
    expect(new Set(chainColors)).toEqual(new Set(['#ff0000', '#00ffff']));
  });
});

describe('detectCliques — collapse chains', () => {
  const bare = (id: string): PaperMeta => ({ id, title: id, authors: [] });
  // These exercise the combining behaviour, so they use the Abridged merge style.
  const chainsOf = (
    nodes: string[],
    edges: GraphEdge[],
    collapse: number,
    style: CollapseStyle = 'ratio',
    m = bare,
  ) =>
    detectCliques(nodes, edges, m, collapse, 'abridged', style).filter((c) => c.nodes.length >= 3);

  it('merges overlapping chains into one without dropping nodes', () => {
    // Three triangles sharing the edge 1-2: {1,2,3}, {1,2,4}, {1,2,5}. Each pair
    // differs by one node per side, so collapse=1 fuses them. The old
    // implementation dropped a node here (stale-reference bug) — the merged chain
    // must contain all five.
    const edges: GraphEdge[] = [
      { source: '1', target: '2' },
      { source: '1', target: '3' },
      { source: '2', target: '3' },
      { source: '1', target: '4' },
      { source: '2', target: '4' },
      { source: '1', target: '5' },
      { source: '2', target: '5' },
    ];
    const chains = chainsOf(['1', '2', '3', '4', '5'], edges, 1);
    expect(chains).toHaveLength(1);
    expect(new Set(chains[0]!.nodes)).toEqual(new Set(['1', '2', '3', '4', '5']));
  });

  it('merges transitively and independent of node input order', () => {
    // A ladder {1,2,3}–{2,3,4}–{3,4,5}: the ends differ by 2 per side directly
    // but are linked through the middle (1 per side each), so single-linkage at
    // collapse=1 fuses all three.
    const edges: GraphEdge[] = [
      { source: '1', target: '2' },
      { source: '1', target: '3' },
      { source: '2', target: '3' },
      { source: '2', target: '4' },
      { source: '3', target: '4' },
      { source: '3', target: '5' },
      { source: '4', target: '5' },
    ];
    const forward = chainsOf(['1', '2', '3', '4', '5'], edges, 1);
    const reversed = chainsOf(['5', '4', '3', '2', '1'], edges, 1);
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(new Set(forward[0]!.nodes)).toEqual(new Set(['1', '2', '3', '4', '5']));
    expect(new Set(reversed[0]!.nodes)).toEqual(new Set(['1', '2', '3', '4', '5']));
  });

  it('merges shifted near-duplicate chains at collapse=1', () => {
    // {A,B,C} and {B,C,D} share B,C → each extends the other by exactly one node.
    const edges: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'C' },
      { source: 'B', target: 'D' },
      { source: 'C', target: 'D' },
    ];
    const nodes = ['A', 'B', 'C', 'D'];
    expect(chainsOf(nodes, edges, 0)).toHaveLength(2); // no-op at 0
    const merged = chainsOf(nodes, edges, 1);
    expect(merged).toHaveLength(1);
    expect(new Set(merged[0]!.nodes)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('does not let a single shared paper fuse chains at low levels (default ratio)', () => {
    // {A,B,C} and {C,D,E} share only C (overlap/union = 1/5). Under the default
    // ratio style a lone shared hub stays separate until the dial is loose: it must
    // not merge at the low levels where the old per-side rule fused it at 2.
    const edges: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'C', target: 'E' },
      { source: 'D', target: 'E' },
    ];
    const nodes = ['A', 'B', 'C', 'D', 'E'];
    expect(chainsOf(nodes, edges, 2)).toHaveLength(2); // was fused at 2 before the fix
    expect(chainsOf(nodes, edges, 3)).toHaveLength(2);
    const merged = chainsOf(nodes, edges, 4); // 1*(4+1) >= 5 → finally fuses
    expect(merged).toHaveLength(1);
    expect(new Set(merged[0]!.nodes)).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
  });

  it('combines a group into one chain (Abridged)', () => {
    // {A,B,C} and {B,C,D} share B,C → one combined chain of all four.
    const edges: GraphEdge[] = [
      { source: 'B', target: 'A' },
      { source: 'C', target: 'A' },
      { source: 'C', target: 'B' },
      { source: 'D', target: 'B' },
      { source: 'D', target: 'C' },
    ];
    const abridged = chainsOf(['A', 'B', 'C', 'D'], edges, 1);
    expect(abridged).toHaveLength(1);
    expect(new Set(abridged[0]!.nodes)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });
});

describe('detectCliques — collapse styles', () => {
  const bare = (id: string): PaperMeta => ({ id, title: id, authors: [] });
  const count = (nodes: string[], edges: GraphEdge[], collapse: number, style: CollapseStyle) =>
    detectCliques(nodes, edges, bare, collapse, 'abridged', style).filter(
      (c) => c.nodes.length >= 3,
    ).length;

  // {A,B,C} and {B,C,D} share an edge (overlap 2); {A,B,C} and {C,D,E} share one hub (overlap 1).
  const shareEdge: GraphEdge[] = [
    { source: 'A', target: 'B' },
    { source: 'A', target: 'C' },
    { source: 'B', target: 'C' },
    { source: 'B', target: 'D' },
    { source: 'C', target: 'D' },
  ];
  const shareEdgeNodes = ['A', 'B', 'C', 'D'];
  const shareHub: GraphEdge[] = [
    { source: 'A', target: 'B' },
    { source: 'A', target: 'C' },
    { source: 'B', target: 'C' },
    { source: 'C', target: 'D' },
    { source: 'C', target: 'E' },
    { source: 'D', target: 'E' },
  ];
  const shareHubNodes = ['A', 'B', 'C', 'D', 'E'];

  it('every style is a no-op at collapse 0', () => {
    for (const style of ['ratio', 'difference', 'bridge'] as const) {
      expect(count(shareEdgeNodes, shareEdge, 0, style)).toBe(2);
      expect(count(shareHubNodes, shareHub, 0, style)).toBe(2);
    }
  });

  it('ratio: share-edge fuses at 1, lone hub only once the dial is loose (4)', () => {
    expect(count(shareEdgeNodes, shareEdge, 1, 'ratio')).toBe(1); // 2/4 ≥ 1/2
    expect(count(shareHubNodes, shareHub, 3, 'ratio')).toBe(2); // 1/5 < 1/4
    expect(count(shareHubNodes, shareHub, 4, 'ratio')).toBe(1); // 1/5 ≥ 1/5
  });

  it('difference: counts total differing papers (share-edge fuses at 2, not 1)', () => {
    expect(count(shareEdgeNodes, shareEdge, 1, 'difference')).toBe(2); // 1+1 > 1
    expect(count(shareEdgeNodes, shareEdge, 2, 'difference')).toBe(1); // 1+1 ≤ 2
    expect(count(shareHubNodes, shareHub, 3, 'difference')).toBe(2); // 2+2 > 3
    expect(count(shareHubNodes, shareHub, 4, 'difference')).toBe(1); // 2+2 ≤ 4
  });

  it('bridge: a single shared paper never fuses, even at max collapse', () => {
    expect(count(shareEdgeNodes, shareEdge, 1, 'bridge')).toBe(1); // shares an edge
    expect(count(shareHubNodes, shareHub, 20, 'bridge')).toBe(2); // overlap 1 < 2 → never
  });
});

describe('detectCliques — citation ordering', () => {
  it('orders a clique in citation order, not by year', () => {
    // c cites a,b and b cites a → citation order a,b,c. Only a has a year; the old
    // year-first sort produced the zigzag a,c,b.
    const edges: GraphEdge[] = [
      { source: 'b', target: 'a' },
      { source: 'c', target: 'a' },
      { source: 'c', target: 'b' },
    ];
    const m = (id: string): PaperMeta => ({ id, title: id, authors: [], year: { a: 2000 }[id] });
    const chains = detectCliques(['a', 'b', 'c'], edges, m, 0).filter((c) => c.nodes.length >= 3);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.nodes).toEqual(['a', 'b', 'c']);
  });

  it('orders a chain forward in time across a surviving backward citation', () => {
    // P (2010) cites Q (2011) — an anti-chronological citation that is NOT part of a
    // cycle, so it survives cycle-breaking and reaches clique detection. The old
    // citation-topological order placed the newer cited paper (Q) before its older
    // citer (P), giving Q,P,R — a path that runs back in time before going forward.
    // The order must follow publication year instead: P, Q, R.
    const edges: GraphEdge[] = [
      { source: 'R', target: 'P' }, // 2012 cites 2010 (forward)
      { source: 'R', target: 'Q' }, // 2012 cites 2011 (forward)
      { source: 'P', target: 'Q' }, // 2010 cites 2011 (backward, survives)
    ];
    const years: Record<string, number> = { P: 2010, Q: 2011, R: 2012 };
    const m = (id: string): PaperMeta => ({ id, title: id, authors: [], year: years[id] });
    const chains = detectCliques(['P', 'Q', 'R'], edges, m, 0).filter((c) => c.nodes.length >= 3);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.nodes).toEqual(['P', 'Q', 'R']);
  });

  it('places an undated paper by its guessed year, not last', () => {
    // U has no real year but cites x (2000) and y (2001), so the layout positions it
    // in the 2001 column — left of b (2002). The chain order must use that same
    // guessed year (x,y,U,b); the old dated-before-undated rule dumped U at the end
    // (x,y,b,U), so the drawn path jumped from b back to U.
    const edges: GraphEdge[] = [
      { source: 'y', target: 'x' },
      { source: 'U', target: 'x' },
      { source: 'U', target: 'y' },
      { source: 'b', target: 'x' },
      { source: 'b', target: 'y' },
    ];
    const years: Record<string, number | undefined> = { x: 2000, y: 2001, b: 2002 };
    const m = (id: string): PaperMeta => ({ id, title: id, authors: [], year: years[id] });
    const merged = detectCliques(['x', 'y', 'U', 'b'], edges, m, 1, 'abridged').filter(
      (c) => c.nodes.length >= 3,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.nodes).toEqual(['x', 'y', 'U', 'b']);
  });

  it('breaks citation ties by year inside a merged chain', () => {
    // {x,y,a} and {x,y,c} merge; a and c both cite x,y but not each other, so their
    // order is citation-ambiguous — the older publication year goes first.
    const edges: GraphEdge[] = [
      { source: 'y', target: 'x' },
      { source: 'a', target: 'x' },
      { source: 'a', target: 'y' },
      { source: 'c', target: 'x' },
      { source: 'c', target: 'y' },
    ];
    const years: Record<string, number> = { a: 2011, c: 2010 };
    const m = (id: string): PaperMeta => ({ id, title: id, authors: [], year: years[id] });
    const merged = detectCliques(['x', 'y', 'a', 'c'], edges, m, 1, 'abridged').filter(
      (c) => c.nodes.length >= 3,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.nodes).toEqual(['x', 'y', 'c', 'a']); // c (2010) before a (2011)
  });
});

describe('detectCliques — merge style', () => {
  const bare = (id: string): PaperMeta => ({ id, title: id, authors: [] });
  // {A,B,C} and {B,C,D} share B,C and merge at collapse 1.
  const edges: GraphEdge[] = [
    { source: 'B', target: 'A' },
    { source: 'C', target: 'A' },
    { source: 'C', target: 'B' },
    { source: 'D', target: 'B' },
    { source: 'D', target: 'C' },
  ];
  const nodes = ['A', 'B', 'C', 'D'];

  it('Split keeps the member chains separate but recolours them the same', () => {
    const split = detectCliques(nodes, edges, bare, 1, 'split').filter((c) => c.nodes.length >= 3);
    expect(split).toHaveLength(2);
    expect(split[0]!.color).toBe(split[1]!.color);
  });

  it('Abridged combines the group into one chain', () => {
    const abridged = detectCliques(nodes, edges, bare, 1, 'abridged').filter(
      (c) => c.nodes.length >= 3,
    );
    expect(abridged).toHaveLength(1);
    expect(new Set(abridged[0]!.nodes)).toEqual(new Set(nodes));
  });
});
