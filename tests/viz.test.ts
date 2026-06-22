import { describe, expect, it } from 'vitest';
import { GraphModel } from '../src/graph/model';
import type { Clique, PaperMeta } from '../src/types';
import { __test, bendControlPoints, yearBandRects } from '../src/viz/cytoscape';

const { buildEdgeStyles, EDGE_GREY, EDGE_NEUTRAL } = __test;

const node = (id: string, year?: number): PaperMeta => ({ id, title: `T${id}`, authors: [], year });
const chain = (nodes: string[], color: string): Clique => ({
  nodes,
  color,
  keywords: [],
  topAuthors: [],
});

const allVisible = (m: GraphModel) => new Set(m.getNodes().map((n) => n.id));

function styleFor(model: GraphModel, cliques: Clique[], useColors: boolean, simplify = false) {
  const { styles } = buildEdgeStyles(model, cliques, useColors, allVisible(model), simplify);
  // Match an edge regardless of stored citer→cited orientation.
  return (a: string, b: string) =>
    styles.find((s) => (s.source === a && s.target === b) || (s.source === b && s.target === a));
}

/** Count connected components over `nodes` using only the solid (kept chain) edges. */
function solidComponents(model: GraphModel, cliques: Clique[], nodes: string[]): number {
  const { styles } = buildEdgeStyles(model, cliques, true, allVisible(model), true);
  const parent = new Map<string, string>(nodes.map((n) => [n, n]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const s of styles) {
    if (s.lineStyle === 'solid') parent.set(find(s.source), find(s.target));
  }
  return new Set(nodes.map(find)).size;
}

/**
 * A triangle with A oldest, C newest (edges are citer→cited): B and C cite A,
 * C cites B. The reference tree is C→B→A; C→A is the redundant (non-path) edge.
 */
function triangle() {
  const m = new GraphModel();
  ['A', 'B', 'C'].forEach((id) => m.addNode(node(id)));
  m.addEdge('B', 'A');
  m.addEdge('C', 'A'); // C's older reference — not on the tree path
  m.addEdge('C', 'B');
  return m;
}

describe('buildEdgeStyles', () => {
  it('colors the chain path edges solid', () => {
    const find = styleFor(triangle(), [chain(['A', 'B', 'C'], '#ff0000')], true);
    expect(find('A', 'B')).toMatchObject({ color: '#ff0000', lineStyle: 'solid', width: 4 });
    expect(find('B', 'C')).toMatchObject({ color: '#ff0000', lineStyle: 'solid' });
  });

  it('hides the redundant intra-chain edge when simplifying', () => {
    const find = styleFor(triangle(), [chain(['A', 'B', 'C'], '#ff0000')], true, true);
    expect(find('A', 'C')).toBeUndefined(); // A→C is not on the chain path → not drawn
  });

  it('shows the redundant intra-chain edge dashed when not simplifying', () => {
    const find = styleFor(triangle(), [chain(['A', 'B', 'C'], '#ff0000')], true, false);
    expect(find('A', 'C')).toMatchObject({ color: EDGE_GREY, lineStyle: 'dashed' });
  });

  it('keeps a true non-chain edge dashed even when simplifying', () => {
    const m = triangle();
    m.addNode(node('D'));
    m.addEdge('C', 'D'); // D is outside the chain → C→D is a lone pair, not redundant
    const find = styleFor(m, [chain(['A', 'B', 'C'], '#ff0000')], true, true);
    expect(find('C', 'D')).toMatchObject({ color: EDGE_GREY, lineStyle: 'dashed' });
  });

  it('blends edges shared by multiple chains into a gradient', () => {
    const m = new GraphModel();
    ['A', 'B', 'C', 'D'].forEach((id) => m.addNode(node(id)));
    m.addEdge('B', 'A'); // B→A is the shared reference edge of both chains
    m.addEdge('C', 'B');
    m.addEdge('D', 'B');
    const find = styleFor(
      m,
      [chain(['A', 'B', 'C'], '#ff0000'), chain(['A', 'B', 'D'], '#0000ff')],
      true,
      true,
    );

    const shared = find('A', 'B');
    expect(shared?.gradient).toEqual(['#ff0000', '#0000ff']);
    expect(shared?.width).toBe(6);
  });

  it('sets edge priority to the number of chains the edge is part of', () => {
    // Single-chain path edge → priority 1; the redundant non-path edge (A→C,
    // drawn dashed) is on no chain → priority 0.
    const find = styleFor(triangle(), [chain(['A', 'B', 'C'], '#ff0000')], true);
    expect(find('A', 'B')?.priority).toBe(1);
    expect(find('A', 'C')?.priority).toBe(0);

    // Edge shared by two chains → priority 2.
    const m = new GraphModel();
    ['A', 'B', 'C', 'D'].forEach((id) => m.addNode(node(id)));
    m.addEdge('B', 'A');
    m.addEdge('C', 'B');
    m.addEdge('D', 'B');
    const find2 = styleFor(
      m,
      [chain(['A', 'B', 'C'], '#ff0000'), chain(['A', 'B', 'D'], '#0000ff')],
      true,
    );
    expect(find2('A', 'B')?.priority).toBe(2);
  });

  it('uses neutral color for chains when colors are disabled', () => {
    const m = new GraphModel();
    ['A', 'B', 'C'].forEach((id) => m.addNode(node(id)));
    m.addEdge('B', 'A');
    m.addEdge('C', 'B');
    const find = styleFor(m, [chain(['A', 'B', 'C'], '#ff0000')], false);
    expect(find('A', 'B')).toMatchObject({ color: EDGE_NEUTRAL, lineStyle: 'solid' });
  });

  it('treats size-2 cliques as dashed (not chains)', () => {
    const m = new GraphModel();
    ['A', 'B'].forEach((id) => m.addNode(node(id)));
    m.addEdge('A', 'B');
    const find = styleFor(m, [chain(['A', 'B'], '#00ff00')], true);
    expect(find('A', 'B')?.lineStyle).toBe('dashed');
  });

  it('flags an older paper citing a newer one as backward', () => {
    const m = new GraphModel();
    m.addNode(node('old', 2020));
    m.addNode(node('new', 2022));
    m.addEdge('old', 'new'); // citer (2020) predates the cited (2022)
    expect(styleFor(m, [], true)('old', 'new')?.backward).toBe(true);
  });

  it('does not flag normal, same-year, or undated citations as backward', () => {
    const m = new GraphModel();
    m.addNode(node('new', 2022));
    m.addNode(node('old', 2020));
    m.addNode(node('same1', 2021));
    m.addNode(node('same2', 2021));
    m.addNode(node('undated'));
    m.addEdge('new', 'old'); // normal: citer newer than cited
    m.addEdge('same1', 'same2'); // same year
    m.addEdge('same1', 'undated'); // missing cited year
    const find = styleFor(m, [], true);
    expect(find('new', 'old')?.backward).toBeFalsy();
    expect(find('same1', 'same2')?.backward).toBeFalsy();
    expect(find('same1', 'undated')?.backward).toBeFalsy();
  });

  it('omits cycle-removed edges from the normal styles (drawn separately)', () => {
    const m = new GraphModel();
    ['A', 'B', 'C'].forEach((id) => m.addNode(node(id)));
    m.addEdge('A', 'B');
    m.addEdge('B', 'C');
    m.addEdge('C', 'A'); // the edge the cycle-breaker dropped
    const removed = new Set(['C A']); // keyed source + ' ' + target
    const { styles } = buildEdgeStyles(m, [], true, allVisible(m), false, removed);
    const find = (a: string, b: string) =>
      styles.find((s) => (s.source === a && s.target === b) || (s.source === b && s.target === a));
    expect(find('C', 'A')).toBeUndefined();
    expect(find('A', 'B')).toBeDefined();
    expect(find('B', 'C')).toBeDefined();
  });
});

describe('buildEdgeStyles — forward chain drawing', () => {
  const nodes = ['A', 'B', 'C', 'D', 'E'];

  const stylesOf = (m: GraphModel, cliques: Clique[], simplify: boolean) =>
    buildEdgeStyles(m, cliques, true, allVisible(m), simplify).styles;
  const hasSynthetic = (m: GraphModel, cliques: Clique[], simplify: boolean) =>
    stylesOf(m, cliques, simplify).some((s) => s.id.startsWith('syn:'));

  /** An Abridged union {A,B,C}+{A,D,E} sharing only A → no C–D edge → gap at C–D. */
  function gappedUnion() {
    const m = new GraphModel();
    nodes.forEach((id) => m.addNode(node(id)));
    m.addEdge('B', 'A');
    m.addEdge('C', 'A');
    m.addEdge('C', 'B');
    m.addEdge('D', 'A');
    m.addEdge('E', 'A');
    m.addEdge('E', 'D');
    return m;
  }

  it('draws a simple clique as one clean forward line (no branch, no connector)', () => {
    const m = new GraphModel();
    ['A', 'B', 'C'].forEach((id) => m.addNode(node(id)));
    m.addEdge('B', 'A');
    m.addEdge('C', 'A'); // redundant chord
    m.addEdge('C', 'B');
    const cliques = [chain(['A', 'B', 'C'], '#ff0000')];
    const find = styleFor(m, cliques, true, true);
    expect(find('A', 'B')).toMatchObject({ lineStyle: 'solid' });
    expect(find('B', 'C')).toMatchObject({ lineStyle: 'solid' });
    expect(find('A', 'C')).toBeUndefined(); // chord hidden, no branch
    expect(hasSynthetic(m, cliques, true)).toBe(false);
  });

  it('bridges a gap with one forward synthetic connector, never a backward link', () => {
    const m = gappedUnion();
    const cliques = [chain(['A', 'B', 'C', 'D', 'E'], '#ff0000')];
    const find = styleFor(m, cliques, true, true);
    expect(solidComponents(m, cliques, nodes)).toBe(1);
    // The gap C→D is bridged by a forward synthetic connector...
    const connector = find('C', 'D');
    expect(connector?.lineStyle).toBe('solid');
    expect(connector?.id.startsWith('syn:')).toBe(true);
    // ...and the real backward references (e.g. D→A) are not drawn into the path.
    expect(find('A', 'D')).toBeUndefined();
  });

  it('does not synthesize connectors when Simplify is off', () => {
    const m = gappedUnion();
    const cliques = [chain(['A', 'B', 'C', 'D', 'E'], '#ff0000')];
    expect(hasSynthetic(m, cliques, false)).toBe(false);
    expect(styleFor(m, cliques, true, false)('C', 'D')).toBeUndefined();
  });

  it('keeps a gapless union connected as a clean line (no connector)', () => {
    // Two triangles sharing C: {A,B,C} and {C,D,E} thread A-B-C-D-E end to end.
    const m = new GraphModel();
    nodes.forEach((id) => m.addNode(node(id)));
    m.addEdge('B', 'A');
    m.addEdge('C', 'A');
    m.addEdge('C', 'B');
    m.addEdge('D', 'C');
    m.addEdge('E', 'C');
    m.addEdge('E', 'D');
    const cliques = [chain(['A', 'B', 'C', 'D', 'E'], '#ff0000')];
    expect(solidComponents(m, cliques, nodes)).toBe(1);
    expect(hasSynthetic(m, cliques, true)).toBe(false);
  });

  it('keeps every node connected when a union has multiple gaps', () => {
    // {A,C,D} and {B,C,D}: no A–B edge → a gap at A–B is bridged forward.
    const m = new GraphModel();
    ['A', 'B', 'C', 'D'].forEach((id) => m.addNode(node(id)));
    m.addEdge('C', 'A');
    m.addEdge('C', 'B');
    m.addEdge('D', 'A');
    m.addEdge('D', 'B');
    m.addEdge('D', 'C');
    const cliques = [chain(['A', 'B', 'C', 'D'], '#ff0000')];
    expect(solidComponents(m, cliques, ['A', 'B', 'C', 'D'])).toBe(1);
  });
});

describe('bendControlPoints', () => {
  it('renders a straight edge (no interior bends) as a single zero-offset midpoint', () => {
    const cp = bendControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(cp).toEqual({ weights: [0.5], distances: [0] });
  });

  it('maps an interior bend to the matching weight and perpendicular distance', () => {
    // Horizontal edge along +x; a bend 20 above the midpoint. Cytoscape's
    // perpendicular N = (-dy, dx)/len = (0, 1) for this edge, so a point at
    // y = -20 (screen up) lies at distance -20 from the line.
    const cp = bendControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, [
      { x: 0, y: 0 },
      { x: 50, y: -20 },
      { x: 100, y: 0 },
    ]);
    expect(cp.weights).toEqual([0.5]);
    expect(cp.distances).toEqual([-20]);
  });

  it('keeps multiple bends in order and skips out-of-segment points', () => {
    const cp = bendControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, [
      { x: 0, y: 0 },
      { x: 25, y: 10 },
      { x: 200, y: 5 }, // weight > 1 → skipped
      { x: 75, y: -10 },
      { x: 100, y: 0 },
    ]);
    expect(cp.weights).toEqual([0.25, 0.75]);
    expect(cp.distances).toEqual([10, -10]);
  });

  it('orders control points source→target even when dagre routed them reversed', () => {
    // A backward edge is reoriented for layout, so dagre's points run target→
    // source; the result must still be sorted along this edge's source→target line.
    const cp = bendControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, [
      { x: 100, y: 0 },
      { x: 75, y: -10 },
      { x: 25, y: 10 },
      { x: 0, y: 0 },
    ]);
    expect(cp.weights).toEqual([0.25, 0.75]);
    expect(cp.distances).toEqual([10, -10]);
  });
});

