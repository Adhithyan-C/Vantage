import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { getEnv } from './config/env';
import { createDb } from './db/client';
import { createRunStore } from './db/runs';
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