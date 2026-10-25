import { describe, expect, it } from 'vitest';
import { DemoRunSchema } from '../src/demo/schema';
import { createReplay } from '../src/demo/replay';
import { detail, fixture, LEAD_ID, lead, RUN_ID, startedAt } from './demoTestFixtures';
import type { SignalJourney, SignalRunSummary } from '@vantage/shared';

function makeFixture() {
  const base = fixture();
  const unranked = { ...lead, leadId: 'noise-id', label: 'noise' as const, rank: 0 };
  const unrankedDetail = { ...detail, lead: unranked };
  return DemoRunSchema.parse({
    ...base,
    events: base.events.map((event) => ({ ...event, offsetMs: event.id * 1000 })),
    leads: [lead, unranked],
    details: { ...base.details, [unranked.leadId]: unrankedDetail },
  });
}

describe('createReplay', () => {
  it('is finished before starting, then reveals events by time and afterId', async () => {
    let clock = 10_000;
    const fixtureData = makeFixture();
    const replay = createReplay({ fixture: fixtureData, now: () => clock });
    expect((await replay.runStore.getRun(RUN_ID))?.status).toBe('completed');
    expect((await replay.runStore.listEvents(RUN_ID, 0))).toHaveLength(2);
    await replay.runStore.createRun('seller', fixtureData.run.params);
    expect((await replay.runStore.getRun(RUN_ID))?.status).toBe('running');
    expect(await replay.runStore.listEvents(RUN_ID, 0)).toEqual([]);
    clock += 1000;
    expect((await replay.runStore.listEvents(RUN_ID, 0)).map((event) => event.id)).toEqual([1]);
    clock += 1000;
    expect((await replay.runStore.listEvents(RUN_ID, 1)).map((event) => event.id)).toEqual([2]);
    clock += 1500;
    expect((await replay.runStore.getRun(RUN_ID))?.status).toBe('completed');
  });

  it('scales long replays only when needed and resets when replay starts again', async () => {
    let clock = 1_000;
    const fixtureData = makeFixture();
    const scaled = createReplay({ fixture: fixtureData, now: () => clock, maxTotalMs: 1000 });
    await scaled.runStore.createRun('seller', fixtureData.run.params);
    clock += 285;
    expect(await scaled.runStore.listEvents(RUN_ID, 0)).toEqual([]);
    clock += 1;
    expect((await scaled.runStore.listEvents(RUN_ID, 0)).map((event) => event.id)).toEqual([1]);
    clock += 714;
    expect((await scaled.runStore.getRun(RUN_ID))?.status).toBe('completed');
    clock = 5_000;
    await scaled.runStore.createRun('seller', fixtureData.run.params);
    expect((await scaled.runStore.getRun(RUN_ID))?.status).toBe('running');
    const unscaled = createReplay({ fixture: fixtureData, now: () => clock, maxTotalMs: 10_000 });
    await unscaled.runStore.createRun('seller', fixtureData.run.params);
    clock += 1500;
    expect((await unscaled.runStore.listEvents(RUN_ID, 0)).map((event) => event.id)).toEqual([1]);
  });

  it('isolates wrong run ids and applies in-memory feedback and lead status changes', async () => {
    const fixtureData = makeFixture();
    const replay = createReplay({ fixture: fixtureData });
    expect(await replay.runStore.getRun('wrong')).toBeNull();
    expect(await replay.runStore.listEvents('wrong', 0)).toEqual([]);
    expect(await replay.leadStore.listLeads('wrong', true)).toEqual([]);
    expect((await replay.leadStore.listLeads(RUN_ID, false)).map((item) => item.label)).toEqual(['buyer_intent']);
    expect((await replay.leadStore.listLeads(RUN_ID, true)).map((item) => item.label)).toEqual(['buyer_intent', 'noise']);
    expect(await replay.leadStore.setLeadStatus(LEAD_ID, 'accepted')).toBe(true);
    expect((await replay.leadStore.getLeadDetail(LEAD_ID))?.lead.status).toBe('accepted');
    await replay.leadStore.addFeedback(LEAD_ID, 'reject');
    expect((await replay.leadStore.listLeads(RUN_ID, false))[0]?.status).toBe('rejected');
    expect(await replay.leadStore.setLeadStatus('unknown', 'new')).toBe(false);
    await expect(replay.leadStore.saveLeads(RUN_ID, [])).rejects.toThrow('Not available in demo mode');
    await expect(replay.leadStore.getScoringContext(RUN_ID)).rejects.toThrow('Not available in demo mode');
  });

  it('reveals source requests after the first Scout event becomes visible', async () => {
    let clock = 0;
    const fixtureData = DemoRunSchema.parse({ ...fixture(), requests: [{ id: 1, source: 'hackernews', label: 'support', status: 'ok', httpStatus: 200, durationMs: 3, itemsReturned: 2, error: null, quotaRemaining: null, createdAt: '2026-10-18T10:00:01.000Z' }] });
    const replay = createReplay({ fixture: fixtureData, now: () => clock });
    await replay.runStore.createRun('seller', fixtureData.run.params);
    expect(await replay.runStore.listSourceRequests(RUN_ID)).toEqual([]);
    clock = 1000;
    expect(await replay.runStore.listSourceRequests(RUN_ID)).toHaveLength(1);
  });

  it('reveals themes after a displacement event and disallows writes in demo mode', async () => {
    let clock = 0;
    const base = fixture();
    const themed = DemoRunSchema.parse({
      ...base,
      events: [...base.events, {
        id: 3, runId: RUN_ID, agent: 'displacement', kind: 'info', message: 'Found 1 theme(s)',
        counts: { themeCount: 1 }, createdAt: '2026-10-18T10:00:03.000Z', offsetMs: 3000,
      }],
      themes: [{ id: 'theme-1', runId: RUN_ID, competitor: 'Acme', title: 'Acme: slow search', summary: '3 signals', quotes: [], members: [], sampleData: false }],
    });
    const replay = createReplay({ fixture: themed, now: () => clock });
    await replay.runStore.createRun('seller', themed.run.params);
    expect(await replay.themeStore.listThemes(RUN_ID)).toEqual([]);
    clock = 3000;
    expect(await replay.themeStore.listThemes(RUN_ID)).toEqual(themed.themes);
    await expect(replay.themeStore.getThemeInputs(RUN_ID)).rejects.toThrow('Not available in demo mode');
    await expect(replay.themeStore.saveThemes(RUN_ID, [])).rejects.toThrow('Not available in demo mode');
  });

  it('replays optional collected signal summaries and their seven-entry journeys', async () => {
    const names = ['scout', 'classifier', 'critic', 'enricher', 'scorer', 'displacement', 'outcome'] as const;
    const stages = Object.fromEntries(names.map((stage) => [stage, { status: 'completed' as const }])) as SignalRunSummary['stages'];
    const summary: SignalRunSummary = { signalId: 'raw-signal', leadId: null, source: 'hackernews', authorHandle: 'seller', url: 'https://example.test', textPreview: 'Post', createdAtSource: startedAt, label: null, score: null, stages };
    const journey: SignalJourney = { ...summary, text: 'Full post', timeline: names.map((stage) => ({ stage, status: 'completed' as const, reason: null, output: {} })) };
    const fixtureData = DemoRunSchema.parse({ ...fixture(), collectedSignals: [summary], journeys: { [summary.signalId]: journey } });
    const replay = createReplay({ fixture: fixtureData });
    expect(await replay.signalJourneyStore.listRunSignals(RUN_ID, 50, 0)).toEqual({ signals: [summary], total: 1 });
    expect(await replay.signalJourneyStore.getSignalJourney(RUN_ID, summary.signalId)).toEqual(journey);
  });
});
