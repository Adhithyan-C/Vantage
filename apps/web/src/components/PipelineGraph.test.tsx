import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RunEvent, RunView } from '@vantage/shared';
import { PipelineGraph } from './PipelineGraph';

describe('PipelineGraph', () => {
  const run = { id: 'run', status: 'running', demo: false, params: { keywords: [], sinceDays: 30, maxResults: 10 }, startedAt: '2026-10-01T00:00:00Z', finishedAt: null, seller: { productName: 'Product', problemDescription: 'Problem', idealCustomer: null, competitors: [] }, sources: [], signalCount: 0 } satisfies RunView;
  const props = { run, requests: [], leads: [], themes: [], selectedAgent: 'scout' as const, onSelectAgent: () => {} };
  it('renders all six stages in execution order with accessible current states', () => {
    const events: RunEvent[] = [{
      id: 1, runId: 'run', agent: 'critic', kind: 'info', message: 'Reviewed 2 signal(s)',
      counts: { reviewed: 2 }, createdAt: '2026-10-01T00:00:01Z',
    }];
    const html = renderToString(<PipelineGraph {...props} selectedAgent="critic" events={events} />);
    const names = ['Scout', 'Classifier', 'Critic', 'Enricher', 'Scorer', 'Displacement'];
    expect(html).toContain('role="tablist" aria-label="Pipeline stages"');
    expect(html).toContain('aria-label="Critic: Completed"');
    expect(names.map((name) => html.indexOf(`>${name}</span>`))).toEqual([...names].map((name) => html.indexOf(`>${name}</span>`)).sort((a, b) => a - b));
    expect(html).toContain('Reviewed 2 signal(s)');
  });

  it('omits the pulse class when reduced motion is requested', () => {
    const events: RunEvent[] = [{
      id: 1, runId: 'run', agent: 'classifier', kind: 'progress', message: 'Classifying',
      counts: null, createdAt: '2026-10-01T00:00:01Z',
    }];
    const html = renderToString(<PipelineGraph {...props} events={events} motionReduced />);
    expect(html).toContain('state-running');
    expect(html).not.toContain('is-pulsing');
  });

  it('shows a distinct detail panel for each of the six pipeline stages', () => {
    const expectedDetails = [
      ['scout', 'Recorded sources'],
      ['classifier', 'Recorded label totals'],
      ['critic', 'No corrections are recorded.'],
      ['enricher', 'Recorded enrichment'],
      ['scorer', 'Recorded score components'],
      ['displacement', 'Method: local text embeddings and DBSCAN.'],
    ] as const;

    for (const [agent, detail] of expectedDetails) {
      const html = renderToString(<PipelineGraph {...props} events={[]} selectedAgent={agent} />);
      expect(html, `${agent} panel`).toContain(detail);
    }
  });
});
