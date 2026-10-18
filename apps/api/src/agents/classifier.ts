import { CRITERION_IDS, ClassifierOutputSchema, LEAD_LABELS } from '@vantage/shared';
import type {
  ClassifierOutput,
  LeadLabel,
  SellerProfileInput,
} from '@vantage/shared';
import type { LlmClient, LlmResult, ProviderError } from '../llm/client';
import { buildClassifierPrompt } from '../llm/prompts/classifier.v2';
import { RUBRIC } from '../config/rubric';
import type { DecisionRow, DecisionStore, RunSignalContext } from '../db/decisions';
import { contentHash } from '../utils/hash';
import { finalizeClassification } from '../verification/verifyQuote';

export interface ClassifyConfig {
  concurrency: number;
  maxClassifyPerRun: number;
  maxPostChars: number;
  promptVersion: string;
}

export interface ClassifySummary {
  total: number;
  classified: number;
  reused: number;
  failed: number;
  labels: Record<LeadLabel, number>;
  verifiedQuotes: number;
  droppedQuotes: number;
  capped: boolean;
  failureReasons: Record<string, number>;
}

export type ClassifyProgress = (done: number, total: number) => void | Promise<void>;
export type ClassifyStage = (runId: string, onProgress?: ClassifyProgress) => Promise<ClassifySummary>;

interface ClassifyStageOptions {
  llm: Pick<LlmClient, 'generateJson'>;
  store: DecisionStore;
  config: ClassifyConfig;
}

const emptyLabels = (): Record<LeadLabel, number> => ({
  buyer_intent: 0,
  competitor_complaint: 0,
  venting: 0,
  noise: 0,
});

function outputRecord(output: Record<string, unknown>): Record<string, unknown> {
  return output;
}

function getLabel(output: Record<string, unknown>): LeadLabel | null {
  const label = output.label;
  return LEAD_LABELS.includes(label as LeadLabel) ? (label as LeadLabel) : null;
}

function buildInputHash(
  config: ClassifyConfig,
  seller: SellerProfileInput,
  signal: RunSignalContext,
): string {
  const input = [
    config.promptVersion,
    RUBRIC.map(({ id, weight }) => [id, weight]),
    seller.problemDescription,
    [...seller.competitors].sort((left, right) => left.localeCompare(right)),
    signal.contentHash,
  ];
  return contentHash(JSON.stringify(input));
}

function emptyDecision(
  runId: string,
  signalId: string,
  inputHash: string,
  promptVersion: string,
  status: 'invalid_output' | 'error',
  model: string | null,
  providerErrors: ProviderError[],
): DecisionRow {
  return {
    runId,
    signalId,
    agent: 'classifier',
    model,
    promptVersion,
    inputHash,
    output: { error: { providers: providerErrors } },
    evidence: [],
    evidenceVerified: false,
    status,
  };
}

function recordFailureReasons(summary: ClassifySummary, providerErrors: ProviderError[]): void {
  if (providerErrors.length === 0) {
    summary.failureReasons['none:none'] = (summary.failureReasons['none:none'] ?? 0) + 1;
    return;
  }
  for (const error of providerErrors) {
    const key = `${error.provider}:${error.status ?? 'none'}`;
    summary.failureReasons[key] = (summary.failureReasons[key] ?? 0) + 1;
  }
}

export function createClassifyStage({ llm, store, config }: ClassifyStageOptions): ClassifyStage {
  return async (runId, onProgress) => {
    const context = await store.getRunContext(runId);
    const signals = [...context.signals].sort(
      (left, right) => Date.parse(right.createdAtSource) - Date.parse(left.createdAtSource),
    );
    const selected = signals.slice(0, config.maxClassifyPerRun);
    const summary: ClassifySummary = {
      total: signals.length,
      classified: 0,
      reused: 0,
      failed: 0,
      labels: emptyLabels(),
      verifiedQuotes: 0,
      droppedQuotes: 0,
      capped: signals.length > selected.length,
      failureReasons: {},
    };
    let cursor = 0;
    let done = 0;

    async function classifySignal(signal: RunSignalContext): Promise<void> {
      const inputHash = buildInputHash(config, context.seller, signal);
      try {
        const reusable = await store.findReusable(inputHash);
        if (reusable) {
          await store.saveDecision({
            runId,
            signalId: signal.id,
            agent: 'classifier',
            model: reusable.model,
            promptVersion: reusable.promptVersion ?? config.promptVersion,
            inputHash,
            output: reusable.output,
            evidence: reusable.evidence,
            evidenceVerified: reusable.evidenceVerified,
            status: 'ok',
          });
          summary.classified += 1;
          summary.reused += 1;
          const label = getLabel(reusable.output);
          if (label) {
            summary.labels[label] += 1;
          }
          summary.verifiedQuotes += reusable.evidence.length;
          return;
        }

        const { system, prompt } = buildClassifierPrompt({ seller: context.seller, text: signal.text });
        const result = await llm.generateJson({
          system,
          prompt,
          schema: ClassifierOutputSchema,
        });
        if (!result.ok) {
          await store.saveDecision(
            emptyDecision(
              runId,
              signal.id,
              inputHash,
              config.promptVersion,
              result.kind,
              result.model,
              result.providerErrors,
            ),
          );
          summary.failed += 1;
          recordFailureReasons(summary, result.providerErrors);
          return;
        }

        const finalized = finalizeClassification(result.data, signal.text);
        await store.saveDecision({
          runId,
          signalId: signal.id,
          agent: 'classifier',
          model: result.model,
          promptVersion: config.promptVersion,
          inputHash,
          output: outputRecord(finalized.output),
          evidence: finalized.evidence,
          evidenceVerified: finalized.evidenceVerified,
          status: 'ok',
        });
        summary.classified += 1;
        summary.labels[finalized.output.label] += 1;
        summary.verifiedQuotes += finalized.evidence.length;
        summary.droppedQuotes += Math.max(
          0,
          result.data.criteria.filter((criterion) => criterion.passed).length - finalized.evidence.length,
        );
      } catch {
        summary.failed += 1;
        recordFailureReasons(summary, []);
        try {
          await store.saveDecision(
            emptyDecision(runId, signal.id, inputHash, config.promptVersion, 'error', null, []),
          );
        } catch {
          // A database failure should not prevent remaining signals from being classified.
        }
      }
    }

    const workerCount = Math.min(Math.max(1, config.concurrency), selected.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < selected.length) {
          const signal = selected[cursor];
          cursor += 1;
          if (signal) {
            await classifySignal(signal);
          }
          done += 1;
          if (done % 10 === 0) {
            await onProgress?.(done, signals.length);
          }
        }
      }),
    );

    return summary;
  };
}
