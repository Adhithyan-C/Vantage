import { describe, it, expect, vi } from 'vitest';
import { runPipeline, computeRunStatus } from '../src/orchestrator/runPipeline';
import type { PipelineDeps } from '../src/orchestrator/runPipeline';
import type { SourceAdapter, AdapterContext, AdapterResult } from '../src/sources/types';
import type { RunStore, SourcePatch } from '../src/db/runs';
import type {
  RawSignal,
  RequestRecord,
  RunParams,
  RunStatus,
  SourceStatus,
  SourceId,
  AgentId,
  EventKind,
  SellerProfileInput,
  RunView,
  RunEvent,
} from '@vantage/shared';

interface RecordedEvent {
  agent: AgentId;
  kind: EventKind;
  message: string;
  counts?: Record<string, unknown>;
}

class FakeStore implements RunStore {
  statusCalls: Array<{ runId: string; status: RunStatus; finished: boolean }> = [];
  sourceCalls: Array<{ runId: string; source: SourceId; patch: SourcePatch }> = [];
  events: RecordedEvent[] = [];
  storeSignalsCalls: Array<{ runId: string; signals: RawSignal[] }> = [];
  storeSignalsResult: { inserted: number; updated: number } = { inserted: 0, updated: 0 };
  storeSignalsError: Error | null = null;
  requestRecords: RequestRecord[] = [];
  saveSourceRequestsError: Error | null = null;
  addEventError: Error | null = null;

  async createSellerProfile(_input: SellerProfileInput): Promise<string> {
    throw new Error('not used');
  }

  async createRun(_sellerProfileId: string, _params: RunParams): Promise<string> {
    throw new Error('not used');
  }

  async getRun(_runId: string): Promise<RunView | null> {
    throw new Error('not used');
  }

  async listEvents(_runId: string, _afterId: number): Promise<RunEvent[]> {
    throw new Error('not used');
  }

  async saveSourceRequests(_runId: string, records: RequestRecord[]): Promise<void> {
    this.requestRecords = records;
    if (this.saveSourceRequestsError) throw this.saveSourceRequestsError;
  }

  async listSourceRequests() { return []; }

  async failStaleRuns(): Promise<number> {
    throw new Error('not used');
  }

  async setRunStatus(runId: string, status: RunStatus, finished: boolean): Promise<void> {
    this.statusCalls.push({ runId, status, finished });
  }

  async upsertRunSource(runId: string, source: SourceId, patch: SourcePatch): Promise<void> {
    this.sourceCalls.push({ runId, source, patch });
  }

  async addEvent(
    _runId: string,
    agent: AgentId,
    kind: EventKind,
    message: string,
    counts?: Record<string, unknown>,
  ): Promise<void> {
    if (this.addEventError) {
      throw this.addEventError;
    }
    this.events.push({ agent, kind, message, counts });
  }

  async storeSignals(
    runId: string,
    signals: RawSignal[],
  ): Promise<{ inserted: number; updated: number }> {
    this.storeSignalsCalls.push({ runId, signals });
    if (this.storeSignalsError) {
      throw this.storeSignalsError;
    }
    return this.storeSignalsResult;
  }
}

const RUN_ID = '00000000-0000-0000-0000-000000000001';

const params: RunParams = {
  keywords: ['zendesk alternative'],
  sinceDays: 30,
  maxResults: 50,
};

const ctx: AdapterContext = {
  fetch: vi.fn() as unknown as typeof fetch,
  now: () => new Date('2026-10-08T00:00:00Z'),
  userAgent: 'test',
  timeoutMs: 1000,
  maxRetries: 0,
};

function makeSignal(n: number): RawSignal {
  return {
    source: 'hackernews',
    externalId: `id-${n}`,
    authorHandle: `user${n}`,
    url: `https://news.ycombinator.com/item?id=${n}`,
    text: `This is test signal number ${n} about a customer support tooling problem.`,
    createdAt: '2026-10-01T00:00:00Z',
    engagement: { score: 1, comments: 0 },
  };
}

function fakeAdapter(id: SourceId, result: AdapterResult): SourceAdapter {
  return {
    id,
    search: async () => result,
  };
}

async function run(
  store: FakeStore,
  adapters: SourceAdapter[],
  runParams: RunParams = params,
): Promise<void> {
  const deps: PipelineDeps = { store, adapters, ctx };
  await runPipeline(deps, RUN_ID, runParams);
}

function recordingAdapter(id: SourceId, searched: SourceId[]): SourceAdapter {
  return {
    id,
    async search() {
      searched.push(id);
      return { signals: [], status: 'ok' };
    },
  };
}

