import { describe, expect, it } from 'vitest';
import type { AgentId, RunEvent } from '@vantage/shared';
import { stageStatus } from './stages';

function event(agent: AgentId, kind: RunEvent['kind'], message: string, at: string, counts: Record<string, unknown> | null = null): RunEvent {
  return { id: Date.parse(at), runId: 'run', agent, kind, message, counts, createdAt: at };
}

describe('stageStatus', () => {
  it('shows waiting and skipped states when a stage has no events', () => {
    expect(stageStatus('classifier', [], 'running').state).toBe('waiting');
    expect(stageStatus('classifier', [], 'completed').state).toBe('skipped');
  });

  it('reports running progress and completed summaries and durations', () => {
    const start = event('critic', 'progress', 'Reviewing 2 signal(s)', '2026-10-01T00:00:00Z');
    const finish = event('critic', 'info', 'Reviewed 2 signal(s)', '2026-10-01T00:00:03Z', { reviewed: 2, failed: 0 });
    expect(stageStatus('critic', [start], 'running').state).toBe('running');
    expect(stageStatus('critic', [start, finish], 'running')).toMatchObject({ state: 'completed', summary: '2 reviewed', durationMs: 3000 });
  });

  it('covers generic finished-without-final and scout completion edge cases', () => {
    const progress = event('enricher', 'progress', 'Enriching 2 signal(s)', '2026-10-01T00:00:00Z');
    expect(stageStatus('enricher', [progress], 'completed').state).toBe('completed_with_warnings');
    const error = event('enricher', 'error', 'Enrichment failed', '2026-10-01T00:00:01Z');
    expect(stageStatus('enricher', [progress, error], 'completed').state).toBe('failed');

    const scoutProgress = event('scout', 'progress', 'Fetching', '2026-10-01T00:00:00Z', { status: 'ok' });
    expect(stageStatus('scout', [scoutProgress], 'running').state).toBe('running');
    const scoutFinal = event('scout', 'info', 'Scouted', '2026-10-01T00:00:02Z', { afterDedupe: 4, status: 'ok' });
    expect(stageStatus('scout', [scoutProgress, scoutFinal], 'running')).toMatchObject({ state: 'completed', summary: '4 signals', durationMs: 2000 });
    const degraded = event('scout', 'warning', 'Source degraded', '2026-10-01T00:00:03Z', { status: 'degraded' });
    expect(stageStatus('scout', [scoutFinal, degraded], 'completed_with_warnings').state).toBe('completed_with_warnings');
  });

  it('represents warning, failure, displacement zero-results and scout source failures', () => {
    const warning = event('scorer', 'warning', 'No ranked signals', '2026-10-01T00:00:01Z');
    const scored = event('scorer', 'info', 'Scored 1 signal(s)', '2026-10-01T00:00:02Z', { ranked: 0 });
    expect(stageStatus('scorer', [scored, warning], 'completed_with_warnings').state).toBe('completed_with_warnings');
    const failed = event('displacement', 'error', 'Displacement failed: offline', '2026-10-01T00:00:03Z');
    expect(stageStatus('displacement', [failed], 'completed_with_warnings').state).toBe('failed');
    const noComplaints = event('displacement', 'info', 'No competitor complaint signals to cluster', '2026-10-01T00:00:04Z', { complaintSignals: 0 });
    expect(stageStatus('displacement', [noComplaints], 'completed')).toMatchObject({ state: 'completed', summary: 'no complaints' });
    const scout = event('scout', 'progress', 'Source failed', '2026-10-01T00:00:00Z', { status: 'failed' });
    expect(stageStatus('scout', [scout], 'failed').state).toBe('failed');
  });
});
