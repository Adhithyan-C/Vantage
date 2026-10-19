import { describe, expect, it } from 'vitest';
import { buildDemoFixture } from '../src/scripts/demo-record';
import { detail, events, fixture, lead, run, startedAt } from './demoTestFixtures';

describe('buildDemoFixture', () => {
  it('sorts events, computes non-negative offsets, and labels the source run', () => {
    const source = fixture();
    const result = buildDemoFixture({
      recordedAt: source.recordedAt,
      run: { ...run, id: '12345678-0000-4000-8000-000000000001' },
      events: [
        { ...events[0]!, createdAt: '2026-10-18T09:59:59.000Z' },
        ...events.slice(1),
      ],
      leads: [lead],
      details: { [lead.leadId]: detail },
    });
    expect(result.events.map((event) => event.id)).toEqual([1, 2]);
    expect(result.events.map((event) => event.offsetMs)).toEqual([1000, 0]);
    expect(result.note).toBe('Recorded from run 12345678');
    expect(Date.parse(startedAt)).toBeLessThan(Date.parse(result.run.finishedAt ?? startedAt));
  });
});