describe('runPipeline', () => {
  it('excludes the snapshot adapter when source selection is omitted', async () => {
    const store = new FakeStore();
    const searched: SourceId[] = [];
    await run(store, [recordingAdapter('hackernews', searched), recordingAdapter('snapshot', searched)]);
    expect(searched).toEqual(['hackernews']);
    expect(new Set(store.sourceCalls.map((call) => call.source))).toEqual(new Set(['hackernews']));
  });

  it('includes Stack Exchange by default while still excluding the snapshot adapter', async () => {
    const store = new FakeStore();
    const searched: SourceId[] = [];
    await run(store, [
      recordingAdapter('hackernews', searched),
      recordingAdapter('snapshot', searched),
      recordingAdapter('stackexchange', searched),
    ]);
    expect(searched).toEqual(['hackernews', 'stackexchange']);
  });

  it.each([
    [['snapshot'], ['snapshot']],
    [['hackernews', 'snapshot'], ['hackernews', 'snapshot']],
  ] as const)('runs only the selected adapters %j', async (sources, expected) => {
    const store = new FakeStore();
    const searched: SourceId[] = [];
    await run(
      store,
      [recordingAdapter('hackernews', searched), recordingAdapter('snapshot', searched)],
      { ...params, sources: [...sources] },
    );
    expect(searched).toEqual(expected);
  });

  it('uses the no-sources path when selected sources have no available adapter', async () => {
    const store = new FakeStore();
    await run(store, [fakeAdapter('hackernews', { signals: [], status: 'ok' })], {
      ...params,
      sources: ['devforums'],
    });
    expect(store.statusCalls.at(-1)?.status).toBe('failed');
    expect(store.events.at(-1)?.message).toBe('No sources are enabled');
  });

  it('completes a run with one ok source and emits the events in order', async () => {
    const store = new FakeStore();
    store.storeSignalsResult = { inserted: 2, updated: 0 };

    await run(store, [
      fakeAdapter('hackernews', { signals: [makeSignal(1), makeSignal(2)], status: 'ok' }),
    ]);

    expect(store.statusCalls.at(-1)).toEqual({
      runId: RUN_ID,
      status: 'completed',
      finished: true,
    });
    expect(store.events.map((e) => [e.agent, e.message])).toEqual([
      ['orchestrator', 'Run started'],
      ['scout', 'Searching hackernews for 1 keyword(s)'],
      ['scout', 'hackernews: ok, fetched 2'],
      ['scout', 'Removed 0 duplicate(s): 2 unique signal(s)'],
      ['scout', 'Stored 2 new and refreshed 0 existing signal(s)'],
      ['orchestrator', 'Run completed'],
    ]);
    expect(store.sourceCalls[0]?.patch.status).toBe('running');
    const lastSourceCall = store.sourceCalls.at(-1);
    expect(lastSourceCall?.patch.status).toBe('ok');
    expect(lastSourceCall?.patch.fetchedCount).toBe(2);
  });

  it('completes with warnings when one source is ok and another failed', async () => {
    const store = new FakeStore();

    await run(store, [
      fakeAdapter('hackernews', { signals: [makeSignal(1), makeSignal(2)], status: 'ok' }),
      fakeAdapter('reddit', { signals: [], status: 'failed', error: 'blocked' }),
    ]);

    expect(store.statusCalls.at(-1)?.status).toBe('completed_with_warnings');
    const redditEvent = store.events.find((e) => e.message.startsWith('reddit:'));
    expect(redditEvent?.kind).toBe('error');
    expect(redditEvent?.message).toContain('reddit: failed, fetched 0 (blocked)');
  });

  it('fails the run when every source failed', async () => {
    const store = new FakeStore();

    await run(store, [
      fakeAdapter('hackernews', { signals: [], status: 'failed', error: 'down' }),
      fakeAdapter('reddit', { signals: [], status: 'failed', error: 'blocked' }),
    ]);

    expect(store.statusCalls.at(-1)?.status).toBe('failed');
    const lastEvent = store.events.at(-1);
    expect(lastEvent?.kind).toBe('error');
    expect(lastEvent?.message).toBe('Run failed: no source succeeded');
  });

  it('does not store anything when no signals are found', async () => {
    const store = new FakeStore();

    await run(store, [fakeAdapter('hackernews', { signals: [], status: 'ok' })]);

    expect(store.statusCalls.at(-1)?.status).toBe('completed');
    const warning = store.events.find((e) => e.agent === 'scout' && e.kind === 'warning');
    expect(warning?.message).toBe(
      'No signals found. Try different keywords or a longer time window.',
    );
    expect(store.storeSignalsCalls).toHaveLength(0);
  });

  it('marks the run failed when storing signals throws', async () => {
    const store = new FakeStore();
    store.storeSignalsError = new Error('boom');

    await expect(
      run(store, [
        fakeAdapter('hackernews', { signals: [makeSignal(1), makeSignal(2)], status: 'ok' }),
      ]),
    ).resolves.toBeUndefined();

    expect(store.statusCalls.at(-1)?.status).toBe('failed');
    const lastEvent = store.events.at(-1);
    expect(lastEvent?.kind).toBe('error');
    expect(lastEvent?.message).toBe('Run failed: boom');
  });

  it('fails the run when no sources are enabled', async () => {
    const store = new FakeStore();

    await run(store, []);

    expect(store.statusCalls.at(-1)?.status).toBe('failed');
    const event = store.events.find((e) => e.agent === 'orchestrator' && e.kind === 'error');
    expect(event?.message).toBe('No sources are enabled');
  });

  it('still finishes the run when writing events keeps failing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new FakeStore();
    store.addEventError = new Error('events down');

    await expect(
      run(store, [
        fakeAdapter('hackernews', { signals: [makeSignal(1), makeSignal(2)], status: 'ok' }),
      ]),
    ).resolves.toBeUndefined();

    expect(store.statusCalls.at(-1)?.status).toBe('completed');
    consoleSpy.mockRestore();
  });

  it('saves request records collected by the adapter context once', async () => {
    const store = new FakeStore();
    const adapter: SourceAdapter = {
      id: 'hackernews',
      async search(_query, context) {
        context.onRequest?.({ source: 'hackernews', label: 'support', status: 'ok', httpStatus: 200, durationMs: 1, itemsReturned: 3, error: null, quotaRemaining: null });
        return { signals: [], status: 'ok' };
      },
    };
    await run(store, [adapter]);
    expect(store.requestRecords).toHaveLength(1);
    expect(store.requestRecords[0]?.label).toBe('support');
  });

  it('passes the run keywords to the classify stage', async () => {
    const store = new FakeStore();
    let receivedKeywords: string[] | undefined;
    const classify: NonNullable<PipelineDeps['classify']> = async (_runId, _onProgress, options) => {
      receivedKeywords = options?.keywords;
      return {
        total: 1, classified: 1, reused: 0, failed: 0,
        labels: { buyer_intent: 0, competitor_complaint: 0, venting: 0, noise: 1 },
        verifiedQuotes: 0, droppedQuotes: 0, capped: false, failureReasons: {},
      };
    };
    await runPipeline({ store, adapters: [fakeAdapter('hackernews', { signals: [makeSignal(1)], status: 'ok' })], ctx, classify }, RUN_ID, {
      ...params,
      keywords: ['support billing', 'customer service'],
    });
    expect(receivedKeywords).toEqual(['support billing', 'customer service']);
  });

  it('warns when request log storage fails without changing run status', async () => {
    const store = new FakeStore();
    store.saveSourceRequestsError = new Error('request log unavailable');
    await run(store, [fakeAdapter('hackernews', { signals: [], status: 'ok' })]);
    expect(store.statusCalls.at(-1)?.status).toBe('completed');
    expect(store.events).toContainEqual(expect.objectContaining({ agent: 'scout', kind: 'warning', message: 'Could not save the request log' }));
  });

  it('keeps at most 200 request records', async () => {
    const store = new FakeStore();
    const adapter: SourceAdapter = {
      id: 'hackernews',
      async search(_query, context) {
        for (let index = 0; index < 205; index++) {
          context.onRequest?.({ source: 'hackernews', label: String(index), status: 'ok', httpStatus: 200, durationMs: 0, itemsReturned: 0, error: null, quotaRemaining: null });
        }
        return { signals: [], status: 'ok' };
      },
    };
    await run(store, [adapter]);
    expect(store.requestRecords).toHaveLength(200);
  });

  it('computeRunStatus maps source statuses to a run status', () => {
    const cases: Array<[SourceStatus[], RunStatus]> = [
      [['ok', 'ok'], 'completed'],
      [['ok', 'failed'], 'completed_with_warnings'],
      [['degraded'], 'completed_with_warnings'],
      [['failed', 'failed'], 'failed'],
      [['skipped'], 'failed'],
      [[], 'failed'],
      [['ok', 'skipped'], 'completed_with_warnings'],
    ];

    for (const [statuses, expected] of cases) {
      expect(computeRunStatus(statuses.map((status) => ({ status })))).toBe(expected);
    }
  });
});
