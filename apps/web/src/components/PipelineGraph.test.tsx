import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RunEvent } from '@vantage/shared';
import { PipelineGraph } from './PipelineGraph';

describe('PipelineGraph', () => {
  it('renders all six stages in execution order with accessible current states', () => {
    const events: RunEvent[] = [{
      id: 1, runId: 'run', agent: 'critic', kind: 'info', message: 'Reviewed 2 signal(s)',
      counts: { reviewed: 2 }, createdAt: '2026-10-01T00:00:01Z',
    }];
    const html = renderToString(<PipelineGraph runStatus="running" events={events} />);
    const names = ['Scout', 'Classifier', 'Critic', 'Enricher', 'Scorer', 'Displacement'];
    expect(html).toContain('aria-label="Scout: Waiting; Classifier: Waiting; Critic: Completed; Enricher: Waiting; Scorer: Waiting; Displacement: Waiting"');
    expect(names.map((name) => html.indexOf(`>${name}</text>`))).toEqual([...names].map((name) => html.indexOf(`>${name}</text>`)).sort((a, b) => a - b));
    expect(html).toContain('2 reviewed');
  });

  it('omits the pulse class when reduced motion is requested', () => {
    const events: RunEvent[] = [{
      id: 1, runId: 'run', agent: 'classifier', kind: 'progress', message: 'Classifying',
      counts: null, createdAt: '2026-10-01T00:00:01Z',
    }];
    const html = renderToString(<PipelineGraph runStatus="running" events={events} motionReduced />);
    expect(html).toContain('state-running');
    expect(html).not.toContain('is-pulsing');
  });
});
