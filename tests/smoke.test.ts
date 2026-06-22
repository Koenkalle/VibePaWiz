import { describe, expect, it } from 'vitest';
import { GraphModel } from '../src/graph/model';
import { detectCliques } from '../src/graph/cliques';
import { visibleNodes } from '../src/graph/visibility';
import { __test } from '../src/viz/cytoscape';

const { buildEdgeStyles } = __test;

function buildModel(): GraphModel {
  const m = new GraphModel();
  // Two overlapping chains, a year-less node, plus `z` — a lone-pair (size-2)
  // citer of `a` that the visibility rule hides (1 neighbour, not a chain member).
  const yr: Record<string, number | undefined> = {
    a: 2000,
    b: 2001,
    c: 2002,
    d: 2003,
    e: undefined,
    f: 2002,
    g: undefined,
    z: 2004,
  };
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'z']) {
    m.addNode({ id, title: id, authors: ['X'], year: yr[id] });
  }
  const E: [string, string][] = [
    ['b', 'a'],
    ['c', 'a'],
    ['c', 'b'],
    ['d', 'b'],
    ['d', 'c'],
    ['e', 'c'],
    ['e', 'd'],
    ['f', 'a'],
    ['f', 'b'],
    ['g', 'c'],
    ['g', 'd'],
    ['z', 'a'],
  ];
  for (const [s, t] of E) m.addEdge(s, t);
  return m;
}

describe('buildEdgeStyles invariants', () => {
  it('never emits an edge to a non-visible node, across collapse + merge style', () => {
    const model = buildModel();
    const ids = model.getNodes().map((n) => n.id);
    for (const collapse of [0, 1, 3]) {
      for (const mergeStyle of ['split', 'abridged'] as const) {
        for (const simplify of [true, false]) {
          const cliques = detectCliques(
            ids,
            model.getEdges(),
            (id) => model.getNode(id),
            collapse,
            mergeStyle,
          );
          const visible = visibleNodes(model, cliques, new Set(), 'a');
          const { styles } = buildEdgeStyles(model, cliques, true, visible, simplify);
          for (const s of styles) {
            expect(visible.has(s.source), `${s.id} source ${s.source}`).toBe(true);
            expect(visible.has(s.target), `${s.id} target ${s.target}`).toBe(true);
          }
          // No duplicate edge ids (cytoscape throws on those).
          const seen = new Set(styles.map((s) => s.id));
          expect(seen.size).toBe(styles.length);
        }
      }
    }
  });
});
