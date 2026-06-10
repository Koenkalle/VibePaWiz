import pLimit from 'p-limit';
import type { CitationProvider } from '../providers/types';
import type { Direction } from '../types';
import type { GraphModel } from './model';

/** Cap on total nodes so a dense seed can't lock up the browser. */
const MAX_NODES = 1200;
/** Max concurrent provider requests in flight. */
const CONCURRENCY = 5;

export interface ExpandProgress {
  /** Nodes whose neighbors have been fetched. */
  loaded: number;
  /** Total nodes discovered so far. */
  total: number;
}

export interface ExpandOptions {
  provider: CitationProvider;
  seedId: string;
  layers: number;
  direction: Direction;
  signal: AbortSignal;
  /** Called as the frontier advances, for progress UI. */
  onProgress?: (p: ExpandProgress) => void;
  /** Called after each node is expanded, for incremental re-rendering. */
  onUpdate?: () => void;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Breadth-first expansion of the citation network from `seedId`, `layers` deep,
 * following the chosen direction. Extends the given model in place (so it also
 * powers click-to-expand). Replaces the recursive `setTimeout` fan-out in the
 * original loadData.js with a single AbortController, a concurrency limiter,
 * and per-node progress callbacks. Resolves quietly if aborted.
 */
export async function expand(model: GraphModel, opts: ExpandOptions): Promise<void> {
  const { provider, seedId, layers, direction, signal } = opts;
  const limit = pLimit(CONCURRENCY);
  const expanded = new Set<string>();

  // Ensure the seed has real metadata before fanning out.
  if (!model.hasNode(seedId)) {
    try {
      const seed = await provider.getPaper(seedId, signal);
      if (seed) model.addNode(seed);
      else model.addNode({ id: seedId, title: '(untitled)', authors: [] });
    } catch (err) {
      if (isAbort(err)) return;
      model.addNode({ id: seedId, title: '(untitled)', authors: [] });
    }
    opts.onUpdate?.();
  }

  const wantCiters = direction === 'citers' || direction === 'both';
  const wantRefs = direction === 'references' || direction === 'both';

  let frontier = new Set<string>([seedId]);

  for (let depth = layers; depth > 0 && !signal.aborted; depth--) {
    const current = [...frontier].filter((id) => !expanded.has(id));
    frontier = new Set<string>();

    const tasks = current.map((id) =>
      limit(async () => {
        if (signal.aborted) return;
        expanded.add(id);
        try {
          if (wantCiters) {
            for (const c of await provider.getCiters(id, signal)) {
              if (model.nodeCount() >= MAX_NODES && !model.hasNode(c.id)) continue;
              model.addNode(c);
              model.addEdge(c.id, id);
              frontier.add(c.id);
            }
          }
          if (wantRefs) {
            for (const r of await provider.getReferences(id, signal)) {
              if (model.nodeCount() >= MAX_NODES && !model.hasNode(r.id)) continue;
              model.addNode(r);
              model.addEdge(id, r.id);
              frontier.add(r.id);
            }
          }
        } catch (err) {
          if (isAbort(err)) throw err;
          // Skip a single failing node rather than aborting the whole run.
          console.warn(`Failed to expand ${id}:`, err);
        }
        opts.onProgress?.({ loaded: expanded.size, total: model.nodeCount() });
        opts.onUpdate?.();
      }),
    );

    try {
      await Promise.all(tasks);
    } catch (err) {
      if (isAbort(err)) return;
      throw err;
    }
  }
}
