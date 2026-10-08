import { describe, it, expect, vi } from 'vitest';
import { dedupeSignals, runScout } from '../src/agents/scout.js';
import type { RawSignal } from '@vantage/shared';
import type { SourceAdapter, SourceQuery, AdapterContext, AdapterResult } from '../src/sources/types.js';

function makeSignal(id: string, text: string, source: RawSignal['source'] = 'hackernews'): RawSignal {
  return {
    source,
    externalId: id,
    authorHandle: 'user',
    url: `https://news.ycombinator.com/item?id=${id}`,
    text,
    createdAt: '2026-10-01T00:00:00Z',
    engagement: {},
  };
}

const baseCtx: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date('2026-10-01T00:00:00Z'),
  userAgent: 'test/1.0',
  timeoutMs: 1000,
  maxRetries: 0,
};

const baseQuery: SourceQuery = {
  keywords: ['test'],
  sinceDays: 30,
  maxResults: 50,
};

describe('dedupeSignals', () => {
  it('removes a repeated source+externalId', () => {
    const s1 = makeSignal('a', 'some text here that is unique for a');
    const s2 = makeSignal('a', 'different text but same id');
    const result = dedupeSignals([s1, s2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.externalId).toBe('a');
  });

  it('keeps two signals with the same short text (under 40 characters) but different ids', () => {
    const s1 = makeSignal('b1', 'short text');
    const s2 = makeSignal('b2', 'short text');
    expect(dedupeSignals([s1, s2])).toHaveLength(2);
  });

  it('removes a second signal with the same long text (50 characters or more) and a different id', () => {
    const longText = 'this is a very long text that is at least fifty chars';
    const s1 = makeSignal('c1', longText);
    const s2 = makeSignal('c2', longText);
    expect(dedupeSignals([s1, s2])).toHaveLength(1);
  });
});

describe('runScout', () => {
  it('combines signals from two fake adapters and reports each source status and fetched count', async () => {
    const sig1 = makeSignal('d1', 'signal one from hackernews');
    const sig2 = makeSignal('d2', 'signal two from reddit', 'reddit');

    const adapterA: SourceAdapter = {
      id: 'hackernews',
      search: vi.fn().mockResolvedValue({ signals: [sig1], status: 'ok' } as AdapterResult),
    };
    const adapterB: SourceAdapter = {
      id: 'reddit',
      search: vi.fn().mockResolvedValue({ signals: [sig2], status: 'ok' } as AdapterResult),
    };

    const result = await runScout({ adapters: [adapterA, adapterB], query: baseQuery, ctx: baseCtx });
    expect(result.signals).toHaveLength(2);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.find(s => s.source === 'hackernews')?.status).toBe('ok');
    expect(result.sources.find(s => s.source === 'hackernews')?.fetched).toBe(1);
    expect(result.sources.find(s => s.source === 'reddit')?.fetched).toBe(1);
  });

  it('an adapter that throws gives status failed for that source while the other adapter signals are still returned', async () => {
    const sig = makeSignal('e1', 'signal from good adapter');
    const goodAdapter: SourceAdapter = {
      id: 'hackernews',
      search: vi.fn().mockResolvedValue({ signals: [sig], status: 'ok' } as AdapterResult),
    };
    const badAdapter: SourceAdapter = {
      id: 'reddit',
      search: vi.fn().mockRejectedValue(new Error('adapter crash')),
    };

    const result = await runScout({ adapters: [goodAdapter, badAdapter], query: baseQuery, ctx: baseCtx });
    expect(result.signals).toHaveLength(1);
    expect(result.sources.find(s => s.source === 'reddit')?.status).toBe('failed');
    expect(result.sources.find(s => s.source === 'hackernews')?.status).toBe('ok');
  });

  it('fetchedTotal and afterDedupe are correct in a case with one duplicate', async () => {
    const longText = 'this is exactly the same long text repeated here for dedupe testing purposes now';
    const s1 = makeSignal('f1', longText);
    const s2 = makeSignal('f2', longText);

    const adapter: SourceAdapter = {
      id: 'hackernews',
      search: vi.fn().mockResolvedValue({ signals: [s1, s2], status: 'ok' } as AdapterResult),
    };

    const result = await runScout({ adapters: [adapter], query: baseQuery, ctx: baseCtx });
    expect(result.fetchedTotal).toBe(2);
    expect(result.afterDedupe).toBe(1);
  });
});
