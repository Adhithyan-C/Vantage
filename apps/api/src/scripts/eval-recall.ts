import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { LeadLabel, RawSignal } from '@vantage/shared';
import { buildSearchVariants } from '../agents/queryVariants';
import { createClassifyStage } from '../agents/classifier';
import { embedTexts } from '../agents/displacement';
import { LLM_CONFIG } from '../config/llm';
import { createLlmClient } from '../llm/client';
import { getEnabledAdapters, defaultAdapterContext } from '../sources';
import { runScout } from '../agents/scout';
import { contentHash } from '../utils/hash';
import type { DecisionRow, DecisionStore, RunSignalContext } from '../db/decisions';
import { assessRecall } from '../evaluation/recall';
import { formatVerboseRequest } from '../evaluation/verboseRequests';
import { resolveCliPath } from '../utils/cliPath';
import { PRODUCTION_MAX_LOOKBACK_DAYS, EvalRecallConfigSchema } from '../evaluation/recallConfig';

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / (leftNorm * rightNorm);
}

async function main(): Promise<void> {
  dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const inputPath = args.find((argument) => argument !== '--verbose');
  if (!inputPath) throw new Error('Usage: npm run eval:recall -- <expected-threads.json> [--verbose]');
  const source = readFileSync(resolveCliPath(inputPath), 'utf8');
  const parsed = EvalRecallConfigSchema.safeParse(JSON.parse(source) as unknown);
  if (!parsed.success) throw new Error(`Invalid recall configuration: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  const config = parsed.data;
  const started = performance.now();
  const adapters = getEnabledAdapters().filter((adapter) => config.search.sources.includes(adapter.id));
  const variants = buildSearchVariants({ seller: config.seller, keywords: config.search.keywords, maxVariants: 8 });
  if (verbose) {
    const cutoff = new Date(Date.now() - config.search.sinceDays * 86400_000).toISOString().slice(0, 10);
    const evalOnly = config.search.sinceDays > PRODUCTION_MAX_LOOKBACK_DAYS
      ? ` (eval-only; production limit is ${PRODUCTION_MAX_LOOKBACK_DAYS} days)`
      : '';
    console.log(`Lookback: ${config.search.sinceDays} days${evalOnly}; source cutoff ${cutoff}`);
    console.log('Generated query variants:');
    for (const variant of variants) console.log(`- ${variant.category}: ${variant.phrase}`);
  }
  const adapterContext = defaultAdapterContext();
  const result = await runScout({
    adapters,
    query: { ...config.search, variants, seller: config.seller },
    ctx: {
      ...adapterContext,
      ...(verbose ? { onRequest: (record) => console.log(formatVerboseRequest(record)) } : {}),
    },
  });
  const signals = result.signals;
  const profileText = [config.seller.problemDescription, config.seller.idealCustomer ?? '', ...config.seller.competitors, ...config.search.keywords]
    .filter(Boolean).join('\n');
  const vectors = await embedTexts([profileText, ...signals.map((signal) => signal.text), ...config.expected.map((item) => item.title ?? item.url ?? '')]);
  const profileVector = vectors[0] ?? [];
  const similarities = new Map<string, number>();
  signals.forEach((signal, index) => {
    const vector = vectors[index + 1];
    if (vector) similarities.set(signal.externalId, cosine(profileVector, vector));
  });

  const runSignals: RunSignalContext[] = signals.map((signal, index) => ({
    id: signal.externalId,
    text: signal.text,
    source: signal.source,
    url: signal.url,
    authorHandle: signal.authorHandle,
    createdAtSource: signal.createdAt,
    contentHash: contentHash(signal.text),
  }));
  const context = { seller: config.seller, signals: runSignals };
  const decisions: DecisionRow[] = [];
  const memoryStore: DecisionStore = {
    getRunContext: async () => context,
    listCriticCandidates: async () => [],
    findReusable: async () => null,
    saveDecision: async (row) => { decisions.push(row); },
    listDecisions: async () => [],
  };
  const hasProviderKey = Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
  if (hasProviderKey && runSignals.length > 0) {
    const llm = createLlmClient({ fetch: globalThis.fetch, groqApiKey: process.env.GROQ_API_KEY, geminiApiKey: process.env.GEMINI_API_KEY, config: LLM_CONFIG });
    await createClassifyStage({ llm, store: memoryStore, config: LLM_CONFIG })('recall-eval', undefined, { keywords: config.search.keywords });
  }
  const labels = new Map<string, LeadLabel>();
  for (const decision of decisions) {
    const label = decision.output.label;
    if (decision.status === 'ok' && (label === 'buyer_intent' || label === 'competitor_complaint' || label === 'venting' || label === 'noise')) {
      labels.set(decision.signalId, label);
    }
  }
  const expectedSimilarities = config.expected.map((_item, index) => {
    const vector = vectors[signals.length + index + 1];
    return vector ? cosine(profileVector, vector) : 0;
  });
  const assessments = assessRecall(config.expected, signals, similarities, labels, expectedSimilarities);
  for (const item of assessments) {
    const name = item.expected.title ?? item.expected.url ?? 'Expected thread';
    const label = item.retrieved ? item.label ?? (hasProviderKey ? 'unclassified' : 'LLM key not configured') : 'not_retrieved';
    console.log(`${item.retrieved ? 'RETRIEVED' : 'MISSING'} | ${name} | similarity ${item.similarity === null ? 'n/a' : item.similarity.toFixed(3)} | label ${label}`);
  }
  console.log(`Retrieved ${signals.length} unique post(s) in ${Math.round(performance.now() - started)} ms across ${result.sources.length} source(s).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
