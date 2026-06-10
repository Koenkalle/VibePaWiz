import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, parseImport } from '../src/ui/importExport';
import type { SerializedGraph } from '../src/types';

const graph: SerializedGraph = {
  version: 1,
  providerId: 'openalex',
  seedId: 'W1',
  settings: { layers: 2, direction: 'citers', colors: true, layout: 'dagre', collapse: 0 },
  nodes: [
    { id: 'W1', title: 'Seed', authors: ['A'] },
    { id: 'W2', title: 'Citer', authors: ['B'], year: 2020 },
  ],
  edges: [{ source: 'W2', target: 'W1' }],
};

describe('import / export', () => {
  it('round-trips through the compressed share encoding', () => {
    const restored = decodeShare(encodeShare(graph));
    expect(restored).toEqual(graph);
  });

  it('parses valid exported JSON', () => {
    expect(parseImport(JSON.stringify(graph))).toEqual(graph);
  });

  it('rejects malformed input', () => {
    expect(parseImport('not json')).toBeNull();
    expect(parseImport(JSON.stringify({ nope: true }))).toBeNull();
    expect(decodeShare('garbage')).toBeNull();
  });
});
