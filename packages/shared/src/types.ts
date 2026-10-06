import { z } from 'zod';
import { SOURCE_IDS, LEAD_LABELS, CRITERION_IDS } from './constants';
import { RawSignalSchema, SellerProfileInputSchema, CriterionResultSchema, ClassifierOutputSchema, ScoreComponentSchema, ScoreBreakdownSchema } from './schemas';

export type SourceId = (typeof SOURCE_IDS)[number];
export type LeadLabel = (typeof LEAD_LABELS)[number];
export type CriterionId = (typeof CRITERION_IDS)[number];
export type RawSignal = z.infer<typeof RawSignalSchema>;
export type SellerProfileInput = z.infer<typeof SellerProfileInputSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
