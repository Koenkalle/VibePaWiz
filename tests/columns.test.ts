import { describe, expect, it } from 'vitest';
import { computeYearColumns } from '../src/graph/columns';

// Edges are cited→citing (source is cited, target builds on it).
describe('computeYearColumns', () => {
  it('lays out years as blocks with intra-year citation depth', () => {
    const cols = computeYearColumns(
      [
        { id: 'old', year: 2010 },
        { id: 'b', year: 2024 },
        { id: 'a', year: 2024 },
        { id: 'z', year: 2024 }, // disconnected 2024 paper
        { id: 'new', year: 2025 },
      ],
      [
        { source: 'b', target: 'a' }, // a (2024) cites b (2024) → a one deeper
        { source: 'old', target: 'a' }, // cross-year
        { source: 'a', target: 'new' }, // cross-year
      ],
    );
    expect(cols.get('old')).toBe(0); // 2010 block
    expect(cols.get('b')).toBe(1); // 2024 block, depth 0
    expect(cols.get('a')).toBe(2); // 2024 block, one deeper (cites b)
    expect(cols.get('z')).toBe(1); // disconnected, still in the 2024 block
    expect(cols.get('new')).toBe(3); // 2025 starts after the whole 2024 block
  });

  it('puts every later-year paper after the entire earlier block', () => {
    const cols = computeYearColumns(
      [
        { id: 'p1', year: 2024 },
        { id: 'p2', year: 2024 },
        { id: 'p3', year: 2024 },
        { id: 'q', year: 2025 },
      ],
      [
        { source: 'p1', target: 'p2' },
        { source: 'p2', target: 'p3' }, // a depth-2 chain within 2024
      ],
    );
    expect(cols.get('p1')).toBe(0);
    expect(cols.get('p2')).toBe(1);
    expect(cols.get('p3')).toBe(2);
    expect(cols.get('q')).toBe(3); // after the deepest 2024 column
  });

  it('keeps unrelated same-year papers in the same column', () => {
    const cols = computeYearColumns(
      [
        { id: 'a', year: 2024 },
        { id: 'b', year: 2024 },
      ],
      [],
    );
    expect(cols.get('a')).toBe(cols.get('b'));
  });

  it('tolerates a same-year citation cycle without looping forever', () => {
    const cols = computeYearColumns(
      [
        { id: 'a', year: 2024 },
        { id: 'b', year: 2024 },
      ],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    );
    expect(cols.get('a')).toBeTypeOf('number');
    expect(cols.get('b')).toBeTypeOf('number');
  });
});
