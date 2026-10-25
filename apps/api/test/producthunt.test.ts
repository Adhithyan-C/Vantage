import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestRecord } from '@vantage/shared';
import { productHuntAdapter } from '../src/sources/producthunt.js';
import type { AdapterContext } from '../src/sources/types.js';

const context: AdapterContext = {
  fetch: vi.fn() as typeof globalThis.fetch,
  now: () => new Date('2026-10-26T00:00:00Z'),
  userAgent: 'test', timeoutMs: 1000, maxRetries: 0,
};

afterEach(() => vi.unstubAllEnvs());

describe('Product Hunt source use gate', () => {
  it('skips without a token and never sends a request', async () => {
    vi.stubEnv('PRODUCT_HUNT_TOKEN', '');
    const records: RequestRecord[] = [];
    const result = await productHuntAdapter.search({ keywords: ['launch'], sinceDays: 30, maxResults: 10 }, {
      ...context, onRequest: (record) => records.push(record),
    });
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('not configured');
    expect(context.fetch).not.toHaveBeenCalled();
    expect(records[0]?.responseSummary?.requestMade).toBe(false);
  });

  it('remains blocked when a token exists until allowed use is established', async () => {
    vi.stubEnv('PRODUCT_HUNT_TOKEN', 'never-log-this-token');
    const result = await productHuntAdapter.search({ keywords: ['launch'], sinceDays: 30, maxResults: 10 }, context);
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('permission is obtained');
    expect(context.fetch).not.toHaveBeenCalled();
  });
});
