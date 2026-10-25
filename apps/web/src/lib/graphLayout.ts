import type { CompetitorGraphView } from '@vantage/shared';

export interface CompetitorGraphLayout {
  nodes: Array<{ competitor: string; mentionCount: number; x: number; y: number; radius: number }>;
  edges: Array<{ a: string; b: string; weight: number; strokeWidth: number }>;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function layoutCircle(graph: CompetitorGraphView, size: number): CompetitorGraphLayout {
  const maxMentionCount = Math.max(...graph.nodes.map((node) => node.mentionCount), 0);
  const maxWeight = Math.max(...graph.edges.map((edge) => edge.weight), 0);
  const nodes = graph.nodes.map((node, index) => {
    if (graph.nodes.length === 1) {
      return { ...node, x: round(size / 2), y: round(size / 2), radius: round(14 + 22 * (node.mentionCount / (maxMentionCount || 1))) };
    }
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / graph.nodes.length;
    const radius = size * 0.38;
    return {
      ...node,
      x: round(size / 2 + radius * Math.cos(angle)),
      y: round(size / 2 + radius * Math.sin(angle)),
      radius: round(14 + 22 * (node.mentionCount / (maxMentionCount || 1))),
    };
  });
  return {
    nodes,
    edges: graph.edges.map((edge) => ({
      ...edge,
      strokeWidth: round(1 + 5 * (edge.weight / (maxWeight || 1))),
    })),
  };
}
