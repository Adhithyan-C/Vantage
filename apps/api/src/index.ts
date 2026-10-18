import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { getEnv } from './config/env';
import { LLM_CONFIG } from './config/llm';
import { createClassifyStage } from './agents/classifier';
import { createDecisionStore } from './db/decisions';
import { createDb } from './db/client';
import { createRunStore } from './db/runs';
import { createLlmClient } from './llm/client';
import { createRunsRouter } from './routes/runs';
import { defaultAdapterContext, getEnabledAdapters } from './sources/index';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

  const env = getEnv();
  const db = createDb(env);
  const store = createRunStore(db);
  let decisionStore: ReturnType<typeof createDecisionStore> | undefined;
  let classify: ReturnType<typeof createClassifyStage> | undefined;
  try {
    const llm = createLlmClient({
      fetch: globalThis.fetch,
      geminiApiKey: env.GEMINI_API_KEY,
      groqApiKey: env.GROQ_API_KEY,
      config: LLM_CONFIG,
    });
    decisionStore = createDecisionStore(db);
    classify = createClassifyStage({ llm, store: decisionStore, config: LLM_CONFIG });
  } catch (err) {
    console.warn(`Warning: classifier is unavailable: ${errorMessage(err)}`);
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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    createRunsRouter({
      store,
      adapters: getEnabledAdapters(),
      ctx: defaultAdapterContext(),
      classify,
      decisionStore,
    }),
  );

  app.listen(env.PORT, () => {
    console.log(`Vantage API listening on port ${env.PORT}`);
  });
}

main().catch((err: unknown) => {
  console.error(errorMessage(err));
  process.exit(1);
});
