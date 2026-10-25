import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CRITERION_IDS } from '@vantage/shared';
import type { ClassifierOutput, CriticOutput, CriterionId } from '@vantage/shared';
import type { CriticCandidate, DecisionRow, DecisionStore } from '../src/db/decisions';
import { createLlmClient } from '../src/llm/client';
import type { LlmClient, LlmResult } from '../src/llm/client';
import { createCriticStage } from '../src/agents/critic';
import { contentHash } from '../src/utils/hash';

const config = { maxCriticPerRun: 8, concurrency: 2, criticPromptVersion: 'critic.v1' };
const criticOutput: CriticOutput = {
  verdict: 'supported',
  issues: [],
  trustScore: 0.94,
};

function candidate(index: number, passedCount = 2): CriticCandidate {
  const criteria = CRITERION_IDS.map((id, criterionIndex) => ({
    id: id as CriterionId,
    passed: criterionIndex < passedCount,
    quote: criterionIndex < passedCount ? `quote-${criterionIndex}` : null,
  }));
  const output: ClassifierOutput = {
    label: 'buyer_intent',
    rationale: `Rationale ${index}`,
    criteria,
  };
  return {
    decisionId: `decision-${String(index).padStart(2, '0')}`,
    signalId: `signal-${String(index).padStart(2, '0')}`,
    output,
    text: `Post text ${index}`,
  };
}

function storeFor(candidates: CriticCandidate[]) {
  const saved: DecisionRow[] = [];
  const store: DecisionStore = {
    async getRunContext() { return { seller: { productName: 'Product', problemDescription: 'Problem', competitors: [] }, signals: [] }; },
    async listCriticCandidates() { return candidates; },
    async findReusable() { return null; },
    async saveDecision(row) { saved.push(row); },
    async listDecisions() { return []; },
  };
  return { store, saved };
}

function llmFor(generate: () => Promise<LlmResult<CriticOutput>>): Pick<LlmClient, 'generateJson'> {
  return {
    async generateJson<T>(_options: { system: string; prompt: string; schema: z.ZodType<T> }): Promise<LlmResult<T>> {
      return await generate() as LlmResult<T>;
    },
  };
}

describe('createCriticStage', () => {
  it('persists a supported review with its classifier-decision input hash', async () => {
    const { store, saved } = storeFor([candidate(1)]);
    const stage = createCriticStage({
      llm: llmFor(async () => ({ ok: true, data: criticOutput, model: 'test-model', attempts: 1 })),
      store,
      config,
    });

    await expect(stage('run-1')).resolves.toMatchObject({ reviewed: 1, failed: 0 });
    expect(saved[0]).toMatchObject({
      runId: 'run-1',
      signalId: 'signal-01',
      agent: 'critic',
      model: 'test-model',
      promptVersion: 'critic.v1',
      inputHash: contentHash(JSON.stringify(['critic.v1', 'decision-01'])),
      output: criticOutput,
      status: 'ok',
    });
  });

  it('records invalid_output with an empty output after the client exhausts validation retries', async () => {
    const { store, saved } = storeFor([candidate(2)]);
    let requests = 0;
    const llm = createLlmClient({
      fetch: async () => {
        requests += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'not JSON' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      groqApiKey: 'test-key',
      config: {
        geminiModel: 'test-gemini',
        groqModel: 'test-groq',
        temperature: 0,
        requestTimeoutMs: 1_000,
        maxValidationRetries: 2,
        rateLimitRetries: 0,
        retryAfterCapMs: 20_000,
        providerOrder: ['groq'],
      },
    });
    const stage = createCriticStage({
      llm,
      store,
      config,
    });

    await expect(stage('run-1')).resolves.toMatchObject({ reviewed: 0, failed: 1, failureCategories: { 'invalid output': 1 } });
    expect(requests).toBe(3);
    expect(saved[0]).toMatchObject({
      agent: 'critic',
      status: 'invalid_output',
      output: {},
    });
  });

  it('caps the run at 8 candidates with the most passed criteria', async () => {
    const candidates = Array.from({ length: 16 }, (_, index) => candidate(index, index % 6));
    const { store, saved } = storeFor(candidates);
    let calls = 0;
    const stage = createCriticStage({
      llm: llmFor(async () => {
        calls += 1;
        return { ok: true, data: criticOutput, model: 'test-model', attempts: 1 };
      }),
      store,
      config: { ...config, maxCriticPerRun: 8 },
    });

    await expect(stage('run-1')).resolves.toMatchObject({ reviewed: 8, failed: 0 });
    expect(calls).toBe(8);
    expect(saved).toHaveLength(8);
    expect(saved.some((row) => row.signalId === 'signal-12')).toBe(false);
    expect(saved.some((row) => row.signalId === 'signal-15')).toBe(true);
  });

  it('runs reviews at configured concurrency two and retries a rate-limited review once at stage end', async () => {
    const candidates = Array.from({ length: 4 }, (_, index) => candidate(index));
    const { store, saved } = storeFor(candidates);
    let active = 0;
    let maxActive = 0;
    let first = true;
    const stage = createCriticStage({
      llm: llmFor(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        if (first) {
          first = false;
          return { ok: false, kind: 'error', error: 'rate limited', model: null, attempts: 1, providerErrors: [{ provider: 'groq', status: 429, message: 'rate limited' }] };
        }
        return { ok: true, data: criticOutput, model: 'test-model', attempts: 1 };
      }),
      store,
      config: { ...config, maxCriticPerRun: 4, concurrency: 2 },
    });
    await expect(stage('run-1')).resolves.toMatchObject({ reviewed: 4, failed: 0 });
    expect(maxActive).toBe(2);
    expect(saved).toHaveLength(4);
  });
});
