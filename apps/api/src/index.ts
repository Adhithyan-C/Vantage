import express from 'express';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnv } from './config/env';
import { LLM_CONFIG } from './config/llm';
import { createClassifyStage } from './agents/classifier';
import { createCriticStage } from './agents/critic';
import { createScoreStage } from './agents/scorer';
import { createDisplaceStage, embedTexts } from './agents/displacement';
import { createRelevanceStage } from './agents/relevance';
import { createDecisionStore } from './db/decisions';
import { createLeadStore } from './db/leads';
import { createDb } from './db/client';
import { createRunStore } from './db/runs';
import { createThemeStore } from './db/themes';
import { createSignalJourneyStore } from './db/signalJourneys';
import { createLlmClient } from './llm/client';
import { createRunsRouter } from './routes/runs';
import { createLeadsRouter } from './routes/leads';
import { createReportRouter } from './routes/report';
import { defaultAdapterContext, getEnabledAdapters } from './sources/index';
import { DemoRunSchema } from './demo/schema';
import type { DemoRun } from './demo/schema';
import { createReplay } from './demo/replay';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

  if (process.env.DEMO_MODE === 'true') {
    let fixture: DemoRun;
    try {
      const fixturePath = fileURLToPath(new URL('../../../fixtures/demo-run.json', import.meta.url));
      fixture = DemoRunSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    } catch (err) {
      console.error(`Demo mode needs fixtures/demo-run.json. Record one with: npm run demo:record -- --run <run id>\n${errorMessage(err)}`);
      process.exitCode = 1;
      return;
    }
    const replay = createReplay({ fixture });
    const app = express();
    app.use(express.json());
    app.use(createHealthRouter(true));
    app.use(createRunsRouter({
      store: replay.runStore,
      adapters: [],
      ctx: defaultAdapterContext(),
      runner: async () => {},
      demoMode: true,
      leadStore: replay.leadStore,
      themes: replay.themeStore,
      signalJourneyStore: replay.signalJourneyStore,
    }));
    app.use(createLeadsRouter({ store: replay.leadStore }));
    app.use(createReportRouter({ runStore: replay.runStore, leadStore: replay.leadStore }));
    const port = Number(process.env.PORT ?? '3001');
    app.listen(port, () => console.log(`Vantage API listening on port ${port} (demo mode)`));
    return;
  }

  const env = getEnv();
  const db = createDb(env);
  const store = createRunStore(db);
  const signalJourneyStore = createSignalJourneyStore(db);
  let decisionStore: ReturnType<typeof createDecisionStore> | undefined;
  let leadStore: ReturnType<typeof createLeadStore> | undefined;
  let leadsRouter: express.Router | undefined;
  let reportRouter: express.Router | undefined;
  let score: ReturnType<typeof createScoreStage> | undefined;
  let classify: ReturnType<typeof createClassifyStage> | undefined;
  let critic: ReturnType<typeof createCriticStage> | undefined;
  let themes: ReturnType<typeof createThemeStore> | undefined;
  let displace: ReturnType<typeof createDisplaceStage> | undefined;
  let relevance: ReturnType<typeof createRelevanceStage> | undefined;
  try {
    const llm = createLlmClient({
      fetch: globalThis.fetch,
      geminiApiKey: env.GEMINI_API_KEY,
      groqApiKey: env.GROQ_API_KEY,
      config: LLM_CONFIG,
    });
    decisionStore = createDecisionStore(db);
    classify = createClassifyStage({ llm, store: decisionStore, config: LLM_CONFIG });
    critic = createCriticStage({ llm, store: decisionStore, config: LLM_CONFIG });
    relevance = createRelevanceStage({ store: decisionStore, embed: embedTexts });
  } catch (err) {
    console.warn(`Warning: classifier is unavailable: ${errorMessage(err)}`);
  }

  try {
    leadStore = createLeadStore(db);
    score = createScoreStage({ store: leadStore });
    leadsRouter = createLeadsRouter({ store: leadStore });
  } catch (err) {
    console.warn(`Warning: scorer is unavailable: ${errorMessage(err)}`);
  }

  try {
    themes = createThemeStore(db);
    displace = createDisplaceStage({ store: themes, embed: embedTexts });
  } catch (err) {
    console.warn(`Warning: displacement is unavailable: ${errorMessage(err)}`);
  }

  try {
    if (leadStore) {
      reportRouter = createReportRouter({ runStore: store, leadStore });
    }
  } catch (err) {
    console.warn(`Warning: report export is unavailable: ${errorMessage(err)}`);
  }

  try {
    const stale = await store.failStaleRuns();
    if (stale > 0) {
      console.log(`Marked ${stale} stale run(s) as failed`);
    }
  } catch (err) {
    console.warn(`Warning: could not check for stale runs: ${errorMessage(err)}`);
  }

  const app = express();
  app.use(express.json());

  app.use(createHealthRouter(false));

  app.use(
    createRunsRouter({
      store,
      adapters: getEnabledAdapters(),
      ctx: defaultAdapterContext(),
      classify,
      critic,
      enableCritic: env.ENABLE_CRITIC,
      displace,
      enableDisplacement: env.ENABLE_DISPLACEMENT,
      themes,
      decisionStore,
      relevance,
      score,
      leadStore,
      signalJourneyStore,
    }),
  );
  if (leadsRouter) {
    app.use(leadsRouter);
  }
  if (reportRouter) {
    app.use(reportRouter);
  }

  app.listen(env.PORT, () => {
    console.log(`Vantage API listening on port ${env.PORT}`);
  });
}

export function createHealthRouter(demo: boolean): express.Router {
  const router = express.Router();
  router.get('/health', (_req, res) => res.json({ status: 'ok', demo }));
  return router;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(errorMessage(err));
    process.exit(1);
  });
}
