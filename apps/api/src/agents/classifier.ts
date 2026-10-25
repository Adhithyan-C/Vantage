import { CRITERION_IDS, ClassifierOutputSchema, LEAD_LABELS } from '@vantage/shared';
import type {
  ClassifierOutput,
  LeadLabel,
  SellerProfileInput,
} from '@vantage/shared';
import type { LlmClient, LlmResult, ProviderError } from '../llm/client';
import { buildClassifierPrompt as buildClassifierPromptV2 } from '../llm/prompts/classifier.v2';
import { buildClassifierPrompt as buildClassifierPromptV3 } from '../llm/prompts/classifier.v3';
import { RUBRIC } from '../config/rubric';
import type { DecisionRow, DecisionStore, RunSignalContext } from '../db/decisions';
import { contentHash } from '../utils/hash';
import { finalizeClassification } from '../verification/verifyQuote';
import { QUERY_STOPWORDS } from '../config/enrich';

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
  failureCategories?: Record<string, number>;
}

export type ClassifyProgress = (done: number, total: number) => void | Promise<void>;
export type ClassifyRunOptions = { keywords?: string[]; signalIds?: string[]; onRateLimitWait?: (provider: string, waitMs: number) => void | Promise<void> };
export type ClassifyStage = (
  runId: string,
  onProgress?: ClassifyProgress,
  options?: ClassifyRunOptions,
) => Promise<ClassifySummary>;

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

function failureCategory(providerErrors: ProviderError[], invalidOutput = false): string {
  if (invalidOutput || providerErrors.some((error) => error.status === 200)) return 'invalid output';
  if (providerErrors.some((error) => /timeout|timed out|abort/i.test(error.message))) return 'timeout';
  if (providerErrors.at(-1)?.status === 429) return 'rate limited';
  return 'provider unavailable';
}

function recordFailureCategory(summary: ClassifySummary, providerErrors: ProviderError[], invalidOutput = false): void {
  const category = failureCategory(providerErrors, invalidOutput);
  const categories = summary.failureCategories ??= {};
  categories[category] = (categories[category] ?? 0) + 1;
}

export function createClassifyStage({ llm, store, config }: ClassifyStageOptions): ClassifyStage {
  return async (runId, onProgress, options) => {
    const context = await store.getRunContext(runId);
    const stopwords = new Set<string>(QUERY_STOPWORDS);
    const queryTerms = [...new Set((options?.keywords ?? []).flatMap((keyword) =>
      keyword.toLowerCase().match(/[a-z0-9]+/g) ?? [],
    ).filter((term) => term.length >= 4 && !stopwords.has(term)))];
    const allowedIds = options?.signalIds ? new Set(options.signalIds) : null;
    const signals = context.signals.filter((signal) => !allowedIds || allowedIds.has(signal.id)).sort((left, right) => {
      if (options?.keywords) {
        const leftText = left.text.toLowerCase();
        const rightText = right.text.toLowerCase();
        const leftMatches = queryTerms.filter((term) => leftText.includes(term)).length;
        const rightMatches = queryTerms.filter((term) => rightText.includes(term)).length;
        if (leftMatches !== rightMatches) return rightMatches - leftMatches;
      }
      const newestFirst = Date.parse(right.createdAtSource) - Date.parse(left.createdAtSource);
      if (newestFirst !== 0) return newestFirst;
      return options?.keywords ? left.id.localeCompare(right.id) : 0;
    });
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
      failureCategories: {},
    };
    let cursor = 0;
    let done = 0;
    const rateLimitRetries: RunSignalContext[] = [];

    async function classifySignal(signal: RunSignalContext, allowRateLimitRetry = true): Promise<void> {
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

        const promptParts = config.promptVersion === 'classifier.v3'
          ? buildClassifierPromptV3({ seller: context.seller, text: signal.text, source: signal.source })
          : buildClassifierPromptV2({ seller: context.seller, text: signal.text });
        const result = await llm.generateJson({
          ...promptParts,
          schema: ClassifierOutputSchema,
          onRateLimitWait: options?.onRateLimitWait,
        });
        if (!result.ok) {
          if (allowRateLimitRetry && result.providerErrors.at(-1)?.status === 429) {
            rateLimitRetries.push(signal);
            return;
          }
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
          recordFailureCategory(summary, result.providerErrors, result.kind === 'invalid_output');
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
        recordFailureCategory(summary, []);
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

    if (rateLimitRetries.length > 0) {
      let retryCursor = 0;
      await Promise.all(Array.from({ length: Math.min(Math.max(1, config.concurrency), rateLimitRetries.length) }, async () => {
        while (retryCursor < rateLimitRetries.length) {
          const signal = rateLimitRetries[retryCursor];
          retryCursor += 1;
          if (signal) await classifySignal(signal, false);
        }
      }));
    }

    return summary;
  };
}
