import type { PaperMeta } from '../types';
import { fetchJson } from './http';
import type { AuthorHit, CitationProvider } from './types';

const BASE = 'https://api.semanticscholar.org/graph/v1';

// Optional API key. The shared (keyless) pool is heavily rate-limited; set a key
// here for reliable use. Obtain one at https://www.semanticscholar.org/product/api.
const API_KEY = '';

const MAX_PER_PAPER = 200;
const PAGE_LIMIT = 100;

const PAPER_FIELDS = 'title,year,venue,citationCount,externalIds,authors';

interface S2Paper {
  paperId?: string | null;
  title?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  externalIds?: { DOI?: string | null } | null;
  authors?: Array<{ name?: string | null }> | null;
}

interface S2Author {
  authorId?: string | null;
  name?: string | null;
  affiliations?: string[] | null;
  paperCount?: number | null;
}

interface S2List<T> {
  data?: T[];
  next?: number | null;
}

function headers(): Record<string, string> | undefined {
  return API_KEY ? { 'x-api-key': API_KEY } : undefined;
}

function url(path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

function mapPaper(p: S2Paper): PaperMeta {
  const authors = (p.authors ?? [])
    .map((a) => a.name ?? undefined)
    .filter((n): n is string => Boolean(n));
  const paper: PaperMeta = {
    id: p.paperId ?? '',
    title: p.title ?? '(untitled)',
    authors,
  };
  if (p.externalIds?.DOI) paper.doi = p.externalIds.DOI;
  if (p.year != null) paper.year = p.year;
  if (p.venue) paper.venue = p.venue;
  if (p.citationCount != null) paper.citedByCount = p.citationCount;
  return paper;
}

/** Semantic Scholar accepts `<paperId>`, `DOI:<doi>`, etc. as a paper id. */
function paperRef(id: string): string {
  const t = id.trim();
  if (/^10\./.test(t)) return `DOI:${t}`;
  if (/^https?:\/\/doi\.org\//i.test(t)) return `DOI:${t.replace(/^https?:\/\/doi\.org\//i, '')}`;
  return t;
}

/** Page through citations/references, unwrapping the nested paper field. */
async function fetchEdgeList(
  id: string,
  kind: 'citations' | 'references',
  pick: 'citingPaper' | 'citedPaper',
  signal?: AbortSignal,
): Promise<PaperMeta[]> {
  const out: PaperMeta[] = [];
  let offset = 0;
  while (out.length < MAX_PER_PAPER) {
    const page = await fetchJson<S2List<Record<string, S2Paper>>>(
      url(`/paper/${paperRef(id)}/${kind}`, {
        fields: PAPER_FIELDS,
        limit: PAGE_LIMIT,
        offset,
      }),
      signal,
      3,
      headers(),
    );
    const rows = page.data ?? [];
    for (const row of rows) {
      const paper = row[pick];
      if (paper?.paperId) out.push(mapPaper(paper));
    }
    if (page.next == null || rows.length === 0) break;
    offset = page.next;
  }
  return out.slice(0, MAX_PER_PAPER);
}

export const semanticScholarProvider: CitationProvider = {
  id: 'semanticscholar',
  label: 'Semantic Scholar',

  async searchAuthors(query, signal) {
    const q = query.trim();
    if (!q) return [];
    const data = await fetchJson<S2List<S2Author>>(
      url('/author/search', { query: q, fields: 'name,affiliations,paperCount', limit: 10 }),
      signal,
      3,
      headers(),
    );
    return (data.data ?? [])
      .filter((a) => a.authorId)
      .map((a): AuthorHit => {
        const parts = [
          a.affiliations?.[0],
          a.paperCount != null ? `${a.paperCount} papers` : undefined,
        ].filter(Boolean);
        const hit: AuthorHit = { id: a.authorId as string, name: a.name ?? '(unknown author)' };
        if (parts.length) hit.hint = parts.join(' · ');
        return hit;
      });
  },

  async worksByAuthor(authorId, signal) {
    const data = await fetchJson<S2List<S2Paper>>(
      url(`/author/${authorId}/papers`, { fields: PAPER_FIELDS, limit: 100 }),
      signal,
      3,
      headers(),
    );
    return (data.data ?? [])
      .filter((p) => p.paperId)
      .map(mapPaper)
      .sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0));
  },

  async getPaper(id, signal) {
    try {
      const p = await fetchJson<S2Paper>(
        url(`/paper/${paperRef(id)}`, { fields: PAPER_FIELDS }),
        signal,
        3,
        headers(),
      );
      return p.paperId ? mapPaper(p) : null;
    } catch (err) {
      if (err instanceof Error && (err as { status?: number }).status === 404) return null;
      throw err;
    }
  },

  getCiters(id, signal) {
    return fetchEdgeList(id, 'citations', 'citingPaper', signal);
  },

  getReferences(id, signal) {
    return fetchEdgeList(id, 'references', 'citedPaper', signal);
  },
};

export const __test = { mapPaper, paperRef };
