import { CriticOutputSchema } from '@vantage/shared';
import type { CriticOutput } from '@vantage/shared';
import type { LlmClient, LlmResult } from '../llm/client';
import { buildCriticPrompt } from '../llm/prompts/critic.v1';
import type { DecisionRow, DecisionStore, CriticCandidate } from '../db/decisions';
import { contentHash } from '../utils/hash';

export interface CriticSummary {
  reviewed: number;
  failed: number;
}

export interface CriticConfig {
  maxCriticPerRun: number;
  criticPromptVersion: string;
}

export type CriticStage = (runId: string) => Promise<CriticSummary>;

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
  return async (runId) => {
    const candidates = (await store.listCriticCandidates(runId))
      .sort((left, right) => passedCriteriaCount(right) - passedCriteriaCount(left) || left.decisionId.localeCompare(right.decisionId))
      .slice(0, config.maxCriticPerRun);
    let reviewed = 0;
    let failed = 0;

    for (const candidate of candidates) {
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
        }
      } catch {
        failed += 1;
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
    }

    return { reviewed, failed };
  };
}
