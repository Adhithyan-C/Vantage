import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CompetitorGraphView } from '@vantage/shared';
import { CompetitorGraph } from './CompetitorGraph';

const graph: CompetitorGraphView = {
  nodes: [{ competitor: 'Acme', mentionCount: 3 }, { competitor: 'Beacon', mentionCount: 2 }],
  edges: [{ a: 'Acme', b: 'Beacon', weight: 2 }],
  signalCount: 4,
  sampleData: true,
};

describe('CompetitorGraph', () => {
  it('renders the accessible graph, pair table and sample badge', () => {
    const html = renderToString(<CompetitorGraph graph={graph} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('Strongest pair: Acme and Beacon, 2 signals.');
    expect(html).toContain('Show as table');
    expect(html).toContain('Acme<!-- --> + <!-- -->Beacon');
    expect(html).toContain('Sample data');
    expect(html).toContain('A line means the same signal mentions both.');
  });
  it('shows the specified empty and no-edge states', () => {
    expect(renderToString(<CompetitorGraph graph={{ ...graph, nodes: [graph.nodes[0]!], edges: [] }} />))
      .toContain('Not enough competitor mentions');
    const noEdges = renderToString(<CompetitorGraph graph={{ ...graph, edges: [] }} />);
    expect(noEdges).toContain('No signal mentions two competitors together in this run.');
    expect(noEdges).toContain('Acme');
    expect(noEdges).toContain('Beacon');
  });
});
