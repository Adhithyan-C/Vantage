import { describe, expect, it } from 'vitest';
import type {
  AgentId,
  EventKind,
  RawSignal,
  RunEvent,
  RunParams,
  RunStatus,
  RunView,
  SellerProfileInput,
  SourceId,
} from '@vantage/shared';
import type { ClassifySummary } from '../src/agents/classifier';
import type { ScoreStage } from '../src/agents/scorer';
import type { PipelineDeps } from '../src/orchestrator/runPipeline';
import { runPipeline } from '../src/orchestrator/runPipeline';
import type { RunStore, SourcePatch } from '../src/db/runs';
import type { AdapterContext, SourceAdapter } from '../src/sources/types';

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const params: RunParams = { keywords: ['support'], sinceDays: 30, maxResults: 10 };
const signal: RawSignal = {
  source: 'hackernews',
  externalId: 'one',
  authorHandle: 'author',
  url: 'https://example.test/post',
  text: 'A support workflow problem.',
  createdAt: '2026-10-01T00:00:00Z',
  engagement: { score: 2, comments: 1 },
};

class PipelineStore implements RunStore {
  statusCalls: RunStatus[] = [];
  events: Array<{ agent: AgentId; kind: EventKind; message: string; counts?: Record<string, unknown> }> = [];

  async createSellerProfile(_input: SellerProfileInput): Promise<string> { return 'seller'; }
  async createRun(_sellerProfileId: string, _params: RunParams): Promise<string> { return RUN_ID; }
  async getRun(_runId: string): Promise<RunView | null> { return null; }
  async listEvents(_runId: string, _afterId: number): Promise<RunEvent[]> { return []; }
  async saveSourceRequests() {}
  async listSourceRequests() { return []; }
  async setRunStatus(_runId: string, status: RunStatus, _finished: boolean): Promise<void> {
    this.statusCalls.push(status);
  }
  async upsertRunSource(_runId: string, _source: SourceId, _patch: SourcePatch): Promise<void> {}
  async addEvent(
    _runId: string,
    agent: AgentId,
    kind: EventKind,
    message: string,
    counts?: Record<string, unknown>,
  ): Promise<void> {
    this.events.push({ agent, kind, message, counts });
  }
  async storeSignals(_runId: string, _signals: RawSignal[]): Promise<{ inserted: number; updated: number }> {
    return { inserted: 1, updated: 0 };
  }
  async failStaleRuns(): Promise<number> { return 0; }
}

const context: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date('2026-10-08T00:00:00Z'),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};

const adapter: SourceAdapter = {
  id: 'hackernews',
  search: async () => ({ signals: [signal], status: 'ok' }),
};

function summary(overrides: Partial<ClassifySummary> = {}): ClassifySummary {
  return {
    total: 3,
    classified: 2,
    reused: 1,
    failed: 0,
    labels: { buyer_intent: 2, competitor_complaint: 0, venting: 0, noise: 0 },
    verifiedQuotes: 2,
    droppedQuotes: 0,
    capped: false,
    failureReasons: {},
    ...overrides,
  };
}

async function execute(store: PipelineStore, deps: Partial<PipelineDeps> = {}): Promise<void> {
  const fullDeps: PipelineDeps = {
    store,
    adapters: [adapter],
    ctx: context,
    ...deps,
  };
  await runPipeline(fullDeps, RUN_ID, params);
}

describe('runPipeline scoring integration', () => {
  it('emits the exact enricher and scorer progress/info events in order', async () => {
    const store = new PipelineStore();
    let scoredRun = '';
    const score: ScoreStage = async (runId) => {
      scoredRun = runId;
      return { scored: 3, ranked: 2, topScore: 81 };
    };
    await execute(store, { classify: async () => summary(), score });
    expect(scoredRun).toBe(RUN_ID);
    expect(store.events.filter((event) => event.agent === 'enricher' || event.agent === 'scorer'))
      .toEqual([
        { agent: 'enricher', kind: 'progress', message: 'Enriching 2 classified signal(s)', counts: { total: 2 } },
        { agent: 'enricher', kind: 'info', message: 'Enriched 3 signal(s)', counts: { enriched: 3 } },
        { agent: 'scorer', kind: 'progress', message: 'Scoring 3 signal(s)', counts: { total: 3 } },
        { agent: 'scorer', kind: 'info', message: 'Scored 3 signal(s): 2 in the ranked list', counts: { scored: 3, ranked: 2, topScore: 81 } },
      ]);
    expect(store.statusCalls.at(-1)).toBe('completed');
  });

  it('uses classified alone for enricher progress when some classifications were reused', async () => {
    const store = new PipelineStore();
    await execute(store, {
      classify: async () => summary({ classified: 2, reused: 1 }),
      score: async () => ({ scored: 2, ranked: 1, topScore: 81 }),
    });
    expect(store.events.find((event) => event.agent === 'enricher' && event.kind === 'progress'))
      .toMatchObject({
        message: 'Enriching 2 classified signal(s)',
        counts: { total: 2 },
      });
  });

  it('emits a scorer error on failure and completes with warnings', async () => {
    const store = new PipelineStore();
    const score: ScoreStage = async () => { throw new Error('score store unavailable'); };
    await execute(store, { classify: async () => summary(), score });
    expect(store.events.find((event) => event.agent === 'scorer' && event.kind === 'error')).toMatchObject({
      agent: 'scorer',
      kind: 'error',
      message: 'Scoring failed: score store unavailable',
    });
    expect(store.statusCalls.at(-1)).toBe('completed_with_warnings');
  });

  it('reports when no signals qualify without changing a healthy run status', async () => {
    const store = new PipelineStore();
    const score: ScoreStage = async () => ({ scored: 2, ranked: 0, topScore: null });
    await execute(store, { classify: async () => summary(), score });
    expect(store.events.find((event) => event.agent === 'scorer' && event.message === 'No buyer intent or competitor complaint signals in this run')).toMatchObject({
      agent: 'scorer',
      kind: 'info',
      message: 'No buyer intent or competitor complaint signals in this run',
    });
    expect(store.statusCalls.at(-1)).toBe('completed');
  });

  it('skips scoring when classification did not run or has no classified items', async () => {
    const skippedStore = new PipelineStore();
    await execute(skippedStore, { score: async () => ({ scored: 1, ranked: 1, topScore: 50 }) });
    expect(skippedStore.events.some((event) => event.agent === 'scorer')).toBe(false);

    const emptyStore = new PipelineStore();
    await execute(emptyStore, {
      classify: async () => summary({ classified: 0, reused: 0 }),
      score: async () => ({ scored: 1, ranked: 1, topScore: 50 }),
    });
    expect(emptyStore.events.some((event) => event.agent === 'scorer')).toBe(false);
  });
});
