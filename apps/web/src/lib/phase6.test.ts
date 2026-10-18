import { describe, expect, it } from 'vitest';
import type { LeadLabel, LeadView } from '@vantage/shared';
import { parseHash } from '../app/routes';
import { formatAge } from './format';
import { filterSignals } from './inbox';
import { segmentText } from './evidence';

const RUN = '00000000-0000-0000-0000-000000000001';
const SIGNAL = '00000000-0000-0000-0000-000000000002';
const base: LeadView = {
  leadId: SIGNAL, signalId: 'signal', rank: 1, label: 'buyer_intent', score: 80,
  confidence: 0.8, status: 'new', source: 'hackernews', url: 'https://example.test',
  authorHandle: 'writer', community: null, createdAtSource: '2026-10-17T00:00:00.000Z',
  textPreview: 'A public post', rationale: 'Asks for support software.',
  criteria: [
    { id: 'states_problem', passed: true, quote: 'support issue' },
    { id: 'asks_for_recommendation', passed: false, quote: null },
    { id: 'mentions_team_or_budget', passed: false, quote: null },
    { id: 'shows_urgency', passed: false, quote: null },
    { id: 'names_competitor', passed: false, quote: null },
  ],
  evidenceVerified: true,
  breakdown: { components: [
    { name: 'intent', value: 0.8, weight: 0.4, contribution: 32 },
    { name: 'fit', value: 0.5, weight: 0.25, contribution: 12.5 },
    { name: 'recency', value: 0.6, weight: 0.2, contribution: 12 },
    { name: 'engagement', value: 0.4, weight: 0.15, contribution: 6 },
  ], total: 63 },
  enrichment: {
    ageDays: 1, commentCount: 2, upvotes: 4, source: 'hackernews', community: null,
    competitorsMentioned: [], purchaseTermsFound: [], teamTermsFound: [],
    fit: { competitorMentioned: false, purchaseLanguage: true, teamOrRoleContext: false },
  },
};

function signal(label: LeadLabel, rank: number, score: number, status: LeadView['status'] = 'new'): LeadView {
  return { ...base, label, rank, score, status, leadId: `signal-${rank}` };
}

describe('Phase 6 pure web functions', () => {
  it('parses setup, run, inbox, and detail routes and rejects malformed ids', () => {
    expect(parseHash('#/')).toEqual({ name: 'setup' });
    expect(parseHash(`#/runs/${RUN}`)).toEqual({ name: 'run', runId: RUN });
    expect(parseHash(`#/runs/${RUN}/signals`)).toEqual({ name: 'signals', runId: RUN });
    expect(parseHash(`#/runs/${RUN}/signals/${SIGNAL}`)).toEqual({ name: 'signal', runId: RUN, leadId: SIGNAL });
    expect(parseHash('#/runs/not-a-uuid')).toEqual({ name: 'not-found' });
    expect(parseHash(`#/runs/${RUN}/signals/not-a-uuid`)).toEqual({ name: 'not-found' });
  });

  it('formats today, one day, and many days', () => {
    const now = Date.parse('2026-10-18T00:00:00.000Z');
    expect(formatAge('2026-10-18T00:00:00.000Z', now)).toBe('today');
    expect(formatAge('2026-10-17T00:00:00.000Z', now)).toBe('1 day ago');
    expect(formatAge('2026-09-14T00:00:00.000Z', now)).toBe('34 days ago');
  });

  it('filters ranked labels by default, toggles other labels, applies filters, and preserves rank order', () => {
    const signals = [
      signal('noise', 4, 99), signal('competitor_complaint', 2, 60),
      signal('buyer_intent', 1, 80, 'accepted'), signal('venting', 3, 72, 'rejected'),
    ];
    const defaults = { showOtherSignals: false, label: 'all' as const, status: 'all' as const, minScore: null };
    expect(filterSignals(signals, defaults).map((item) => item.rank)).toEqual([1, 2]);
    expect(filterSignals(signals, { ...defaults, showOtherSignals: true }).map((item) => item.rank)).toEqual([1, 2, 3, 4]);
    expect(filterSignals(signals, { ...defaults, showOtherSignals: true, label: 'venting' }).map((item) => item.label)).toEqual(['venting']);
    expect(filterSignals(signals, { ...defaults, showOtherSignals: true, status: 'accepted' }).map((item) => item.label)).toEqual(['buyer_intent']);
    expect(filterSignals(signals, { ...defaults, showOtherSignals: true, minScore: 70 }).map((item) => item.label)).toEqual(['buyer_intent', 'venting', 'noise']);
  });

  it('segments text with absent, single, adjacent, overlapping, invalid, start, and end spans', () => {
    const span = (start: number, end: number) => ({ criterion: 'states_problem' as const, quote: '', start, end });
    expect(segmentText('abc', [])).toEqual([{ text: 'abc', highlighted: false }]);
    expect(segmentText('abc', [span(1, 2)])).toEqual([
      { text: 'a', highlighted: false }, { text: 'b', highlighted: true, criterion: 'states_problem' }, { text: 'c', highlighted: false },
    ]);
    expect(segmentText('abcd', [span(0, 2), span(2, 4)]).filter((item) => item.highlighted).map((item) => item.text)).toEqual(['ab', 'cd']);
    expect(segmentText('abcd', [span(0, 3), span(2, 4)]).filter((item) => item.highlighted).map((item) => item.text)).toEqual(['abcd']);
    expect(segmentText('abcd', [span(-1, 1), span(3, 5), span(2, 2)])).toEqual([{ text: 'abcd', highlighted: false }]);
    expect(segmentText('abcd', [span(0, 1), span(3, 4)]).map((item) => item.text)).toEqual(['a', 'bc', 'd']);
  });
});
