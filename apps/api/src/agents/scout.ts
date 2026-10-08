import type { RawSignal } from '@vantage/shared';
import type { SourceId } from '@vantage/shared';
import { normalizeForHash, contentHash } from '../utils/hash.js';
import type { SourceAdapter, SourceQuery, AdapterContext, AdapterResult } from '../sources/types.js';

export function dedupeSignals(signals: RawSignal[]): RawSignal[] {
  const seenSourceId = new Set<string>();
  const seenContentHash = new Set<string>();
  const result: RawSignal[] = [];

  for (const signal of signals) {
    const sourceKey = `${signal.source}:${signal.externalId}`;
    if (seenSourceId.has(sourceKey)) continue;
    seenSourceId.add(sourceKey);

    const normalized = normalizeForHash(signal.text);
    if (normalized.length >= 40) {
      const hash = contentHash(signal.text);
      if (seenContentHash.has(hash)) continue;
      seenContentHash.add(hash);
    }

    result.push(signal);
  }

  return result;
}

export type ScoutSourceReport = {
  source: SourceId;
  status: AdapterResult['status'];
  fetched: number;
  error?: string;
};

export type ScoutResult = {
  signals: RawSignal[];
  sources: ScoutSourceReport[];
  fetchedTotal: number;
  afterDedupe: number;
};

export async function runScout(params: {
  adapters: SourceAdapter[];
  query: SourceQuery;
  ctx: AdapterContext;
}): Promise<ScoutResult> {
  const { adapters, query, ctx } = params;

  const adapterResults = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const result = await adapter.search(query, ctx);
        return { adapter, result };
      } catch (err: any) {
        return {
          adapter,
          result: {
            signals: [] as RawSignal[],
            status: 'failed' as const,
            error: err.message || String(err),
          },
        };
      }
    })
  );

  const allSignals: RawSignal[] = [];
  const sources: ScoutSourceReport[] = [];

  for (const { adapter, result } of adapterResults) {
    sources.push({
      source: adapter.id,
      status: result.status,
      fetched: result.signals.length,
      error: result.error,
    });
    allSignals.push(...result.signals);
  }

  const fetchedTotal = allSignals.length;
  const deduped = dedupeSignals(allSignals);

  return {
    signals: deduped,
    sources,
    fetchedTotal,
    afterDedupe: deduped.length,
  };
}
