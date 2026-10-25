import { describe, expect, it } from 'vitest';
import { buildSearchVariants, SearchVariantSchema, searchQueryForm } from '../src/agents/queryVariants';

describe('buildSearchVariants', () => {
  it('generates validated, deduplicated seller-profile query categories within the cap', () => {
    const variants = buildSearchVariants({
      seller: {
        productName: 'TraceLite',
        problemDescription: 'self-hosted error tracking',
        idealCustomer: 'small engineering teams',
        competitors: ['Sentry'],
      },
      keywords: ['self-hosted error tracking', 'Sentry alternative', 'error grouping', 'affordable error monitoring'],
      maxVariants: 8,
    });
    expect(variants).toHaveLength(8);
    expect(variants.map((variant) => variant.category)).toEqual([
      'problem', 'competitor_dissatisfaction', 'feature_request', 'operational_pain',
      'budget', 'workaround', 'switching', 'indirect',
    ]);
    expect(new Set(variants.map((variant) => variant.phrase.toLowerCase())).size).toBe(variants.length);
    expect(variants.map((variant) => variant.phrase)).toEqual([
      'error tracking', 'Sentry', 'error grouping', 'error monitoring',
      'affordable error monitoring', 'self-hosted error tracker', 'Sentry alternative',
      'small engineering teams error tracking',
    ]);
    expect(variants.every((variant) => variant.phrase.split(/\s+/).length > 1 || variant.category === 'competitor_dissatisfaction')).toBe(true);
  });

  it('rejects generic single-word searches but allows a competitor name', () => {
    expect(SearchVariantSchema.safeParse({ category: 'operational_pain', phrase: 'monitoring' }).success).toBe(false);
    expect(SearchVariantSchema.safeParse({ category: 'competitor_dissatisfaction', phrase: 'Sentry' }).success).toBe(true);
  });

  it('quotes only phrases up to five words', () => {
    expect(searchQueryForm('affordable error monitoring for teams')).toBe('quoted');
    expect(searchQueryForm('affordable error monitoring for small teams')).toBe('all_words');
  });

  it('omits a tracker variant when the profile has only a generic tracking term', () => {
    const variants = buildSearchVariants({
      seller: { productName: 'Tool', problemDescription: 'tracking', competitors: [] },
      keywords: ['tracking'],
      maxVariants: 8,
    });
    expect(variants.some((variant) => variant.phrase === 'tracker')).toBe(false);
    expect(variants.every((variant) => variant.phrase.split(/\s+/).length > 1)).toBe(true);
  });
});
