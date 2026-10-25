import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { RunEvent, RunView } from '@vantage/shared';
import { agentStageStatus, agentSummary, displacementStatus, displacementSummary, PipelineProgress, RunStatusBadge, scoutStatus } from './PipelineProgress';
import { renderToString } from 'react-dom/server';

function run(status: RunView['status'], sourceStatuses: RunView['sources'][number]['status'][] = ['ok']): RunView {
  return {
    id: 'run-1',
    status,
    demo: false,
    params: { keywords: ['support'], sinceDays: 30, maxResults: 10 },
    startedAt: '2026-10-01T00:00:00Z',
    finishedAt: null,
    seller: { productName: 'Support', problemDescription: 'Tickets', idealCustomer: null, competitors: [] },
    sources: sourceStatuses.map((status) => ({
      source: 'hackernews',
      status,
      fetchedCount: 1,
      error: null,
    })),
    signalCount: 1,
  };
}

const scoutComplete: RunEvent = {
  id: 1,
  runId: 'run-1',
  agent: 'scout',
  kind: 'progress',
  message: 'Removed duplicates',
  counts: { afterDedupe: 1 },
  createdAt: '2026-10-01T00:01:00Z',
};

function stageEvent(
  agent: 'enricher' | 'scorer' | 'displacement',
  kind: RunEvent['kind'],
  message: string,
  counts: Record<string, unknown> | null = null,
): RunEvent {
  return { ...scoutComplete, id: 2, agent, kind, message, counts };
}

describe('Scout pipeline badge', () => {
  it('stays Running until the dedupe-count event arrives during a running run', () => {
    expect(scoutStatus(run('running'), [])).toBe('Running');
  });

  it('shows Completed after the dedupe-count event when sources are healthy', () => {
    expect(scoutStatus(run('running'), [scoutComplete])).toBe('Completed');
  });

  it('shows Completed with warnings for degraded, failed, or skipped sources', () => {
    expect(scoutStatus(run('completed_with_warnings', ['degraded']), [scoutComplete]))
      .toBe('Completed with warnings');
    expect(scoutStatus(run('completed_with_warnings', ['ok', 'failed']), [scoutComplete]))
      .toBe('Completed with warnings');
    expect(scoutStatus(run('completed_with_warnings', ['skipped']), [scoutComplete]))
      .toBe('Completed with warnings');
  });

  it('shows Failed when every source failed', () => {
    expect(scoutStatus(run('failed', ['failed', 'failed']), [scoutComplete])).toBe('Failed');
  });

  it('shows a finished healthy Scout as Completed when no result event was received', () => {
    expect(scoutStatus(run('completed'), [])).toBe('Completed');
  });

  it('uses the run status for the page-header badge', () => {
    const badge = RunStatusBadge({ status: 'completed_with_warnings' });
    expect(badge.props.className).toContain('badge-run-completed_with_warnings');
  });
});

describe('Enricher and Scorer pipeline stages', () => {
  it('shows Waiting before events, Running while active, and Skipped when finished without events', () => {
    expect(agentStageStatus('enricher', 'Enriched ', run('running'), [])).toBe('Waiting');
    expect(agentStageStatus('scorer', 'Scored ', run('completed'), [])).toBe('Skipped');
    expect(agentStageStatus(
      'enricher',
      'Enriched ',
      run('completed'),
      [stageEvent('enricher', 'progress', 'Enriching 2 classified signal(s)')],
    )).toBe('Running');
  });

  it('marks completed final info events complete and degraded stages with warnings', () => {
    const enricherInfo = stageEvent('enricher', 'info', 'Enriched 2 signal(s)', { enriched: 2 });
    const scorerInfo = stageEvent('scorer', 'info', 'Scored 2 signal(s): 1 in the ranked list', {
      scored: 2,
      ranked: 1,
      topScore: 72,
    });
    expect(agentStageStatus('enricher', 'Enriched ', run('running'), [enricherInfo])).toBe('Completed');
    expect(agentStageStatus('scorer', 'Scored ', run('running'), [scorerInfo])).toBe('Completed');
    const noRankedScorerInfo = stageEvent(
      'scorer',
      'info',
      'Scored 2 signal(s): 0 in the ranked list',
      { scored: 2, ranked: 0, topScore: null },
    );
    expect(agentStageStatus('scorer', 'Scored ', run('completed'), [
      noRankedScorerInfo,
      stageEvent('scorer', 'info', 'No buyer intent or competitor complaint signals in this run'),
    ])).toBe('Completed');
    expect(agentStageStatus('enricher', 'Enriched ', run('completed'), [
      stageEvent('enricher', 'error', 'Enrichment failed'),
    ])).toBe('Running');
  });

  it('formats the Enricher and Scorer summary lines from final event counts', () => {
    expect(agentSummary([
      stageEvent('enricher', 'info', 'Enriched 4 signal(s)', { enriched: 4 }),
    ], 'enricher')).toBe('4 enriched');
    expect(agentSummary([
      stageEvent('scorer', 'info', 'Scored 4 signal(s): 2 in the ranked list', {
        scored: 4,
        ranked: 2,
        topScore: 79,
      }),
    ], 'scorer')).toBe(`4 scored \u00b7 2 in the ranked list`);
  });
});

describe('Displacement pipeline stage', () => {
  it('shows live status and summary from the final displacement event', () => {
    expect(displacementStatus(run('running'), [])).toBe('Waiting');
    expect(displacementStatus(run('running'), [stageEvent('displacement', 'progress', 'Clustering competitor complaints')])).toBe('Running');
    const final = stageEvent('displacement', 'info', 'Found 2 theme(s) from 4 complaint signal(s)', { themeCount: 2 });
    expect(displacementStatus(run('completed'), [final])).toBe('Completed');
    expect(displacementSummary([final])).toBe('2 themes');
    expect(displacementSummary([stageEvent('displacement', 'info', 'No competitor complaint signals to cluster', { complaintSignals: 0 })])).toBe('no complaints');
    expect(displacementStatus(run('completed'), [stageEvent('displacement', 'error', 'Displacement failed: offline')])).toBe('Failed');
  });

  it('renders Displacement as an active stage', () => {
    const html = renderToString(createElement(PipelineProgress, { run: run('running'), events: [] }));
    expect(html).toContain('Displacement');
    expect(html).not.toContain('Planned</span>');
  });
});
