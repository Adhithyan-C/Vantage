import { RawSignalSchema } from '@vantage/shared';
import type { RawSignal, RequestRecord } from '@vantage/shared';
import type { AdapterContext, AdapterResult, SourceAdapter, SourceQuery } from './types.js';
import { htmlToText } from '../utils/text.js';
import { fetchWithRetry } from '../utils/rateLimit.js';
import { sanitizeRequestError } from '../utils/redact.js';
import { buildSearchVariants } from '../agents/queryVariants.js';
import {
  MAX_STACKEXCHANGE_QUERY_VARIANTS,
  STACKEXCHANGE_DEFAULT_SITES,
  STACKEXCHANGE_MAX_PAGES_PER_VARIANT,
} from '../config/retrieval.js';
import type { SearchVariant } from '../agents/queryVariants.js';

const STACK_EXCHANGE_ENDPOINT = 'https://api.stackexchange.com/2.3/search/advanced';

interface StackExchangeAdapterOptions {
  key?: string;
  sites?: string[];
  sleep?: (ms: number) => Promise<void>;
}

interface StackExchangeQuestion extends Record<string, unknown> {
  question_id?: number;
  title?: string;
  body?: string;
  link?: string;
  creation_date?: number;
  score?: number;
  answer_count?: number;
  owner?: { display_name?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configuredSites(sites: string[] | undefined): string[] {
  const values = sites ?? (process.env.STACKEXCHANGE_SITES ?? '').split(',');
  const unique = [...new Set(values
    .map((site) => site.trim())
    .filter((site) => /^[a-z0-9.]+$/.test(site)))];
  return unique.length > 0 ? unique.slice(0, 3) : [...STACKEXCHANGE_DEFAULT_SITES];
}

export function mapQuestion(item: unknown, site: string): RawSignal | null {
  if (!isRecord(item)) return null;
  const question = item as StackExchangeQuestion;
  const owner = isRecord(question.owner) ? question.owner : null;
  const questionId = question.question_id;
  const link = question.link;
  const displayName = owner?.display_name;
  if (typeof questionId !== 'number' || !Number.isInteger(questionId)) return null;
  if (typeof link !== 'string' || link.length === 0) return null;
  if (typeof displayName !== 'string' || displayName.trim().length === 0) return null;

  try {
    const title = typeof question.title === 'string' ? htmlToText(question.title) : '';
    const body = typeof question.body === 'string' ? htmlToText(question.body) : '';
    const text = body ? `${title}\n\n${body}` : title;
    if (text.length < 20 || typeof question.creation_date !== 'number') return null;
    const createdAt = new Date(question.creation_date * 1000);
    if (Number.isNaN(createdAt.getTime())) return null;

    const mapped = {
      source: 'stackexchange' as const,
      externalId: `${site}:${questionId}`,
      authorHandle: htmlToText(displayName),
      community: site,
      url: link,
      text,
      createdAt: createdAt.toISOString(),
      engagement: {
        score: typeof question.score === 'number' ? question.score : undefined,
        comments: typeof question.answer_count === 'number' ? question.answer_count : undefined,
      },
    };
    const parsed = RawSignalSchema.safeParse(mapped);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function backoffFrom(body: unknown): number | null {
  if (!isRecord(body) || typeof body.backoff !== 'number' || !Number.isFinite(body.backoff) || body.backoff < 0) {
    return null;
  }
  return body.backoff;
}

function quotaFrom(body: unknown): number | null {
  if (!isRecord(body) || typeof body.quota_remaining !== 'number' || !Number.isFinite(body.quota_remaining)) {
    return null;
  }
  return body.quota_remaining;
}

function failureMessage(response: Response | null, body: unknown): string {
  if (response && !response.ok) {
    return `Stack Exchange request failed with status ${response.status}`;
  }
  if (isRecord(body) && typeof body.error_id === 'number') {
    return `Stack Exchange API error ${body.error_id}`;
  }
  return 'Stack Exchange response had no items array';
}

export function createStackExchangeAdapter(options: StackExchangeAdapterOptions = {}): SourceAdapter {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    id: 'stackexchange',
    async search(query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult> {
      if (query.keywords.length === 0) {
        return { signals: [], status: 'skipped', error: 'No keywords provided' };
      }
      const key = options.key ?? process.env.STACKEXCHANGE_KEY;
      const sites = configuredSites(options.sites);
      const seller = query.seller ?? { productName: query.keywords[0] ?? 'Product', problemDescription: query.keywords.join(' '), competitors: [] };
      const variants: SearchVariant[] = query.variants?.slice(0, MAX_STACKEXCHANGE_QUERY_VARIANTS) ?? buildSearchVariants({
        seller, keywords: query.keywords, maxVariants: MAX_STACKEXCHANGE_QUERY_VARIANTS,
      });
      if (variants.length === 0) return { signals: [], status: 'skipped', error: 'No valid query variants' };
      const perVariantPageSize = Math.min(100, Math.max(5, Math.ceil(query.maxResults / variants.length) * 2));
      const fromDate = Math.floor(ctx.now().getTime() / 1000) - query.sinceDays * 86400;
      const candidates: Array<{ site: string; variant: SearchVariant; page: number; signals: RawSignal[]; hasMore: boolean }> = [];
      const successfulRequests = { count: 0 };
      let failedRequests = 0;
      let firstError: string | undefined;
      let stopError: string | undefined;
      const firstPages = sites.flatMap((site) => variants.map((variant) => ({ site, variant, page: 1 })));

      async function fetchPage(site: string, variant: SearchVariant, page: number, hasPotentialNext: boolean): Promise<void> {
        const startedAt = ctx.now().getTime();
        let response: Response | null = null;
        let body: unknown = null;
        let requestFailed = false;
        let requestError: string | null = null;
        let itemsReturned = 0;
        let backoff: number | null = null;
        let quotaRemaining: number | null = null;
        let hasMore = false;
        let outcome: NonNullable<RequestRecord['outcome']> = 'failed';
        const params: Record<string, string> = {
          q: variant.phrase,
          site,
          sort: 'relevance',
          order: 'desc',
          fromdate: String(fromDate),
          pagesize: String(perVariantPageSize),
          page: String(page),
          filter: 'withbody',
        };
        const url = new URL(STACK_EXCHANGE_ENDPOINT);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
        if (key) url.searchParams.set('key', key);

        try {
          response = await fetchWithRetry(ctx.fetch, url.toString(), {
            headers: { 'User-Agent': ctx.userAgent, Accept: 'application/json' },
            timeoutMs: ctx.timeoutMs,
            maxRetries: 0,
          });
          body = await response.json();
          backoff = backoffFrom(body);
          quotaRemaining = quotaFrom(body);
          if (isRecord(body) && Array.isArray(body.items)) {
            itemsReturned = body.items.length;
            hasMore = body.has_more === true;
          }
          if (!response.ok || (isRecord(body) && typeof body.error_id === 'number')) {
            requestFailed = true;
            const errorName = isRecord(body) && typeof body.error_name === 'string' ? body.error_name : null;
            const rateLimited = response.status === 429 || errorName === 'throttle_violation' || errorName === 'temporarily_unavailable';
            const unsupported = errorName === 'bad_parameter';
            outcome = rateLimited ? 'rate_limited' : unsupported ? 'unsupported_query' : 'failed';
            requestError = sanitizeRequestError(failureMessage(response, body));
            firstError ??= requestError;
          } else if (!isRecord(body) || !Array.isArray(body.items)) {
            requestFailed = true;
            outcome = 'failed';
            requestError = 'Stack Exchange response had no items array';
            firstError ??= requestError;
          } else {
            successfulRequests.count += 1;
            outcome = itemsReturned === 0 ? 'no_results' : 'success';
            const mapped = body.items.flatMap((item) => {
              const signal = mapQuestion(item, site);
              return signal ? [signal] : [];
            });
            candidates.push({ site, variant, page, signals: mapped, hasMore });
          }
        } catch (err: unknown) {
          requestFailed = true;
          requestError = response ? sanitizeRequestError(failureMessage(response, body))
            : sanitizeRequestError(err instanceof Error ? err.message : String(err));
          firstError ??= requestError || 'Stack Exchange request failed';
        }
        if (requestFailed) failedRequests++;
        const willHaveNextRequest = hasPotentialNext || (hasMore && page < STACKEXCHANGE_MAX_PAGES_PER_VARIANT);
        if (backoff !== null && willHaveNextRequest && backoff > 60) {
          stopError = `Stack Exchange asked for a ${backoff}s backoff; stopped early`;
          outcome = 'rate_limited';
        }

        try {
          ctx.onRequest?.({
            source: 'stackexchange',
            label: `${site} · ${variant.category}: ${variant.phrase} · page ${page}`,
            status: requestFailed ? 'failed' : 'ok',
            httpStatus: response?.status ?? null,
            durationMs: Math.max(0, ctx.now().getTime() - startedAt),
            itemsReturned,
            error: requestError,
            quotaRemaining,
            outcome,
            request: { endpoint: STACK_EXCHANGE_ENDPOINT, params },
            responseSummary: {
              returned: itemsReturned,
              hasMore,
              page,
              quotaRemaining,
              backoffSeconds: backoff,
              errorId: isRecord(body) && typeof body.error_id === 'number' ? body.error_id : null,
              errorName: isRecord(body) && typeof body.error_name === 'string' ? body.error_name : null,
              errorMessage: isRecord(body) && typeof body.error_message === 'string' ? sanitizeRequestError(body.error_message.slice(0, 160)) : null,
              sampleTitles: isRecord(body) && Array.isArray(body.items) ? body.items.slice(0, 3).flatMap((item) => {
                const title = isRecord(item) ? item.title : null;
                return typeof title === 'string' ? [htmlToText(title).slice(0, 120)] : [];
              }) : [],
            },
          });
        } catch {
          // Request logging must not change adapter behavior.
        }

        if (backoff !== null && willHaveNextRequest) {
          if (backoff > 60) {
            // The run stops before another request when the required wait is too long.
          } else if (!(quotaRemaining !== null && quotaRemaining < 10)) {
            try {
              await ctx.onRateLimitWait?.('stackexchange', backoff * 1000);
              await sleep(backoff * 1000);
            } catch {
              stopError = 'Stack Exchange backoff wait failed; stopped early';
            }
          }
        }

        if (quotaRemaining !== null && quotaRemaining < 10) {
          stopError ??= `Stack Exchange quota nearly used (${quotaRemaining} left)`;
        }
      }

      for (const [index, request] of firstPages.entries()) {
        if (stopError) break;
        const hasPotentialNext = index < firstPages.length - 1;
        await fetchPage(request.site, request.variant, request.page, hasPotentialNext);
      }
      if (!stopError) {
        const laterPages = candidates.filter((candidate) => candidate.hasMore);
        for (const [index, candidate] of laterPages.entries()) {
          if (stopError) break;
          const siteCount = candidates.filter((item) => item.site === candidate.site).flatMap((item) => item.signals).length;
          if (siteCount >= query.maxResults) continue;
          await fetchPage(candidate.site, candidate.variant, candidate.page + 1,
            index < laterPages.length - 1 || candidate.page + 1 < STACKEXCHANGE_MAX_PAGES_PER_VARIANT);
        }
      }

      const groups = sites.flatMap((site) => variants.map((variant) => candidates
        .filter((candidate) => candidate.site === site && candidate.variant.phrase === variant.phrase)
        .sort((left, right) => left.page - right.page)
        .flatMap((candidate) => candidate.signals)));
      const signals: RawSignal[] = [];
      const seenIds = new Set<string>();
      const maxLength = Math.max(0, ...groups.map((group) => group.length));
      for (let index = 0; index < maxLength && signals.length < query.maxResults; index += 1) {
        for (const group of groups) {
          const signal = group[index];
          if (!signal || seenIds.has(signal.externalId)) continue;
          seenIds.add(signal.externalId);
          signals.push(signal);
          if (signals.length >= query.maxResults) break;
        }
      }

      if (stopError) {
        return { signals, status: 'degraded', error: stopError };
      }
      const attempted = successfulRequests.count + failedRequests;
      if (failedRequests === attempted && attempted > 0) {
        return { signals, status: 'failed', error: firstError ?? stopError };
      }
      if (failedRequests > 0 || stopError) {
        return { signals, status: 'degraded', error: firstError ?? stopError };
      }
      return { signals, status: 'ok' };
    },
  };
}
