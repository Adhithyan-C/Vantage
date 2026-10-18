import type {
  ClassifierOutput,
  CriterionId,
  Enrichment,
  LeadLabel,
  ScoreBreakdown,
} from '@vantage/shared';
import { ENGAGEMENT_CAP, RECENCY_HALF_LIFE_DAYS, SCORE_WEIGHTS } from '../config/scoring';
import { RUBRIC } from '../config/rubric';
import { enrichSignal } from './enricher';
import { computeConfidence, computeScore, rankLeads } from '../scoring/computeScore';
import type { ScoreRubricCriterion, ScoreWeights } from '../scoring/computeScore';
import type { LeadStore, LeadUpsertRow, ScoringContextItem } from '../db/leads';

export interface ScoreSummary {
  scored: number;
  ranked: number;
  topScore: number | null;
}

export type ScoreStage = (runId: string) => Promise<ScoreSummary>;

export interface ScoreConfig {
  rubric: ReadonlyArray<ScoreRubricCriterion>;
  weights: ScoreWeights;
  halfLifeDays: number;
  engagementCap: number;
}

interface ScoreStageOptions {
  store: LeadStore;
  now?: () => Date;
  config?: Partial<ScoreConfig>;
}

const DEFAULT_CONFIG: ScoreConfig = {
  rubric: RUBRIC,
  weights: SCORE_WEIGHTS,
  halfLifeDays: RECENCY_HALF_LIFE_DAYS,
  engagementCap: ENGAGEMENT_CAP,
};

interface ScoredLead extends LeadUpsertRow {
  label: LeadLabel;
  createdAtSource: string;
  scoreBreakdown: ScoreBreakdown & { confidence: number | null; enrichment: Enrichment };
}

function passedCriteria(output: ClassifierOutput): CriterionId[] {
  return output.criteria.filter((criterion) => criterion.passed).map((criterion) => criterion.id);
}

function unverifiedCount(item: ScoringContextItem): number {
  const unverified = item.decision.output.notes?.unverified;
  return Array.isArray(unverified) ? unverified.length : 0;
}

function isRankedLabel(label: LeadLabel): boolean {
  return label === 'buyer_intent' || label === 'competitor_complaint';
}

export function createScoreStage({ store, now = () => new Date(), config = {} }: ScoreStageOptions): ScoreStage {
  const effectiveConfig: ScoreConfig = { ...DEFAULT_CONFIG, ...config };
  return async (runId) => {
    const context = await store.getScoringContext(runId);
    if (context.items.length === 0) {
      return { scored: 0, ranked: 0, topScore: null };
    }

    const scored: ScoredLead[] = context.items.map((item) => {
      const enrichment = enrichSignal({
        text: item.text,
        source: item.source,
        community: item.community,
        createdAtSource: item.createdAtSource,
        engagement: item.engagement,
        competitors: context.seller.competitors,
        now: now(),
      });
      const passed = passedCriteria(item.decision.output);
      const breakdown = computeScore({
        passedCriteria: passed,
        enrichment,
        rubric: effectiveConfig.rubric,
        weights: effectiveConfig.weights,
        halfLifeDays: effectiveConfig.halfLifeDays,
        engagementCap: effectiveConfig.engagementCap,
      });
      const confidence = computeConfidence(passed.length, unverifiedCount(item));
      return {
        signalId: item.signal,
        label: item.decision.output.label,
        score: breakdown.total,
        createdAtSource: item.createdAtSource,
        rank: 0,
        scoreBreakdown: { ...breakdown, confidence, enrichment },
      };
    });
    const ranked = rankLeads(scored);
    const rows: LeadUpsertRow[] = ranked.map(({ signalId, label, score, rank, scoreBreakdown }) => ({
      signalId,
      label,
      score,
      rank,
      scoreBreakdown,
    }));
    await store.saveLeads(runId, rows);
    const rankedItems = ranked.filter((item) => isRankedLabel(item.label));
    return {
      scored: ranked.length,
      ranked: rankedItems.length,
      topScore: rankedItems.length > 0
        ? Math.max(...rankedItems.map((item) => item.score))
        : null,
    };
  };
}

