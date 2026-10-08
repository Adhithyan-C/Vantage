import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runScout } from '../agents/scout.js';
import { getEnabledAdapters } from '../sources/index.js';
import { SOURCE_CONFIG } from '../config/sources.js';

const { values } = parseArgs({
  options: {
    keywords: { type: 'string', default: 'zendesk alternative,helpdesk software' },
    'since-days': { type: 'string', default: '30' },
    max: { type: 'string', default: '50' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const keywordsRaw = values['keywords'] as string;
const sinceDaysRaw = values['since-days'] as string;
const maxRaw = values['max'] as string;
const dryRun = values['dry-run'] as boolean;

// Validate since-days and max
const sinceDays = parseInt(sinceDaysRaw, 10);
const maxResults = parseInt(maxRaw, 10);

if (!Number.isInteger(sinceDays) || sinceDays <= 0 || String(sinceDays) !== sinceDaysRaw) {
  console.error(`Error: --since-days must be a positive integer, got: "${sinceDaysRaw}"`);
  process.exit(1);
}

if (!Number.isInteger(maxResults) || maxResults <= 0 || String(maxResults) !== maxRaw) {
  console.error(`Error: --max must be a positive integer, got: "${maxRaw}"`);
  process.exit(1);
}

// Split and clean keywords
const keywords = keywordsRaw
  .split(',')
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

// Permanent output line: print parsed keywords as JSON array
console.log('Keywords:', JSON.stringify(keywords));

// Build context
const ctx = {
  fetch: globalThis.fetch,
  now: () => new Date(),
  userAgent: 'vantage-lab-project/0.1',
  timeoutMs: SOURCE_CONFIG.requestTimeoutMs,
  maxRetries: SOURCE_CONFIG.maxRetries,
};

// Run scout
const adapters = getEnabledAdapters();
const result = await runScout({
  adapters,
  query: { keywords, sinceDays, maxResults },
  ctx,
});

// Print source reports
for (const source of result.sources) {
  const errorText = source.error ? ` — ${source.error}` : '';
  console.log(`${source.source}: ${source.status} (fetched ${source.fetched})${errorText}`);
}

console.log(`\nTotal fetched: ${result.fetchedTotal}`);
console.log(`After dedupe:  ${result.afterDedupe}`);
console.log();

// Print signals
const signals = result.signals;
const toShow = signals.slice(0, 20);

for (const signal of toShow) {
  const ageDays = Math.floor(
    (Date.now() - new Date(signal.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  console.log(`[${signal.source}] @${signal.authorHandle} | ${ageDays} days ago | ${signal.url}`);
  console.log(signal.text.slice(0, 160));
  console.log();
}

if (signals.length > 20) {
  console.log(`... and ${signals.length - 20} more`);
}

// Database write or dry run
if (dryRun) {
  console.log('Dry run: nothing written to the database.');
} else {
  // Load dotenv and write to DB
  const dotenv = await import('dotenv');
  dotenv.default.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

  const { getEnv } = await import('../config/env.js');
  let env;
  try {
    env = getEnv();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const { createDb } = await import('../db/client.js');
  const { upsertSignals } = await import('../db/queries.js');

  const db = createDb(env);
  const { inserted, updated } = await upsertSignals(db, result.signals);
  console.log(`Stored: ${inserted} inserted, ${updated} updated`);
}