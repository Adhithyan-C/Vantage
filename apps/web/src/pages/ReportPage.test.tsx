import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CompetitorGraphView, LeadView, ReportView, ThemeView } from '@vantage/shared';
import { ReportContent } from './ReportPage';

const ranked: LeadView = {
  leadId: 'ranked', signalId: 'signal-ranked', rank: 1, label: 'buyer_intent', score: 63,
  confidence: 1, status: 'new', source: 'hackernews', url: 'https://example.test/post',
  authorHandle: 'writer', community: 'hn', createdAtSource: '2026-10-17T00:00:00Z',
  textPreview: 'I need a better support tool.', rationale: 'The author asks for a support tool.',
  criteria: [{ id: 'asks_for_recommendation', passed: true, quote: 'need a better support tool' }],
  evidenceVerified: true,
  breakdown: { components: [
    { name: 'intent', value: 0.8, weight: 0.4, contribution: 32 },
    { name: 'fit', value: 0.5, weight: 0.25, contribution: 12.5 },
    { name: 'recency', value: 0.6, weight: 0.2, contribution: 12 },
    { name: 'engagement', value: 0.4, weight: 0.15, contribution: 6 },
  ], total: 63 },
  enrichment: {
    ageDays: 1, commentCount: 2, upvotes: 4, source: 'hackernews', community: 'hn',
    competitorsMentioned: ['Zendesk'], purchaseTermsFound: ['recommend'], teamTermsFound: [],
    fit: { competitorMentioned: true, purchaseLanguage: true, teamOrRoleContext: false },
  },
};

const other: LeadView = {
  ...ranked, leadId: 'other', signalId: 'signal-other', rank: 2, label: 'noise', score: 98,
  source: 'snapshot', url: 'sample://signal/other', authorHandle: 'sample-writer',
  rationale: 'An unrelated sample post.', criteria: [], confidence: null,
  enrichment: { ...ranked.enrichment, source: 'snapshot' },
};

function report(signals: LeadView[] = [ranked, other], sampleData = false): ReportView {
  return {
    generatedAt: '2026-10-18T12:00:00Z',
    run: {
      id: '00000000-0000-0000-0000-000000000001', status: 'completed', demo: false,
      params: { keywords: ['support'], sinceDays: 30, maxResults: 50, sources: ['hackernews'] },
      startedAt: '2026-10-18T10:00:00Z', finishedAt: '2026-10-18T10:01:00Z',
      seller: { productName: 'Support app', problemDescription: 'Support workload', idealCustomer: null, competitors: [] },
      sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 1, error: null }], signalCount: signals.length,
    },
    summary: {
      signalsFound: signals.length,
      buyingSignals: signals.filter((signal) => signal.label === 'buyer_intent' || signal.label === 'competitor_complaint').length,
      byLabel: {
        buyer_intent: signals.filter((signal) => signal.label === 'buyer_intent').length,
        competitor_complaint: signals.filter((signal) => signal.label === 'competitor_complaint').length,
        venting: signals.filter((signal) => signal.label === 'venting').length,
        noise: signals.filter((signal) => signal.label === 'noise').length,
      },
      bySource: Object.fromEntries([...new Set(signals.map((signal) => signal.source))].map((source) => [source, signals.filter((item) => item.source === source).length])),
      sampleData,
    },
    sources: [],
    method: { weights: { intent: 0.4, fit: 0.25, recency: 0.2, engagement: 0.15 }, recencyHalfLifeDays: 30, promptVersion: 'classifier.v2' },
    signals,
  };
}

