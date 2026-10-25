import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type {
  LeadDetail,
  LeadView,
  RunEvent,
  RunParams,
  RunStatus,
  RunView,
  SellerProfileInput,
  SourceId,
  SourceRequestView,
} from '@vantage/shared';
import type { RunStore, SourcePatch } from '../src/db/runs';
import type { LeadStore } from '../src/db/leads';
import { buildReportCsv, toCsv } from '../src/report/csv';
import { createReportRouter } from '../src/routes/report';

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const ranked: LeadView = {
  leadId: 'ranked-id', signalId: 'ranked-signal', rank: 1, label: 'buyer_intent', score: 71,
  confidence: 0.8, status: 'new', source: 'hackernews', url: 'https://example.test/post',
  authorHandle: 'writer', community: 'hn', createdAtSource: '2026-10-01T00:00:00Z',
  textPreview: '=formula preview', rationale: 'Asks for a recommendation.',
  criteria: [{ id: 'asks_for_recommendation', passed: true, quote: 'asks for a tool' }],
  evidenceVerified: true,
  breakdown: { components: [
    { name: 'intent', value: 0.8, weight: 0.4, contribution: 32 },
    { name: 'fit', value: 0.5, weight: 0.25, contribution: 12.5 },
    { name: 'recency', value: 0.6, weight: 0.2, contribution: 12 },
    { name: 'engagement', value: 0.4, weight: 0.15, contribution: 6 },
  ], total: 71 },
  enrichment: {
    ageDays: 2, commentCount: 3, upvotes: 5, source: 'hackernews', community: 'hn',
    competitorsMentioned: ['Zendesk'], purchaseTermsFound: ['recommendation'], teamTermsFound: ['our team'],
    fit: { competitorMentioned: true, purchaseLanguage: true, teamOrRoleContext: true },
  },
};
const sample: LeadView = {
  ...ranked,
  leadId: 'sample-id', signalId: 'sample-signal', rank: 2, label: 'noise', score: 9,
  source: 'snapshot', url: 'sample://signal/sample', confidence: null,
  textPreview: '=sample preview', criteria: [],
  enrichment: { ...ranked.enrichment, source: 'snapshot' },
};
const run: RunView = {
  id: RUN_ID, status: 'completed', demo: false,
  params: { keywords: ['support', 'helpdesk'], sinceDays: 30, maxResults: 50, sources: ['hackernews'] },
  startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:01:00Z',
  seller: { productName: 'Support tool', problemDescription: 'Support issues', idealCustomer: null, competitors: [] },
  sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 2, error: null }], signalCount: 2,
};

function createStores(options: { run?: RunView | null; signals?: LeadView[]; requests?: SourceRequestView[] } = {}) {
  const currentRun = options.run === undefined ? run : options.run;
  const signals = options.signals ?? [ranked, sample];
  const runStore: RunStore = {
    async createSellerProfile(_input: SellerProfileInput) { return 'seller'; },
    async createRun(_sellerProfileId: string, _params: RunParams) { return RUN_ID; },
    async getRun(_runId: string) { return currentRun; },
    async listEvents(_runId: string, _afterId: number): Promise<RunEvent[]> { return []; },
    async saveSourceRequests() {},
    async listSourceRequests() { return options.requests ?? []; },
    async setRunStatus(_runId: string, _status: RunStatus, _finished: boolean) {},
    async upsertRunSource(_runId: string, _source: SourceId, _patch: SourcePatch) {},
    async addEvent(_runId: string) {},
    async storeSignals(_runId: string) { return { inserted: 0, updated: 0 }; },
    async failStaleRuns() { return 0; },
  };
  const calls: boolean[] = [];
  const leadStore: LeadStore = {
    async getScoringContext() { return { seller: { productName: 'Support', problemDescription: 'Tickets', competitors: [] }, items: [] }; },
    async saveLeads() {},
    async listLeads(_runId: string, includeAll: boolean) { calls.push(includeAll); return signals; },
    async getLeadDetail(_leadId: string): Promise<LeadDetail | null> { return null; },
    async setLeadStatus() { return true; },
    async addFeedback() {},
  };
  return { runStore, leadStore, calls };
}

