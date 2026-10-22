import { describe, expect, it } from 'vitest';
import { mapQuestion, createStackExchangeAdapter } from '../src/sources/stackexchange.js';
import type { AdapterContext, SourceQuery } from '../src/sources/types.js';
import type { RequestRecord } from '@vantage/shared';

const NOW = new Date('2026-10-20T00:00:00.000Z');
const query: SourceQuery = { keywords: ['helpdesk'], sinceDays: 30, maxResults: 10 };

function question(id = 1): Record<string, unknown> {
  return {
    question_id: id,
    title: 'Need a better support platform',
    body: '<p>Our small team needs customer support software.</p>',
    link: `https://softwarerecs.stackexchange.com/questions/${id}/support`,
    creation_date: 1_700_000_000,
    score: 4,
    answer_count: 2,
    owner: { display_name: 'Test <b>User</b> &amp; Co' },
  };
}

function makeContext(fetch: typeof globalThis.fetch): AdapterContext {
  return {
    fetch,
    now: () => new Date(NOW),
    userAgent: 'vantage-test/1.0',
    timeoutMs: 100,
    maxRetries: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiBody(items: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { items, quota_remaining: 1000, quota_max: 10000, has_more: false, ...extra };
}

describe('mapQuestion', () => {
  it('combines title and body, decodes HTML, and maps date, id and engagement', () => {
    const mapped = mapQuestion(question(42), 'softwarerecs');
    expect(mapped).toMatchObject({
      source: 'stackexchange',
      externalId: 'softwarerecs:42',
      authorHandle: 'Test User & Co',
      community: 'softwarerecs',
      url: 'https://softwarerecs.stackexchange.com/questions/42/support',
      text: 'Need a better support platform\n\nOur small team needs customer support software.',
      createdAt: new Date(1_700_000_000_000).toISOString(),
      engagement: { score: 4, comments: 2 },
    });
  });

  it.each([
    ['missing owner', { ...question(), owner: undefined }],
    ['missing link', { ...question(), link: undefined }],
    ['short text', { ...question(), title: 'Short', body: '' }],
  ])('skips an item with %s', (_reason, item) => {
    expect(mapQuestion(item, 'softwarerecs')).toBeNull();
  });

  it('uses the title alone when the body is empty', () => {
    expect(mapQuestion({ ...question(), body: '' }, 'softwarerecs')?.text)
      .toBe('Need a better support platform');
  });
});

describe('Stack Exchange adapter', () => {
  it('builds an advanced-search request with the configured key and required parameters', async () => {
    const urls: URL[] = [];
    const fetchFn: typeof fetch = async (input) => {
      urls.push(new URL(String(input)));
      return jsonResponse(apiBody([]));
    };
    const adapter = createStackExchangeAdapter({ key: 'public-app-key', sites: ['softwarerecs'] });
    await adapter.search(query, makeContext(fetchFn));
    const url = urls[0];
    expect(url?.pathname).toBe('/2.3/search/advanced');
    expect(url?.searchParams.get('q')).toBe('helpdesk');
    expect(url?.searchParams.get('site')).toBe('softwarerecs');
    expect(url?.searchParams.get('sort')).toBe('relevance');
    expect(url?.searchParams.get('order')).toBe('desc');
    expect(url?.searchParams.get('fromdate')).toBe(String(Math.floor(NOW.getTime() / 1000) - 30 * 86400));
    expect(url?.searchParams.get('pagesize')).toBe('10');
    expect(url?.searchParams.get('page')).toBe('1');
    expect(url?.searchParams.get('filter')).toBe('withbody');
    expect(url?.searchParams.get('key')).toBe('public-app-key');
  });

  it('caps page size at 100 and omits an unconfigured key', async () => {
    let requestUrl = '';
    const fetchFn: typeof fetch = async (input) => {
      requestUrl = String(input);
      return jsonResponse(apiBody([]));
    };
    const adapter = createStackExchangeAdapter({ key: '', sites: ['softwarerecs'] });
    await adapter.search({ ...query, maxResults: 150 }, makeContext(fetchFn));
    const url = new URL(requestUrl);
    expect(url.searchParams.get('pagesize')).toBe('100');
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('makes one request per keyword and site in site-then-keyword order', async () => {
    const urls: URL[] = [];
    let id = 0;
    const fetchFn: typeof fetch = async (input) => {
      urls.push(new URL(String(input)));
      id++;
      return jsonResponse(apiBody([question(id)]));
    };
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs', 'stackoverflow'] });
    const result = await adapter.search({ ...query, keywords: ['first', 'second'] }, makeContext(fetchFn));
    expect(urls.map((url) => [url.searchParams.get('site'), url.searchParams.get('q')])).toEqual([
      ['softwarerecs', 'first'],
      ['softwarerecs', 'second'],
      ['stackoverflow', 'first'],
      ['stackoverflow', 'second'],
    ]);
    expect(result.signals).toHaveLength(4);
  });

  it('deduplicates question ids across keywords', async () => {
    const fetchFn: typeof fetch = async () => jsonResponse(apiBody([question(7)]));
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    const result = await adapter.search({ ...query, keywords: ['first', 'second'] }, makeContext(fetchFn));
    expect(result.signals).toHaveLength(1);
  });

  it('stops after collecting maxResults signals', async () => {
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return jsonResponse(apiBody([question(requests), question(requests + 10)]));
    };
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    const result = await adapter.search({ ...query, keywords: ['first', 'second'], maxResults: 1 }, makeContext(fetchFn));
    expect(result.signals).toHaveLength(1);
    expect(requests).toBe(1);
  });

  it('waits for the exact supported backoff duration', async () => {
    const waits: number[] = [];
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return jsonResponse(apiBody([], requests === 1 ? { backoff: 2 } : {}));
    };
    const adapter = createStackExchangeAdapter({
      sites: ['softwarerecs'],
      sleep: async (ms) => { waits.push(ms); },
    });
    await adapter.search({ ...query, keywords: ['first', 'second'] }, makeContext(fetchFn));
    expect(waits).toEqual([2000]);
  });

  it('stops with a degraded result when the requested backoff exceeds 60 seconds', async () => {
    let requests = 0;
    const waits: number[] = [];
    const fetchFn: typeof fetch = async () => {
      requests++;
      return requests === 1
        ? jsonResponse(apiBody([question()]))
        : jsonResponse({ error_id: 502, error_name: 'throttle_violation', backoff: 90 }, 502);
    };
    const adapter = createStackExchangeAdapter({
      sites: ['softwarerecs'],
      sleep: async (ms) => { waits.push(ms); },
    });
    const result = await adapter.search(
      { ...query, keywords: ['first', 'second'] },
      { ...makeContext(fetchFn), maxRetries: 3 },
    );
    expect(result.status).toBe('degraded');
    expect(result.error).toBe('Stack Exchange asked for a 90s backoff; stopped early');
    expect(result.signals).toHaveLength(1);
    expect(requests).toBe(2);
    expect(waits).toEqual([]);
  });

  it('stops when quota is below ten and reports the remaining quota', async () => {
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return jsonResponse(apiBody([question()], { quota_remaining: 5 }));
    };
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    const result = await adapter.search({ ...query, keywords: ['first', 'second'] }, makeContext(fetchFn));
    expect(result).toMatchObject({ status: 'degraded', error: 'Stack Exchange quota nearly used (5 left)' });
    expect(result.signals).toHaveLength(1);
    expect(requests).toBe(1);
  });

  it('returns degraded when one request fails and keeps signals from the successful request', async () => {
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return requests === 1 ? jsonResponse(apiBody([question()])) : new Response('error', { status: 500 });
    };
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    const result = await adapter.search({ ...query, keywords: ['first', 'second'] }, makeContext(fetchFn));
    expect(result.status).toBe('degraded');
    expect(result.signals).toHaveLength(1);
  });

  it('returns failed when every request fails and treats API error bodies as failures', async () => {
    const fetchFn: typeof fetch = async () => jsonResponse({
      error_id: 502,
      error_name: 'throttle_violation',
      error_message: 'Request failed',
      quota_remaining: 100,
    });
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    const result = await adapter.search(query, makeContext(fetchFn));
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Stack Exchange API error 502');
  });

  it('treats a successful response without an items array as failed', async () => {
    const fetchFn: typeof fetch = async () => jsonResponse({ quota_remaining: 100 });
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    const result = await adapter.search(query, makeContext(fetchFn));
    expect(result).toMatchObject({
      status: 'failed',
      error: 'Stack Exchange response had no items array',
    });
  });

  it('does not return a configured key in an error', async () => {
    const fetchFn: typeof fetch = async () => new Response('error', { status: 403 });
    const adapter = createStackExchangeAdapter({ key: 'secret-key-value', sites: ['softwarerecs'] });
    const result = await adapter.search(query, makeContext(fetchFn));
    expect(result.error).not.toContain('secret-key-value');
  });

  it('returns skipped without making a request when there are no keywords', async () => {
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return jsonResponse(apiBody([]));
    };
    const adapter = createStackExchangeAdapter();
    const result = await adapter.search({ ...query, keywords: [] }, makeContext(fetchFn));
    expect(result).toMatchObject({ status: 'skipped', error: 'No keywords provided', signals: [] });
    expect(requests).toBe(0);
  });

  it('drops invalid sites and limits configured sites to three', async () => {
    const requestedSites: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      requestedSites.push(new URL(String(input)).searchParams.get('site') ?? '');
      return jsonResponse(apiBody([]));
    };
    const adapter = createStackExchangeAdapter({
      sites: ['Bad', 'stackoverflow', 'bad site', 'softwarerecs', 'unix', 'askubuntu'],
    });
    await adapter.search({ ...query, keywords: ['one'] }, makeContext(fetchFn));
    expect(requestedSites).toEqual(['stackoverflow', 'softwarerecs', 'unix']);
  });

  it('records one request with site and keyword, raw item count and quota', async () => {
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async () => jsonResponse(apiBody([question()], { quota_remaining: 88 }));
    const adapter = createStackExchangeAdapter({ sites: ['softwarerecs'] });
    await adapter.search(query, { ...makeContext(fetchFn), onRequest: (record) => records.push(record) });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: 'stackexchange', label: 'softwarerecs: helpdesk', status: 'ok', httpStatus: 200, itemsReturned: 1, quotaRemaining: 88 });
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records sanitized errors without exposing a configured key', async () => {
    const records: RequestRecord[] = [];
    const fetchFn: typeof fetch = async () => new Response('error', { status: 403 });
    const adapter = createStackExchangeAdapter({ key: 'private-key', sites: ['softwarerecs'] });
    await adapter.search(query, { ...makeContext(fetchFn), onRequest: (record) => records.push(record) });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'failed', httpStatus: 403, error: 'Stack Exchange request failed with status 403', quotaRemaining: null });
    expect(JSON.stringify(records)).not.toContain('private-key');
  });
});
