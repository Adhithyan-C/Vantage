import dotenv from 'dotenv';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LeadDetail, LeadView, RunEvent, RunView, SignalJourney, SignalRunSummary, SourceRequestView, ThemeView } from '@vantage/shared';
import { getEnv } from '../config/env';
import { createDb } from '../db/client';
import { createLeadStore } from '../db/leads';
import { createRunStore } from '../db/runs';
import { createThemeStore } from '../db/themes';
import { createSignalJourneyStore } from '../db/signalJourneys';
import { DemoRunSchema } from '../demo/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DemoFixtureInput {
  recordedAt: string;
  run: RunView;
  events: RunEvent[];
  leads: LeadView[];
  details: Record<string, LeadDetail>;
  requests?: SourceRequestView[];
  themes?: ThemeView[];
  collectedSignals?: SignalRunSummary[];
  journeys?: Record<string, SignalJourney>;
}

export function buildDemoFixture(input: DemoFixtureInput) {
  const events = [...input.events]
    .sort((left, right) => left.id - right.id)
    .map((event) => ({
      ...event,
      offsetMs: Math.max(0, Date.parse(event.createdAt) - Date.parse(input.run.startedAt)),
    }));
  return DemoRunSchema.parse({
    version: 1,
    recordedAt: input.recordedAt,
    note: `Recorded from run ${input.run.id.slice(0, 8)}`,
    run: input.run,
    events,
    leads: input.leads,
    details: input.details,
    requests: input.requests ?? [],
    themes: input.themes ?? [],
    collectedSignals: input.collectedSignals,
    journeys: input.journeys,
  });
}

async function main(): Promise<void> {
  dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });
  const { values } = parseArgs({ options: {
    run: { type: 'string' },
    out: { type: 'string' },
  } });
  if (!values.run || !UUID_RE.test(values.run)) {
    console.error('--run must be a valid UUID');
    process.exitCode = 1;
    return;
  }
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const outPath = resolve(repoRoot, values.out ?? 'fixtures/demo-run.json');
  const db = createDb(getEnv());
  const runStore = createRunStore(db);
  const themeStore = createThemeStore(db);
  const signalJourneyStore = createSignalJourneyStore(db);
  const leadStore = createLeadStore(db);
  const run = await runStore.getRun(values.run);
  if (!run) {
    console.error(`Run ${values.run} was not found`);
    process.exitCode = 1;
    return;
  }
  if (run.status === 'running') {
    console.error(`Run ${values.run} is still running`);
    process.exitCode = 1;
    return;
  }
  const events: RunEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await runStore.listEvents(values.run, after);
    if (page.length === 0) break;
    events.push(...page);
    after = page[page.length - 1]!.id;
  }
  const leads = await leadStore.listLeads(values.run, true);
  const details: Record<string, LeadDetail> = {};
  for (const lead of leads) {
    const detail = await leadStore.getLeadDetail(lead.leadId);
    if (!detail) throw new Error(`Could not load detail for lead ${lead.leadId}`);
    details[lead.leadId] = detail;
  }
  const fixture = buildDemoFixture({
    recordedAt: new Date().toISOString(), run, events, leads, details,
    requests: await runStore.listSourceRequests(values.run),
    themes: await themeStore.listThemes(values.run),
    ...await (async () => {
      const collectedSignals: SignalRunSummary[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await signalJourneyStore.listRunSignals(values.run!, 100, offset);
        collectedSignals.push(...page.signals);
        if (collectedSignals.length >= page.total || page.signals.length === 0) break;
      }
      const journeys: Record<string, SignalJourney> = {};
      for (const signal of collectedSignals) {
        const journey = await signalJourneyStore.getSignalJourney(values.run!, signal.signalId);
        if (journey) journeys[signal.signalId] = journey;
      }
      return { collectedSignals, journeys };
    })(),
  });
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`Recorded ${fixture.events.length} events, ${fixture.leads.length} leads, ${Object.keys(fixture.details).length} details`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
