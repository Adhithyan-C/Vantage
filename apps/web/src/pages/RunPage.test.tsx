import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RunEvent, RunView } from '@vantage/shared';

const { hookState } = vi.hoisted(() => ({ hookState: { value: null as unknown } }));
vi.mock('../hooks/useRunEvents', () => ({ useRunEvents: () => hookState.value }));

import { RunPage } from './RunPage';

const baseRun: RunView = {
  id: 'run-1', status: 'completed', demo: false,
  params: { keywords: ['support'], sinceDays: 30, maxResults: 10 },
  startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:00:10Z',
  seller: { productName: 'Beacon', problemDescription: 'Support', idealCustomer: null, competitors: [] },
  sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 0, error: null }], signalCount: 0,
};

function renderRun(run: RunView, events: RunEvent[] = []): string {
  hookState.value = { run, events, requests: [], error: null, retry: () => {} };
  return renderToString(<RunPage runId={run.id} />);
}

describe('RunPage Part A explainability sections', () => {
  it('renders the funnel, zero-result message, and collapsed diagnostics disclosure', () => {
    const html = renderRun(baseRun);
    expect(html).toContain('aria-label="Signal funnel"');
    expect(html).toContain('No matching posts were returned');
    expect(html).toContain('<details class="run-diagnostics">');
    expect(html).toContain('<summary>Diagnostics</summary>');
    expect(html).not.toContain('<details class="run-diagnostics" open');
  });

  it('renders the completed-with-warnings explanation from the run status', () => {
    const run: RunView = {
      ...baseRun,
      status: 'completed_with_warnings',
      signalCount: 1,
      sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 1, error: null }],
    };
    const events: RunEvent[] = [
      { id: 1, runId: run.id, agent: 'classifier', kind: 'info', message: 'Classified 1 signal(s)', counts: { classified: 1, buyer_intent: 1 }, createdAt: run.startedAt },
      { id: 2, runId: run.id, agent: 'scorer', kind: 'info', message: 'Scored 1 signal(s)', counts: { scored: 1, ranked: 1 }, createdAt: run.finishedAt! },
    ];
    const html = renderRun(run, events);
    expect(html).toContain('Run completed with warnings');
    expect(html).toContain('Open Diagnostics to review the details.');
  });

  it('adds the relevance funnel step and excluded-post count', () => {
    const run: RunView = { ...baseRun, signalCount: 2 };
    const events: RunEvent[] = [
      { id: 1, runId: run.id, agent: 'scout', kind: 'info', message: 'Relevance gate kept 1 signal(s), excluded 1 before classification', counts: { relevanceTotal: 2, eligible: 1, excluded: 1, threshold: 0.36 }, createdAt: run.startedAt },
    ];
    const html = renderRun(run, events);
    expect(html).toContain('Relevant');
    expect(html).toContain('1 excluded before classification at similarity threshold 0.36.');
  });
});
