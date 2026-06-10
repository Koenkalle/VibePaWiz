import type { PaperMeta } from '../types';

/** A search hit when looking up an author by name. */
export interface AuthorHit {
  /** Provider-native author id, used to fetch the author's works. */
  id: string;
  name: string;
  /** Short disambiguation hint, e.g. institution and/or works count. */
  hint?: string;
}

/**
 * A swappable citation data source. Implementations adapt a single upstream API
 * (OpenAlex, Semantic Scholar, ...) onto these normalized methods so the rest of
 * the app never depends on a particular provider's schema.
 *
 * All methods accept an optional AbortSignal so in-flight work can be cancelled.
 */
export interface CitationProvider {
  /** Stable machine id, used as a cache namespace and in serialized graphs. */
  readonly id: string;
  /** Human-readable label for the provider picker. */
  readonly label: string;

  /** Find authors matching a free-text name query. */
  searchAuthors(query: string, signal?: AbortSignal): Promise<AuthorHit[]>;

  /** List an author's works (most-cited first), keyed by the id from searchAuthors. */
  worksByAuthor(authorId: string, signal?: AbortSignal): Promise<PaperMeta[]>;

  /** Fetch a single paper by provider id or DOI. Returns null if not found. */
  getPaper(id: string, signal?: AbortSignal): Promise<PaperMeta | null>;

  /** Papers that cite `id` (incoming citations). */
  getCiters(id: string, signal?: AbortSignal): Promise<PaperMeta[]>;

  /** Papers referenced by `id` (outgoing citations). */
  getReferences(id: string, signal?: AbortSignal): Promise<PaperMeta[]>;
}

/** Thrown for non-retryable provider/protocol errors (bad request, not found). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
