import { describe, expect, it } from 'vitest';
import { expand } from '../src/graph/expand';
import { GraphModel } from '../src/graph/model';
import type { CitationProvider } from '../src/providers/types';
import type { PaperMeta } from '../src/types';

const meta = (id: string): PaperMeta => ({ id, title: `T${id}`, authors: [] });

/** Fake provider whose citation graph is A←B,C ; B←D. */
function fakeProvider(citers: Record<string, string[]>): CitationProvider {
  return {
    id: 'fake',
    label: 'Fake',
    searchAuthors: async () => [],
    worksByAuthor: async () => [],
    getPaper: async (id) => meta(id),
    getCiters: async (id) => (citers[id] ?? []).map(meta),
    getReferences: async () => [],
  };
}

describe('GraphModel', () => {
  it('dedupes nodes and upgrades stubs to richer records', () => {
    const m = new GraphModel();
    m.addNode({ id: 'A', title: '(untitled)', authors: [] });
    m.addNode({ id: 'A', title: 'Real Title', authors: ['X'] });
    m.addNode({ id: 'A', title: '(untitled)', authors: [] }); // must not clobber
    expect(m.getNode('A')?.title).toBe('Real Title');
    expect(m.nodeCount()).toBe(1);
  });

  it('ignores self-loops and duplicate edges', () => {
    const m = new GraphModel();
    m.addEdge('A', 'A');
    m.addEdge('A', 'B');
    m.addEdge('A', 'B');
    expect(m.getEdges()).toEqual([{ source: 'A', target: 'B' }]);
  });

  it('computes in+out degree per node', () => {
    const m = new GraphModel();
    ['A', 'B', 'C'].forEach((id) => m.addNode(meta(id)));
    m.addEdge('B', 'A');
    m.addEdge('C', 'A');
    const deg = m.degrees();
    expect(deg.get('A')).toBe(2);
    expect(deg.get('B')).toBe(1);
  });

  it('computes citer count as in-degree (papers citing a node)', () => {
    const m = new GraphModel();
    ['A', 'B', 'C'].forEach((id) => m.addNode(meta(id)));
    m.addEdge('B', 'A'); // B cites A
    m.addEdge('C', 'A'); // C cites A
    const citers = m.inDegrees();
    expect(citers.get('A')).toBe(2); // A has two citers
    expect(citers.get('B')).toBe(0); // B is a leaf citer
    expect(citers.get('C')).toBe(0);
  });

  it('round-trips through serialize/load', () => {
    const m = new GraphModel();
    m.addNode(meta('A'));
    m.addNode(meta('B'));
    m.addEdge('B', 'A');
    const serialized = m.serialize('openalex', 'A', {
      layers: 2,
      direction: 'citers',
      colors: true,
      layout: 'dagre',
      collapse: 0,
      yearOrder: true,
      prioritizeChains: true,
      simplifyChains: true,
      mergeStyle: 'split',
      collapseStyle: 'ratio',
    });
    const m2 = new GraphModel();
    m2.load(serialized);
    expect(m2.nodeCount()).toBe(2);
    expect(m2.getEdges()).toEqual([{ source: 'B', target: 'A' }]);
  });
});

describe('expand (BFS)', () => {
  it('walks citers layer by layer with deduped edges', async () => {
    const model = new GraphModel();
    const provider = fakeProvider({ A: ['B', 'C'], B: ['D'], C: [], D: [] });
    await expand(model, {
      provider,
      seedId: 'A',
      layers: 2,
      direction: 'citers',
      signal: new AbortController().signal,
    });
    expect(
      model
        .getNodes()
        .map((n) => n.id)
        .sort(),
    ).toEqual(['A', 'B', 'C', 'D']);
    expect(model.getEdges().sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: 'B', target: 'A' },
      { source: 'C', target: 'A' },
      { source: 'D', target: 'B' },
    ]);
  });

  it('respects layer depth', async () => {
    const model = new GraphModel();
    const provider = fakeProvider({ A: ['B'], B: ['C'], C: ['D'] });
    await expand(model, {
      provider,
      seedId: 'A',
      layers: 1,
      direction: 'citers',
      signal: new AbortController().signal,
    });
    // 1 layer: only A's direct citers are added.
    expect(
      model
        .getNodes()
        .map((n) => n.id)
        .sort(),
    ).toEqual(['A', 'B']);
  });

  it('stops immediately when the signal is already aborted', async () => {
    const model = new GraphModel();
    const provider = fakeProvider({ A: ['B', 'C'] });
    const ac = new AbortController();
    ac.abort();
    await expand(model, {
      provider,
      seedId: 'A',
      layers: 3,
      direction: 'citers',
      signal: ac.signal,
    });
    expect(model.nodeCount()).toBe(1); // only the seed
  });
});
