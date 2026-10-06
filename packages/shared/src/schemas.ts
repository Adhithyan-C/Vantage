import { z } from 'zod';
import { SOURCE_IDS, LEAD_LABELS, CRITERION_IDS, SCORE_COMPONENT_NAMES } from './constants';

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
