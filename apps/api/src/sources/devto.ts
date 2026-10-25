import type { RawSignal, RequestRecord } from '@vantage/shared';
import type { AdapterContext, AdapterResult, SourceAdapter, SourceQuery } from './types.js';
import { MAX_DEVTO_QUERY_VARIANTS, DEVTO_MAX_PAGES_PER_VARIANT } from '../config/retrieval.js';
import { buildSearchVariants } from '../agents/queryVariants.js';
import type { SearchVariant } from '../agents/queryVariants.js';
import { htmlToText } from '../utils/text.js';

export const DEVTO_SEARCH_ENDPOINT = 'https://dev.to/api/articles/search';

interface ForemArticle extends Record<string, unknown> {
  id?: number;
  title?: string;
  description?: string | null;
  url?: string;
  canonical_url?: string;
  published_at?: string;
  created_at?: string;
  positive_reactions_count?: number;
  comments_count?: number;
  tag_list?: string[] | string;
  user?: { username?: string; name?: string } | null;
}

interface DevToOptions {
  sleep?: (milliseconds: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTags(value: ForemArticle['tag_list']): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === 'string');
  if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
}

export function mapDevToArticle(value: unknown, query: string): RawSignal | null {
  if (!isRecord(value)) return null;
  const article = value as ForemArticle;
  const username = article.user?.username;
  const url = typeof article.canonical_url === 'string' && article.canonical_url ? article.canonical_url : article.url;
  const created = typeof article.published_at === 'string' ? article.published_at : article.created_at;
  if (typeof article.id !== 'number' || !Number.isInteger(article.id) || typeof article.title !== 'string' ||
      typeof username !== 'string' || username.trim() === '' || typeof url !== 'string' || typeof created !== 'string') return null;
  const title = htmlToText(article.title);
  const description = typeof article.description === 'string' ? htmlToText(article.description) : '';
  const text = description ? `${title}\n\n${description}` : title;
  const createdAt = new Date(created);
  if (!text || Number.isNaN(createdAt.getTime())) return null;
  const tags = readTags(article.tag_list);
  return {
    source: 'devto',
    externalId: String(article.id),
    authorHandle: username,
    ...(tags.length > 0 ? { community: tags.join(', ') } : {}),
    url,
    text,
    createdAt: createdAt.toISOString(),
    engagement: {
      ...(typeof article.positive_reactions_count === 'number' ? { score: article.positive_reactions_count } : {}),
      ...(typeof article.comments_count === 'number' ? { comments: article.comments_count } : {}),
    },
    metadata: {
      title,
      description: description || null,
      tags,
      queriesFound: [query],
    },
    contentCompleteness: description ? 'snippet' : 'title_only',
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createDevToAdapter(options: DevToOptions = {}): SourceAdapter {
  const sleep = options.sleep ?? defaultSleep;
  return {
    id: 'devto',
    async search(query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult> {
      if (query.keywords.length === 0) return { signals: [], status: 'skipped', error: 'No keywords provided' };
      const variants: SearchVariant[] = query.variants?.slice(0, MAX_DEVTO_QUERY_VARIANTS) ?? buildSearchVariants({
        seller: query.seller ?? { productName: query.keywords[0] ?? 'Product', problemDescription: query.keywords.join(' '), competitors: [] },
        keywords: query.keywords,
        maxVariants: MAX_DEVTO_QUERY_VARIANTS,
      });
      if (variants.length === 0) return { signals: [], status: 'skipped', error: 'No valid query variants' };
      const perPage = Math.min(100, Math.max(1, Math.ceil(query.maxResults / variants.length)));
      const collected: RawSignal[] = [];
      const seen = new Set<string>();
      let requestsOk = 0;
      let requestsFailed = 0;
      let firstError: string | undefined;
      for (const variant of variants) {
        for (let page = 1; page <= DEVTO_MAX_PAGES_PER_VARIANT && collected.length < query.maxResults; page += 1) {
          const params = { q: variant.phrase, top: String(query.sinceDays), page: String(page), per_page: String(perPage) };
          const url = new URL(DEVTO_SEARCH_ENDPOINT);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
          const started = ctx.now().getTime();
          let response: Response | null = null;
          let articles: unknown[] | null = null;
          let requestError: string | null = null;
          let retryCount = 0;
          let requestOutcome: NonNullable<RequestRecord['outcome']> = 'failed';
          for (let attempt = 0; attempt <= ctx.maxRetries; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);
            try {
              response = await ctx.fetch(url.toString(), { headers: { Accept: 'application/json', 'User-Agent': ctx.userAgent }, signal: controller.signal });
              clearTimeout(timeout);
              if (response.status === 429) {
                requestOutcome = 'rate_limited';
                requestError = 'Forem article search rate limited';
                if (attempt < ctx.maxRetries) {
                  const retryAfter = Number(response.headers.get('retry-after'));
                  const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 30_000);
                  await ctx.onRateLimitWait?.('devto', delay);
                  await sleep(delay);
                  retryCount += 1;
                  continue;
                }
                break;
              }
              if (!response.ok) {
                requestError = `Forem article search failed with status ${response.status}`;
                if (response.status >= 500 && attempt < ctx.maxRetries) {
                  await sleep(Math.min(500 * 2 ** attempt, 30_000));
                  retryCount += 1;
                  continue;
                }
                break;
              }
              const body: unknown = await response.json();
              if (Array.isArray(body)) {
                articles = body;
                requestError = null;
              } else requestError = 'Forem response was not an article array';
              break;
            } catch (err: unknown) {
              clearTimeout(timeout);
              requestError = errorText(err);
              if (attempt < ctx.maxRetries) {
                await sleep(Math.min(500 * 2 ** attempt, 30_000));
                retryCount += 1;
                continue;
              }
              break;
            }
          }
          const mapped = (articles ?? []).flatMap((article) => {
            const signal = mapDevToArticle(article, variant.phrase);
            return signal ? [signal] : [];
          });
          if (response?.ok && articles) {
            requestsOk += 1;
            requestOutcome = mapped.length > 0 ? 'success' : 'no_results';
            for (const signal of mapped) {
              if (seen.has(signal.externalId)) continue;
              seen.add(signal.externalId);
              collected.push(signal);
              if (collected.length >= query.maxResults) break;
            }
          } else {
            requestsFailed += 1;
            firstError ??= requestError ?? 'Forem article search failed';
          }
          try {
            ctx.onRequest?.({
              source: 'devto',
              label: `${variant.category} (search): ${variant.phrase} · page ${page}`,
              status: response?.ok && articles ? 'ok' : 'failed',
              httpStatus: response?.status ?? null,
              durationMs: Math.max(0, ctx.now().getTime() - started),
              itemsReturned: articles?.length ?? 0,
              error: requestError,
              quotaRemaining: null,
              outcome: requestOutcome,
              request: { endpoint: DEVTO_SEARCH_ENDPOINT, params },
              responseSummary: {
                returned: articles?.length ?? 0,
                retryCount,
                sampleTitles: (articles ?? []).slice(0, 5).flatMap((article) => isRecord(article) && typeof article.title === 'string' ? [htmlToText(article.title).slice(0, 120)] : []),
              },
            });
          } catch {
            // Logging failures must not change source retrieval.
          }
          if (!articles || articles.length < perPage) break;
        }
        if (collected.length >= query.maxResults) break;
      }
      if (requestsFailed > 0 && requestsOk === 0) return { signals: collected, status: 'failed', error: firstError };
      if (requestsFailed > 0) return { signals: collected, status: 'degraded', error: firstError };
      return { signals: collected, status: 'ok' };
    },
  };
}

export const devToAdapter = createDevToAdapter();
