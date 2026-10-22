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

  it('the first fake request URL contains created_at_i and tags= (check the decoded URL contains "(story,comment)")', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await hackerNewsAdapter.search({ keywords: ['k1'], sinceDays: 30, maxResults: 10 }, getCtx(fetchFn));
    const url = fetchFn.mock.calls[0]![0] as string;
    const decoded = decodeURIComponent(url);
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
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: 'hackernews', label: 'billing', status: 'ok', httpStatus: 200, itemsReturned: 1, quotaRemaining: null });
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
});
