import { z } from 'zod';
import { SOURCE_IDS, LEAD_LABELS, CRITERION_IDS, SCORE_COMPONENT_NAMES, FEEDBACK_ACTIONS } from './constants';

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Must be an ISO 8601 date string' });

export const RawSignalSchema = z.object({
  source: z.enum(SOURCE_IDS),
  externalId: z.string().min(1),
  authorHandle: z.string().min(1),
  community: z.string().min(1).optional(),
  url: z.string().min(1),
  text: z.string().min(1),
  createdAt: isoDate,
  engagement: z.object({ score: z.number().optional(), comments: z.number().optional() }),
});

export const SellerProfileInputSchema = z.object({
  productName: z.string().min(1),
  problemDescription: z.string().min(1),
  idealCustomer: z.string().min(1).optional(),
  competitors: z.array(z.string().min(1)).default([]),
});

export const CriterionResultSchema = z.object({
  id: z.enum(CRITERION_IDS),
  passed: z.boolean(),
  quote: z.string().max(300).nullable(),
});

export const ClassifierOutputSchema = z.object({
  label: z.enum(LEAD_LABELS),
  criteria: z.array(CriterionResultSchema),
  rationale: z.string().max(280),
});

export const ScoreComponentSchema = z.object({
  name: z.enum(SCORE_COMPONENT_NAMES),
  value: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(100),
});

export const ScoreBreakdownSchema = z.object({
  components: z.array(ScoreComponentSchema).length(4),
  total: z.number().int().min(0).max(100),
});

export const RunParamsSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  sinceDays: z.number().int().min(1).max(365),
  maxResults: z.number().int().min(1).max(100),
  sources: z.array(z.enum(SOURCE_IDS)).min(1).optional(),
});

export const SampleDatasetSchema = z.object({
  synthetic: z.literal(true),
  description: z.string(),
  expectedCounts: z.record(z.string(), z.number()),
  items: z.array(z.object({
    id: z.string(),
    authorHandle: z.string(),
    community: z.string(),
    text: z.string().min(20),
    daysAgo: z.number().int().min(0),
    engagement: z.object({ score: z.number(), comments: z.number() }),
    expectedLabel: z.enum(LEAD_LABELS),
    note: z.string(),
  })),
});

export const RunCreateRequestSchema = z.object({
  seller: SellerProfileInputSchema,
  params: RunParamsSchema,
});

export const FeedbackRequestSchema = z.object({
  action: z.enum(FEEDBACK_ACTIONS),
});