describe('report page rendering', () => {
  const theme: ThemeView = { id: 'theme', runId: '00000000-0000-0000-0000-000000000001', competitor: 'Acme', title: 'Acme: slow search', summary: '3 signals', quotes: [], members: [], sampleData: false };
  const graph: CompetitorGraphView = { nodes: [{ competitor: 'Acme', mentionCount: 2 }, { competitor: 'Beacon', mentionCount: 1 }], edges: [{ a: 'Acme', b: 'Beacon', weight: 1 }], signalCount: 2, sampleData: false };

  it('places competitor themes between ranked and other signals and hides an empty section', () => {
    const html = renderToString(<ReportContent report={report()} themes={[theme]} />);
    expect(html.indexOf('Ranked signals')).toBeLessThan(html.indexOf('Competitor themes'));
    expect(html.indexOf('Competitor themes')).toBeLessThan(html.indexOf('Other signals'));
    expect(html).toContain('Acme: slow search');
    expect(renderToString(<ReportContent report={report()} themes={[]} />)).not.toContain('Competitor themes');
  });

  it('keeps a theme loading error inline while rendering the rest of the report', () => {
    const html = renderToString(<ReportContent report={report()} themesError="Themes unavailable" retryThemes={() => {}} />);
    expect(html).toContain('Themes unavailable');
    expect(html).toContain('Ranked signals');
    expect(html).toContain('Other signals');
  });

  it('shows competitor co-mentions after themes and keeps graph errors inline', () => {
    const html = renderToString(<ReportContent report={report()} themes={[theme]} competitorGraph={graph} />);
    expect(html.indexOf('Competitor themes')).toBeLessThan(html.indexOf('Competitor co-mentions'));
    expect(html).toContain('Acme<!-- --> + <!-- -->Beacon');
    const failed = renderToString(<ReportContent report={report()} competitorGraphError="Graph offline" retryCompetitorGraph={() => {}} />);
    expect(failed).toContain('Graph offline');
    expect(failed).toContain('Ranked signals');
  });
  it('shows the sample data banner only when the report includes sample data', () => {
    const withSample = renderToString(<ReportContent report={report([ranked, other], true)} />);
    const liveOnly = renderToString(<ReportContent report={report([ranked], false)} />);
    expect(withSample).toContain('This report includes synthetic sample data written for testing.');
    expect(liveOnly).not.toContain('This report includes synthetic sample data written for testing.');
  });

  it('renders ranked evidence and score details', () => {
    const html = renderToString(<ReportContent report={report([ranked])} />);
    expect(html).toContain('Ranked signals');
    expect(html).toContain('need a better support tool');
    expect(html).toContain('Score');
    expect(html).toContain('63');
    expect(html).toContain('Quotes verified');
  });

  it('renders other signals as not ranked without showing their score', () => {
    const html = renderToString(<ReportContent report={report([other], true)} />);
    expect(html).toContain('Not ranked');
    expect(html).not.toContain('98');
    expect(html).toContain('Sample dataset (synthetic)');
    expect(html).toContain('Sample data');
  });

  it('shows the empty state when no ranked signals exist', () => {
    const html = renderToString(<ReportContent report={report([other])} />);
    expect(html).toContain('No buying signals in this run');
    expect(html).toContain('classified as venting or noise');
  });

  it('renders failed source counts and sanitized errors in Data sources', () => {
    const model = report([ranked]);
    model.sources = [{ source: 'hackernews', requestsOk: 1, requestsFailed: 1, itemsReturned: 4, signalsKept: 2, errors: ['Request failed'] }];
    const html = renderToString(<ReportContent report={model} />);
    expect(html).toContain('Data sources');
    expect(html).toContain('Requests failed');
    expect(html).toContain('Request failed');
    expect(html.toLowerCase()).not.toContain('lead');
  });

  it('shows download and print controls and uses no contact-oriented wording', () => {
    const html = renderToString(<ReportContent report={report()} />);
    expect(html).toContain('Download CSV');
    expect(html).toContain('Download CSV with all signals');
    expect(html).toContain('Print or save as PDF');
    expect(html).toContain('Back to signals');
    expect(html).toContain('Buying-intent signals are listed before competitor complaints; within each group, signals are ordered by score.');
    expect(html.toLowerCase()).not.toContain('lead');
  });
});
