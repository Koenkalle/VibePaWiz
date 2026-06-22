import { describe, expect, it } from 'vitest';
import { columnAnchors, computeYearColumns, guessYears } from '../src/graph/columns';

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

  it('places an undated node just right of the newest paper it cites', () => {
    const cols = computeYearColumns(
      [
        { id: 'old', year: 2010 },
        { id: 'mid', year: 2020 }, // the newest paper the undated node cites
        { id: 'u' }, // no year
      ],
      [
        { source: 'old', target: 'u' }, // u cites old
        { source: 'mid', target: 'u' }, // u cites mid (newer)
      ],
    );
    expect(cols.get('u')).toBe(cols.get('mid')! + 1);
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

// Edges are cited→citing, so the papers a node cites are the sources of edges
// pointing at it. guessYears assigns each undated node the newest such year.
describe('guessYears', () => {
  it('guesses an undated node as the newest paper it cites', () => {
    const g = guessYears(
      [
        { id: 'old', year: 2010 },
        { id: 'mid', year: 2020 },
        { id: 'u' }, // no year; cites old and mid
      ],
      [
        { source: 'old', target: 'u' },
        { source: 'mid', target: 'u' },
      ],
    );
    expect(g.get('u')).toBe(2020);
  });

  it('propagates a guess through a chain of undated citers', () => {
    const g = guessYears(
      [
        { id: 'a', year: 2015 },
        { id: 'u1' }, // cites a
        { id: 'u2' }, // cites u1 (undated)
      ],
      [
        { source: 'a', target: 'u1' },
        { source: 'u1', target: 'u2' },
      ],
    );
    expect(g.get('u1')).toBe(2015);
    expect(g.get('u2')).toBe(2015);
  });

  it('leaves a node that cites nothing dated unguessed', () => {
    const g = guessYears([{ id: 'x' }, { id: 'y' }], [{ source: 'x', target: 'y' }]);
    expect(g.has('x')).toBe(false);
    expect(g.has('y')).toBe(false);
  });
});

// The layout pins each source (a node no edge points at) to its year column via
// an invisible spine, so disconnected nodes can't drift out of their year band.
describe('columnAnchors', () => {
  const cols = (entries: Array<[string, number]>) => new Map(entries);

  it('reports the widest column as the spine extent', () => {
    const { maxColumn } = columnAnchors(
      cols([
        ['old', 0],
        ['b', 1],
        ['a', 2],
        ['new', 3],
      ]),
      [],
    );
    expect(maxColumn).toBe(3);
  });

  it('anchors a disconnected node at its own column', () => {
    // Mirrors computeYearColumns' `z` case: z is connected to nothing, so it is a
    // source and must be anchored at its real column (1) — not left to drift.
    const { anchors } = columnAnchors(
      cols([
        ['old', 0],
        ['b', 1],
        ['a', 2],
        ['z', 1],
        ['new', 3],
      ]),
      [
        { source: 'b', target: 'a' },
        { source: 'old', target: 'a' },
        { source: 'a', target: 'new' },
      ],
    );
    const byId = new Map(anchors.map((x) => [x.id, x.column]));
    expect(byId.get('z')).toBe(1); // the regression case
    // `old` and `b` are sources (never a target); `a`/`new` are targets, not anchored.
    expect(byId.has('old')).toBe(true);
    expect(byId.has('b')).toBe(true);
    expect(byId.has('a')).toBe(false);
    expect(byId.has('new')).toBe(false);
  });

  it('anchors a single connected backbone only at its leftmost source', () => {
    const { anchors } = columnAnchors(
      cols([
        ['a', 0],
        ['b', 1],
        ['c', 2],
      ]),
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    );
    expect(anchors).toEqual([{ id: 'a', column: 0 }]);
  });

  it('anchors every node when allNodes is set', () => {
    const { anchors } = columnAnchors(
      cols([
        ['a', 0],
        ['b', 1],
      ]),
      [{ source: 'a', target: 'b' }],
      { allNodes: true },
    );
    expect(anchors).toHaveLength(2);
  });

  it('anchors the lower-column endpoint of a backward (anti-chronological) edge', () => {
    // The layout orients edges low→high column. Here the edge's stored `target`
    // (`o`, col 0) is the LOWER column — a backward citation — so `o` must stay a
    // source (anchored) and the higher-column `n` be treated as the head.
    const { anchors } = columnAnchors(
      cols([
        ['o', 0],
        ['n', 1],
      ]),
      [{ source: 'n', target: 'o' }],
    );
    const byId = new Map(anchors.map((x) => [x.id, x.column]));
    expect(byId.get('o')).toBe(0); // lower-column endpoint anchored
    expect(byId.has('n')).toBe(false); // higher-column endpoint is the head
  });
});
