import { describe, expect, it } from 'vitest';
import type { LeadView } from '@vantage/shared';
import { buildCompetitorGraph } from '../src/report/competitorGraph';

function lead(label: LeadView['label'], competitorsMentioned: string[], source: LeadView['source'] = 'hackernews'): LeadView {
  return {
    leadId: 'lead', signalId: 'signal', rank: 1, label, score: 50, confidence: 1, status: 'new', source,
    url: 'https://example.test', authorHandle: 'author', community: null, createdAtSource: '2026-10-01T00:00:00Z',
    textPreview: 'text', rationale: 'rationale', criteria: [], evidenceVerified: true,
    breakdown: { components: [], total: 50 },
    enrichment: {
      ageDays: 1, commentCount: 0, upvotes: 0, source, community: null, competitorsMentioned,
      purchaseTermsFound: [], teamTermsFound: [],
      fit: { competitorMentioned: competitorsMentioned.length > 0, purchaseLanguage: false, teamOrRoleContext: false },
    },
  };
}

describe('buildCompetitorGraph', () => {
  it('counts distinct buying-signal mentions, pairs, ordering and sample data', () => {
    expect(buildCompetitorGraph([
      lead('buyer_intent', ['Zeta', 'Acme', 'Acme']),
      lead('competitor_complaint', ['Acme', 'Beta']),
      lead('competitor_complaint', ['Beta', 'Zeta']),
      lead('buyer_intent', ['Zeta', 'Beta'], 'snapshot'),
      lead('noise', ['Ignored']),
    ])).toEqual({
      nodes: [
        { competitor: 'Beta', mentionCount: 3 },
        { competitor: 'Zeta', mentionCount: 3 },
        { competitor: 'Acme', mentionCount: 2 },
      ],
      edges: [
        { a: 'Beta', b: 'Zeta', weight: 2 },
        { a: 'Acme', b: 'Beta', weight: 1 },
        { a: 'Acme', b: 'Zeta', weight: 1 },
      ],
      signalCount: 4,
      sampleData: true,
    });
  });

  it('caps nodes at twelve and retains only edges between returned nodes', () => {
    const names = Array.from({ length: 13 }, (_, index) => `Competitor ${String(index).padStart(2, '0')}`);
    const graph = buildCompetitorGraph([
      ...names.slice(0, 12).flatMap((name) => [lead('buyer_intent', [name]), lead('buyer_intent', [name])]),
      lead('competitor_complaint', [names[0]!, names[12]!]),
    ]);
    expect(graph.nodes).toHaveLength(12);
    expect(graph.nodes.some((node) => node.competitor === names[12])).toBe(false);
    expect(graph.edges).toEqual([]);
  });
});
