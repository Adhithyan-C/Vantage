import { describe, expect, it } from 'vitest';
import { buildSearchVariants } from '../src/agents/queryVariants';

describe('buildSearchVariants', () => {
  it('generates validated, deduplicated seller-profile query categories within the cap', () => {
    const variants = buildSearchVariants({
      seller: {
        productName: 'TraceLite',
        problemDescription: 'self-hosted error tracking',
        idealCustomer: 'small engineering teams',
        competitors: ['Sentry'],
      },
      keywords: ['self-hosted error tracking', 'Sentry alternative', 'error grouping'],
      maxVariants: 8,
    });
    expect(variants).toHaveLength(8);
    expect(variants.map((variant) => variant.category)).toEqual([
      'problem', 'competitor_dissatisfaction', 'feature_request', 'operational_pain',
      'budget', 'workaround', 'switching', 'indirect',
    ]);
    expect(new Set(variants.map((variant) => variant.phrase.toLowerCase())).size).toBe(variants.length);
    expect(variants.some((variant) => variant.phrase.includes('Sentry'))).toBe(true);
  });
});
