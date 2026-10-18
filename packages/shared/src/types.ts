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
  ScoreComponentSchema,
  ScoreBreakdownSchema,
  RunParamsSchema,
  RunCreateRequestSchema
} from './schemas';

export type SourceId = (typeof SOURCE_IDS)[number];
export type LeadLabel = (typeof LEAD_LABELS)[number];
export type CriterionId = (typeof CRITERION_IDS)[number];
export type RawSignal = z.infer<typeof RawSignalSchema>;
export type SellerProfileInput = z.infer<typeof SellerProfileInputSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type AgentId = (typeof AGENTS)[number];
export type RunParams = z.infer<typeof RunParamsSchema>;
export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;

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
