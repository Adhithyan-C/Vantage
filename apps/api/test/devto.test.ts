import { describe, expect, it, vi } from 'vitest';
import type { RequestRecord } from '@vantage/shared';
import { createDevToAdapter, mapDevToArticle } from '../src/sources/devto.js';
import type { AdapterContext, SourceQuery } from '../src/sources/types.js';

const query: SourceQuery = {
  keywords: ['error tracking'], sinceDays: 730, maxResults: 2,
  variants: [{ category: 'problem', phrase: 'error tracking' }],
};

function context(fetch: typeof globalThis.fetch, overrides: Partial<AdapterContext> = {}): AdapterContext {
  return { fetch, now: () => new Date('2026-10-26T00:00:00Z'), userAgent: 'test', timeoutMs: 1000, maxRetries: 0, ...overrides };
}

function article(id: number) {
  return {
    id, title: `Error tracking article ${id}`, description: 'A short summary of the issue.',
    url: `https://dev.to/writer/error-tracking-${id}`, canonical_url: `https://dev.to/writer/error-tracking-${id}`,
    created_at: '2026-01-01T00:00:00Z', published_at: '2026-01-02T00:00:00Z',
    user: { username: 'writer' }, tag_list: ['observability'], positive_reactions_count: 8, comments_count: 2,
  };
}

describe('DEV Community source', () => {
  it('searches by query and lookback, paginates, and normalizes article snippets', async () => {
    const urls: URL[] = [];
    const fetch = vi.fn(async (input: Request | URL | string) => {
      const url = new URL(String(input));
      urls.push(url);
      const page = Number(url.searchParams.get('page'));
      return new Response(JSON.stringify([article(page * 10), article(page * 10 + 1), article(page * 10 + 2)]), { status: 200 });
    }) as typeof globalThis.fetch;
    const records: RequestRecord[] = [];
    const pagedQuery: SourceQuery = { ...query, maxResults: 5, variants: [query.variants![0]!, { category: 'feature_request', phrase: 'issue grouping' }] };
    const result = await createDevToAdapter().search(pagedQuery, context(fetch, {
      onRequest: (record) => records.push(record),
    }));
    expect(result.status).toBe('ok');
    expect(result.signals).toHaveLength(5);
    expect(urls.map((url) => [url.searchParams.get('q'), url.searchParams.get('top'), url.searchParams.get('page')]))
      .toEqual([['error tracking', '730', '1'], ['error tracking', '730', '2']]);
    expect(result.signals[0]).toMatchObject({
      source: 'devto', authorHandle: 'writer', text: 'Error tracking article 10\n\nA short summary of the issue.',
      contentCompleteness: 'snippet', metadata: { tags: ['observability'], queriesFound: ['error tracking'] },
    });
    expect(records[0]?.request).toEqual({ endpoint: 'https://dev.to/api/articles/search', params: { q: 'error tracking', top: '730', page: '1', per_page: '3' } });
    expect(records[0]?.responseSummary).toMatchObject({ returned: 3, sampleTitles: ['Error tracking article 10', 'Error tracking article 11', 'Error tracking article 12'] });
  });

  it('marks title-only results and successful empty results distinctly from errors', async () => {
    expect(mapDevToArticle({ ...article(5), description: '' }, 'query')?.contentCompleteness).toBe('title_only');
    const empty = await createDevToAdapter().search(query, context(
      vi.fn(async () => new Response('[]', { status: 200 })) as typeof globalThis.fetch,
    ));
    expect(empty.status).toBe('ok');
    expect(empty.signals).toEqual([]);
    const failed = await createDevToAdapter().search(query, context(
      vi.fn(async () => new Response('unavailable', { status: 503 })) as typeof globalThis.fetch,
    ));
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('503');
  });

  it('retries a rate-limited request using the provided delay', async () => {
    let calls = 0;
    const delays: number[] = [];
    const records: RequestRecord[] = [];
    const fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('rate limited', { status: 429, headers: { 'retry-after': '3' } })
        : new Response('[]', { status: 200 });
    }) as typeof globalThis.fetch;
    const result = await createDevToAdapter({ sleep: async (milliseconds) => { delays.push(milliseconds); } }).search(query, context(fetch, {
      maxRetries: 1, onRequest: (record) => records.push(record),
    }));
    expect(result.status).toBe('ok');
    expect(calls).toBe(2);
    expect(delays).toEqual([3000]);
    expect(records[0]).toMatchObject({ status: 'ok', outcome: 'no_results', error: null });
  });
});