function reportFixture(signals: LeadView[] = [ranked, sample], sampleData = false) {
  return {
    generatedAt: '2026-10-18T12:00:00Z', run,
    summary: {
      signalsFound: signals.length,
      buyingSignals: signals.filter((signal) => signal.label === 'buyer_intent' || signal.label === 'competitor_complaint').length,
      byLabel: {
        buyer_intent: signals.filter((signal) => signal.label === 'buyer_intent').length,
        competitor_complaint: signals.filter((signal) => signal.label === 'competitor_complaint').length,
        venting: signals.filter((signal) => signal.label === 'venting').length,
        noise: signals.filter((signal) => signal.label === 'noise').length,
      },
      bySource: Object.fromEntries([...new Set(signals.map((signal) => signal.source))].map((source) => [source, signals.filter((signal) => signal.source === source).length])),
      sampleData,
    },
    sources: [],
    method: { weights: { intent: 0.4, fit: 0.25, recency: 0.2, engagement: 0.15 }, recencyHalfLifeDays: 30, promptVersion: 'classifier.v2' },
    signals,
  };
}

describe('CSV report export', () => {
  it('quotes delimiters, doubles quotes, uses CRLF, and starts with a BOM', () => {
    expect(toCsv([['comma, value', 'say "hi"', 'two\nlines'], ['next', null, 3]])).toBe(
      '\uFEFF"comma, value","say ""hi""","two\nlines"\r\nnext,,3',
    );
  });

  it('neutralizes formula-leading strings without changing numbers or embedded equals signs', () => {
    const csv = toCsv([['=a', '+b', '-c', '@d', '\tvalue', '\rvalue', 7, null, 'inside=value']]);
    expect(csv).toBe("\uFEFF'=a,'+b,'-c,'@d,'\tvalue,\"'\rvalue\",7,,inside=value");
  });

  it('uses the exact header and includes only ranked labels by default', () => {
    const csv = buildReportCsv(reportFixture(), false);
    expect(csv.slice(1).split('\r\n')[0]).toBe('rank,label,score,confidence_percent,status,source,community,author,posted_at,age_days,link,summary,evidence_quotes,criteria_passed,competitors_mentioned,purchase_terms,team_terms,comments,upvotes,data_origin,post_preview');
    expect(csv).toContain('buyer_intent');
    expect(csv).not.toContain('noise');
    expect(csv).toContain("'=formula preview");
  });

  it('adds unranked sample rows with empty rank values, no link, and joined evidence fields', () => {
    const csv = buildReportCsv(reportFixture(), true);
    expect(csv).toContain('asks for a tool,asks_for_recommendation,Zendesk,recommendation,our team');
    expect(csv).toContain(',noise,,,new,snapshot,hn,writer');
    expect(csv).toContain('sample (synthetic)');
    expect(csv).toContain("sample (synthetic),'=sample preview");
    expect(csv).not.toContain('sample://signal/sample');
    expect(csv).toContain('71,80,new,hackernews,hn,writer');
  });
});

async function invoke(
  path: string,
  params: Record<string, string>,
  query: Record<string, unknown> = {},
  options: { run?: RunView | null; signals?: LeadView[]; requests?: SourceRequestView[] } = {},
) {
  const stores = createStores(options);
  const router = createReportRouter(stores);
  const handler = router.stack.find((layer) => layer.route?.path === path)?.route?.stack[0]?.handle;
  if (!handler) throw new Error(`Missing handler for ${path}`);
  let statusCode = 0;
  let body: unknown;
  const headers: Record<string, string> = {};
  const req = { params, query } as unknown as Request;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
    set(name: string, value: string) { headers[name] = value; return this; },
    send(value: unknown) { body = value; return this; },
  } as unknown as Response;
  await handler(req, res, () => {});
  return { statusCode, body, headers, calls: stores.calls };
}

