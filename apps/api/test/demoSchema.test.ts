import { describe, expect, it } from 'vitest';
import type { LeadDetail, LeadView, RunEvent, RunView } from '@vantage/shared';
import { DemoRunSchema } from '../src/demo/schema';
import { fixture, LEAD_ID } from './demoTestFixtures';

describe('DemoRunSchema', () => {
  it('accepts the small fixture with output assignable to shared view types', () => {
    const parsed = DemoRunSchema.parse(fixture());
    const run: RunView = parsed.run;
    const event: RunEvent = parsed.events[0]!;
    const lead: LeadView = parsed.leads[0]!;
    const detail: LeadDetail = parsed.details[LEAD_ID]!;
    expect([run.id, event.runId, lead.leadId, detail.runId]).toEqual([
      run.id, run.id, LEAD_ID, run.id,
    ]);
    expect(parsed.requests).toEqual([]);
    expect(parsed.themes).toEqual([]);
  });

  it('accepts a fixture containing request views', () => {
    const parsed = DemoRunSchema.parse({ ...fixture(), requests: [{ id: 1, source: 'hackernews', label: 'support', status: 'ok', httpStatus: 200, durationMs: 3, itemsReturned: 2, error: null, quotaRemaining: null, createdAt: '2026-10-18T10:00:01.000Z' }] });
    expect(parsed.requests).toHaveLength(1);
  });

  it('rejects a missing field, unknown label, unsupported version, and missing detail', () => {
    const valid = fixture();
    const { run: missingRun, ...missing } = valid;
    expect(DemoRunSchema.safeParse({ ...missing, run: { ...missingRun, id: undefined } }).success).toBe(false);
    expect(DemoRunSchema.safeParse({ ...valid, leads: [{ ...valid.leads[0], label: 'unknown' }] }).success).toBe(false);
    expect(DemoRunSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
    expect(DemoRunSchema.safeParse({ ...valid, details: {} }).success).toBe(false);
  });
});
