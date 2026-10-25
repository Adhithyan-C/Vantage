import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { SellerProfileInputSchema, SOURCE_IDS } from '@vantage/shared';
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

const EvalConfigSchema = z.object({
  seller: SellerProfileInputSchema,
  search: z.object({
    keywords: z.array(z.string().min(1)).min(1),
    sinceDays: z.number().int().min(1).max(1095),
    maxResults: z.number().int().min(1).max(100).default(50),
    sources: z.array(z.enum(SOURCE_IDS)).default(['hackernews', 'stackexchange']),
  }),
  expected: z.array(z.object({
    title: z.string().min(1).optional(),
    url: z.string().url().optional(),
  }).refine((entry) => Boolean(entry.title || entry.url), 'Provide a title or URL')).min(1),
});

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / (leftNorm * rightNorm);
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: npm run eval:recall -- <expected-threads.json>');
  const source = readFileSync(resolve(inputPath), 'utf8');
  const parsed = EvalConfigSchema.safeParse(JSON.parse(source) as unknown);
  if (!parsed.success) throw new Error(`Invalid recall configuration: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  const config = parsed.data;
  const started = performance.now();
  const adapters = getEnabledAdapters().filter((adapter) => config.search.sources.includes(adapter.id));
  const variants = buildSearchVariants({ seller: config.seller, keywords: config.search.keywords, maxVariants: 8 });
  const result = await runScout({
    adapters,
    query: { ...config.search, variants, seller: config.seller },
    ctx: defaultAdapterContext(),
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