describe('report routes', () => {
  it('validates run ids and CSV include values', async () => {
    expect(await invoke('/runs/:runId/report.json', { runId: 'bad' })).toMatchObject({ statusCode: 400, body: { error: 'Invalid run id' } });
    expect(await invoke('/runs/:runId/report.csv', { runId: RUN_ID }, { include: 'foo' })).toMatchObject({ statusCode: 400, body: { error: 'Invalid include' } });
  });

  it('returns not found and running responses', async () => {
    expect(await invoke('/runs/:runId/report.json', { runId: RUN_ID }, {}, { run: null })).toMatchObject({ statusCode: 404, body: { error: 'Run not found' } });
    expect(await invoke('/runs/:runId/report.csv', { runId: RUN_ID }, {}, { run: { ...run, status: 'running' } })).toMatchObject({ statusCode: 409, body: { error: 'Run is still running' } });
  });

  it('returns the JSON report with method and sample summaries', async () => {
    const normal = await invoke('/runs/:runId/report.json', { runId: RUN_ID });
    expect(normal.statusCode).toBe(200);
    expect(normal.body).toMatchObject({
      run, summary: { signalsFound: 2, buyingSignals: 1, sampleData: true },
      method: { weights: { intent: 0.4, fit: 0.25, recency: 0.2, engagement: 0.15 }, recencyHalfLifeDays: 30, promptVersion: 'classifier.v2' },
      signals: [ranked, sample],
    });
    expect(normal.calls).toEqual([true]);
    const live = await invoke('/runs/:runId/report.json', { runId: RUN_ID }, {}, { signals: [ranked] });
    expect(live.body).toMatchObject({ summary: { sampleData: false } });
  });

  it('summarizes source requests, kept signals, errors and signal counts by source', async () => {
    const result = await invoke('/runs/:runId/report.json', { runId: RUN_ID }, {}, {
      signals: [ranked, sample],
      requests: [
        { id: 1, source: 'hackernews', label: 'support', status: 'ok', httpStatus: 200, durationMs: 20, itemsReturned: 2, error: null, quotaRemaining: null, createdAt: '2026-10-01T00:00:00Z' },
        { id: 2, source: 'stackexchange', label: 'softwarerecs: support', status: 'failed', httpStatus: 502, durationMs: 30, itemsReturned: 0, error: 'request failed', quotaRemaining: 90, createdAt: '2026-10-01T00:00:01Z' },
      ],
    });
    expect(result.body).toMatchObject({
      summary: { bySource: { hackernews: 1, snapshot: 1 } },
      sources: [
        { source: 'hackernews', requestsOk: 1, requestsFailed: 0, itemsReturned: 2, signalsKept: 1, errors: [] },
        { source: 'stackexchange', requestsOk: 0, requestsFailed: 1, itemsReturned: 0, signalsKept: 0, errors: ['request failed'] },
        { source: 'snapshot', requestsOk: 0, requestsFailed: 0, itemsReturned: 0, signalsKept: 1, errors: [] },
      ],
    });
  });

  it('returns CSV headers and uses include=all to include unranked signals', async () => {
    const result = await invoke('/runs/:runId/report.csv', { runId: RUN_ID }, { include: 'all' });
    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="vantage-report-00000000.csv"',
    });
    expect(result.body).toContain('noise');
    expect(result.calls).toEqual([true]);
  });
});

describe('competitor graph route', () => {
  it('returns 400, 404, 409 and the computed graph for valid completed runs', async () => {
    const path = '/runs/:runId/competitor-graph';
    expect(await invoke(path, { runId: 'bad' })).toMatchObject({ statusCode: 400, body: { error: 'Invalid run id' } });
    expect(await invoke(path, { runId: RUN_ID }, {}, { run: null })).toMatchObject({ statusCode: 404, body: { error: 'Run not found' } });
    expect(await invoke(path, { runId: RUN_ID }, {}, { run: { ...run, status: 'running' } })).toMatchObject({ statusCode: 409, body: { error: 'Run is still running' } });
    expect(await invoke(path, { runId: RUN_ID }, {}, { signals: [ranked, { ...ranked, label: 'competitor_complaint', leadId: 'other', enrichment: { ...ranked.enrichment, competitorsMentioned: ['Zendesk', 'Acme'] } }] })).toMatchObject({
      statusCode: 200,
      body: { graph: { signalCount: 2, nodes: [{ competitor: 'Zendesk', mentionCount: 2 }, { competitor: 'Acme', mentionCount: 1 }], edges: [{ a: 'Acme', b: 'Zendesk', weight: 1 }], sampleData: false } },
    });
  });
});
