import { describe, expect, it } from 'vitest';
import { breakCycles } from '../src/graph/cycles';
import type { GraphEdge } from '../src/types';

const E = (source: string, target: string): GraphEdge => ({ source, target });
const key = (e: GraphEdge) => `${e.source}->${e.target}`;
const keys = (es: GraphEdge[]) => es.map(key).sort();

/** True when the directed edge set has no cycle (DFS three-coloring). */
function isAcyclic(nodes: string[], edges: GraphEdge[]): boolean {
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const e of edges) adj.get(e.source)?.push(e.target);
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (n: string): boolean => {
    color.set(n, 1);
    for (const v of adj.get(n) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) return false;
      if (c === 0 && !visit(v)) return false;
    }
    color.set(n, 2);
    return true;
  };
  return nodes.every((n) => (color.get(n) ?? 0) !== 0 || visit(n));
}

describe('breakCycles', () => {
  const years: Record<string, number | undefined> = {
    A: 2021,
    B: 2020,
    C: 2019,
    U: undefined,
  };
  const yearOf = (id: string) => years[id];

  it('leaves an acyclic graph untouched', () => {
    const edges = [E('A', 'B'), E('B', 'C'), E('A', 'C')];
    const { kept, removed } = breakCycles(['A', 'B', 'C'], edges, yearOf);
    expect(removed).toEqual([]);
    expect(keys(kept)).toEqual(keys(edges));
  });

  it('drops a 3-cycle’s anti-chronological edge and keeps the year-correct ones', () => {
    // A(2021)→B(2020)→C(2019) are forward in time; C→A (2019 cites 2021) is the
    // lone backward edge, so it is the one removed.
    const { kept, removed } = breakCycles(
      ['A', 'B', 'C'],
      [E('A', 'B'), E('B', 'C'), E('C', 'A')],
      yearOf,
    );
    expect(removed).toEqual([E('C', 'A')]);
    expect(keys(kept)).toEqual(['A->B', 'B->C']);
    expect(isAcyclic(['A', 'B', 'C'], kept)).toBe(true);
  });

  it('breaks a reciprocal 2-cycle by removing the backward citation', () => {
    // A(2021)↔B(2020): A→B is correct (newer cites older); B→A is the backward one.
    const { kept, removed } = breakCycles(['A', 'B'], [E('A', 'B'), E('B', 'A')], yearOf);
    expect(removed).toEqual([E('B', 'A')]);
    expect(keys(kept)).toEqual(['A->B']);
  });

  it('breaks a same-year cycle deterministically into an acyclic graph', () => {
    const flat = (id: string) => (id === 'U' ? undefined : 2020);
    const { kept, removed } = breakCycles(
      ['A', 'B', 'C'],
      [E('A', 'B'), E('B', 'C'), E('C', 'A')],
      flat,
    );
    expect(removed).toHaveLength(1);
    expect(isAcyclic(['A', 'B', 'C'], kept)).toBe(true);
  });

  it('still breaks a cycle that runs through an undated node', () => {
    // A(2021)→B(2020) is the only edge with a year-defined verdict (correct); the
    // undated edges score neutral, so a single edge is dropped and A→B survives.
    const { kept, removed } = breakCycles(
      ['A', 'B', 'U'],
      [E('A', 'B'), E('B', 'U'), E('U', 'A')],
      yearOf,
    );
    expect(removed).toHaveLength(1);
    expect(keys(kept)).toContain('A->B');
    expect(isAcyclic(['A', 'B', 'U'], kept)).toBe(true);
  });

  it('resolves several independent cycles', () => {
    const edges = [
      E('A', 'B'),
      E('B', 'C'),
      E('C', 'A'), // backward in cycle 1
      E('D', 'E'),
      E('E', 'D'), // a separate 2-cycle (both same year → one is dropped)
    ];
    const yr = (id: string) => ({ A: 2021, B: 2020, C: 2019, D: 2020, E: 2020 })[id];
    const { kept, removed } = breakCycles(['A', 'B', 'C', 'D', 'E'], edges, yr);
    expect(removed).toHaveLength(2);
    expect(keys(removed)).toContain('C->A');
    expect(isAcyclic(['A', 'B', 'C', 'D', 'E'], kept)).toBe(true);
  });
});
