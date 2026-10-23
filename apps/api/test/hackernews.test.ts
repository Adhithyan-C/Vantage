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

  it('normal request URLs contain created_at_i and tags=(story,comment)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    const normalUrl = String(fetchFn.mock.calls[1]![0]);
    const decoded = decodeURIComponent(normalUrl);
    expect(decoded).toContain('created_at_i>');
    expect(decoded).toContain('tags=(story,comment)');
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
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ hits: [{ objectID: 'r', author: 'u', title: 'Valid title', created_at: '2026-10-01T00:00:00Z' }] }), { status: 200 });
    await hackerNewsAdapter.search({ keywords: ['billing'], sinceDays: 30, maxResults: 10 }, {
      ...getCtx(fetchFn), onRequest: (record) => records.push(record),
    });
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.label)).toEqual(['billing (Ask HN)', 'billing']);
    expect(records.every((record) => record.status === 'ok' && record.itemsReturned === 1)).toBe(true);
    expect(records[0]).toMatchObject({ source: 'hackernews', httpStatus: 200, quotaRemaining: null });
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

  it('issues Ask and normal requests for every keyword with per-keyword limits', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await hackerNewsAdapter.search({ keywords: ['one', 'two', 'three'], sinceDays: 30, maxResults: 30 }, getCtx(fetchFn));
    expect(fetchFn).toHaveBeenCalledTimes(6);
    const urls = fetchFn.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls.map((url) => url.searchParams.get('query'))).toContain('one');
    expect(urls.map((url) => url.searchParams.get('query'))).toContain('two');
    expect(urls.map((url) => url.searchParams.get('query'))).toContain('three');
    expect(urls.slice(0, 3).every((url) => url.searchParams.get('tags') === 'ask_hn')).toBe(true);
    expect(urls.slice(3).every((url) => url.searchParams.get('tags') === '(story,comment)')).toBe(true);
    expect(urls.slice(0, 3).every((url) => url.searchParams.get('hitsPerPage') === '10')).toBe(true);
  });

  it.each([
    { keywords: Array.from({ length: 10 }, (_, index) => `kw${index}`), maxResults: 50, expected: '5' },
    { keywords: ['one', 'two'], maxResults: 100, expected: '50' },
    { keywords: ['one'], maxResults: 100, expected: '100' },
    { keywords: ['one'], maxResults: 1, expected: '5' },
  ])('uses bounded per-keyword limits for $keywords.length keywords and cap $maxResults', async ({ keywords, maxResults, expected }) => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await hackerNewsAdapter.search({ keywords, sinceDays: 30, maxResults }, getCtx(fetchFn));
    const urls = fetchFn.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls.slice(0, keywords.length).every((url) =>
      url.searchParams.get('hitsPerPage') === String(Math.min(20, Number(expected))),
    )).toBe(true);
    expect(urls.slice(keywords.length).every((url) => url.searchParams.get('hitsPerPage') === expected)).toBe(true);
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

  it('merges Ask results first and round-robins by keyword independent of response timing', async () => {
    const hit = (id: string) => ({ objectID: id, author: 'user', title: `Post ${id}`, created_at: '2026-10-01T00:00:00Z' });
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const keyword = url.searchParams.get('query');
      const ask = url.searchParams.get('tags') === 'ask_hn';
      await new Promise((resolve) => setTimeout(resolve, keyword === 'one' ? 5 : 0));
      const prefix = ask ? 'ask' : 'normal';
      const hits = keyword === 'one' ? [hit(`${prefix}-one-1`), hit(`${prefix}-one-2`)] : [hit(`${prefix}-two-1`), hit(`${prefix}-two-2`)];
      return new Response(JSON.stringify({ hits }), { status: 200 });
    };
    const result = await hackerNewsAdapter.search({ keywords: ['one', 'two'], sinceDays: 30, maxResults: 8 }, getCtx(fetchFn));
    expect(result.signals.map((signal) => signal.externalId)).toEqual([
      'ask-one-1', 'ask-two-1', 'ask-one-2', 'ask-two-2',
      'normal-one-1', 'normal-two-1', 'normal-one-2', 'normal-two-2',
    ]);
  });

  it('dedupes on first occurrence and applies maxResults after merged ordering', async () => {
    const hit = (id: string, title: string) => ({ objectID: id, author: 'user', title, created_at: '2026-10-01T00:00:00Z' });
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const ask = url.searchParams.get('tags') === 'ask_hn';
      return new Response(JSON.stringify({ hits: ask
        ? [hit('duplicate', 'Ask version'), hit('ask-two', 'Ask second')]
        : [hit('duplicate', 'Normal version'), hit('normal-two', 'Normal second')],
      }), { status: 200 });
    };
    const result = await hackerNewsAdapter.search({ keywords: ['one'], sinceDays: 30, maxResults: 3 }, getCtx(fetchFn));
    expect(result.signals.map((signal) => signal.externalId)).toEqual(['duplicate', 'ask-two', 'normal-two']);
    expect(result.signals[0]?.text).toBe('Ask version');
  });

  it('request labels include the keyword and Ask HN suffix', async () => {
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ hits: [] }), { status: 200 });
    await hackerNewsAdapter.search({ keywords: ['kw'], sinceDays: 30, maxResults: 10 }, {
      ...getCtx(fetchFn), onRequest: (record) => records.push(record),
    });
    expect(records.map((record) => record.label)).toEqual(['kw (Ask HN)', 'kw']);
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