describe('yearBandRects', () => {
  it('tiles monotonic extents at the midpoints, padding the ends', () => {
    const rects = yearBandRects(
      [
        { x1: 0, x2: 10 },
        { x1: 30, x2: 40 },
        { x1: 60, x2: 70 },
      ],
      5,
    );
    expect(rects).toEqual([
      { left: -5, right: 20 }, // 0-pad → (10+30)/2
      { left: 20, right: 50 }, // (10+30)/2 → (40+60)/2
      { left: 50, right: 75 }, // (40+60)/2 → 70+pad
    ]);
  });

  it('never inverts or overlaps when a later year drifts left', () => {
    const rects = yearBandRects(
      [
        { x1: 0, x2: 100 },
        { x1: 10, x2: 20 }, // drifted left, overlapping the first year
        { x1: 200, x2: 210 },
      ],
      5,
    );
    for (let i = 0; i < rects.length; i++) {
      expect(rects[i]!.right).toBeGreaterThan(rects[i]!.left); // no inversion / slivers
      if (i > 0) {
        expect(rects[i]!.left).toBe(rects[i - 1]!.right); // tiles: no gap, no overlap
        expect(rects[i]!.left).toBeGreaterThanOrEqual(rects[i - 1]!.left); // monotonic
      }
    }
  });

  it('returns a single padded rect for one year', () => {
    expect(yearBandRects([{ x1: 10, x2: 20 }], 5)).toEqual([{ left: 5, right: 25 }]);
  });

  it('returns no rects when there are no years', () => {
    expect(yearBandRects([], 5)).toEqual([]);
  });
});
