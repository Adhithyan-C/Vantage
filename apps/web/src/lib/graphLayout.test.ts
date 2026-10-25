import { describe, expect, it } from 'vitest';
import type { CompetitorGraphView } from '@vantage/shared';
import { layoutCircle } from './graphLayout';

function graph(count: number): CompetitorGraphView {
  return {
    nodes: Array.from({ length: count }, (_, index) => ({ competitor: `C${index + 1}`, mentionCount: count - index })),
    edges: count > 1 ? [{ a: 'C1', b: 'C2', weight: 2 }] : [],
    signalCount: count,
    sampleData: false,
  };
}

describe('layoutCircle', () => {
  it('centres one node and scales its radius', () => {
    expect(layoutCircle(graph(1), 100).nodes).toEqual([{ competitor: 'C1', mentionCount: 1, x: 50, y: 50, radius: 36 }]);
  });
  it('places two nodes at the top and bottom of the circle', () => {
    expect(layoutCircle(graph(2), 100).nodes.map(({ x, y }) => [x, y])).toEqual([[50, 12], [50, 88]]);
  });
  it('places three nodes deterministically and calculates edge widths', () => {
    const layout = layoutCircle(graph(3), 100);
    expect(layout.nodes.map(({ x, y }) => [x, y])).toEqual([[50, 12], [82.9, 69], [17.1, 69]]);
    expect(layout.edges).toEqual([{ a: 'C1', b: 'C2', weight: 2, strokeWidth: 6 }]);
  });
});
