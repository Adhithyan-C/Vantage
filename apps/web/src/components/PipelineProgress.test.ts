import { describe, expect, it } from 'vitest';
import type { RunEvent, RunView } from '@vantage/shared';
import { RunStatusBadge, scoutStatus } from './PipelineProgress';

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
