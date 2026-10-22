import { describe, expect, it } from 'vitest';
import { DemoRunSchema } from '../src/demo/schema';
import { createReplay } from '../src/demo/replay';
import { detail, fixture, LEAD_ID, lead, RUN_ID } from './demoTestFixtures';

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
});
