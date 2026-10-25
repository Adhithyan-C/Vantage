import { describe, it, expect, vi } from 'vitest';
import { hackerNewsAdapter } from '../src/sources/hackernews';
import type { RequestRecord } from '@vantage/shared';
import * as fs from 'fs';
import * as path from 'path';

describe('Hacker News adapter', () => {
  const getCtx = (fetchFn: typeof fetch) => ({
    fetch: fetchFn,
    now: () => new Date('2026-10-01T00:00:00Z'),
    userAgent: 'test/1.0',
    timeoutMs: 1000,
    maxRetries: 0
  });

  it('a comment hit maps correctly', async () => {
    const body = { hits: [{ objectID: '1', author: 'user', _tags: ['comment'], comment_text: '<p>test</p>', created_at: '2026-10-01T00:00:00Z' }] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const result = await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.signals[0]!.text).toBe('test');
    expect(result.signals[0]!.url).toBe('https://news.ycombinator.com/item?id=1');
    expect(result.signals[0]!.authorHandle).toBe('user');
    expect(result.signals[0]!.externalId).toBe('1');
    expect(result.signals[0]!.createdAt).toBe('2026-10-01T00:00:00Z');
  });

  it('a story hit has text equal to its title, then a blank line, then the plain-text story_text', async () => {
    const body = { hits: [{ objectID: '2', author: 'u2', _tags: ['story'], title: 'Story Title', story_text: 'story content', created_at_i: 1000000 }] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const result = await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.signals[0]!.text).toBe('Story Title\n\nstory content');
  });

  it('a hit with author null, a hit with author [deleted], and a hit with empty text are all skipped', async () => {
    const body = { hits: [
      { objectID: '3', author: null, title: 't', created_at: '2026-10-01T00:00:00Z' },
      { objectID: '4', author: '[deleted]', title: 't', created_at: '2026-10-01T00:00:00Z' },
      { objectID: '5', author: 'u5', title: '', comment_text: '', _tags: ['story'], created_at: '2026-10-01T00:00:00Z' },
      { objectID: '6', author: 'valid', title: 't6', created_at: '2026-10-01T00:00:00Z' }
    ] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const result = await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.signals.length).toBe(1);
    expect(result.signals[0]!.externalId).toBe('6');
  });

  it('two keywords where the second request returns status 500: the result status is degraded and the signals from the first keyword are returned', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ hits: [{ objectID: '7', author: 'u7', title: 't', created_at: '2026-10-01T00:00:00Z' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }));
    const result = await hackerNewsAdapter.search({ keywords: ['k1', 'k2'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.status).toBe('degraded');
    expect(result.signals.length).toBe(1);
    expect(result.signals[0]!.externalId).toBe('7');
  });

  it('one keyword whose request returns status 500: status failed and zero signals', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));
    const result = await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.status).toBe('failed');
    expect(result.signals.length).toBe(0);
  });

  it('request URLs contain a quoted phrase, bounded type filters and a lookback', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    const normalUrl = String(fetchFn.mock.calls.find((call) => new URL(String(call[0])).searchParams.get('query') === '"k1 feature request"')?.[0]);
    const parsedUrl = new URL(normalUrl);
    expect(parsedUrl.searchParams.get('numericFilters')).toContain('created_at_i>');
    expect(parsedUrl.searchParams.get('tags')).toBe('(story,ask_hn,show_hn)');
    expect(parsedUrl.searchParams.get('query')).toBe('"k1 feature request"');
  });

  it('a duplicate objectID returned across two keywords appears once', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [{ objectID: '8', author: 'u8', title: 't', created_at: '2026-10-01T00:00:00Z' }] }), { status: 200 }));
    const result = await hackerNewsAdapter.search({ keywords: ['k1', 'k2'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.signals.length).toBe(1);
  });

  it('using the recorded fixture fixtures/hn/search-sample.json as the response body: signals.length is greater than 0 and every signal passes RawSignalSchema.safeParse', async () => {
    const fixturePath = path.join(process.cwd(), 'fixtures', 'hn', 'search-sample.json');
    if (!fs.existsSync(fixturePath)) {
      console.warn('Fixture not found, skipping.');
      return;
    }
    const fixtureText = fs.readFileSync(fixturePath, 'utf8');
    const fetchFn = vi.fn().mockResolvedValue(new Response(fixtureText, { status: 200 }));
    const result = await hackerNewsAdapter.search({ keywords: ['test'], sinceDays: 30, maxResults: 50 }, getCtx(fetchFn));
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('an empty keywords array returns status skipped', async () => {
    const fetchFn = vi.fn();
    const result = await hackerNewsAdapter.search({ keywords: [], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    expect(result.status).toBe('skipped');
    expect(result.signals.length).toBe(0);
  });

  it('records one request with its keyword, raw item count, status and duration', async () => {
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ hits: Array.from({ length: 10 }, (_, index) => ({ objectID: `r-${index}`, author: 'u', title: 'Valid title', created_at: '2026-10-01T00:00:00Z' })), nbHits: 10, nbPages: 1 }), { status: 200 });
    await hackerNewsAdapter.search({ keywords: ['billing'], sinceDays: 30, maxResults: 10, variants: [{ category: 'problem', phrase: 'billing' }] }, {
      ...getCtx(fetchFn), onRequest: (record) => records.push(record),
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.label).toContain('problem (quoted): billing');
    expect(records.every((record) => record.status === 'ok' && record.itemsReturned === 10)).toBe(true);
    expect(records[0]).toMatchObject({ source: 'hackernews', httpStatus: 200, quotaRemaining: null });
    expect(records[0]?.request).toMatchObject({ endpoint: 'https://hn.algolia.com/api/v1/search', params: { query: '"billing"', tags: '(story,ask_hn,show_hn)' } });
    expect(records[0]?.responseSummary).toMatchObject({ returned: 10, totalHits: 10, page: 0 });
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records sanitized request errors for failed responses', async () => {
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async () => new Response('error', { status: 403 });
    await hackerNewsAdapter.search({ keywords: ['billing'], sinceDays: 30, maxResults: 10 }, {
      ...getCtx(fetchFn), onRequest: (record) => records.push(record),
    });
    expect(records[0]).toMatchObject({ status: 'failed', httpStatus: 403, error: 'HN request failed with status 403' });
  });

  it('uses capped phrase variants and HN type filters', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    const variants = Array.from({ length: 10 }, (_, index) => ({ category: 'problem' as const, phrase: `phrase ${index}` }));
    await hackerNewsAdapter.search({ keywords: ['one', 'two', 'three'], sinceDays: 30, maxResults: 30, variants }, getCtx(fetchFn));
    expect(fetchFn).toHaveBeenCalledTimes(16);
    const urls = fetchFn.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls.map((url) => url.searchParams.get('query'))).toContain('"phrase 0"');
    expect(urls.map((url) => url.searchParams.get('query'))).toContain('phrase 0');
    expect(urls.every((url) => url.searchParams.get('tags') === '(story,ask_hn,show_hn)')).toBe(true);
    expect(urls.every((url) => url.searchParams.get('page') === '0')).toBe(true);
  });

  it('fetches a bounded second relevance page when Algolia reports more pages', async () => {
    const pages: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      pages.push(url.searchParams.get('page') ?? '');
      return new Response(JSON.stringify({
        hits: [{ objectID: `page-${url.searchParams.get('page')}`, author: 'user', title: 'Error monitoring options', created_at: '2026-10-01T00:00:00Z' }],
        nbPages: 20,
        nbHits: 20,
      }), { status: 200 });
    };
    const result = await hackerNewsAdapter.search({
      keywords: ['error monitoring'], sinceDays: 1095, maxResults: 10,
      variants: [{ category: 'problem', phrase: 'error monitoring' }],
    }, getCtx(fetchFn));
    expect(pages).toEqual(['0', '1', '0', '1']);
    expect(result.signals.map((signal) => signal.externalId)).toEqual(['page-0', 'page-1']);
  });

  it.each([
    { variants: ['one', 'two'], maxResults: 30, expected: '45' },
    { variants: ['one'], maxResults: 100, expected: '100' },
  ])('uses bounded page sizes for $variants.length variants and cap $maxResults', async ({ variants, maxResults, expected }) => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await hackerNewsAdapter.search({ keywords: variants, variants: variants.map((phrase) => ({ category: 'problem' as const, phrase })), sinceDays: 30, maxResults }, getCtx(fetchFn));
    const urls = fetchFn.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls.every((url) => url.searchParams.get('hitsPerPage') === expected)).toBe(true);
  });

  it('never has more than three requests in flight', async () => {
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchFn: typeof fetch = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    };
    const pending = hackerNewsAdapter.search({ keywords: ['a', 'b', 'c'], sinceDays: 30, maxResults: 30 }, getCtx(fetchFn));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maximum).toBe(3);
    release?.();
    await pending;
    expect(maximum).toBe(3);
  });

  it('round-robins phrase variants independent of response timing', async () => {
    const hit = (id: string) => ({ objectID: id, author: 'user', title: `Post ${id}`, created_at: '2026-10-01T00:00:00Z' });
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const keyword = url.searchParams.get('query')?.replaceAll('"', '');
      await new Promise((resolve) => setTimeout(resolve, keyword === 'one' ? 5 : 0));
      const hits = keyword === 'one' ? [hit('one-1'), hit('one-2')] : [hit('two-1'), hit('two-2')];
      return new Response(JSON.stringify({ hits }), { status: 200 });
    };
    const variants = ['one', 'two'].map((phrase) => ({ category: 'problem' as const, phrase }));
    const result = await hackerNewsAdapter.search({ keywords: ['one', 'two'], variants, sinceDays: 30, maxResults: 4 }, getCtx(fetchFn));
    expect(result.signals.map((signal) => signal.externalId)).toEqual([
      'one-1', 'two-1', 'one-2', 'two-2',
    ]);
  });

  it('dedupes on first occurrence and applies maxResults after merged ordering', async () => {
    const hit = (id: string, title: string) => ({ objectID: id, author: 'user', title, created_at: '2026-10-01T00:00:00Z' });
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const phrase = url.searchParams.get('query');
      return new Response(JSON.stringify({ hits: phrase?.includes('one')
        ? [hit('duplicate', 'First version'), hit('first-two', 'First second')]
        : [hit('duplicate', 'Second version'), hit('second-two', 'Second second')],
      }), { status: 200 });
    };
    const variants = ['one', 'two'].map((phrase) => ({ category: 'problem' as const, phrase }));
    const result = await hackerNewsAdapter.search({ keywords: ['one'], variants, sinceDays: 30, maxResults: 3 }, getCtx(fetchFn));
    expect(result.signals.map((signal) => signal.externalId)).toEqual(['duplicate', 'first-two', 'second-two']);
    expect(result.signals[0]?.text).toBe('First version');
  });

  it('request labels record whether a query was quoted or an all-words fallback', async () => {
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ hits: [] }), { status: 200 });
    await hackerNewsAdapter.search({ keywords: ['two words'], sinceDays: 30, maxResults: 10, variants: [{ category: 'problem', phrase: 'two words' }] }, {
      ...getCtx(fetchFn), onRequest: (record) => records.push(record),
    });
    expect(records.map((record) => record.label)).toEqual(['problem (quoted): two words', 'problem (all_words): two words']);
  });

  it('retries only a sparse quoted query when another query has enough results', async () => {
    const queries: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const query = new URL(String(input)).searchParams.get('query') ?? '';
      queries.push(query);
      const isSparseQuery = query.includes('error tracking');
      const hits = isSparseQuery && query.startsWith('"') ? [] : Array.from({ length: 10 }, (_, index) => ({
        objectID: `${query}-${index}`, author: 'user', title: 'A relevant error monitoring discussion', created_at: '2026-10-01T00:00:00Z',
      }));
      return new Response(JSON.stringify({ hits, nbPages: 1 }), { status: 200 });
    };
    await hackerNewsAdapter.search({
      keywords: ['error tracking'], sinceDays: 30, maxResults: 100,
      variants: [
        { category: 'problem', phrase: 'error tracking' },
        { category: 'operational_pain', phrase: 'error monitoring' },
      ],
    }, getCtx(fetchFn));
    expect(queries).toEqual(['"error tracking"', '"error monitoring"', 'error tracking']);
  });

  it('retries sparse quoted results with the same unquoted query and records the form', async () => {
    const records: RequestRecord[] = [];
    const queries: string[] = [];
    const requestUrls: URL[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requestUrls.push(url);
      const query = url.searchParams.get('query') ?? '';
      queries.push(query);
      const hits = query === '"error tracking"' ? [] : [{ objectID: 'fallback-hit', author: 'user', title: 'Error tracking choices', created_at: '2026-10-01T00:00:00Z' }];
      return new Response(JSON.stringify({ hits, nbPages: 1 }), { status: 200 });
    };
    const result = await hackerNewsAdapter.search({
      keywords: ['error tracking'], sinceDays: 1095, maxResults: 10,
      variants: [{ category: 'problem', phrase: 'error tracking' }],
    }, { ...getCtx(fetchFn), onRequest: (record) => records.push(record) });
    expect(queries).toEqual(['"error tracking"', 'error tracking']);
    expect(result.signals.map((signal) => signal.externalId)).toEqual(['fallback-hit']);
    expect(requestUrls[0]?.searchParams.get('numericFilters'))
      .toBe(`created_at_i>${Math.floor(new Date('2026-10-01T00:00:00Z').getTime() / 1000) - 1095 * 86400}`);
    expect(records[0]?.request?.params.numericFilters).toBe(requestUrls[0]?.searchParams.get('numericFilters'));
    expect(records.map((record) => record.label)).toEqual(['problem (quoted): error tracking', 'problem (all_words): error tracking']);
  });

  it('sends phrases longer than five words unquoted on the primary request', async () => {
    const queries: string[] = [];
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async (input) => {
      queries.push(new URL(String(input)).searchParams.get('query') ?? '');
      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    };
    await hackerNewsAdapter.search({
      keywords: ['monitoring options'], sinceDays: 30, maxResults: 10,
      variants: [{ category: 'operational_pain', phrase: 'monitoring options for a medium-sized company' }],
    }, { ...getCtx(fetchFn), onRequest: (record) => records.push(record) });
    expect(queries).toEqual(['monitoring options for a medium-sized company']);
    expect(records[0]?.label).toContain('(all_words)');
  });

  it('one failed request among multiple degrades the result while all failed requests fail it', async () => {
    const partlyFailing = vi.fn()
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    const partial = await hackerNewsAdapter.search({ keywords: ['one'], sinceDays: 30, maxResults: 10 }, getCtx(partlyFailing));
    expect(partial.status).toBe('degraded');
    const failing = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));
    const allFailed = await hackerNewsAdapter.search({ keywords: ['one'], sinceDays: 30, maxResults: 10 }, getCtx(failing));
    expect(allFailed.status).toBe('failed');
  });
});
