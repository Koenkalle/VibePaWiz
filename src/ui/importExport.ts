import LZString from 'lz-string';
import type { SerializedGraph } from '../types';

/** Compress a graph into a URL-safe string for `?g=` share links. */
export function encodeShare(graph: SerializedGraph): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(graph));
}

export function decodeShare(encoded: string): SerializedGraph | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    return json ? validate(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

/** Parse pasted/exported JSON, returning null if it isn't a valid graph. */
export function parseImport(text: string): SerializedGraph | null {
  try {
    return validate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Trigger a browser download of the graph as a JSON file. */
export function downloadJson(graph: SerializedGraph, filename = 'vibepawiz-graph.json'): void {
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Build a shareable URL with the compressed graph embedded as `?g=`. */
export function buildShareUrl(graph: SerializedGraph): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('g', encodeShare(graph));
  return url.toString();
}

/** Read share params from the current URL: inline `?g=` or remote `?data=`. */
export function readUrlParams(): { inline?: SerializedGraph; remoteUrl?: string } {
  const params = new URLSearchParams(window.location.search);
  const g = params.get('g');
  if (g) {
    const inline = decodeShare(g);
    if (inline) return { inline };
  }
  const data = params.get('data');
  if (data) return { remoteUrl: data };
  return {};
}

/** Minimal structural validation so a bad paste can't crash the app. */
function validate(obj: unknown): SerializedGraph | null {
  if (!obj || typeof obj !== 'object') return null;
  const g = obj as Partial<SerializedGraph>;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges) || !g.settings) return null;
  return {
    version: 1,
    providerId: typeof g.providerId === 'string' ? g.providerId : 'openalex',
    seedId: typeof g.seedId === 'string' ? g.seedId : null,
    settings: g.settings,
    nodes: g.nodes,
    edges: g.edges,
    ...(Array.isArray(g.expanded) ? { expanded: g.expanded } : {}),
  };
}
