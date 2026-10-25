import type { SellerProfileInput } from '@vantage/shared';
import type { DecisionStore, RunSignalContext } from '../db/decisions';
import { contentHash } from '../utils/hash';
import { RELEVANCE_MAX_CLASSIFY_PER_RUN, RELEVANCE_THRESHOLD } from '../config/retrieval';
import type { Embedder } from './displacement';

export interface RelevanceConfig {
  threshold: number;
  maxClassifyPerRun: number;
}

export interface RelevanceResult {
  eligibleIds: string[];
  total: number;
  eligible: number;
  excluded: number;
  threshold: number;
  scores: Record<string, number>;
}

export type RelevanceStage = (runId: string, keywords?: string[]) => Promise<RelevanceResult>;

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error('Relevance embeddings have inconsistent dimensions');
  }
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (leftNorm * rightNorm);
}

export async function scoreRelevance(
  seller: SellerProfileInput,
  signals: RunSignalContext[],
  embed: Embedder,
  config: RelevanceConfig,
  keywords: string[] = [],
): Promise<RelevanceResult> {
  if (signals.length === 0) {
    return { eligibleIds: [], total: 0, eligible: 0, excluded: 0, threshold: config.threshold, scores: {} };
  }
  const profileText = [seller.problemDescription, seller.idealCustomer ?? '', ...seller.competitors, ...keywords]
    .filter(Boolean).join('\n');
  const vectors = await embed([profileText, ...signals.map((signal) => signal.text)]);
  const profileVector = vectors[0];
  if (!profileVector || vectors.length !== signals.length + 1) {
    throw new Error('Relevance embedder returned an invalid batch');
  }
  const scored = signals.map((signal, index) => {
    const vector = vectors[index + 1];
    if (!vector) throw new Error('Relevance embedder returned an incomplete batch');
    return { signal, score: cosine(profileVector, vector) };
  }).sort((left, right) => right.score - left.score || left.signal.id.localeCompare(right.signal.id));
  const aboveThreshold = scored.filter((item) => item.score >= config.threshold);
  const selected = aboveThreshold.slice(0, config.maxClassifyPerRun);
  const eligibleIds = selected.map((item) => item.signal.id);
  const scores = Object.fromEntries(scored.map(({ signal, score }) => [signal.id, Number(score.toFixed(4))]));
  return {
    eligibleIds,
    total: signals.length,
    eligible: selected.length,
    excluded: signals.length - selected.length,
    threshold: config.threshold,
    scores,
  };
}

export function createRelevanceStage({
  store,
  embed,
  config = { threshold: RELEVANCE_THRESHOLD, maxClassifyPerRun: RELEVANCE_MAX_CLASSIFY_PER_RUN },
}: {
  store: DecisionStore;
  embed: Embedder;
  config?: RelevanceConfig;
}): RelevanceStage {
  return async (runId, keywords = []) => {
    const context = await store.getRunContext(runId);
    const result = await scoreRelevance(context.seller, context.signals, embed, config, keywords);
    const eligible = new Set(result.eligibleIds);
    await Promise.all(context.signals.map((signal) => {
      const similarity = result.scores[signal.id] ?? 0;
      const included = eligible.has(signal.id);
      return store.saveDecision({
        runId,
        signalId: signal.id,
        agent: 'scout',
        model: null,
        promptVersion: 'relevance.v1',
        inputHash: contentHash(JSON.stringify(['relevance.v1', config.threshold, config.maxClassifyPerRun, context.seller.problemDescription, keywords, signal.contentHash])),
        output: {
          similarity,
          threshold: config.threshold,
          eligible: included,
          reason: included ? null : 'Excluded before classification',
          exclusionReason: included ? null : similarity < config.threshold ? 'Below relevance threshold' : 'Excluded by relevance top-N cap',
        },
        evidence: [],
        evidenceVerified: false,
        status: 'ok',
      });
    }));
    return result;
  };
}
