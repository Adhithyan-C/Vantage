import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SampleDatasetSchema } from '@vantage/shared';
import type { RawSignal, SampleDataset } from '@vantage/shared';
import type { SourceAdapter } from './types.js';
import { sanitizeRequestError } from '../utils/redact.js';

type SnapshotReadFile = (path: string, encoding: 'utf8') => string;

interface SnapshotAdapterOptions {
  readFile?: SnapshotReadFile;
  path?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSnapshotAdapter(options: SnapshotAdapterOptions = {}): SourceAdapter {
  const path = options.path ?? fileURLToPath(new URL('../../../../fixtures/sample-signals.json', import.meta.url));
  const readFile = options.readFile ?? readFileSync;

  return {
    id: 'snapshot',
    async search(query, ctx) {
      const startedAt = ctx.now().getTime();
      let itemsReturned = 0;
      let requestError: string | null = null;
      let status: 'ok' | 'failed' = 'failed';
      try {
        const dataset: SampleDataset = SampleDatasetSchema.parse(JSON.parse(readFile(path, 'utf8')));
        // The sample dataset deliberately ignores keywords and sinceDays.
        const now = ctx.now().getTime();
        const items = dataset.items.slice(0, query.maxResults);
        itemsReturned = items.length;
        const signals: RawSignal[] = items.map((item) => ({
          source: 'snapshot',
          externalId: item.id,
          authorHandle: item.authorHandle,
          community: item.community,
          url: `sample://signal/${item.id}`,
          text: item.text,
          createdAt: new Date(now - item.daysAgo * 86_400_000).toISOString(),
          engagement: item.engagement,
        }));
        status = 'ok';
        return { signals, status: 'ok' };
      } catch (err) {
        const message = errorMessage(err);
        requestError = sanitizeRequestError(message);
        return { signals: [], status: 'failed', error: message };
      } finally {
        try {
          ctx.onRequest?.({
            source: 'snapshot',
            label: 'fixture file',
            status,
            httpStatus: null,
            durationMs: Math.max(0, ctx.now().getTime() - startedAt),
            itemsReturned,
            error: requestError,
            quotaRemaining: null,
          });
        } catch {
          // Request logging must not change adapter behavior.
        }
      }
    },
  };
}
