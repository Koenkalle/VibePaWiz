import type { CitationProvider } from './providers/types';
import type { PaperMeta } from './types';

const NS = 'vpw';

/**
 * Thin localStorage wrapper namespaced under `vpw:`. Tolerates absent storage
 * and recovers from quota errors by purging its own namespace — unlike the
 * original, which blindly stringified the entire cache on every request and
 * could overflow silently.
 */
export class LocalCache {
  private available: boolean;

  constructor(private store: Storage | undefined = globalThis.localStorage) {
    this.available = Boolean(this.store);
  }

  private k(parts: string): string {
    return `${NS}:${parts}`;
  }

  get<T>(key: string): T | undefined {
    if (!this.available) return undefined;
    try {
      const raw = this.store!.getItem(this.k(key));
      return raw == null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    if (!this.available) return;
    try {
      this.store!.setItem(this.k(key), JSON.stringify(value));
    } catch {
      // Likely quota exceeded — clear our namespace and try once more.
      this.clear();
      try {
        this.store!.setItem(this.k(key), JSON.stringify(value));
      } catch {
        /* give up silently; caching is best-effort */
      }
    }
  }

  clear(): void {
    if (!this.available) return;
    const toRemove: string[] = [];
    for (let i = 0; i < this.store!.length; i++) {
      const key = this.store!.key(i);
      if (key?.startsWith(`${NS}:`)) toRemove.push(key);
    }
    for (const key of toRemove) this.store!.removeItem(key);
  }
}

/**
 * Wrap a provider so paper/citer/reference lookups are memoized in localStorage.
 * Keyed by provider id so switching sources never mixes results. Author search
 * stays live (it depends on the exact query, not worth caching).
 */
export function withCache(provider: CitationProvider, cache: LocalCache): CitationProvider {
  const memo = async <T>(key: string, fetch: () => Promise<T>): Promise<T> => {
    const hit = cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fetch();
    cache.set(key, value);
    return value;
  };

  return {
    id: provider.id,
    label: provider.label,
    searchAuthors: (q, signal) => provider.searchAuthors(q, signal),
    worksByAuthor: (id, signal) => provider.worksByAuthor(id, signal),
    getPaper: (id, signal) =>
      memo<PaperMeta | null>(`${provider.id}:paper:${id}`, () => provider.getPaper(id, signal)),
    getCiters: (id, signal) =>
      memo<PaperMeta[]>(`${provider.id}:citers:${id}`, () => provider.getCiters(id, signal)),
    getReferences: (id, signal) =>
      memo<PaperMeta[]>(`${provider.id}:refs:${id}`, () => provider.getReferences(id, signal)),
  };
}
