import { z } from 'zod';
import type { SellerProfileInput } from '@vantage/shared';

export const SEARCH_VARIANT_CATEGORIES = [
  'problem',
  'competitor_dissatisfaction',
  'feature_request',
  'operational_pain',
  'budget',
  'workaround',
  'switching',
  'indirect',
] as const;

export const SearchVariantSchema = z.object({
  category: z.enum(SEARCH_VARIANT_CATEGORIES),
  phrase: z.string().trim().min(3).max(160),
});

export type SearchVariant = z.infer<typeof SearchVariantSchema>;

function cleanPhrase(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^['"“”]+|['"“”]+$/g, '').slice(0, 160).trim();
}

export function buildSearchVariants(input: {
  seller: SellerProfileInput;
  keywords: string[];
  maxVariants: number;
}): SearchVariant[] {
  const keywords = [...new Set(input.keywords.map(cleanPhrase).filter(Boolean))];
  const problem = cleanPhrase(input.seller.problemDescription) || keywords[0] || input.seller.productName;
  const base = keywords[0] ?? problem;
  const competitor = input.seller.competitors.map(cleanPhrase).find(Boolean);
  const idealCustomer = input.seller.idealCustomer ? cleanPhrase(input.seller.idealCustomer) : '';
  const candidates: Array<{ category: (typeof SEARCH_VARIANT_CATEGORIES)[number]; phrase: string }> = [
    { category: 'problem', phrase: problem },
    { category: 'competitor_dissatisfaction', phrase: competitor ? `${competitor} alternative` : `${base} complaints` },
    { category: 'feature_request', phrase: `${base} feature request` },
    { category: 'operational_pain', phrase: `${base} operational issues` },
    { category: 'budget', phrase: `${base} affordable pricing` },
    { category: 'workaround', phrase: `${base} workaround` },
    { category: 'switching', phrase: competitor ? `switch from ${competitor}` : `${base} switching` },
    { category: 'indirect', phrase: idealCustomer ? `${idealCustomer} ${base}` : `how to ${base}` },
  ];
  const seen = new Set<string>();
  const variants: SearchVariant[] = [];
  for (const candidate of candidates) {
    const parsed = SearchVariantSchema.safeParse({ category: candidate.category, phrase: cleanPhrase(candidate.phrase) });
    if (!parsed.success) continue;
    const key = parsed.data.phrase.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(parsed.data);
    if (variants.length >= input.maxVariants) break;
  }
  return variants;
}
