import type { RawSignal, RequestRecord } from '@vantage/shared';
import type { AdapterContext, AdapterResult, SourceAdapter, SourceQuery } from './types.js';
import { MAX_GITHUB_QUERY_VARIANTS as GITHUB_VARIANT_CAP, GITHUB_MAX_PAGES_PER_VARIANT as GITHUB_PAGE_CAP } from '../config/retrieval.js';
import { buildSearchVariants } from '../agents/queryVariants.js';
import { searchQueryForm } from '../agents/queryVariants.js';
import type { SearchVariant } from '../agents/queryVariants.js';
import { htmlToText } from '../utils/text.js';

export const GITHUB_SEARCH_ENDPOINT = 'https://api.github.com/search/issues';

interface GitHubIssue extends Record<string, unknown> {
  id?: number;
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  comments?: number;
  state?: string;
  repository_url?: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string }>;
}

interface GitHubOptions {
  token?: string;
  sleep?: (milliseconds: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseIssues(value: unknown): { items: unknown[]; totalCount: number | null; incomplete: boolean } | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  return {
    items: value.items,
    totalCount: typeof value.total_count === 'number' ? value.total_count : null,
    incomplete: value.incomplete_results === true,
  };
}

export function mapGitHubIssue(value: unknown, query: string): RawSignal | null {
  if (!isRecord(value)) return null;
  const issue = value as GitHubIssue;
  if (typeof issue.id !== 'number' || !Number.isInteger(issue.id) || typeof issue.title !== 'string' ||
      typeof issue.html_url !== 'string' || typeof issue.created_at !== 'string' ||
      typeof issue.user?.login !== 'string' || issue.user.login.trim() === '') return null;
  const title = htmlToText(issue.title);
  const body = typeof issue.body === 'string' ? htmlToText(issue.body) : '';
  const text = body ? `${title}\n\n${body}` : title;
  if (!text) return null;
  const createdAt = new Date(issue.created_at);
  if (Number.isNaN(createdAt.getTime())) return null;
  const repository = typeof issue.repository_url === 'string' ? issue.repository_url : undefined;
  const labels = Array.isArray(issue.labels)
    ? issue.labels.flatMap((label) => typeof label?.name === 'string' ? [label.name] : [])
    : [];
  return {
    source: 'github',
    externalId: String(issue.id),
    authorHandle: issue.user.login,
    ...(repository ? { community: repository.replace('https://api.github.com/repos/', '') } : {}),
    url: issue.html_url,
    text,
    createdAt: createdAt.toISOString(),
    engagement: { ...(typeof issue.comments === 'number' ? { comments: issue.comments } : {}) },
    metadata: {
      title,
      issueNumber: typeof issue.number === 'number' ? issue.number : null,
      state: typeof issue.state === 'string' ? issue.state : null,
      ...(repository ? { repositoryUrl: repository } : {}),
      labels,
      queriesFound: [query],
    },
    contentCompleteness: body ? 'complete' : 'title_only',
  };
}

function secondaryRateLimit(response: Response, body: unknown): boolean {
  const message = isRecord(body) && typeof body.message === 'string' ? body.message.toLowerCase() : '';
  return response.status === 429 || (response.status === 403 && (
    response.headers.get('retry-after') !== null || response.headers.get('x-ratelimit-remaining') === '0' || message.includes('secondary rate limit') || message.includes('rate limit exceeded')
  ));
}

function rateDelay(response: Response, attempt: number): number {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const reset = resetHeader === null ? Number.NaN : Number(resetHeader);
    if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - Date.now());
  }
  return 60_000 * 2 ** attempt;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createGitHubAdapter(options: GitHubOptions = {}): SourceAdapter {
  const sleep = options.sleep ?? defaultSleep;
  return {
    id: 'github',
    async search(query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult> {
      if (query.keywords.length === 0) return { signals: [], status: 'skipped', error: 'No keywords provided' };
      const variants: SearchVariant[] = query.variants?.slice(0, GITHUB_VARIANT_CAP) ?? buildSearchVariants({
        seller: query.seller ?? { productName: query.keywords[0] ?? 'Product', problemDescription: query.keywords.join(' '), competitors: [] },
        keywords: query.keywords,
        maxVariants: GITHUB_VARIANT_CAP,
      });
      if (variants.length === 0) return { signals: [], status: 'skipped', error: 'No valid query variants' };
      const token = options.token ?? process.env.GITHUB_TOKEN;
      const sinceDate = new Date(ctx.now().getTime() - query.sinceDays * 86400_000).toISOString().slice(0, 10);
      const perPage = Math.min(100, Math.max(1, Math.ceil(query.maxResults / variants.length)));
      const collected: RawSignal[] = [];
      const seen = new Set<string>();
      let requestsOk = 0;
      let requestsFailed = 0;
      let firstError: string | undefined;
      for (const variant of variants) {
        for (let page = 1; page <= GITHUB_PAGE_CAP && collected.length < query.maxResults; page += 1) {
          const queryPhrase = searchQueryForm(variant.phrase) === 'quoted' ? `"${variant.phrase}"` : variant.phrase;
          const q = `${queryPhrase} is:issue in:title,body created:>${sinceDate}`;
          const params = { q, per_page: String(perPage), page: String(page) };
          const url = new URL(GITHUB_SEARCH_ENDPOINT);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
          const started = ctx.now().getTime();
          let response: Response | null = null;
          let body: unknown = null;
          let issues: ReturnType<typeof parseIssues> = null;
          let requestError: string | null = null;
          let retryCount = 0;
          let requestOutcome: NonNullable<RequestRecord['outcome']> = 'failed';
          for (let attempt = 0; attempt <= ctx.maxRetries; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);
            try {
              response = await ctx.fetch(url.toString(), {
                headers: {
                  Accept: 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28',
                  'User-Agent': ctx.userAgent,
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                signal: controller.signal,
              });
              clearTimeout(timeout);
              body = await response.json().catch(() => null);
              if (response.ok) {
                issues = parseIssues(body);
                requestError = issues ? null : 'GitHub response did not contain an items array';
                break;
              }
              if (secondaryRateLimit(response, body)) {
                requestOutcome = 'rate_limited';
                requestError = `GitHub rate limit response ${response.status}`;
                if (attempt < ctx.maxRetries) {
                  const delay = rateDelay(response, attempt);
                  await ctx.onRateLimitWait?.('github', delay);
                  await sleep(delay);
                  retryCount += 1;
                  continue;
                }
                break;
              }
              requestError = `GitHub search failed with status ${response.status}`;
              if (response.status >= 500 && attempt < ctx.maxRetries) {
                await sleep(Math.min(500 * 2 ** attempt, 30_000));
                retryCount += 1;
                continue;
              }
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
          const mapped = (issues?.items ?? []).flatMap((item) => {
            const signal = mapGitHubIssue(item, variant.phrase);
            return signal ? [signal] : [];
          });
          if (response?.ok && issues) {
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
            firstError ??= requestError ?? 'GitHub search failed';
          }
          const remainingHeader = response?.headers.get('x-ratelimit-remaining') ?? null;
          try {
            ctx.onRequest?.({
              source: 'github',
              label: `${variant.category} (search): ${variant.phrase} · page ${page}`,
              status: response?.ok && issues ? 'ok' : 'failed',
              httpStatus: response?.status ?? null,
              durationMs: Math.max(0, ctx.now().getTime() - started),
              itemsReturned: issues?.items.length ?? 0,
              error: requestError,
              quotaRemaining: remainingHeader !== null && Number.isFinite(Number(remainingHeader)) ? Number(remainingHeader) : null,
              outcome: requestOutcome,
              request: { endpoint: GITHUB_SEARCH_ENDPOINT, params },
              responseSummary: {
                returned: issues?.items.length ?? 0,
                totalCount: issues?.totalCount ?? null,
                incomplete: issues?.incomplete ?? null,
                retryCount,
                sampleTitles: (issues?.items ?? []).slice(0, 5).flatMap((item) => isRecord(item) && typeof item.title === 'string' ? [htmlToText(item.title).slice(0, 120)] : []),
              },
            });
          } catch {
            // Logging failures must not change source retrieval.
          }
          if (!issues || issues.items.length < perPage) break;
        }
        if (collected.length >= query.maxResults) break;
      }
      if (requestsFailed > 0 && requestsOk === 0) return { signals: collected, status: 'failed', error: firstError };
      if (requestsFailed > 0) return { signals: collected, status: 'degraded', error: firstError };
      return { signals: collected, status: 'ok' };
    },
  };
}

export const githubAdapter = createGitHubAdapter();
