import { RawSignalSchema } from '@vantage/shared';
import type { RawSignal } from '@vantage/shared';
import type { SourceAdapter, SourceQuery, AdapterContext, AdapterResult } from './types.js';
import { htmlToText } from '../utils/text.js';
import { fetchWithRetry } from '../utils/rateLimit.js';
import { sanitizeRequestError } from '../utils/redact.js';
import { mapWithConcurrency } from '../utils/concurrency.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';

export function buildHnUrl(
  keyword: string,
  sinceUnix: number,
  hitsPerPage: number,
  tags = '(story,comment)',
): string {
  const url = new URL(HN_ENDPOINT);
  url.searchParams.set('query', keyword);
  url.searchParams.set('tags', tags);
  url.searchParams.set('numericFilters', `created_at_i>${sinceUnix}`);
  url.searchParams.set('hitsPerPage', hitsPerPage.toString());
  return url.toString();
}

export function mapHit(hit: unknown): RawSignal | null {
  if (!isRecord(hit)) return null;
  const objectID = hit.objectID;
  const author = hit.author;
  if (!objectID || typeof objectID !== 'string') return null;
  if (!author || typeof author !== 'string' || author === '[deleted]') return null;

  const tags = Array.isArray(hit._tags)
    ? hit._tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const isComment = tags.includes('comment');

  let text = '';
  if (isComment) {
    text = htmlToText(typeof hit.comment_text === 'string' ? hit.comment_text : '');
  } else {
    const title = typeof hit.title === 'string' ? hit.title : '';
    const storyText = htmlToText(typeof hit.story_text === 'string' ? hit.story_text : '');
    const parts = [];
    if (title) parts.push(title);
    if (storyText) parts.push(storyText);
    text = parts.join('\n\n');
  }
  if (!text) return null;

  let createdAt = '';
  if (typeof hit.created_at === 'string' && hit.created_at) {
    createdAt = hit.created_at;
  } else if (typeof hit.created_at_i === 'number') {
    createdAt = new Date(hit.created_at_i * 1000).toISOString();
  } else {
    return null;
  }

  const score = typeof hit.points === 'number' ? hit.points : undefined;
  const comments = typeof hit.num_comments === 'number' ? hit.num_comments : undefined;

  return {
    source: 'hackernews',
    externalId: objectID,
    authorHandle: author,
    url: `https://news.ycombinator.com/item?id=${objectID}`,
    text,
    createdAt,
    engagement: { score, comments }
  };
}

export const hackerNewsAdapter: SourceAdapter = {
  id: 'hackernews',
  async search(query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult> {
    if (!query.keywords || query.keywords.length === 0) {
      return { signals: [], status: 'skipped', error: 'No keywords provided' };
    }

    const sinceUnix = Math.floor(ctx.now().getTime() / 1000) - query.sinceDays * 86400;
    const perKeywordLimit = Math.min(100, Math.max(5, Math.ceil(query.maxResults / query.keywords.length)));
    type RequestResult = { hits: unknown[]; status: 'ok' | 'failed' };
    type RequestSpec = { keyword: string; ask: boolean };
    const requests: RequestSpec[] = [
      ...query.keywords.map((keyword) => ({ keyword, ask: true })),
      ...query.keywords.map((keyword) => ({ keyword, ask: false })),
    ];
    let failedRequests = 0;
    let firstError: string | undefined;
    const outcomes = await mapWithConcurrency(requests, 3, async ({ keyword, ask }): Promise<RequestResult> => {
      const startedAt = ctx.now().getTime();
      let httpStatus: number | null = null;
      let itemsReturned = 0;
      let requestStatus: 'ok' | 'failed' = 'failed';
      let requestError: string | null = null;
      let hits: unknown[] = [];
      try {
        const url = buildHnUrl(
          keyword,
          sinceUnix,
          ask ? Math.min(20, perKeywordLimit) : perKeywordLimit,
          ask ? 'ask_hn' : '(story,comment)',
        );
        const response = await fetchWithRetry(ctx.fetch, url, {
          headers: { 'User-Agent': ctx.userAgent, Accept: 'application/json' },
          timeoutMs: ctx.timeoutMs,
          maxRetries: ctx.maxRetries
        });

        httpStatus = response.status;
        if (!response.ok) {
          throw new Error(`HN request failed with status ${response.status}`);
        }

        const body: unknown = await response.json();
        if (!isRecord(body) || !Array.isArray(body.hits)) {
          throw new Error('HN response had no hits array');
        }
        itemsReturned = body.hits.length;
        hits = body.hits;
        requestStatus = 'ok';
      } catch (err: unknown) {
        failedRequests++;
        const message = errorMessage(err);
        if (!firstError) firstError = message;
        requestError = sanitizeRequestError(message);
      } finally {
        try {
          ctx.onRequest?.({
            source: 'hackernews',
            label: ask ? `${keyword} (Ask HN)` : keyword,
            status: requestStatus,
            httpStatus,
            durationMs: Math.max(0, ctx.now().getTime() - startedAt),
            itemsReturned,
            error: requestError,
            quotaRemaining: null,
          });
        } catch {
          // Request logging must not change adapter behavior.
        }
      }
      return { hits, status: requestStatus };
    });

    function roundRobin(groups: unknown[][]): unknown[] {
      const merged: unknown[] = [];
      const maxLength = Math.max(0, ...groups.map((group) => group.length));
      for (let index = 0; index < maxLength; index++) {
        for (const group of groups) {
          const hit = group[index];
          if (hit !== undefined) merged.push(hit);
        }
      }
      return merged;
    }

    const askGroups = outcomes.slice(0, query.keywords.length).map((outcome) => outcome.hits);
    const normalGroups = outcomes.slice(query.keywords.length).map((outcome) => outcome.hits);
    const seenIds = new Set<string>();
    const signals: RawSignal[] = [];
    for (const hit of [...roundRobin(askGroups), ...roundRobin(normalGroups)]) {
      const mapped = mapHit(hit);
      if (!mapped || seenIds.has(mapped.externalId)) continue;
      seenIds.add(mapped.externalId);
      const parsed = RawSignalSchema.safeParse(mapped);
      if (parsed.success) signals.push(parsed.data);
      if (signals.length >= query.maxResults) break;
    }

    let status: AdapterResult['status'] = 'ok';
    if (failedRequests > 0) {
      if (failedRequests < requests.length) {
        status = 'degraded';
      } else {
        status = 'failed';
      }
    }

    return { signals, status, error: firstError };
  }
};
