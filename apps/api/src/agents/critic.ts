import { CriticOutputSchema } from '@vantage/shared';
import type { CriticOutput } from '@vantage/shared';
import type { LlmClient, LlmResult } from '../llm/client';
import { buildCriticPrompt } from '../llm/prompts/critic.v1';
import type { DecisionRow, DecisionStore, CriticCandidate } from '../db/decisions';
import { contentHash } from '../utils/hash';

export interface CriticSummary {
  reviewed: number;
  failed: number;
  failureCategories?: Record<string, number>;
}

export interface CriticConfig {
  maxCriticPerRun: number;
  concurrency?: number;
  criticPromptVersion: string;
}

export type CriticStage = (runId: string, options?: { onRateLimitWait?: (provider: string, waitMs: number) => void | Promise<void> }) => Promise<CriticSummary>;

interface CriticStageOptions {
  llm: Pick<LlmClient, 'generateJson'>;
  store: DecisionStore;
  config: CriticConfig;
}

function passedCriteriaCount(candidate: CriticCandidate): number {
  return candidate.output.criteria.filter((criterion) => criterion.passed).length;
}

function decisionRow(
  runId: string,
  candidate: CriticCandidate,
  inputHash: string,
  promptVersion: string,
  model: string | null,
  output: Record<string, unknown>,
  status: DecisionRow['status'],
): DecisionRow {
  return {
    runId,
    signalId: candidate.signalId,
    agent: 'critic',
    model,
    promptVersion,
    inputHash,
    output,
    evidence: [],
    evidenceVerified: false,
    status,
  };
}

export function createCriticStage({ llm, store, config }: CriticStageOptions): CriticStage {
  return async (runId, options) => {
    const candidates = (await store.listCriticCandidates(runId))
      .sort((left, right) => passedCriteriaCount(right) - passedCriteriaCount(left) || left.decisionId.localeCompare(right.decisionId))
      .slice(0, config.maxCriticPerRun);
    let reviewed = 0;
    let failed = 0;
    const failureCategories: Record<string, number> = {};
    const rateLimitRetries: CriticCandidate[] = [];

    const processCandidate = async (candidate: CriticCandidate, allowRateLimitRetry: boolean): Promise<void> => {
      const inputHash = contentHash(JSON.stringify([config.criticPromptVersion, candidate.decisionId]));
      const prompt = buildCriticPrompt({
        label: candidate.output.label,
        rationale: candidate.output.rationale,
        criteria: candidate.output.criteria,
        text: candidate.text,
      });
      try {
        const result: LlmResult<CriticOutput> = await llm.generateJson({
          ...prompt,
          schema: CriticOutputSchema,
          onRateLimitWait: options?.onRateLimitWait,
        });
        if (result.ok) {
          await store.saveDecision(decisionRow(
            runId,
            candidate,
            inputHash,
            config.criticPromptVersion,
            result.model,
            { ...result.data },
            'ok',
          ));
          reviewed += 1;
        } else {
          if (allowRateLimitRetry && result.providerErrors.at(-1)?.status === 429) {
            rateLimitRetries.push(candidate);
            return;
          }
          await store.saveDecision(decisionRow(
            runId,
            candidate,
            inputHash,
            config.criticPromptVersion,
            result.model,
            {},
            result.kind,
          ));
          failed += 1;
          const category = result.kind === 'invalid_output' || result.providerErrors.some((error) => error.status === 200)
            ? 'invalid output'
            : result.providerErrors.some((error) => /timeout|timed out|abort/i.test(error.message))
              ? 'timeout'
              : result.providerErrors.at(-1)?.status === 429 ? 'rate limited' : 'provider unavailable';
          failureCategories[category] = (failureCategories[category] ?? 0) + 1;
        }
      } catch {
        failed += 1;
        failureCategories['provider unavailable'] = (failureCategories['provider unavailable'] ?? 0) + 1;
        try {
          await store.saveDecision(decisionRow(
            runId,
            candidate,
            inputHash,
            config.criticPromptVersion,
            null,
            {},
            'error',
          ));
        } catch {
          // Continue reviewing other signals if persisting one failure also fails.
        }
      }
    };

    async function processBatch(items: CriticCandidate[], allowRateLimitRetry: boolean): Promise<void> {
      let cursor = 0;
      const workerCount = Math.min(Math.max(1, config.concurrency ?? 1), items.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
          const candidate = items[cursor];
          cursor += 1;
          if (candidate) await processCandidate(candidate, allowRateLimitRetry);
        }
      }));
    }

    await processBatch(candidates, true);
    await processBatch(rateLimitRetries, false);

    return { reviewed, failed, failureCategories };
  };
}
