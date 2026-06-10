import type { PaperMeta } from '../types';
import { fetchJson } from './http';
import type { AuthorHit, CitationProvider } from './types';

const BASE = 'https://api.openalex.org';

// OpenAlex "polite pool" contact. Using a mailto gets faster, more reliable
// service. Swap this for your own address if you fork the tool.
const MAILTO = 'vibepawiz@users.noreply.github.com';

// Bound per-paper fan-out so a single highly-cited node cannot explode the graph
// (and the request count). Sorted by citation count so we keep the most relevant.
const MAX_PER_PAPER = 200;
const PAGE_SIZE = 200;
const ID_BATCH = 100; // OpenAlex OR-filter accepts up to 100 ids per request.

// Top-level fields requested via `select` to keep payloads small.
const WORK_FIELDS = [
  'id',
  'doi',
  'title',
  'display_name',
  'publication_year',
  'cited_by_count',
  'authorships',
  'primary_location',
];
const WORK_FIELDS_WITH_REFS = [...WORK_FIELDS, 'referenced_works'];

interface OAWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  referenced_works?: string[] | null;
}

interface OAAuthor {
  id: string;
  display_name?: string | null;
  works_count?: number | null;
  last_known_institutions?: Array<{ display_name?: string | null }> | null;
  last_known_institution?: { display_name?: string | null } | null;
}

interface OAList<T> {
  results?: T[];
  meta?: { next_cursor?: string | null };
}

/** Last path segment of an OpenAlex URL id (`https://openalex.org/W123` → `W123`). */
function shortId(id: string): string {
  const idx = id.lastIndexOf('/');
  return idx === -1 ? id : id.slice(idx + 1);
}

function buildUrl(path: string, params: Record<string, string | number> = {}): string {
  const url = new URL(BASE + path);
  url.searchParams.set('mailto', MAILTO);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

function mapWork(w: OAWork): PaperMeta {
  const authors = (w.authorships ?? [])
    .map((a) => a.author?.display_name ?? undefined)
    .filter((n): n is string => Boolean(n));
  const paper: PaperMeta = {
    id: shortId(w.id),
    title: w.title ?? w.display_name ?? '(untitled)',
    authors,
  };
  if (w.doi) paper.doi = w.doi.replace(/^https?:\/\/doi\.org\//i, '');
  if (w.publication_year != null) paper.year = w.publication_year;
  const venue = w.primary_location?.source?.display_name;
  if (venue) paper.venue = venue;
  if (w.cited_by_count != null) paper.citedByCount = w.cited_by_count;
  return paper;
}

/** Resolve an app-level id (OpenAlex id or DOI) to a `/works/...` lookup path. */
function workPath(id: string): string {
  const trimmed = id.trim();
  if (/^https?:\/\/doi\.org\//i.test(trimmed)) return `/works/${trimmed}`;
  if (/^10\./.test(trimmed)) return `/works/https://doi.org/${trimmed}`;
  return `/works/${shortId(trimmed)}`;
}

/** Page through a `cites:`-style list, sorted by impact, up to MAX_PER_PAPER. */
async function fetchWorkList(filter: string, signal?: AbortSignal): Promise<PaperMeta[]> {
  const out: PaperMeta[] = [];
  let cursor = '*';
  while (cursor && out.length < MAX_PER_PAPER) {
    const page = await fetchJson<OAList<OAWork>>(
      buildUrl('/works', {
        filter,
        sort: 'cited_by_count:desc',
        'per-page': PAGE_SIZE,
        cursor,
        select: WORK_FIELDS.join(','),
      }),
      signal,
    );
    for (const w of page.results ?? []) out.push(mapWork(w));
    cursor = page.meta?.next_cursor ?? '';
  }
  return out.slice(0, MAX_PER_PAPER);
}

export const openAlexProvider: CitationProvider = {
  id: 'openalex',
  label: 'OpenAlex',

  async searchAuthors(query, signal) {
    const q = query.trim();
    if (!q) return [];
    const data = await fetchJson<OAList<OAAuthor>>(
      buildUrl('/authors', {
        search: q,
        'per-page': 10,
        select: 'id,display_name,works_count,last_known_institutions',
      }),
      signal,
    );
    return (data.results ?? []).map((a): AuthorHit => {
      const inst =
        a.last_known_institutions?.[0]?.display_name ?? a.last_known_institution?.display_name;
      const parts = [inst, a.works_count != null ? `${a.works_count} works` : undefined].filter(
        Boolean,
      );
      const hit: AuthorHit = { id: shortId(a.id), name: a.display_name ?? '(unknown author)' };
      if (parts.length) hit.hint = parts.join(' · ');
      return hit;
    });
  },

  async worksByAuthor(authorId, signal) {
    const data = await fetchJson<OAList<OAWork>>(
      buildUrl('/works', {
        filter: `author.id:${shortId(authorId)}`,
        sort: 'cited_by_count:desc',
        'per-page': 100,
        select: WORK_FIELDS.join(','),
      }),
      signal,
    );
    return (data.results ?? []).map(mapWork);
  },

  async getPaper(id, signal) {
    try {
      const w = await fetchJson<OAWork>(
        buildUrl(workPath(id), { select: WORK_FIELDS_WITH_REFS.join(',') }),
        signal,
      );
      return mapWork(w);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 404) {
        return null;
      }
      throw err;
    }
  },

  getCiters(id, signal) {
    return fetchWorkList(`cites:${shortId(id)}`, signal);
  },

  async getReferences(id, signal) {
    const w = await fetchJson<OAWork>(
      buildUrl(workPath(id), { select: 'id,referenced_works' }),
      signal,
    );
    const refs = (w.referenced_works ?? []).map(shortId).slice(0, MAX_PER_PAPER);
    if (refs.length === 0) return [];

    const out: PaperMeta[] = [];
    for (let i = 0; i < refs.length; i += ID_BATCH) {
      const batch = refs.slice(i, i + ID_BATCH);
      const page = await fetchJson<OAList<OAWork>>(
        buildUrl('/works', {
          filter: `openalex_id:${batch.join('|')}`,
          'per-page': ID_BATCH,
          select: WORK_FIELDS.join(','),
        }),
        signal,
      );
      for (const r of page.results ?? []) out.push(mapWork(r));
    }
    return out;
  },
};

// Exposed for unit tests.
export const __test = { mapWork, shortId, workPath, buildUrl };
