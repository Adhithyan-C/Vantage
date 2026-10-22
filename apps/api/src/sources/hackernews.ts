import { RawSignalSchema } from '@vantage/shared';
import type { RawSignal } from '@vantage/shared';
import type { SourceAdapter, SourceQuery, AdapterContext, AdapterResult } from './types.js';
import { htmlToText } from '../utils/text.js';
import { fetchWithRetry } from '../utils/rateLimit.js';
import { sanitizeRequestError } from '../utils/redact.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';

export function buildHnUrl(keyword: string, sinceUnix: number, hitsPerPage: number): string {
  const url = new URL(HN_ENDPOINT);
  url.searchParams.set('query', keyword);
  url.searchParams.set('tags', '(story,comment)');
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
    const hitsPerPage = Math.min(query.maxResults, 100);

    const signals: RawSignal[] = [];
    let attempted = 0;
    let failedRequests = 0;
    let firstError: string | undefined;

    const seenIds = new Set<string>();

    for (const keyword of query.keywords) {
      if (signals.length >= query.maxResults) break;
      attempted++;
      const startedAt = ctx.now().getTime();
      let httpStatus: number | null = null;
      let itemsReturned = 0;
      let requestStatus: 'ok' | 'failed' = 'failed';
      let requestError: string | null = null;
      try {
        const url = buildHnUrl(keyword, sinceUnix, hitsPerPage);
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
        requestStatus = 'ok';

        for (const hit of body.hits) {
          if (signals.length >= query.maxResults) break;
          const mapped = mapHit(hit);
          if (!mapped) continue;
          if (seenIds.has(mapped.externalId)) continue;
          seenIds.add(mapped.externalId);

          const parsed = RawSignalSchema.safeParse(mapped);
          if (parsed.success) {
            signals.push(parsed.data);
          }
        }
      } catch (err: unknown) {
        failedRequests++;
        const message = errorMessage(err);
        if (!firstError) firstError = message;
        requestError = sanitizeRequestError(message);
      } finally {
        try {
          ctx.onRequest?.({
            source: 'hackernews',
            label: keyword,
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
    }

    let status: AdapterResult['status'] = 'ok';
    if (failedRequests > 0) {
      if (failedRequests < attempted) {
        status = 'degraded';
      } else {
        status = 'failed';
      }
    }

    return { signals, status, error: firstError };
  }
};
