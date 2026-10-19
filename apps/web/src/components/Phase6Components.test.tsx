import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { LeadView } from '@vantage/shared';
import { SignalCard } from './SignalCard';
import { ScoreBreakdown } from './ScoreBreakdown';
import { CriteriaChecklist } from './CriteriaChecklist';
import { DiscardedQuotesNote } from '../pages/SignalDetailPage';
import { EMPTY_FORM, buildRequest, SetupPage } from '../pages/SetupPage';
import { SOURCE_LABEL } from '../lib/format';

const ranked: LeadView = {
  leadId: 'id', signalId: 'signal', rank: 1, label: 'buyer_intent', score: 63,
  confidence: 0.8, status: 'new', source: 'hackernews', url: 'https://example.test',
  authorHandle: 'writer', community: null, createdAtSource: '2026-10-17T00:00:00Z',
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

describe('Phase 6 server-rendered components', () => {
  it('shows Not ranked without a numeric score for noise and score for buyer intent', () => {
    const noise = renderToString(<SignalCard signal={{ ...ranked, label: 'noise', score: 99 }} runId="run" />);
    const buyer = renderToString(<SignalCard signal={ranked} runId="run" />);
    expect(noise).toContain('Not ranked');
    expect(noise).not.toContain('Score 99');
    expect(noise).not.toContain('Rank 1');
    expect(buyer).toContain('Rank <!-- -->1');
    expect(buyer).toContain('Score');
    expect(buyer).toContain('63');
  });

  it('shows evidence verification wording only when confidence is present', () => {
    const verified = renderToString(<SignalCard signal={{ ...ranked, confidence: 1 }} runId="run" />);
    const partial = renderToString(<SignalCard signal={{ ...ranked, confidence: 0.8 }} runId="run" />);
    const unknown = renderToString(<SignalCard signal={{ ...ranked, confidence: null }} runId="run" />);
    expect(verified).toContain('Quotes verified');
    expect(partial).toContain('Some quotes could not be verified');
    expect(unknown).not.toContain('Evidence check');
    expect(unknown).not.toContain('Quotes verified');
    expect(unknown).not.toContain('Some quotes could not be verified');
  });

  it('labels snapshot cards as sample data and removes their original-post link', () => {
    const sample = renderToString(<SignalCard signal={{ ...ranked, source: 'snapshot' }} runId="run" />);
    const live = renderToString(<SignalCard signal={ranked} runId="run" />);
    expect(sample).toContain('Sample data');
    expect(sample).toContain('Sample dataset (synthetic)');
    expect(sample).toContain('Sample post (not a real link)');
    expect(sample).not.toContain('Open original post');
    expect(sample).not.toContain('href="https://example.test"');
    expect(live).not.toContain('Sample data');
    expect(live).toContain('Open original post');
  });

  it('includes the selected sources in setup requests and blocks an empty selection', () => {
    const request = buildRequest(EMPTY_FORM, ['hackernews', 'snapshot']);
    expect(request).toMatchObject({ params: { sources: ['hackernews', 'snapshot'] } });
    expect(buildRequest(EMPTY_FORM, [])).toBeNull();
    const setup = renderToString(<SetupPage />);
    expect(setup).toContain('Labelled test posts written for Vantage. They are not real posts and ignore your keywords.');
    expect(setup).toContain('Sample dataset (synthetic)');
  });

  it('uses the explicit synthetic source label', () => {
    expect(SOURCE_LABEL.snapshot).toBe('Sample dataset (synthetic)');
  });

  it('renders score rows and total only for ranked signals', () => {
    const html = renderToString(<ScoreBreakdown lead={ranked} />);
    expect(html).toContain('Intent');
    expect(html).toContain('Total');
    expect(html).toContain('63');
    const noise = renderToString(<ScoreBreakdown lead={{ ...ranked, label: 'noise', score: 99 }} />);
    expect(noise).toContain('Not ranked');
    expect(noise).not.toContain('99');
  });

  it('renders all five criteria', () => {
    const html = renderToString(<CriteriaChecklist criteria={ranked.criteria} />);
    expect(html).toContain('States a problem');
    expect(html).toContain('Asks for a recommendation');
    expect(html).toContain('Mentions team or budget');
    expect(html).toContain('Shows urgency');
    expect(html).toContain('Names a competitor');
  });

  it('shows the discarded quote note only when quote count is positive', () => {
    expect(renderToString(<DiscardedQuotesNote count={0} />)).toBe('');
    expect(renderToString(<DiscardedQuotesNote count={2} />)).toContain('quotes<!-- --> from the model could not be found');
  });
});
