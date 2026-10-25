import { describe, expect, it } from 'vitest';
import type { AgentId, EventKind, RawSignal, RunParams, RunStatus, SourceId } from '@vantage/shared';
import type { PipelineDeps } from '../src/orchestrator/runPipeline';
import { runPipeline } from '../src/orchestrator/runPipeline';
import type { RunStore, SourcePatch } from '../src/db/runs';
import type { ClassifySummary } from '../src/agents/classifier';
import type { AdapterContext, AdapterResult, SourceAdapter } from '../src/sources/types';

const params: RunParams = { keywords: ['support tool'], sinceDays: 30, maxResults: 20 };
const signal: RawSignal = {
  source: 'hackernews',
  externalId: 'one',
  authorHandle: 'author',
  url: 'https://example.test/one',
  text: 'This is a sufficiently long signal about customer support tools.',
  createdAt: '2026-10-01T00:00:00Z',
  engagement: {},
};
const context: AdapterContext = {
  fetch: fetch,
  now: () => new Date('2026-10-08T00:00:00Z'),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};

class PipelineStore implements RunStore {
  events: Array<{ agent: AgentId; kind: EventKind; message: string; counts?: Record<string, unknown> }> = [];
  statuses: RunStatus[] = [];
  async createSellerProfile(): Promise<string> { return 'unused'; }
  async createRun(): Promise<string> { return 'unused'; }
  async getRun() { return null; }
  async listEvents() { return []; }
  async saveSourceRequests() {}
  async listSourceRequests() { return []; }
  async failStaleRuns() { return 0; }
  async setRunStatus(_runId: string, status: RunStatus): Promise<void> { this.statuses.push(status); }
  async upsertRunSource(_runId: string, _source: SourceId, _patch: SourcePatch): Promise<void> {}
  async addEvent(_runId: string, agent: AgentId, kind: EventKind, message: string, counts?: Record<string, unknown>): Promise<void> {
    this.events.push({ agent, kind, message, counts });
  }
  async storeSignals(): Promise<{ inserted: number; updated: number }> { return { inserted: 1, updated: 0 }; }
}

const summary: ClassifySummary = {
  total: 1,
  classified: 1,
  reused: 0,
  failed: 0,
  labels: { buyer_intent: 1, competitor_complaint: 0, venting: 0, noise: 0 },
  verifiedQuotes: 1,
  droppedQuotes: 0,
  capped: false,
  failureReasons: {},
  failureCategories: {},
};

function deps(store: PipelineStore, classify?: PipelineDeps['classify'], result: AdapterResult = { signals: [signal], status: 'ok' }): PipelineDeps {
  const adapter: SourceAdapter = { id: 'hackernews', search: async () => result };
  return { store, adapters: [adapter], ctx: context, classify };
}

describe('runPipeline classifier integration', () => {
  it('emits classifier events in the required order and preserves the completion status', async () => {
    const store = new PipelineStore();
    await runPipeline(deps(store, async (_runId, onProgress) => {
      await onProgress?.(10, 10);
      return summary;
    }), 'run-1', params);
    const classifierEvents = store.events.filter((event) => event.agent === 'classifier');
    expect(classifierEvents).toEqual([
      { agent: 'classifier', kind: 'progress', message: 'Classifying 1 signal(s)', counts: { total: 1 } },
      { agent: 'classifier', kind: 'progress', message: 'Classified 10 of 10', counts: undefined },
      {
        agent: 'classifier',
        kind: 'info',
        message: 'Classified 1 signal(s): 1 buyer intent, 0 competitor complaint, 0 venting, 0 noise',
        counts: {
          classified: 1,
          reused: 0,
          failed: 0,
          buyer_intent: 1,
          competitor_complaint: 0,
          venting: 0,
          noise: 0,
          verifiedQuotes: 1,
          droppedQuotes: 0,
          failureReasons: {},
          failureCategories: {},
        },
      },
    ]);
    expect(store.events.at(-1)?.message).toBe('Run completed');
    expect(store.statuses).toEqual(['completed']);
  });

  it('marks a successful-source run completed with warnings when classification has failures', async () => {
    const store = new PipelineStore();
    await runPipeline(deps(store, async () => ({
      ...summary,
      failed: 2,
      failureReasons: { 'groq:429': 2, 'gemini:none': 1 },
      failureCategories: { 'rate limited': 2 },
    })), 'run-1', params);
    expect(store.events.some((event) => event.message === '2 failed: 2 rate limited')).toBe(true);
    expect(store.events.find((event) => event.agent === 'classifier' && event.kind === 'info')?.counts)
      .toMatchObject({ failureReasons: { 'groq:429': 2, 'gemini:none': 1 } });
    expect(store.statuses).toEqual(['completed_with_warnings']);
  });

  it('marks a successful-source run completed with warnings when the stage throws', async () => {
    const store = new PipelineStore();
    await runPipeline(deps(store, async () => { throw new Error('stage unavailable'); }), 'run-1', params);
    expect(store.events.some((event) => event.message === 'Classification failed: stage unavailable')).toBe(true);
    expect(store.statuses).toEqual(['completed_with_warnings']);
  });

  it('skips classification when Scout returns no signals', async () => {
    const store = new PipelineStore();
    let called = false;
    await runPipeline(deps(store, async () => {
      called = true;
      return summary;
    }, { signals: [], status: 'ok' }), 'run-1', params);
    expect(called).toBe(false);
    expect(store.events.some((event) => event.agent === 'classifier')).toBe(false);
  });

  it.each([
    ['gemini:404', 'provider unavailable'],
    ['groq:none', 'provider unavailable'],
    ['none:none', 'provider unavailable'],
  ])('formats the failure reason %s', async (key, expected) => {
    const store = new PipelineStore();
    await runPipeline(deps(store, async () => ({
      ...summary,
      failed: 1,
      failureReasons: { [key]: 1 },
      failureCategories: { [expected]: 1 },
    })), 'run-1', params);
    expect(store.events.some((event) => event.message === `1 failed: 1 ${expected}`)).toBe(true);
  });

  it('keeps grouped failure details in the classifier warning', async () => {
    const store = new PipelineStore();
    await runPipeline(deps(store, async () => ({
      ...summary,
      failed: 1,
      failureReasons: { 'groq:429': 1, 'gemini:404': 1 },
      failureCategories: { 'rate limited': 1 },
    })), 'run-1', params);
    expect(store.events.some((event) => event.message === '1 failed: 1 rate limited')).toBe(true);
  });
});
