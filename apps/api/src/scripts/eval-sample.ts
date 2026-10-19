import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ClassifierOutputSchema, SampleDatasetSchema, LEAD_LABELS } from '@vantage/shared';
import type { LeadLabel } from '@vantage/shared';
import { loadDemoSeller } from '../config/demo.js';
import { getEnv } from '../config/env.js';
import { resolveLlmConfig } from '../config/llm.js';
import { accuracy, confusionMatrix, perLabelStats } from '../evaluation/metrics.js';
import { createLlmClient } from '../llm/client.js';
import { buildClassifierPrompt } from '../llm/prompts/classifier.v2.js';
import { finalizeClassification } from '../verification/verifyQuote.js';

dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const { values } = parseArgs({ options: { limit: { type: 'string', default: '36' } } });
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('--limit must be a positive integer');
  process.exitCode = 1;
} else {
  const env = getEnv();
  const config = resolveLlmConfig(env);
  const client = createLlmClient({
    fetch: globalThis.fetch,
    geminiApiKey: env.GEMINI_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    config,
  });
  const datasetPath = fileURLToPath(new URL('../../../../fixtures/sample-signals.json', import.meta.url));
  const dataset = SampleDatasetSchema.parse(JSON.parse(readFileSync(datasetPath, 'utf8')));
  const seller = loadDemoSeller();
  const items = dataset.items.slice(0, limit);
  const pairs: Array<{ expected: LeadLabel; predicted: LeadLabel }> = [];
  const predictions = new Map<string, LeadLabel>();
  let failed = 0;
  let discardedQuotes = 0;

  for (const item of items) {
    const { system, prompt } = buildClassifierPrompt({ seller, text: item.text });
    const result = await client.generateJson({ system, prompt, schema: ClassifierOutputSchema });
    if (!result.ok) {
      failed += 1;
      const reason = result.providerErrors.at(-1)?.message ?? result.error;
      console.log(`${item.id} expected=${item.expectedLabel} predicted=FAILED ! reason=${reason} quote-check: unavailable`);
      continue;
    }

    const finalized = finalizeClassification(result.data, item.text);
    const predicted = finalized.output.label;
    const discarded = finalized.notes.unverified.length;
    predictions.set(item.id, predicted);
    pairs.push({ expected: item.expectedLabel, predicted });
    discardedQuotes += discarded;
    const mark = predicted === item.expectedLabel ? '✓' : '✗';
    const quoteCheck = discarded === 0 ? 'quote-check: ok' : `quote-check: ${discarded} discarded`;
    console.log(`${item.id} expected=${item.expectedLabel} predicted=${predicted} ${mark} ${quoteCheck}`);
  }

  const matrix = confusionMatrix(pairs);
  const stats = perLabelStats(matrix);
  console.log(`Accuracy: ${(accuracy(pairs) * 100).toFixed(2)}%`);
  console.log('Confusion matrix (expected rows, predicted columns):');
  console.log(`expected\\predicted\t${LEAD_LABELS.join('\t')}`);
  for (const expected of LEAD_LABELS) {
    console.log(`${expected}\t${LEAD_LABELS.map((predicted) => matrix[expected][predicted]).join('\t')}`);
  }
  console.log('Per-label statistics:');
  for (const label of LEAD_LABELS) {
    console.log(`${label}: precision=${stats[label].precision.toFixed(3)} recall=${stats[label].recall.toFixed(3)} support=${stats[label].support}`);
  }
  console.log(`Failed items: ${failed}/${items.length}`);
  console.log(`Discarded quotes: ${discardedQuotes}`);
  const injection32 = predictions.get('s32') ?? 'not evaluated';
  const injection33 = predictions.get('s33') ?? 'not evaluated';
  const injectionBuyerIntent = injection32 === 'buyer_intent' || injection33 === 'buyer_intent';
  console.log(`Injection predictions: s32=${injection32}, s33=${injection33}`);
  console.log(`Either injection item labelled buyer_intent: ${injectionBuyerIntent ? 'yes' : 'no'}`);

  if (failed > items.length / 2) {
    process.exitCode = 1;
  }
}
