import { describe, expect, it } from 'vitest';
import { assessRecall } from '../src/evaluation/recall';
import { resolveCliPath } from '../src/utils/cliPath';
import { formatVerboseRequest } from '../src/evaluation/verboseRequests';
import { PRODUCTION_MAX_LOOKBACK_DAYS, EvalRecallConfigSchema } from '../src/evaluation/recallConfig';

describe('recall assessment', () => {
  it('allows eval-only lookbacks through 3650 days without changing production limits', () => {
    const config = {
      seller: { productName: 'Product', problemDescription: 'A specific problem', competitors: [] },
      search: { keywords: ['specific problem'], sinceDays: 3650 },
      expected: [{ title: 'Expected public thread' }],
    };
    expect(EvalRecallConfigSchema.safeParse(config).success).toBe(true);
    expect(EvalRecallConfigSchema.safeParse({ ...config, search: { ...config.search, sinceDays: 3651 } }).success).toBe(false);
    expect(PRODUCTION_MAX_LOOKBACK_DAYS).toBe(1095);
  });

  it('formats a sanitized request with an ISO date filter and up to five titles', () => {
    const line = formatVerboseRequest({
      source: 'hackernews', label: 'problem (quoted): error tracking', status: 'ok', httpStatus: 200,
      durationMs: 4, itemsReturned: 6, error: null, quotaRemaining: null,
      request: { endpoint: 'https://hn.algolia.com/api/v1/search', params: { numericFilters: 'created_at_i>1790035200', query: '"error tracking"' } },
      responseSummary: { sampleTitles: ['one', 'two', 'three', 'four', 'five', 'six'] },
    });
    expect(line).toContain('date_filter=2026-09-22');
    expect(line).toContain('form=quoted');
    expect(line).toContain('http_status=200 | hit_item_count=6');
    expect(line).toContain('top_titles=one | two | three | four | five');
    expect(line).not.toContain('six');
  });

  it('resolves a relative CLI input from INIT_CWD before the workspace cwd, then falls back', () => {
    const existing = new Set(['C:\\repo\\fixtures\\expected.json', 'C:\\repo\\apps\\api\\fixtures\\expected.json']);
    const exists = (path: string) => existing.has(path);

    expect(resolveCliPath('fixtures/expected.json', {
      initCwd: 'C:\\repo', cwd: 'C:\\repo\\apps\\api', exists,
    })).toBe('C:\\repo\\fixtures\\expected.json');
    expect(resolveCliPath('fixtures/expected.json', {
      initCwd: 'C:\\repo', cwd: 'C:\\repo\\apps\\api', exists: (path) => path === 'C:\\repo\\apps\\api\\fixtures\\expected.json',
    })).toBe('C:\\repo\\apps\\api\\fixtures\\expected.json');
  });

  it('matches expected title and URL with similarity and assigned label', () => {
    const signal = {
      source: 'hackernews' as const, externalId: '123', authorHandle: 'user',
      url: 'https://news.ycombinator.com/item?id=123', text: 'Show HN: Bugsink - Self-Hosted Error Tracking',
      createdAt: '2026-10-01T00:00:00Z', engagement: {},
    };
    const result = assessRecall(
      [{ title: 'Show HN: Bugsink - Self-Hosted Error Tracking' }, { url: signal.url }],
      [signal], new Map([['123', 0.82]]), new Map([['123', 'competitor_complaint']]),
    );
    expect(result.map((item) => [item.retrieved, item.similarity, item.label])).toEqual([
      [true, 0.82, 'competitor_complaint'], [true, 0.82, 'competitor_complaint'],
    ]);
  });

  it('reports the profile similarity for an expected thread that was not retrieved', () => {
    const result = assessRecall([{ title: 'Missing expected post' }], [], new Map(), new Map(), [0.41]);
    expect(result[0]).toMatchObject({ retrieved: false, similarity: 0.41, label: null });
  });
});
