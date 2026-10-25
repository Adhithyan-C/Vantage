import type { CompetitorGraphView, LeadView } from '@vantage/shared';

export function buildCompetitorGraph(leads: LeadView[]): CompetitorGraphView {
  const used = leads.filter((lead) => lead.label === 'buyer_intent' || lead.label === 'competitor_complaint');
  const mentionCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  for (const lead of used) {
    const names = [...new Set(lead.enrichment.competitorsMentioned)];
    for (const name of names) mentionCounts.set(name, (mentionCounts.get(name) ?? 0) + 1);
    for (let leftIndex = 0; leftIndex < names.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
        const left = names[leftIndex];
        const right = names[rightIndex];
        if (left === undefined || right === undefined) continue;
        const a = left < right ? left : right;
        const b = left < right ? right : left;
        const key = JSON.stringify([a, b]);
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const nodes = [...mentionCounts].map(([competitor, mentionCount]) => ({ competitor, mentionCount }))
    .sort((left, right) => right.mentionCount - left.mentionCount || left.competitor.localeCompare(right.competitor))
    .slice(0, 12);
  const kept = new Set(nodes.map((node) => node.competitor));
  const edges = [...edgeCounts].flatMap(([key, weight]) => {
    const pair = JSON.parse(key) as [string, string];
    const [a, b] = pair;
    return a !== undefined && b !== undefined && kept.has(a) && kept.has(b) ? [{ a, b, weight }] : [];
  }).sort((left, right) => right.weight - left.weight || left.a.localeCompare(right.a) || left.b.localeCompare(right.b));
  return {
    nodes,
    edges,
    signalCount: used.length,
    sampleData: used.some((lead) => lead.source === 'snapshot'),
  };
}
