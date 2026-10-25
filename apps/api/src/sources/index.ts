import type { SourceId } from '@vantage/shared';
import type { SourceAdapter } from './types.js';
import { hackerNewsAdapter } from './hackernews.js';
import { createStackExchangeAdapter } from './stackexchange.js';
import { createSnapshotAdapter } from './snapshot.js';
import { githubAdapter } from './github.js';
import { devToAdapter } from './devto.js';
import { productHuntAdapter } from './producthunt.js';
import { SOURCE_CONFIG } from '../config/sources.js';

export const ADAPTERS: Partial<Record<SourceId, SourceAdapter>> = {
  hackernews: hackerNewsAdapter,
  snapshot: createSnapshotAdapter(),
  stackexchange: createStackExchangeAdapter(),
  github: githubAdapter,
  devto: devToAdapter,
  producthunt: productHuntAdapter,
};

export function getEnabledAdapters(): SourceAdapter[] {
  return (Object.keys(ADAPTERS) as SourceId[]).filter(
    (id) => SOURCE_CONFIG.enabled[id] === true && ADAPTERS[id] !== undefined
  ).map((id) => ADAPTERS[id]!);
}

export function defaultAdapterContext() {
  return {
    fetch: globalThis.fetch,
    now: () => new Date(),
    userAgent: 'vantage-lab-project/0.1',
    timeoutMs: SOURCE_CONFIG.requestTimeoutMs,
    maxRetries: SOURCE_CONFIG.maxRetries,
  };
}
