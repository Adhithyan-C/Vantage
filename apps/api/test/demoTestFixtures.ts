import type { LeadDetail, LeadView, RunEvent, RunView } from '@vantage/shared';

export const RUN_ID = '00000000-0000-4000-8000-000000000001';
export const LEAD_ID = '00000000-0000-4000-8000-000000000002';
export const startedAt = '2026-10-18T10:00:00.000Z';

export const run: RunView = {
  id: RUN_ID,
  status: 'completed',
  demo: false,
  params: { keywords: ['support'], sinceDays: 30, maxResults: 10, sources: ['hackernews'] },
  startedAt,
  finishedAt: '2026-10-18T10:00:03.000Z',
  seller: { productName: 'Support app', problemDescription: 'Support workload', idealCustomer: null, competitors: [] },
  sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 1, error: null }],
  signalCount: 1,
};

export const lead: LeadView = {
  leadId: LEAD_ID,
  signalId: 'signal-1',
  rank: 1,
  label: 'buyer_intent',
  score: 70,
  confidence: 1,
  status: 'new',
  source: 'hackernews',
  url: 'https://example.test/post',
  authorHandle: 'writer',
  community: null,
  createdAtSource: startedAt,
  textPreview: 'Need a support tool',
  rationale: 'The author seeks a tool.',
  criteria: [{ id: 'asks_for_recommendation', passed: true, quote: 'Need a support tool' }],
  evidenceVerified: true,
  breakdown: { components: [{ name: 'intent', value: 1, weight: 1, contribution: 70 }], total: 70 },
  enrichment: {
    ageDays: 1, commentCount: 0, upvotes: 0, source: 'hackernews', community: null,
    competitorsMentioned: [], purchaseTermsFound: [], teamTermsFound: [],
    fit: { competitorMentioned: false, purchaseLanguage: true, teamOrRoleContext: false },
  },
};

export const detail: LeadDetail = {
  lead,
  runId: RUN_ID,
  text: 'Need a support tool',
  evidence: [{ criterion: 'asks_for_recommendation', quote: 'Need a support tool', start: 0, end: 20 }],
  discardedQuotes: 0,
  trace: { model: null, promptVersion: null, createdAt: startedAt, status: 'ok', output: {} },
};

export const events: RunEvent[] = [
  { id: 2, runId: RUN_ID, agent: 'classifier', kind: 'info', message: 'second', counts: null, createdAt: '2026-10-18T10:00:02.000Z' },
  { id: 1, runId: RUN_ID, agent: 'scout', kind: 'progress', message: 'first', counts: { total: 1 }, createdAt: '2026-10-18T10:00:01.000Z' },
];

export function fixture() {
  return {
    version: 1,
    recordedAt: '2026-10-19T00:00:00.000Z',
    note: 'Recorded from run 00000000',
    run,
    events: events.map((event) => ({ ...event, offsetMs: Date.parse(event.createdAt) - Date.parse(startedAt) })),
    leads: [lead],
    details: { [LEAD_ID]: detail },
  };
}
