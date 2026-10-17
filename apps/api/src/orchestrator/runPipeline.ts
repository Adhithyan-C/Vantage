import type { RunParams, RunStatus, SourceStatus } from '@vantage/shared';
import type { RunStore } from '../db/runs';
import type { SourceAdapter, AdapterContext } from '../sources/types';
import { runScout } from '../agents/scout';
import { createEmitter } from './events';

export interface PipelineDeps {
  store: RunStore;
  adapters: SourceAdapter[];
  ctx: AdapterContext;
}

export function computeRunStatus(reports: Array<{ status: SourceStatus }>): RunStatus {
  if (reports.length === 0) {
    return 'failed';
  }
  if (reports.every((report) => report.status === 'ok')) {
    return 'completed';
  }
  if (reports.some((report) => report.status === 'ok' || report.status === 'degraded')) {
    return 'completed_with_warnings';
  }
  return 'failed';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function eventKindFor(status: SourceStatus): 'info' | 'warning' | 'error' {
  if (status === 'ok') {
    return 'info';
  }
  if (status === 'failed') {
    return 'error';
  }
  return 'warning';
}

export async function runPipeline(
  deps: PipelineDeps,
  runId: string,
  params: RunParams,
): Promise<void> {
  const { store, adapters, ctx } = deps;
  const emit = createEmitter(store, runId);

  try {
    await emit.info('orchestrator', 'Run started', {
      keywords: params.keywords.length,
      sinceDays: params.sinceDays,
      maxResults: params.maxResults,
    });

    if (adapters.length === 0) {
      await emit.error('orchestrator', 'No sources are enabled');
      await store.setRunStatus(runId, 'failed', true);
      return;
    }

    for (const adapter of adapters) {
      await store.upsertRunSource(runId, adapter.id, {
        status: 'running',
        startedAt: ctx.now().toISOString(),
      });
    }

    const ids = adapters.map((adapter) => adapter.id).join(', ');
    await emit.progress('scout', `Searching ${ids} for ${params.keywords.length} keyword(s)`);

    const result = await runScout({
      adapters,
      query: {
        keywords: params.keywords,
        sinceDays: params.sinceDays,
        maxResults: params.maxResults,
      },
      ctx,
    });

    for (const report of result.sources) {
      await store.upsertRunSource(runId, report.source, {
        status: report.status,
        fetchedCount: report.fetched,
        error: report.error ?? null,
        finishedAt: ctx.now().toISOString(),
      });

      const suffix = report.error ? ` (${report.error})` : '';
      const message = `${report.source}: ${report.status}, fetched ${report.fetched}${suffix}`;
      const kind = eventKindFor(report.status);
      await emit[kind]('scout', message, {
        source: report.source,
        status: report.status,
        fetched: report.fetched,
      });
    }

    const duplicates = result.fetchedTotal - result.afterDedupe;
    await emit.progress(
      'scout',
      `Removed ${duplicates} duplicate(s): ${result.afterDedupe} unique signal(s)`,
      { fetched: result.fetchedTotal, afterDedupe: result.afterDedupe },
    );

    if (result.afterDedupe === 0) {
      await emit.warning(
        'scout',
        'No signals found. Try different keywords or a longer time window.',
      );
    } else {
      const stored = await store.storeSignals(runId, result.signals);
      await emit.progress(
        'scout',
        `Stored ${stored.inserted} new and refreshed ${stored.updated} existing signal(s)`,
        { inserted: stored.inserted, updated: stored.updated },
      );
    }

    const status = computeRunStatus(result.sources);
    await store.setRunStatus(runId, status, true);

    const counts = { signals: result.afterDedupe };
    if (status === 'completed') {
      await emit.info('orchestrator', 'Run completed', counts);
    } else if (status === 'completed_with_warnings') {
      await emit.warning('orchestrator', 'Run completed with warnings', counts);
    } else {
      await emit.error('orchestrator', 'Run failed: no source succeeded', counts);
    }
  } catch (err) {
    await emit.error('orchestrator', `Run failed: ${errorMessage(err)}`);
    try {
      await store.setRunStatus(runId, 'failed', true);
    } catch (innerErr) {
      console.error(`Could not mark run as failed: ${errorMessage(innerErr)}`);
    }
  }
}