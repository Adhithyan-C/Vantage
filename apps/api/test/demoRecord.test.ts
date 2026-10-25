import { describe, expect, it } from 'vitest';
import { buildDemoFixture } from '../src/scripts/demo-record';
import { detail, events, fixture, lead, run, startedAt } from './demoTestFixtures';
import type { SourceRequestView, ThemeView } from '@vantage/shared';

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

  it('includes recorded source requests', () => {
    const request: SourceRequestView = { id: 4, source: 'hackernews', label: 'support', status: 'ok', httpStatus: 200, durationMs: 1, itemsReturned: 2, error: null, quotaRemaining: null, createdAt: startedAt };
    const source = fixture();
    const result = buildDemoFixture({ recordedAt: source.recordedAt, run, events, leads: [lead], details: { [lead.leadId]: detail }, requests: [request] });
    expect(result.requests).toEqual([request]);
  });

  it('records theme views and defaults them to an empty list', () => {
    const source = fixture();
    const theme: ThemeView = { id: 't', runId: run.id, competitor: 'Acme', title: 'Acme: slow', summary: '3 signals', quotes: [], members: [], sampleData: false };
    const withTheme = buildDemoFixture({ recordedAt: source.recordedAt, run, events, leads: [lead], details: { [lead.leadId]: detail }, themes: [theme] });
    const withoutTheme = buildDemoFixture({ recordedAt: source.recordedAt, run, events, leads: [lead], details: { [lead.leadId]: detail } });
    expect(withTheme.themes).toEqual([theme]);
    expect(withoutTheme.themes).toEqual([]);
  });
});
