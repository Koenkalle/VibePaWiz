import { describe, expect, it } from 'vitest';
import { detectCliques } from '../src/graph/cliques';
import type { GraphEdge, PaperMeta } from '../src/types';

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
