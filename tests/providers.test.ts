import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test as oa, openAlexProvider } from '../src/providers/openalex';
import { __test as ss, semanticScholarProvider } from '../src/providers/semanticscholar';

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAlex mapping helpers', () => {
  it('shortens OpenAlex URL ids', () => {
    expect(oa.shortId('https://openalex.org/W123')).toBe('W123');
    expect(oa.shortId('W123')).toBe('W123');
  });

  it('builds /works lookup paths for ids and DOIs', () => {
    expect(oa.workPath('W42')).toBe('/works/W42');
    expect(oa.workPath('10.1/abc')).toBe('/works/https://doi.org/10.1/abc');
    expect(oa.workPath('https://doi.org/10.1/abc')).toBe('/works/https://doi.org/10.1/abc');
  });

  it('always attaches the polite-pool mailto', () => {
    expect(oa.buildUrl('/works', { filter: 'cites:W1' })).toContain('mailto=');
  });

  it('maps a work into normalized PaperMeta', () => {
    const paper = oa.mapWork({
      id: 'https://openalex.org/W9',
      doi: 'https://doi.org/10.5/xyz',
      title: 'A Title',
      publication_year: 2021,
      cited_by_count: 7,
      authorships: [
        { author: { display_name: 'Ada L.' } },
        { author: { display_name: 'Alan T.' } },
      ],
      primary_location: { source: { display_name: 'JACM' } },
    });
    expect(paper).toEqual({
      id: 'W9',
      doi: '10.5/xyz',
      title: 'A Title',
      authors: ['Ada L.', 'Alan T.'],
      year: 2021,
      venue: 'JACM',
      citedByCount: 7,
    });
  });
});

describe('OpenAlex provider over a mocked API', () => {
  it('paginates getCiters across cursor pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'https://openalex.org/W2', title: 'P2', authorships: [] }],
          meta: { next_cursor: 'next' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'https://openalex.org/W3', title: 'P3', authorships: [] }],
          meta: { next_cursor: null },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const citers = await openAlexProvider.getCiters('W1');
    expect(citers.map((c) => c.id)).toEqual(['W2', 'W3']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('filter=cites%3AW1');
  });

  it('batch-fetches references from referenced_works', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'https://openalex.org/W1',
          referenced_works: ['https://openalex.org/W5', 'https://openalex.org/W6'],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: 'https://openalex.org/W5', title: 'R5', authorships: [] },
            { id: 'https://openalex.org/W6', title: 'R6', authorships: [] },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const refs = await openAlexProvider.getReferences('W1');
    expect(refs.map((r) => r.id).sort()).toEqual(['W5', 'W6']);
  });
});

describe('Semantic Scholar mapping helpers', () => {
  it('maps a paper into normalized PaperMeta', () => {
    const paper = ss.mapPaper({
      paperId: 'abc',
      title: 'SS Paper',
      year: 2018,
      venue: 'NeurIPS',
      citationCount: 3,
      externalIds: { DOI: '10.9/ss' },
      authors: [{ name: 'Grace H.' }],
    });
    expect(paper).toEqual({
      id: 'abc',
      doi: '10.9/ss',
      title: 'SS Paper',
      authors: ['Grace H.'],
      year: 2018,
      venue: 'NeurIPS',
      citedByCount: 3,
    });
  });

  it('formats paper references for the API', () => {
    expect(ss.paperRef('abc')).toBe('abc');
    expect(ss.paperRef('10.1/x')).toBe('DOI:10.1/x');
    expect(ss.paperRef('https://doi.org/10.1/x')).toBe('DOI:10.1/x');
  });

  it('unwraps citingPaper from the citations endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ citingPaper: { paperId: 'p2', title: 'Citing', authors: [] } }],
        next: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const citers = await semanticScholarProvider.getCiters('p1');
    expect(citers).toEqual([{ id: 'p2', title: 'Citing', authors: [] }]);
  });
});
