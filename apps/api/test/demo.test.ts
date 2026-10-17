import { describe, it, expect } from 'vitest';
import { loadDemoSeller, DEMO_RUN_PARAMS } from '../src/config/demo';
import { RunParamsSchema } from '../../../packages/shared/src/schemas';

describe('demo config', () => {
  it('loadDemoSeller returns productName "Beacon Support"', () => {
    const seller = loadDemoSeller();
    expect(seller.productName).toBe('Beacon Support');
  });

  it('DEMO_RUN_PARAMS passes RunParamsSchema.safeParse', () => {
    expect(RunParamsSchema.safeParse(DEMO_RUN_PARAMS).success).toBe(true);
  });
});