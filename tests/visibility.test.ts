import { describe, expect, it } from 'vitest';
import { GraphModel } from '../src/graph/model';
import { visibleNodes } from '../src/graph/visibility';
import type { Clique, PaperMeta } from '../src/types';

const node = (id: string): PaperMeta => ({ id, title: `T${id}`, authors: [] });
const chain = (nodes: string[]): Clique => ({ nodes, color: '#000', keywords: [], topAuthors: [] });

function model(ids: string[], edges: Array<[string, string]>): GraphModel {
  const m = new GraphModel();
  ids.forEach((id) => m.addNode(node(id)));
  edges.forEach(([s, t]) => m.addEdge(s, t));
  return m;
}

describe('visibleNodes', () => {
  it('hides a lone leaf whose cited node was not expanded', () => {
    // B cites A; B is a dangling leaf (degree 1) and A was not clicked.
    const m = model(['A', 'B'], [['B', 'A']]);
    const visible = visibleNodes(m, [], new Set(), 'A');
    expect(visible.has('A')).toBe(true); // seed
    expect(visible.has('B')).toBe(false); // hidden leaf
  });

  it('shows the leaf once the node it cites is explicitly expanded', () => {
    const m = model(['A', 'B'], [['B', 'A']]);
    const visible = visibleNodes(m, [], new Set(['A']), 'A');
    expect(visible.has('B')).toBe(true);
  });

  it('shows the seed’s direct references (degree-1 leaves) since the seed is expanded', () => {
    // References mode: seed S references R1, R2 (S→R1, S→R2); refs don't interlink.
    // With the seed treated as expanded, its references stay visible.
    const m = model(
      ['S', 'R1', 'R2'],
      [
        ['S', 'R1'],
        ['S', 'R2'],
      ],
    );
    const visible = visibleNodes(m, [], new Set(['S']), 'S');
    expect(visible.has('R1')).toBe(true);
    expect(visible.has('R2')).toBe(true);
  });

  it('shows nodes connected to at least two others', () => {
    // C cites both A and B → C has two neighbors → visible even with no expansion.
    const m = model(
      ['A', 'B', 'C'],
      [
        ['C', 'A'],
        ['C', 'B'],
      ],
    );
    const visible = visibleNodes(m, [], new Set(), null);
    expect(visible.has('C')).toBe(true);
  });

  it('shows nodes that are part of a chain (clique of size ≥ 3)', () => {
    const m = model(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['A', 'C'],
      ],
    );
    const visible = visibleNodes(m, [chain(['A', 'B', 'C'])], new Set(), null);
    expect([...visible].sort()).toEqual(['A', 'B', 'C']);
  });

  it('always shows the seed even with no edges', () => {
    const m = model(['A'], []);
    expect(visibleNodes(m, [], new Set(), 'A').has('A')).toBe(true);
  });
});
