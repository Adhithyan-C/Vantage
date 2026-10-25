import { describe, expect, it } from 'vitest';
import type { RunEvent, RunView } from '@vantage/shared';
import { buildFunnel, runOutcome } from './pipelineExplainability';

const run: RunView = {
  id: 'run', status: 'completed', demo: false,
  params: { keywords: ['support'], sinceDays: 30, maxResults: 20 },
  startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:00:10Z',
  seller: { productName: 'Beacon', problemDescription: 'Support', idealCustomer: null, competitors: [] },
  sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 8, error: null }], signalCount: 8,
};

function event(agent: RunEvent['agent'], kind: RunEvent['kind'], message: string, counts: Record<string, unknown> | null = null): RunEvent {
  return { id: 1, runId: run.id, agent, kind, message, counts, createdAt: '2026-10-01T00:00:02Z' };
}

describe('run funnel and outcome explanations', () => {
  it('uses only completed event counts and records label drops', () => {
    const events = [
      event('scout', 'progress', 'Removed duplicates', { fetched: 10, afterDedupe: 8 }),
      event('scout', 'info', 'Relevance gate kept 6 signal(s), excluded 2 before classification', { relevanceTotal: 8, eligible: 6, excluded: 2, threshold: 0.36 }),
      event('classifier', 'info', 'Classified 8 signal(s)', { classified: 8, buyer_intent: 2, competitor_complaint: 1, venting: 2, noise: 3, failed: 0 }),
      event('scorer', 'info', 'Scored 8 signal(s)', { scored: 8, ranked: 3 }),
      event('displacement', 'info', 'Found 2 theme(s)', { themeCount: 2, complaintSignals: 1 }),
    ];
    expect(buildFunnel(run, events)).toEqual([
      { key: 'collected', label: 'Collected', count: 8, note: null },
      { key: 'relevance', label: 'Relevant', count: 6, note: '2 excluded before classification at similarity threshold 0.36.' },
      { key: 'classified', label: 'Classified', count: 8, note: null },
      { key: 'buying', label: 'Buying signals', count: 3, note: '2 venting and 3 noise signal(s) were not ranked.' },
      { key: 'ranked', label: 'Ranked', count: 3, note: null },
      { key: 'themes', label: 'Themes', count: 2, note: '1 competitor complaint signal(s) were evaluated for themes.' },
    ]);
  });

  it('distinguishes source-empty, source-failed, warning, failure, and collected-but-unranked outcomes', () => {
    const noPosts: RunView = { ...run, signalCount: 0, sources: [{ ...run.sources[0]!, fetchedCount: 0 }] };
    expect(runOutcome(noPosts, [])?.title).toBe('No matching posts were returned');
    expect(runOutcome(noPosts, [])?.hint).toContain('not evidence of no demand');
    const sourceFailed: RunView = { ...noPosts, sources: [{ ...noPosts.sources[0]!, status: 'failed', error: 'offline' }] };
    expect(runOutcome(sourceFailed, [])?.title).toBe('Sources could not collect posts');

    const failed = event('scorer', 'error', 'Scoring failed: offline');
    expect(runOutcome(run, [failed])?.title).toBe('A pipeline stage failed');
    const capped = event('classifier', 'warning', 'Classifying the newest 40 of 60 signals');
    expect(runOutcome(run, [capped])?.title).toBe('Classification was capped');
    const scoredZero = event('scorer', 'info', 'Scored 8 signal(s)', { scored: 8, ranked: 0 });
    const classifier = event('classifier', 'info', 'Classified 8 signal(s)', { classified: 8, buyer_intent: 0, competitor_complaint: 0, venting: 3, noise: 5, failed: 0 });
    expect(runOutcome(run, [classifier, scoredZero])?.hint).toContain('not evidence of no demand');

    const completedWithWarnings = { ...run, status: 'completed_with_warnings' as const };
    const scoredRanked = event('scorer', 'info', 'Scored 8 signal(s)', { scored: 8, ranked: 3 });
    expect(runOutcome(completedWithWarnings, [scoredRanked])?.title).toBe('Run completed with warnings');
  });

  it('does not invent a count before the stage records its final event', () => {
    const funnel = buildFunnel({ ...run, signalCount: 0 }, []);
    expect(funnel.map((step) => step.count)).toEqual([null, null, null, null, null, null]);
  });
});
