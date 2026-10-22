import { RawSignalSchema } from '@vantage/shared';
import type { RawSignal } from '@vantage/shared';
import type { AdapterContext, AdapterResult, SourceAdapter, SourceQuery } from './types.js';
import { htmlToText } from '../utils/text.js';
import { fetchWithRetry } from '../utils/rateLimit.js';
import { sanitizeRequestError } from '../utils/redact.js';

const STACK_EXCHANGE_ENDPOINT = 'https://api.stackexchange.com/2.3/search/advanced';
const DEFAULT_SITE = 'softwarerecs';

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
  return unique.length > 0 ? unique.slice(0, 3) : [DEFAULT_SITE];
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

      const signals: RawSignal[] = [];
      const key = options.key ?? process.env.STACKEXCHANGE_KEY;
      const sites = configuredSites(options.sites);
      const seenIds = new Set<string>();
      let attempted = 0;
      let failedRequests = 0;
      let firstError: string | undefined;
      let stopError: string | undefined;
      const fromDate = Math.floor(ctx.now().getTime() / 1000) - query.sinceDays * 86400;

      const requests = sites.flatMap((site) => query.keywords.map((keyword) => ({ site, keyword })));
      for (const [requestIndex, request] of requests.entries()) {
        const { site, keyword } = request;
        if (signals.length >= query.maxResults || stopError) break;
        attempted++;
        const startedAt = ctx.now().getTime();
        let response: Response | null = null;
        let body: unknown = null;
        let requestFailed = false;
        let requestError: string | null = null;
        let itemsReturned = 0;

        try {
          const url = new URL(STACK_EXCHANGE_ENDPOINT);
          url.searchParams.set('q', keyword);
          url.searchParams.set('site', site);
          url.searchParams.set('sort', 'relevance');
          url.searchParams.set('order', 'desc');
          url.searchParams.set('fromdate', String(fromDate));
          url.searchParams.set('pagesize', String(Math.min(query.maxResults, 100)));
          url.searchParams.set('page', '1');
          url.searchParams.set('filter', 'withbody');
          if (key) url.searchParams.set('key', key);
          response = await fetchWithRetry(ctx.fetch, url.toString(), {
            headers: { 'User-Agent': ctx.userAgent, Accept: 'application/json' },
            timeoutMs: ctx.timeoutMs,
            // Read response backoff before any retry can call the method again.
            maxRetries: 0,
          });
          body = await response.json();
        } catch (err: unknown) {
          requestFailed = true;
          requestError = response
            ? sanitizeRequestError(failureMessage(response, body))
            : sanitizeRequestError(err instanceof Error ? err.message : String(err));
          firstError ??= requestError || 'Stack Exchange request failed';
        }

        const quotaRemaining = quotaFrom(body);
        const backoff = backoffFrom(body);
        if (isRecord(body) && Array.isArray(body.items)) itemsReturned = body.items.length;
        if (!requestFailed && response && response.ok) {
          if (!isRecord(body) || !Array.isArray(body.items) || typeof body.error_id === 'number') {
            requestFailed = true;
            requestError = sanitizeRequestError(failureMessage(response, body));
            firstError ??= requestError;
          } else {
            for (const item of body.items) {
              if (signals.length >= query.maxResults) break;
              const mapped = mapQuestion(item, site);
              if (!mapped || seenIds.has(mapped.externalId)) continue;
              seenIds.add(mapped.externalId);
              signals.push(mapped);
            }
          }
        } else if (!requestFailed) {
          requestFailed = true;
          requestError = sanitizeRequestError(failureMessage(response, body));
          firstError ??= requestError;
        }

        if (requestFailed) failedRequests++;

        try {
          ctx.onRequest?.({
            source: 'stackexchange',
            label: `${site}: ${keyword}`,
            status: requestFailed ? 'failed' : 'ok',
            httpStatus: response?.status ?? null,
            durationMs: Math.max(0, ctx.now().getTime() - startedAt),
            itemsReturned,
            error: requestError,
            quotaRemaining,
          });
        } catch {
          // Request logging must not change adapter behavior.
        }

        if (backoff !== null) {
          if (backoff > 60) {
            stopError = `Stack Exchange asked for a ${backoff}s backoff; stopped early`;
          } else if (
            requestIndex < requests.length - 1
            && signals.length < query.maxResults
            && !(quotaRemaining !== null && quotaRemaining < 10)
          ) {
            try {
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

      if (stopError) {
        return { signals, status: 'degraded', error: stopError };
      }
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
