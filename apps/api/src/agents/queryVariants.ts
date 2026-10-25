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

const GENERIC_SINGLE_WORD_QUERIES = new Set(['monitor', 'monitoring', 'tracking', 'tracker', 'software', 'tool', 'tools', 'platform', 'service', 'solution', 'solutions', 'application', 'applications', 'app', 'apps']);

export const SearchVariantSchema = z.object({
  category: z.enum(SEARCH_VARIANT_CATEGORIES),
  phrase: z.string().trim().min(3).max(160),
}).refine((variant) => {
  const words = variant.phrase.split(/\s+/);
  return words.length > 1 || (variant.category === 'competitor_dissatisfaction' && !GENERIC_SINGLE_WORD_QUERIES.has(variant.phrase.toLocaleLowerCase('en-US')));
}, 'A search query must be specific and contain at least two words unless it is a competitor name');

export type SearchVariant = z.infer<typeof SearchVariantSchema>;
export type SearchQueryForm = 'quoted' | 'all_words';

export function searchQueryForm(phrase: string): SearchQueryForm {
  return phrase.trim().split(/\s+/).length <= 5 ? 'quoted' : 'all_words';
}

function cleanPhrase(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^['"“”]+|['"“”]+$/g, '').slice(0, 160).trim();
}

function tailWords(value: string, count: number): string {
  return value.split(' ').slice(-count).join(' ');
}

export function buildSearchVariants(input: {
  seller: SellerProfileInput;
  keywords: string[];
  maxVariants: number;
}): SearchVariant[] {
  const keywords = [...new Set(input.keywords.map(cleanPhrase).filter(Boolean))];
  const problem = keywords[0] || cleanPhrase(input.seller.problemDescription) || input.seller.productName;
  const core = tailWords(problem, 2);
  const competitor = input.seller.competitors.map(cleanPhrase).find(Boolean);
  const idealCustomer = input.seller.idealCustomer ? cleanPhrase(input.seller.idealCustomer) : '';
  const featureKeyword = keywords.find((keyword) => /feature|group|request/i.test(keyword));
  const monitoringKeyword = keywords.find((keyword) => /monitor/i.test(keyword));
  const budgetKeyword = keywords.find((keyword) => /affordable|budget|cheap|pricing|price/i.test(keyword));
  const trackingKeyword = keywords.find((keyword) => /\btracking\b/i.test(keyword));
  const trackerVariant = trackingKeyword?.replace(/\btracking\b/i, 'tracker');
  const operationalPhrase = monitoringKeyword?.replace(/^(affordable|budget|cheap|low[- ]cost|inexpensive)\s+/i, '') ?? `${core} operational issues`;
  const candidates: Array<{ category: (typeof SEARCH_VARIANT_CATEGORIES)[number]; phrase: string }> = [
    { category: 'problem', phrase: core || problem },
    { category: 'competitor_dissatisfaction', phrase: competitor ?? `${core} complaints` },
    { category: 'feature_request', phrase: featureKeyword ?? `${core} feature request` },
    { category: 'operational_pain', phrase: operationalPhrase },
    { category: 'budget', phrase: budgetKeyword ?? (competitor ? `${competitor} too expensive` : `${core} affordable pricing`) },
    { category: 'workaround', phrase: trackerVariant ?? `${core} workaround` },
    { category: 'switching', phrase: competitor ? `${competitor} alternative` : `${core} switching` },
    { category: 'indirect', phrase: idealCustomer ? `${idealCustomer} ${core}` : `how to ${core}` },
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
