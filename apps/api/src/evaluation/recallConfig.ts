import { z } from 'zod';
import { SellerProfileInputSchema, SOURCE_IDS } from '@vantage/shared';

export const PRODUCTION_MAX_LOOKBACK_DAYS = 1095;

export const EvalRecallConfigSchema = z.object({
  seller: SellerProfileInputSchema,
  search: z.object({
    keywords: z.array(z.string().min(1)).min(1),
    sinceDays: z.number().int().min(1).max(3650),
    maxResults: z.number().int().min(1).max(100).default(50),
    sources: z.array(z.enum(SOURCE_IDS)).default(['hackernews', 'stackexchange']),
  }),
  expected: z.array(z.object({
    title: z.string().min(1).optional(),
    url: z.string().url().optional(),
  }).refine((entry) => Boolean(entry.title || entry.url), 'Provide a title or URL')).min(1),
});
