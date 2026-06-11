import { describe, expect, it } from 'vitest';
import { GraphModel } from '../src/graph/model';
import type { Clique, PaperMeta } from '../src/types';
import { __test, bendControlPoints } from '../src/viz/cytoscape';

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
  return (source: string, target: string) =>
    styles.find((s) => s.source === source && s.target === target);
}

/** A triangle A,B,C forming one size-3 chain; A→C is the non-path (redundant) edge. */
function triangle() {
  const m = new GraphModel();
  ['A', 'B', 'C'].forEach((id) => m.addNode(node(id)));
  m.addEdge('A', 'B');
  m.addEdge('B', 'C');
  m.addEdge('A', 'C'); // not consecutive on the sorted chain path
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
    m.addEdge('A', 'B'); // shared by both chains
    m.addEdge('B', 'C');
    m.addEdge('B', 'D');
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

  it('uses neutral color for chains when colors are disabled', () => {
    const m = new GraphModel();
    ['A', 'B', 'C'].forEach((id) => m.addNode(node(id)));
    m.addEdge('A', 'B');
    m.addEdge('B', 'C');
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
});
