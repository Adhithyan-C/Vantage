import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ClassifierOutput } from '@vantage/shared';
import type { DecisionRow, DecisionStore, RunClassificationContext, RunSignalContext } from '../src/db/decisions';
import type { LlmClient, LlmResult } from '../src/llm/client';
import { createClassifyStage } from '../src/agents/classifier';

const seller = {
  productName: 'Support Desk',
  problemDescription: 'Help support teams manage customer tickets.',
  competitors: ['Zendesk'],
};
const config = { concurrency: 1, maxClassifyPerRun: 30, maxPostChars: 2_000, promptVersion: 'classifier.v2' };
const output: ClassifierOutput = { label: 'noise', criteria: [], rationale: 'Unrelated post.' };

function signal(index: number): RunSignalContext {
  return {
    id: `signal-${index}`,
    text: `post-${index}`,
    source: 'hackernews',
    url: `https://example.test/${index}`,
    authorHandle: `author-${index}`,
    createdAtSource: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    contentHash: `hash-${index}`,
  };
}

function context(count: number): RunClassificationContext {
  return { seller, signals: Array.from({ length: count }, (_, index) => signal(index)) };
}

function storeFor(runContext: RunClassificationContext, reusable: Awaited<ReturnType<DecisionStore['findReusable']>> = null) {
  const saved: DecisionRow[] = [];
  const store: DecisionStore = {
    getRunContext: async () => runContext,
    findReusable: async () => reusable,
    saveDecision: async (row) => { saved.push(row); },
    listDecisions: async () => [],
  };
  return { store, saved };
}

function llmFor(
  generate: () => Promise<LlmResult<ClassifierOutput>> = async () => ({
    ok: true,
    data: output,
    model: 'test-model',
    attempts: 1,
  }),
): Pick<LlmClient, 'generateJson'> {
  return {
    async generateJson<T>(): Promise<LlmResult<T>> {
      return (await generate()) as LlmResult<T>;
    },
  };
}

describe('createClassifyStage', () => {
  it('classifies and stores a successful signal', async () => {
    const { store, saved } = storeFor(context(1));
    const summary = await createClassifyStage({ llm: llmFor(), store, config })('run-1');
    expect(summary).toMatchObject({ total: 1, classified: 1, reused: 0, failed: 0, labels: { noise: 1 } });
    expect(saved[0]).toMatchObject({ agent: 'classifier', status: 'ok', model: 'test-model' });
    expect(saved[0]?.output).toMatchObject({ label: 'noise', rationale: 'Unrelated post.' });
  });

  it('processes newest first and caps the run', async () => {
    const { store, saved } = storeFor(context(5));
    const prompts: string[] = [];
    const summary = await createClassifyStage({
      llm: {
        async generateJson<T>(options: { system: string; prompt: string; schema: z.ZodType<T> }): Promise<LlmResult<T>> {
          prompts.push(options.prompt);
          return { ok: true, data: output as T, model: 'test-model', attempts: 1 };
        },
      },
      store,
      config: { ...config, maxClassifyPerRun: 2 },
    })('run-1');
    expect(summary.capped).toBe(true);
    expect(saved.map((row) => row.signalId).sort()).toEqual(['signal-3', 'signal-4']);
    expect(prompts[0]).toContain('post-4');
    expect(prompts[1]).toContain('post-3');
  });

  it('reuses matching cached output and saves a copy for the current run', async () => {
    const reusable = {
      model: 'cached-model',
      promptVersion: 'classifier.v2',
      output: { label: 'venting', criteria: [], rationale: 'Cached result.' },
      evidence: [],
      evidenceVerified: true,
    };
    const { store, saved } = storeFor(context(1), reusable);
    const llm = llmFor(async () => ({
      ok: false,
      kind: 'error',
      error: 'should not run',
      model: null,
      attempts: 0,
      providerErrors: [],
    }));
    const summary = await createClassifyStage({ llm, store, config })('new-run');
    expect(summary).toMatchObject({ classified: 1, reused: 1, failed: 0, labels: { venting: 1 } });
    expect(saved[0]).toMatchObject({ runId: 'new-run', model: 'cached-model', output: reusable.output });
  });

  it('records one failed signal and continues processing the rest', async () => {
    const { store, saved } = storeFor(context(2));
    let calls = 0;
    const llm = llmFor(async () => {
      calls += 1;
      return calls === 1
        ? {
          ok: false,
          kind: 'error',
          error: 'provider failed',
          model: null,
          attempts: 2,
          providerErrors: [
            { provider: 'groq', status: 429, message: 'rate limited' },
            { provider: 'gemini', status: 503, message: 'unavailable' },
          ],
        }
        : { ok: true, data: output, model: 'test-model', attempts: 1 };
    });
    const summary = await createClassifyStage({ llm, store, config })('run-1');
    expect(summary).toMatchObject({ classified: 1, failed: 1 });
    expect(saved.some((row) => row.status === 'error')).toBe(true);
    expect(saved.some((row) => row.status === 'ok')).toBe(true);
    expect(saved.find((row) => row.status === 'error')?.output).toEqual({
      error: {
        providers: [
          { provider: 'groq', status: 429, message: 'rate limited' },
          { provider: 'gemini', status: 503, message: 'unavailable' },
        ],
      },
    });
    expect(summary.failureReasons).toEqual({ 'groq:429': 1, 'gemini:503': 1 });
    expect(JSON.stringify(saved.find((row) => row.status === 'error')?.output)).not.toContain('post-');
    expect(JSON.stringify(saved.find((row) => row.status === 'error')?.output)).not.toContain('Seller product');
  });

  it('saves invalid-output provider reasons and preserves the invalid_output status', async () => {
    const { store, saved } = storeFor(context(1));
    const llm = llmFor(async () => ({
      ok: false,
      kind: 'invalid_output',
      error: 'invalid output',
      model: 'groq-model',
      attempts: 3,
      providerErrors: [
        { provider: 'groq', status: 200, message: 'Provider returned invalid JSON' },
      ],
    }));
    const summary = await createClassifyStage({ llm, store, config })('run-1');
    expect(summary).toMatchObject({ failed: 1, failureReasons: { 'groq:200': 1 } });
    expect(saved[0]).toMatchObject({
      status: 'invalid_output',
      output: {
        error: {
          providers: [{ provider: 'groq', status: 200, message: 'Provider returned invalid JSON' }],
        },
      },
    });
  });

  it('calls the progress callback every ten signals', async () => {
    const { store } = storeFor(context(22));
    const updates: number[] = [];
    await createClassifyStage({ llm: llmFor(), store, config })('run-1', (done) => {
      updates.push(done);
    });
    expect(updates).toEqual([10, 20]);
  });

  it('never exceeds the configured concurrency', async () => {
    const { store } = storeFor(context(8));
    let active = 0;
    let maximum = 0;
    const llm = llmFor(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ok: true, data: output, model: 'test-model', attempts: 1 };
    });
    await createClassifyStage({ llm, store, config: { ...config, concurrency: 2 } })('run-1');
    expect(maximum).toBe(2);
  });
});
