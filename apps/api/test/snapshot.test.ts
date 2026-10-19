import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RawSignalSchema, SampleDatasetSchema } from '@vantage/shared';
import type { AdapterContext, SourceQuery } from '../src/sources/types';
import { getEnabledAdapters } from '../src/sources/index';
import { createSnapshotAdapter } from '../src/sources/snapshot';

const fixturePath = fileURLToPath(new URL('../../../fixtures/sample-signals.json', import.meta.url));
const fixtureText = readFileSync(fixturePath, 'utf8');
const dataset = SampleDatasetSchema.parse(JSON.parse(fixtureText));
const now = new Date('2026-10-19T12:00:00.000Z');
const context: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date(now),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};
const query: SourceQuery = { keywords: ['helpdesk'], sinceDays: 30, maxResults: 100 };

describe('snapshot adapter', () => {
  it('registers snapshot as an enabled source', () => {
    expect(getEnabledAdapters().map((adapter) => adapter.id)).toContain('snapshot');
  });

  it('maps all 36 synthetic items to valid RawSignals with deterministic dates', async () => {
    const adapter = createSnapshotAdapter({ readFile: () => fixtureText, path: fixturePath });
    const result = await adapter.search(query, context);
    expect(result.status).toBe('ok');
    expect(result.signals).toHaveLength(36);
    expect(result.signals.every((signal) => RawSignalSchema.safeParse(signal).success)).toBe(true);
    expect(result.signals.every((signal) => signal.url.startsWith('sample://signal/'))).toBe(true);
    expect(result.signals[0]?.createdAt).toBe(
      new Date(now.getTime() - (dataset.items[0]?.daysAgo ?? 0) * 86_400_000).toISOString(),
    );
    expect(result.signals[1]?.createdAt).toBe(
      new Date(now.getTime() - (dataset.items[1]?.daysAgo ?? 0) * 86_400_000).toISOString(),
    );
  });

  it('caps results and ignores keywords and sinceDays', async () => {
    const adapter = createSnapshotAdapter({ readFile: () => fixtureText, path: fixturePath });
    const limited = await adapter.search({ ...query, maxResults: 4 }, context);
    const differentSearch = await adapter.search({ ...query, keywords: ['unrelated'], sinceDays: 1 }, context);
    expect(limited.signals).toHaveLength(4);
    expect(differentSearch.signals).toEqual((await adapter.search(query, context)).signals);
  });

  it.each([
    ['missing file', () => { throw new Error('sample file missing'); }],
    ['invalid file', () => '{ invalid json'],
  ])('returns a failed result for an %s and never throws', async (_name, readFile) => {
    const adapter = createSnapshotAdapter({ readFile, path: fixturePath });
    const result = await adapter.search(query, context);
    expect(result).toMatchObject({
      signals: [],
      status: 'failed',
    });
    expect(typeof result.error).toBe('string');
  });
});
