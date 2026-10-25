import { describe, expect, it, vi } from 'vitest';
import type { RequestRecord } from '@vantage/shared';
import { createGitHubAdapter, mapGitHubIssue } from '../src/sources/github.js';
import type { AdapterContext, SourceQuery } from '../src/sources/types.js';

const query: SourceQuery = {
  keywords: ['error tracking'], sinceDays: 1095, maxResults: 2,
  variants: [{ category: 'problem', phrase: 'error tracking' }],
};

function context(fetch: typeof globalThis.fetch, overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    fetch, now: () => new Date('2026-10-26T00:00:00Z'), userAgent: 'test',
    timeoutMs: 1000, maxRetries: 0, ...overrides,
  };
}

function issue(id: number, title = `Error tracking issue ${id}`) {
  return {
    id, number: id, title, body: 'The error tracking workflow is difficult to operate.',
    html_url: `https://github.com/example/repo/issues/${id}`,
    created_at: '2024-01-01T00:00:00Z', comments: 3, state: 'open',
    repository_url: 'https://api.github.com/repos/example/repo', user: { login: 'reporter' },
    labels: [{ name: 'bug' }],
  };
}

describe('GitHub issue source', () => {
  it('sends a phrase query with issue, field and date qualifiers and paginates within its cap', async () => {
    const urls: URL[] = [];
    const authorizationHeaders: Array<string | null> = [];
    const fetch = vi.fn(async (input: Request | URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      urls.push(url);
      authorizationHeaders.push(new Headers(init?.headers).get('Authorization'));
      const page = Number(url.searchParams.get('page'));
      return new Response(JSON.stringify({ items: [issue(page * 10), issue(page * 10 + 1), issue(page * 10 + 2)], total_count: 5 }), { status: 200 });
    }) as typeof globalThis.fetch;
    const records: RequestRecord[] = [];
    const pagedQuery: SourceQuery = { ...query, maxResults: 5, variants: [query.variants![0]!, { category: 'feature_request', phrase: 'issue grouping' }] };
    const result = await createGitHubAdapter({ token: 'private-token' }).search(pagedQuery, context(fetch, {
      onRequest: (record) => records.push(record),
    }));

    expect(result.status).toBe('ok');
    expect(result.signals).toHaveLength(5);
    expect(urls).toHaveLength(2);
    expect(authorizationHeaders).toEqual(['Bearer private-token', 'Bearer private-token']);
    expect(urls[0]!.searchParams.get('q')).toBe('"error tracking" is:issue in:title,body created:>2023-10-27');
    expect(urls.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(records[0]?.request?.params?.q).toBe(urls[0]!.searchParams.get('q'));
    expect(JSON.stringify(records)).not.toContain('private-token');
  });

  it('normalizes public issue fields and marks title-only content', () => {
    const mapped = mapGitHubIssue({ ...issue(4), body: null }, 'error tracking');
    expect(mapped).toMatchObject({
      source: 'github', externalId: '4', authorHandle: 'reporter', community: 'example/repo',
      text: 'Error tracking issue 4', contentCompleteness: 'title_only',
      metadata: { title: 'Error tracking issue 4', issueNumber: 4, state: 'open', labels: ['bug'], queriesFound: ['error tracking'] },
    });
  });

  it('filters bots and reports the dropped bot count in request summaries', async () => {
    const records: RequestRecord[] = [];
    const fetch = async () => new Response(JSON.stringify({ items: [
      issue(20),
      { ...issue(21), user: { login: 'github-actions[bot]', type: 'User' } },
      { ...issue(22), user: { login: 'automation', type: 'Bot' } },
    ], total_count: 3 }), { status: 200 });
    const result = await createGitHubAdapter().search({ ...query, maxResults: 10 }, context(fetch as typeof globalThis.fetch, {
      onRequest: (record) => records.push(record),
    }));
    expect(result.signals.map((item) => item.externalId)).toEqual(['20']);
    expect(records[0]?.responseSummary).toMatchObject({ returned: 3, botIssuesDropped: 2 });
    expect(mapGitHubIssue({ ...issue(23), user: { login: 'github-actions[bot]' } }, 'query')).toBeNull();
  });

  it('distinguishes a successful zero-hit response from an authentication failure without logging the token', async () => {
    const records: RequestRecord[] = [];
    const emptyFetch = vi.fn(async () => new Response(JSON.stringify({ items: [], total_count: 0 }), { status: 200 })) as typeof globalThis.fetch;
    const empty = await createGitHubAdapter({ token: 'private-token' }).search(query, context(emptyFetch, {
      onRequest: (record) => records.push(record),
    }));
    expect(empty.status).toBe('ok');
    expect(records[0]?.outcome).toBe('no_results');

    const authFetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })) as typeof globalThis.fetch;
    const failed = await createGitHubAdapter({ token: 'private-token' }).search(query, context(authFetch, {
      onRequest: (record) => records.push(record),
    }));
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('401');
    expect(JSON.stringify(records)).not.toContain('private-token');
  });

  it('waits for Retry-After on a rate limit and retries the request', async () => {
    const delays: number[] = [];
    const waitEvents: number[] = [];
    const records: RequestRecord[] = [];
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ message: 'secondary rate limit' }), { status: 429, headers: { 'retry-after': '2' } })
        : new Response(JSON.stringify({ items: [], total_count: 0 }), { status: 200 });
    }) as typeof globalThis.fetch;
    const result = await createGitHubAdapter({ sleep: async (milliseconds) => { delays.push(milliseconds); } }).search(query, context(fetch, {
      maxRetries: 1, onRateLimitWait: (_source, milliseconds) => { waitEvents.push(milliseconds); },
      onRequest: (record) => records.push(record),
    }));
    expect(result.status).toBe('ok');
    expect(calls).toBe(2);
    expect(delays).toEqual([2000]);
    expect(waitEvents).toEqual([2000]);
    expect(records[0]).toMatchObject({ status: 'ok', outcome: 'no_results', error: null });
  });

  it('uses an increasing minimum wait when a secondary rate limit has no retry headers', async () => {
    const delays: number[] = [];
    const fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), { status: 403 })) as typeof globalThis.fetch;
    const result = await createGitHubAdapter({ sleep: async (milliseconds) => { delays.push(milliseconds); } }).search(query, context(fetch, { maxRetries: 2 }));
    expect(result.status).toBe('failed');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([60_000, 120_000]);
  });
});
