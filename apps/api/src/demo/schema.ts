import { z } from 'zod';
import {
  AGENTS,
  CRITERION_IDS,
  EVENT_KINDS,
  LEAD_LABELS,
  LEAD_STATUSES,
  RUN_STATUSES,
  SCORE_COMPONENT_NAMES,
  SOURCE_IDS,
  SOURCE_STATUSES,
} from '@vantage/shared';

const isoDate = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
  {
    message: 'Must be an ISO 8601 date string',
  },
);

const RunParamsSchema = z.object({
  keywords: z.array(z.string()),
  sinceDays: z.number(),
  maxResults: z.number(),
  sources: z.array(z.enum(SOURCE_IDS)).optional(),
});

const SellerSchema = z.object({
  productName: z.string(),
  problemDescription: z.string(),
  idealCustomer: z.string().nullable(),
  competitors: z.array(z.string()),
});

const RunSourceSchema = z.object({
  source: z.enum(SOURCE_IDS),
  status: z.enum(SOURCE_STATUSES),
  fetchedCount: z.number(),
  error: z.string().nullable(),
});

const RunViewSchema = z.object({
  id: z.string(),
  status: z.enum(RUN_STATUSES),
  demo: z.boolean(),
  params: RunParamsSchema,
  startedAt: isoDate,
  finishedAt: isoDate.nullable(),
  seller: SellerSchema,
  sources: z.array(RunSourceSchema),
  signalCount: z.number(),
});

const CriterionSchema = z.object({
  id: z.enum(CRITERION_IDS),
  passed: z.boolean(),
  quote: z.string().nullable(),
});

const ScoreComponentSchema = z.object({
  name: z.enum(SCORE_COMPONENT_NAMES),
  value: z.number(),
  weight: z.number(),
  contribution: z.number(),
});

const ScoreBreakdownSchema = z.object({
  components: z.array(ScoreComponentSchema),
  total: z.number(),
});

const EnrichmentSchema = z.object({
  ageDays: z.number(),
  commentCount: z.number(),
  upvotes: z.number(),
  source: z.enum(SOURCE_IDS),
  community: z.string().nullable(),
  competitorsMentioned: z.array(z.string()),
  purchaseTermsFound: z.array(z.string()),
  teamTermsFound: z.array(z.string()),
  fit: z.object({
    competitorMentioned: z.boolean(),
    purchaseLanguage: z.boolean(),
    teamOrRoleContext: z.boolean(),
  }),
});

const LeadViewSchema = z.object({
  leadId: z.string(),
  signalId: z.string(),
  rank: z.number(),
  label: z.enum(LEAD_LABELS),
  score: z.number(),
  confidence: z.number().nullable(),
  status: z.enum(LEAD_STATUSES),
  source: z.enum(SOURCE_IDS),
  url: z.string(),
  authorHandle: z.string(),
  community: z.string().nullable(),
  createdAtSource: isoDate,
  textPreview: z.string(),
  rationale: z.string(),
  criteria: z.array(CriterionSchema),
  evidenceVerified: z.boolean(),
  breakdown: ScoreBreakdownSchema,
  enrichment: EnrichmentSchema,
});

const EvidenceSpanSchema = z.object({
  criterion: z.enum(CRITERION_IDS),
  quote: z.string(),
  start: z.number(),
  end: z.number(),
});

const LeadDetailSchema = z.object({
  lead: LeadViewSchema,
  runId: z.string(),
  text: z.string(),
  evidence: z.array(EvidenceSpanSchema),
  discardedQuotes: z.number(),
  trace: z.object({
    model: z.string().nullable(),
    promptVersion: z.string().nullable(),
    createdAt: isoDate,
    status: z.string(),
    output: z.record(z.string(), z.unknown()),
  }),
});

const DemoEventSchema = z.object({
  id: z.number(),
  runId: z.string(),
  agent: z.enum(AGENTS),
  kind: z.enum(EVENT_KINDS),
  message: z.string(),
  counts: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDate,
  offsetMs: z.number().int().min(0),
});

const SourceRequestSchema = z.object({
  id: z.number(),
  source: z.enum(SOURCE_IDS),
  label: z.string(),
  status: z.enum(['ok', 'failed', 'skipped']),
  httpStatus: z.number().nullable(),
  durationMs: z.number(),
  itemsReturned: z.number(),
  error: z.string().nullable(),
  quotaRemaining: z.number().nullable(),
  createdAt: isoDate,
});

const ThemeQuoteSchema = z.object({
  signalId: z.string(),
  criterion: z.enum(CRITERION_IDS),
  quote: z.string(),
});

const ThemeViewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  competitor: z.string(),
  title: z.string(),
  summary: z.string(),
  quotes: z.array(ThemeQuoteSchema),
  members: z.array(z.object({ signalId: z.string(), leadId: z.string().nullable() })),
  sampleData: z.boolean(),
});

export const DemoRunSchema = z.object({
  version: z.literal(1),
  recordedAt: isoDate,
  note: z.string(),
  run: RunViewSchema,
  events: z.array(DemoEventSchema),
  leads: z.array(LeadViewSchema),
  details: z.record(z.string(), LeadDetailSchema),
  requests: z.array(SourceRequestSchema).default([]),
  themes: z.array(ThemeViewSchema).default([]),
}).refine(
  (fixture) => fixture.leads.every((lead) => Object.hasOwn(fixture.details, lead.leadId)),
  { message: 'Every recorded signal must have a detail entry', path: ['details'] },
);

export type DemoRun = z.infer<typeof DemoRunSchema>;
