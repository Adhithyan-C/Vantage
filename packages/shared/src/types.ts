import { z } from 'zod';
import {
  SOURCE_IDS,
  LEAD_LABELS,
  CRITERION_IDS,
  RUN_STATUSES,
  SOURCE_STATUSES,
  EVENT_KINDS,
  AGENTS
} from './constants';
import {
  RawSignalSchema,
  SellerProfileInputSchema,
  CriterionResultSchema,
  ClassifierOutputSchema,
  CriticOutputSchema,
  ScoreComponentSchema,
  ScoreBreakdownSchema,
  RunParamsSchema,
  RunCreateRequestSchema,
  SampleDatasetSchema,
  FeedbackRequestSchema
} from './schemas';
import type { FEEDBACK_ACTIONS } from './constants';

export type SourceId = (typeof SOURCE_IDS)[number];
export type LeadLabel = (typeof LEAD_LABELS)[number];
export type CriterionId = (typeof CRITERION_IDS)[number];
export type RawSignal = z.infer<typeof RawSignalSchema>;
export type SellerProfileInput = z.infer<typeof SellerProfileInputSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;
export type CriticOutput = z.infer<typeof CriticOutputSchema>;
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export interface Enrichment {
  ageDays: number;
  commentCount: number;
  upvotes: number;
  source: SourceId;
  community: string | null;
  competitorsMentioned: string[];
  purchaseTermsFound: string[];
  teamTermsFound: string[];
  fit: {
    competitorMentioned: boolean;
    purchaseLanguage: boolean;
    teamOrRoleContext: boolean;
  };
}

export interface LeadView {
  leadId: string;
  signalId: string;
  rank: number;
  label: LeadLabel;
  score: number;
  confidence: number | null;
  status: (typeof import('./constants').LEAD_STATUSES)[number];
  source: SourceId;
  url: string;
  authorHandle: string;
  community: string | null;
  createdAtSource: string;
  textPreview: string;
  rationale: string;
  criteria: Array<{ id: CriterionId; passed: boolean; quote: string | null }>;
  evidenceVerified: boolean;
  breakdown: ScoreBreakdown;
  enrichment: Enrichment;
  criticTrace?: DecisionTrace | null;
}

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export interface EvidenceSpan {
  criterion: CriterionId;
  quote: string;
  start: number;
  end: number;
}

export interface DecisionTrace {
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  status: string;
  output: Record<string, unknown>;
}

export interface LeadDetail {
  lead: LeadView;
  runId: string;
  text: string;
  evidence: EvidenceSpan[];
  discardedQuotes: number;
  trace: DecisionTrace;
  criticTrace?: DecisionTrace | null;
}
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type AgentId = (typeof AGENTS)[number];
export type RunParams = z.infer<typeof RunParamsSchema>;
export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;
export type SampleDataset = z.infer<typeof SampleDatasetSchema>;

export interface RequestRecord {
  source: SourceId;
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  httpStatus: number | null;
  durationMs: number;
  itemsReturned: number;
  error: string | null;
  quotaRemaining: number | null;
  outcome?: 'success' | 'no_results' | 'failed' | 'rate_limited' | 'unsupported_query' | 'partial';
  request?: { endpoint: string; params: Record<string, string> } | null;
  responseSummary?: Record<string, unknown> | null;
}

export interface SourceRequestView extends RequestRecord {
  id: number;
  createdAt: string;
}

export interface ThemeQuote {
  signalId: string;
  criterion: CriterionId;
  quote: string;
}

export interface ThemeView {
  id: string;
  runId: string;
  competitor: string;
  title: string;
  summary: string;
  quotes: ThemeQuote[];
  members: Array<{ signalId: string; leadId: string | null }>;
  sampleData: boolean;
}

export interface CompetitorGraphView {
  nodes: Array<{ competitor: string; mentionCount: number }>;
  edges: Array<{ a: string; b: string; weight: number }>;
  signalCount: number;
  sampleData: boolean;
}

export interface RunSourceView {
  source: SourceId;
  status: SourceStatus;
  fetchedCount: number;
  error: string | null;
}

export interface RunView {
  id: string;
  status: RunStatus;
  demo: boolean;
  params: RunParams;
  startedAt: string;
  finishedAt: string | null;
  seller: {
    productName: string;
    problemDescription: string;
    idealCustomer: string | null;
    competitors: string[];
  };
  sources: RunSourceView[];
  signalCount: number;
}

export interface ReportView {
  generatedAt: string;
  run: RunView;
  summary: {
    signalsFound: number;
    buyingSignals: number;
    byLabel: Record<LeadLabel, number>;
    bySource: Record<string, number>;
    sampleData: boolean;
  };
  sources: Array<{
    source: SourceId;
    requestsOk: number;
    requestsFailed: number;
    itemsReturned: number;
    signalsKept: number;
    errors: string[];
  }>;
  method: {
    weights: Record<'intent' | 'fit' | 'recency' | 'engagement', number>;
    recencyHalfLifeDays: number;
    promptVersion: string;
  };
  signals: LeadView[];
}

export interface RunEvent {
  id: number;
  runId: string;
  agent: AgentId;
  kind: EventKind;
  message: string;
  counts: Record<string, unknown> | null;
  createdAt: string;
}

export interface DecisionView {
  signalId: string;
  source: SourceId;
  url: string;
  authorHandle: string;
  createdAtSource: string;
  textPreview: string;
  label: LeadLabel | null;
  rationale: string;
  criteria: Array<{ id: CriterionId; passed: boolean; quote: string | null }>;
  evidenceVerified: boolean;
  model: string | null;
  promptVersion: string | null;
  status: (typeof import('./constants').DECISION_STATUSES)[number];
}

export type SignalJourneyStage = 'scout' | 'classifier' | 'critic' | 'enricher' | 'scorer' | 'displacement' | 'outcome';
export type SignalStageStatus = 'completed' | 'not_run' | 'failed' | 'not_available';

export interface SignalRunSummary {
  signalId: string;
  leadId: string | null;
  source: SourceId;
  authorHandle: string;
  url: string;
  textPreview: string;
  createdAtSource: string;
  label: LeadLabel | null;
  score: number | null;
  stages: Record<SignalJourneyStage, { status: SignalStageStatus; reason?: string }>;
}

export interface SignalJourney extends SignalRunSummary {
  text: string;
  timeline: Array<{ stage: SignalJourneyStage; status: SignalStageStatus; reason: string | null; output: Record<string, unknown> | null }>;
}
