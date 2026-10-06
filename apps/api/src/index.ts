import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { getEnv } from './config/env.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

try {
  const env = getEnv();
  const app = express();

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.listen(env.PORT, () => {
    console.log(`Vantage API listening on port ${env.PORT}`);
  });
} catch (err: any) {
  console.error(err.message);
  process.exit(1);
}
