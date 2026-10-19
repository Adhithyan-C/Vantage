import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SampleDatasetSchema } from '@vantage/shared';

const fixturePath = fileURLToPath(new URL('../../../fixtures/sample-signals.json', import.meta.url));

describe('SampleDatasetSchema', () => {
  it('accepts the human-supplied sample fixture', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
    expect(SampleDatasetSchema.safeParse(fixture).success).toBe(true);
  });

  it('rejects synthetic false', () => {
    const fixture = SampleDatasetSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    expect(SampleDatasetSchema.safeParse({ ...fixture, synthetic: false }).success).toBe(false);
  });

  it('rejects a negative daysAgo value', () => {
    const fixture = SampleDatasetSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const items = fixture.items.map((item, index) => index === 0 ? { ...item, daysAgo: -1 } : item);
    expect(SampleDatasetSchema.safeParse({ ...fixture, items }).success).toBe(false);
  });

  it('rejects an unknown expected label', () => {
    const fixture = SampleDatasetSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const items = fixture.items.map((item, index) => index === 0 ? { ...item, expectedLabel: 'unknown' } : item);
    expect(SampleDatasetSchema.safeParse({ ...fixture, items }).success).toBe(false);
  });

  it('rejects text shorter than 20 characters', () => {
    const fixture = SampleDatasetSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const items = fixture.items.map((item, index) => index === 0 ? { ...item, text: 'too short' } : item);
    expect(SampleDatasetSchema.safeParse({ ...fixture, items }).success).toBe(false);
  });
});
