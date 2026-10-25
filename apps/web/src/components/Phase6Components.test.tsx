import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { DecisionTrace, LeadView } from '@vantage/shared';
import { SignalCard } from './SignalCard';
import { ScoreBreakdown } from './ScoreBreakdown';
import { CriteriaChecklist } from './CriteriaChecklist';
import { CriticTrustReview, DiscardedQuotesNote } from '../pages/SignalDetailPage';
import { EMPTY_FORM, buildRequest, SetupPage } from '../pages/SetupPage';
import { SOURCE_LABEL } from '../lib/format';
import { AppFooter } from '../app/App';

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
    const stackExchange = renderToString(<SignalCard signal={{ ...ranked, source: 'stackexchange' }} runId="run" />);
    expect(sample).toContain('Sample data');
    expect(sample).toContain('Sample dataset (synthetic)');
    expect(sample).toContain('Sample post (not a real link)');
    expect(sample).not.toContain('Open original post');
    expect(sample).not.toContain('href="https://example.test"');
    expect(live).not.toContain('Sample data');
    expect(live).toContain('Open original post');
    expect(stackExchange).toContain('Open original post');
    expect(stackExchange).toContain('href="https://example.test"');
    expect(stackExchange).not.toContain('Sample data');
  });

  it('includes the selected sources in setup requests and blocks an empty selection', () => {
    const request = buildRequest(EMPTY_FORM, ['hackernews', 'snapshot', 'stackexchange']);
    expect(request).toMatchObject({ params: { sources: ['hackernews', 'snapshot', 'stackexchange'] } });
    expect(buildRequest(EMPTY_FORM, ['hackernews'])).toMatchObject({
      params: { sources: ['hackernews'] },
    });
    expect(buildRequest(EMPTY_FORM, [])).toBeNull();
    const setup = renderToString(<SetupPage />);
    expect(setup).toContain('Labelled test posts written for Vantage. They are not real posts and ignore your keywords.');
    expect(setup).toContain('Sample dataset (synthetic)');
    expect(setup).toContain('Stack Exchange (Software Recommendations and Software Engineering)');
    expect(setup).toContain('Use 2 to 5 short, specific phrases. Long lists dilute the results.');
    expect(setup).toContain('aria-describedby="source-stackexchange-hint" checked=""');
    expect(setup).toContain('Questions across Software Recommendations and Software Engineering.');
    expect(setup).toContain('GitHub Issues');
    expect(setup).toContain('Public issue search. GITHUB_TOKEN is optional and recommended');
    expect(setup).toContain('DEV Community');
    expect(setup).toContain('Unavailable until API use is permitted; its terms prohibit commercial use without permission');
    expect(setup).not.toContain('id="source-github" type="checkbox" checked=""');
    expect(setup).not.toContain('id="source-devto" type="checkbox" checked=""');
  });

  it('uses the explicit synthetic source label', () => {
    expect(SOURCE_LABEL.snapshot).toBe('Sample dataset (synthetic)');
    expect(SOURCE_LABEL.stackexchange).toBe('Stack Exchange');
    expect(SOURCE_LABEL.github).toBe('GitHub Issues');
    expect(SOURCE_LABEL.devto).toBe('DEV Community');
    expect(SOURCE_LABEL.producthunt).toBe('Product Hunt');
  });

  it('shows Stack Exchange attribution in the shared footer', () => {
    const footer = renderToString(<AppFooter />);
    expect(footer).toContain('licensed under applicable CC BY-SA terms');
    expect(footer).toContain('each signal links to its source and shows its author');
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

  it('shows critic verdicts as a separate trust review and expands issues for weak or unsupported results', () => {
    const trace = (verdict: string, issues: string[] = []): DecisionTrace => ({
      model: 'test-model',
      promptVersion: 'critic.v1',
      createdAt: '2026-10-01T00:00:00Z',
      status: 'ok',
      output: { verdict, issues, trustScore: 0.5 },
    });
    expect(renderToString(<CriticTrustReview trace={null} />)).toBe('');
    expect(renderToString(<CriticTrustReview trace={trace('supported')} />)).toContain('Trust review: <!-- -->supported');
    const weak = renderToString(<CriticTrustReview trace={trace('weak', ['The quote does not support urgency.'])} />);
    expect(weak).toContain('Trust review: <!-- -->weak');
    expect(weak).toContain('<details>');
    expect(weak).toContain('The quote does not support urgency.');
    expect(renderToString(<CriticTrustReview trace={trace('unsupported', ['The label is unsupported.'])} />))
      .toContain('Trust review: <!-- -->unsupported');
    expect(renderToString(<CriticTrustReview trace={{ ...trace('supported'), status: 'invalid_output', output: {} }} />))
      .toContain('Trust review unavailable');
  });
});
