import type { RawSignal } from '@vantage/shared';
import type { SourceId } from '@vantage/shared';
import { normalizeForHash, contentHash } from '../utils/hash.js';
import type { SourceAdapter, SourceQuery, AdapterContext, AdapterResult } from '../sources/types.js';

export function dedupeSignals(signals: RawSignal[]): RawSignal[] {
  const sourceIds = new Map<string, number>();
  const canonicalUrls = new Map<string, number>();
  const fingerprints = new Map<string, number>();
  const result: RawSignal[] = [];

  for (const signal of signals) {
    const sourceKey = `${signal.source}:${signal.externalId}`;
    const canonicalUrl = canonicalizeUrl(signal.url);
    const fingerprint = signalFingerprint(signal);
    const duplicateIndex = sourceIds.get(sourceKey) ?? canonicalUrls.get(canonicalUrl) ?? (fingerprint ? fingerprints.get(fingerprint) : undefined);
    if (duplicateIndex !== undefined) {
      result[duplicateIndex] = mergeSignal(result[duplicateIndex]!, signal);
      sourceIds.set(sourceKey, duplicateIndex);
      if (canonicalUrl) canonicalUrls.set(canonicalUrl, duplicateIndex);
      if (fingerprint) fingerprints.set(fingerprint, duplicateIndex);
      continue;
    }

    const index = result.length;
    result.push(signal);
    sourceIds.set(sourceKey, index);
    if (canonicalUrl) canonicalUrls.set(canonicalUrl, index);
    if (fingerprint) fingerprints.set(fingerprint, index);
  }

  return result;
}

function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
  } catch {
    return value.trim();
  }
}

function signalFingerprint(signal: RawSignal): string | null {
  const normalizedText = normalizeForHash(signal.text);
  const author = normalizeForHash(signal.authorHandle);
  if (normalizedText.length < 40 || !author) return null;
  const title = typeof signal.metadata?.title === 'string' ? normalizeForHash(signal.metadata.title) : normalizeForHash(signal.text.split('\n')[0] ?? '');
  return contentHash(`${author}\n${title}\n${normalizedText}`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function mergeSignal(canonical: RawSignal, duplicate: RawSignal): RawSignal {
  const canonicalMetadata = canonical.metadata ?? {};
  const duplicateMetadata = duplicate.metadata ?? {};
  const alternateUrls = [...new Set([
    ...stringArray(canonicalMetadata.alternateUrls),
    ...(duplicate.url === canonical.url ? [] : [duplicate.url]),
    ...stringArray(duplicateMetadata.alternateUrls),
  ])];
  const queriesFound = [...new Set([
    ...stringArray(canonicalMetadata.queriesFound),
    ...stringArray(duplicateMetadata.queriesFound),
  ])];
  const mergedSources = Array.isArray(canonicalMetadata.mergedSources) ? canonicalMetadata.mergedSources : [];
  const duplicateSource = { source: duplicate.source, externalId: duplicate.externalId, url: duplicate.url, metadata: duplicateMetadata };
  return {
    ...canonical,
    metadata: {
      ...canonicalMetadata,
      ...(alternateUrls.length > 0 ? { alternateUrls } : {}),
      ...(queriesFound.length > 0 ? { queriesFound } : {}),
      mergedSources: [...mergedSources, duplicateSource],
    },
  };
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
      } catch (err: unknown) {
        return {
          adapter,
          result: {
            signals: [] as RawSignal[],
            status: 'failed' as const,
            error: err instanceof Error ? err.message : String(err),
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
