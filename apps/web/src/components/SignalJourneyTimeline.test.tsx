import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { SignalJourney } from '@vantage/shared';
import { SignalJourneyTimeline } from './SignalJourneyTimeline';

const stages: SignalJourney['timeline'] = [
  { stage: 'scout', status: 'completed', reason: null, output: { source: 'hackernews' } },
  { stage: 'classifier', status: 'completed', reason: null, output: { label: 'competitor_complaint', rationale: 'Evidence supports this label.', criteria: [{ id: 'names_competitor', passed: true, quote: 'Acme is slow' }] } },
  { stage: 'critic', status: 'completed', reason: null, output: { verdict: 'weak', issues: ['Needs context'] } },
  { stage: 'enricher', status: 'completed', reason: null, output: { competitorsMentioned: ['Acme'] } },
  { stage: 'scorer', status: 'completed', reason: null, output: { score: 72, rank: 1 } },
  { stage: 'displacement', status: 'completed', reason: null, output: { title: 'Acme: slow search', competitor: 'Acme', otherMemberCount: 2, href: '#/runs/run/themes' } },
  { stage: 'outcome', status: 'completed', reason: null, output: { reason: 'Included in ranked results', theme: 'Acme: slow search' } },
];

const journey: SignalJourney = {
  signalId: 'signal', leadId: null, source: 'hackernews', authorHandle: 'seller', url: 'https://example.test', textPreview: 'Acme is slow', createdAtSource: '2026-10-01T00:00:00Z',
  label: 'competitor_complaint', score: 72, text: 'Acme is slow',
  stages: Object.fromEntries(stages.map((item) => [item.stage, { status: item.status }])) as SignalJourney['stages'], timeline: stages,
};

describe('SignalJourneyTimeline', () => {
  it('shows all seven entries in pipeline and outcome order with recorded details', () => {
    const html = renderToString(<SignalJourneyTimeline journey={journey} />);
    const names = ['Scout', 'Classifier', 'Critic', 'Enricher', 'Scorer', 'Displacement', 'Outcome'];
    const positions = names.map((name) => html.indexOf(`<strong>${name}</strong>`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('Acme: slow search; 2 other member(s)');
    expect(html).toContain('href="#/runs/run/themes"');
    expect(html).toContain('Also a member of theme:');
    expect(html).toContain('Acme: slow search');
    expect(html).toContain('Acme is slow');
  });

  it('shows a recorded relevance exclusion and its similarity threshold', () => {
    const excluded: SignalJourney = {
      ...journey,
      label: null,
      timeline: stages.map((item) => item.stage === 'scout'
        ? { ...item, output: { source: 'hackernews', relevance: { eligible: false, similarity: 0.21, threshold: 0.36, exclusionReason: 'Below relevance threshold' } } }
        : item.stage === 'classifier' ? { ...item, status: 'not_run', reason: 'Excluded before classification', output: null } : item),
    };
    const html = renderToString(<SignalJourneyTimeline journey={excluded} />);
    expect(html).toContain('Excluded before classification');
    expect(html).toContain('(below relevance threshold) · similarity 0.210; threshold 0.36');
  });
});
