import type { RunParams, RunStatus, SourceStatus } from '@vantage/shared';
import type { RunStore } from '../db/runs';
import type { SourceAdapter, AdapterContext } from '../sources/types';
import { runScout } from '../agents/scout';
import type { ClassifyStage, ClassifySummary } from '../agents/classifier';
import type { ScoreStage } from '../agents/scorer';
import { maxClassifyPerRun } from '../config/llm';
import { createEmitter } from './events';

export interface PipelineDeps {
  store: RunStore;
  adapters: SourceAdapter[];
  ctx: AdapterContext;
  classify?: ClassifyStage;
  score?: ScoreStage;
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

export function formatFailureReason(reasonKey: string): string {
  const separator = reasonKey.lastIndexOf(':');
  const provider = separator < 0 ? 'unknown' : reasonKey.slice(0, separator);
  const status = separator < 0 ? 'none' : reasonKey.slice(separator + 1);
  if (status === 'none') {
    return provider === 'none' ? 'network error' : `${provider} network error`;
  }
  return provider === 'none' ? `HTTP ${status}` : `${provider} HTTP ${status}`;
}

function mostFrequentFailureReason(failureReasons: Record<string, number>): string {
  const sorted = Object.entries(failureReasons).sort(
    ([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || leftKey.localeCompare(rightKey),
  );
  return sorted[0] ? formatFailureReason(sorted[0][0]) : 'unknown error';
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

    let classificationFailed = false;
    let scoringFailed = false;
    if (deps.classify && result.afterDedupe > 0) {
      await emit.progress('classifier', `Classifying ${result.afterDedupe} signal(s)`, {
        total: result.afterDedupe,
      });
      if (result.afterDedupe > maxClassifyPerRun) {
        await emit.warning(
          'classifier',
          `Classifying the newest ${maxClassifyPerRun} of ${result.afterDedupe} signals`,
        );
      }
      let summary: ClassifySummary | null = null;
      try {
        summary = await deps.classify(runId, async (done, total) => {
          await emit.progress('classifier', `Classified ${done} of ${total}`);
        });
      } catch (err) {
        classificationFailed = true;
        await emit.error('classifier', `Classification failed: ${errorMessage(err)}`);
      }
      if (summary) {
        const { buyer_intent, competitor_complaint, venting, noise } = summary.labels;
        await emit.info(
          'classifier',
          `Classified ${summary.classified} signal(s): ${buyer_intent} buyer intent, ${competitor_complaint} competitor complaint, ${venting} venting, ${noise} noise`,
          {
            classified: summary.classified,
            reused: summary.reused,
            failed: summary.failed,
            buyer_intent,
            competitor_complaint,
            venting,
            noise,
            verifiedQuotes: summary.verifiedQuotes,
            droppedQuotes: summary.droppedQuotes,
            failureReasons: summary.failureReasons,
          },
        );
        if (summary.failed > 0) {
          classificationFailed = true;
          const reason = mostFrequentFailureReason(summary.failureReasons);
          await emit.warning(
            'classifier',
            `${summary.failed} signal(s) could not be classified (${reason})`,
          );
        }
        const classified = summary.classified;
        if (deps.score && classified > 0) {
          await emit.progress('enricher', `Enriching ${classified} classified signal(s)`, {
            total: classified,
          });
          try {
            const scoreSummary = await deps.score(runId);
            await emit.info('enricher', `Enriched ${scoreSummary.scored} signal(s)`, {
              enriched: scoreSummary.scored,
            });
            await emit.progress('scorer', `Scoring ${scoreSummary.scored} signal(s)`, {
              total: scoreSummary.scored,
            });
            await emit.info(
              'scorer',
              `Scored ${scoreSummary.scored} signal(s): ${scoreSummary.ranked} in the ranked list`,
              {
                scored: scoreSummary.scored,
                ranked: scoreSummary.ranked,
                topScore: scoreSummary.topScore,
              },
            );
            if (scoreSummary.ranked === 0) {
              await emit.info(
                'scorer',
                'No buyer intent or competitor complaint signals in this run',
              );
            }
          } catch (err) {
            scoringFailed = true;
            await emit.error('scorer', `Scoring failed: ${errorMessage(err)}`);
          }
        }
      }
    }

    const sourceStatus = computeRunStatus(result.sources);
    const status = sourceStatus === 'completed' && (classificationFailed || scoringFailed)
      ? 'completed_with_warnings'
      : sourceStatus;
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
