import { RawSignalSchema } from '@vantage/shared';
import type { RawSignal } from '@vantage/shared';
import type { SourceAdapter, SourceQuery, AdapterContext, AdapterResult } from './types.js';
import { htmlToText } from '../utils/text.js';
import { fetchWithRetry } from '../utils/rateLimit.js';
import { sanitizeRequestError } from '../utils/redact.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { buildSearchVariants } from '../agents/queryVariants.js';
import { HN_MAX_PAGES_PER_VARIANT, MAX_HN_QUERY_VARIANTS } from '../config/retrieval.js';
import type { SearchVariant } from '../agents/queryVariants.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search';

export function buildHnUrl(
  keyword: string,
  sinceUnix: number,
  hitsPerPage: number,
  tags = '(story,ask_hn,show_hn)',
  page = 0,
): string {
  const url = new URL(HN_ENDPOINT);
  url.searchParams.set('query', `"${keyword.replaceAll('"', '').trim()}"`);
  url.searchParams.set('tags', tags);
  url.searchParams.set('numericFilters', `created_at_i>${sinceUnix}`);
  url.searchParams.set('hitsPerPage', hitsPerPage.toString());
  url.searchParams.set('page', page.toString());
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
    const seller = query.seller ?? { productName: query.keywords[0] ?? 'Product', problemDescription: query.keywords.join(' '), competitors: [] };
    const variants: SearchVariant[] = query.variants?.slice(0, MAX_HN_QUERY_VARIANTS) ?? buildSearchVariants({
      seller, keywords: query.keywords, maxVariants: MAX_HN_QUERY_VARIANTS,
    });
    if (variants.length === 0) return { signals: [], status: 'skipped', error: 'No valid query variants' };
    const perVariantLimit = Math.max(5, Math.min(100, Math.ceil(query.maxResults / variants.length) * 3));
    type RequestResult = { variant: SearchVariant; page: number; hits: unknown[]; nbPages: number; status: 'ok' | 'failed' };
    const requests = variants.map((variant) => ({ variant, page: 0 }));
    let failedRequests = 0;
    let firstError: string | undefined;
    const fetchPage = async ({ variant, page }: { variant: SearchVariant; page: number }): Promise<RequestResult> => {
      const startedAt = ctx.now().getTime();
      let httpStatus: number | null = null;
      let itemsReturned = 0;
      let requestStatus: 'ok' | 'failed' = 'failed';
      let outcome: 'success' | 'no_results' | 'failed' | 'rate_limited' = 'failed';
      let requestError: string | null = null;
      let hits: unknown[] = [];
      let nbHits: number | null = null;
      let nbPages = 0;
      const url = new URL(buildHnUrl(variant.phrase, sinceUnix, perVariantLimit, '(story,ask_hn,show_hn)', page));
      const request = { endpoint: HN_ENDPOINT, params: Object.fromEntries(url.searchParams.entries()) };
      try {
        const response = await fetchWithRetry(ctx.fetch, url.toString(), {
          headers: { 'User-Agent': ctx.userAgent, Accept: 'application/json' },
          timeoutMs: ctx.timeoutMs,
          maxRetries: ctx.maxRetries
        });

        httpStatus = response.status;
        if (!response.ok) {
          if (response.status === 429) outcome = 'rate_limited';
          throw new Error(`HN request failed with status ${response.status}`);
        }

        const body: unknown = await response.json();
        if (!isRecord(body) || !Array.isArray(body.hits)) {
          throw new Error('HN response had no hits array');
        }
        nbHits = typeof body.nbHits === 'number' ? body.nbHits : null;
        nbPages = typeof body.nbPages === 'number' ? body.nbPages : 0;
        itemsReturned = body.hits.length;
        hits = body.hits;
        requestStatus = 'ok';
        outcome = hits.length === 0 ? 'no_results' : 'success';
      } catch (err: unknown) {
        failedRequests++;
        const message = errorMessage(err);
        if (!firstError) firstError = message;
        requestError = sanitizeRequestError(message);
      } finally {
        try {
          ctx.onRequest?.({
            source: 'hackernews',
            label: `${variant.category}: ${variant.phrase}`,
            status: requestStatus,
            httpStatus,
            durationMs: Math.max(0, ctx.now().getTime() - startedAt),
            itemsReturned,
            error: requestError,
            quotaRemaining: null,
            outcome,
            request,
            responseSummary: {
              totalHits: nbHits,
              page,
              pagesAvailable: nbPages,
              returned: itemsReturned,
              sampleTitles: hits.slice(0, 3).flatMap((hit) => {
                const title = isRecord(hit) ? hit.title : null;
                return typeof title === 'string' ? [title.slice(0, 120)] : [];
              }),
            },
          });
        } catch {
          // Request logging must not change adapter behavior.
        }
      }
      return { variant, page, hits, nbPages, status: requestStatus };
    };

    const firstPages = await mapWithConcurrency(requests, 3, fetchPage);
    const followups = firstPages.flatMap((outcome) =>
      outcome.status === 'ok' && outcome.page + 1 < Math.min(outcome.nbPages, HN_MAX_PAGES_PER_VARIANT)
        ? [{ variant: outcome.variant, page: outcome.page + 1 }]
        : [],
    );
    const laterPages = await mapWithConcurrency(followups, 3, fetchPage);
    const outcomes = [...firstPages, ...laterPages];

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

    const groups = variants.map((variant) => outcomes
      .filter((outcome) => outcome.variant.category === variant.category && outcome.variant.phrase === variant.phrase)
      .sort((left, right) => left.page - right.page)
      .flatMap((outcome) => outcome.hits));
    const seenIds = new Set<string>();
    const signals: RawSignal[] = [];
    for (const hit of roundRobin(groups)) {
      const mapped = mapHit(hit);
      if (!mapped || seenIds.has(mapped.externalId)) continue;
      seenIds.add(mapped.externalId);
      const parsed = RawSignalSchema.safeParse(mapped);
      if (parsed.success) signals.push(parsed.data);
      if (signals.length >= query.maxResults) break;
    }

    let status: AdapterResult['status'] = 'ok';
    if (failedRequests > 0) {
      if (failedRequests < outcomes.length) {
        status = 'degraded';
      } else {
        status = 'failed';
      }
    }

    return { signals, status, error: firstError };
  }
};
