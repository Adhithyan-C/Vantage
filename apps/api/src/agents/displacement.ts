import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CriterionId, SourceId, ThemeQuote } from '@vantage/shared';
import {
  DBSCAN_EPS,
  DBSCAN_MIN_PTS,
  EMBED_BATCH_SIZE,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL,
  MAX_EMBED_CHARS,
  MODEL_CACHE_DIR,
  MAX_TERMS_PER_THEME,
  MIN_SIGNALS_PER_COMPETITOR,
  STAGE_TIMEOUT_MS,
  THEME_STOPWORDS,
  TITLE_TERMS,
} from '../config/displacement';
import type { ThemeStore } from '../db/themes';
import { htmlToText } from '../utils/text';
import { dbscan } from '../utils/dbscan';

export type Embedder = (texts: string[]) => Promise<number[][]>;
export interface ThemeInput {
  signalId: string;
  source: SourceId;
  text: string;
  competitorsMentioned: string[];
  evidence: Array<{ criterion: CriterionId; quote: string }>;
}
export interface ThemeDraft {
  competitor: string;
  title: string;
  summary: string;
  signalIds: string[];
  quotes: ThemeQuote[];
}
export interface DisplaceSummary {
  complaintSignals: number;
  competitors: number;
  skippedCompetitors: string[];
  themeCount: number;
}
export type DisplaceStage = (runId: string) => Promise<DisplaceSummary>;
type FeatureExtractor = (texts: string[], options: { pooling: 'mean'; normalize: true }) => Promise<{ tolist(): unknown }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function validVectors(raw: unknown, expectedCount: number): number[][] {
  if (!Array.isArray(raw) || raw.length !== expectedCount) {
    throw new Error('Embedding model returned an invalid batch shape');
  }
  const vectors: number[][] = [];
  let dimension: number | null = null;
  for (const candidate of raw as unknown[]) {
    if (!Array.isArray(candidate) || candidate.length === 0) {
      throw new Error('Embedding model returned an invalid vector');
    }
    const vector: number[] = [];
    for (const value of candidate as unknown[]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Embedding model returned a non-numeric value');
      }
      vector.push(value);
    }
    if (dimension !== null && vector.length !== dimension) {
      throw new Error('Embedding model returned inconsistent vector dimensions');
    }
    dimension = vector.length;
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (Math.abs(norm - 1) > 0.02) {
      throw new Error('Embedding model returned a non-normalized vector');
    }
    vectors.push(vector);
  }
  return vectors;
}

async function loadExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
      const cacheDir = resolve(repoRoot, MODEL_CACHE_DIR);
      await mkdir(cacheDir, { recursive: true });
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = cacheDir;
      const pipeline = await transformers.pipeline('feature-extraction', EMBEDDING_MODEL, {
        dtype: EMBEDDING_DTYPE,
      });
      return pipeline;
    })().catch((err: unknown) => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await loadExtractor();
  const results: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE)
      .map((text) => htmlToText(text).slice(0, MAX_EMBED_CHARS));
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    const raw: unknown = tensor.tolist();
    results.push(...validVectors(raw, batch.length));
  }
  return results;
}

export { validVectors as validateEmbeddingOutput };

function tokenize(text: string): string[] {
  return htmlToText(text).toLowerCase().replace(/['’]/g, '').match(/[a-z][a-z0-9]{2,}/g) ?? [];
}

export function scoreThemeTerms(
  memberTexts: string[],
  corpusTexts: string[],
  competitorNames: string[],
): string[] {
  const stopwords = new Set(THEME_STOPWORDS);
  const blockedNames = new Set(competitorNames.flatMap(tokenize));
  const memberTokens = memberTexts.map((text) => new Set(tokenize(text)));
  const corpusTokens = corpusTexts.map((text) => new Set(tokenize(text)));
  const terms = new Set(memberTokens.flatMap((tokens) => [...tokens]));
  return [...terms]
    .filter((term) => !stopwords.has(term) && !blockedNames.has(term))
    .map((term) => {
      const memberDf = memberTokens.filter((tokens) => tokens.has(term)).length;
      const groupDf = corpusTokens.filter((tokens) => tokens.has(term)).length;
      const idf = Math.log((corpusTexts.length + 1) / (groupDf + 1)) + 1;
      return { term, score: memberDf * idf, memberDf };
    })
    .filter((entry) => entry.memberDf >= 2)
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term))
    .slice(0, MAX_TERMS_PER_THEME)
    .map((entry) => entry.term);
}

export function buildThemeTitle(competitor: string, terms: string[]): string {
  const titleTerms = terms.slice(0, TITLE_TERMS);
  return titleTerms.length > 0 ? `${competitor}: ${titleTerms.join(', ')}` : `${competitor}: shared complaint`;
}

export function buildThemeSummary(competitor: string, memberCount: number, terms: string[]): string {
  const base = `${memberCount} signal(s) complaining about ${competitor}`;
  return terms.length > 0 ? `${base}, mentioning: ${terms.join(', ')}.` : `${base}.`;
}

export async function buildThemeDrafts(
  inputs: ThemeInput[],
  embed: Embedder,
): Promise<{ drafts: ThemeDraft[]; complaintSignals: number; competitors: number; skippedCompetitors: string[] }> {
  const ordered = [...inputs].sort((left, right) => left.signalId.localeCompare(right.signalId));
  const groups = new Map<string, ThemeInput[]>();
  for (const item of ordered) {
    const competitor = item.competitorsMentioned[0];
    if (!competitor) continue;
    const group = groups.get(competitor) ?? [];
    group.push(item);
    groups.set(competitor, group);
  }
  const drafts: ThemeDraft[] = [];
  const skippedCompetitors: string[] = [];
  let competitors = 0;
  const competitorNames = [...new Set(ordered.flatMap((item) => item.competitorsMentioned))];
  for (const [competitor, group] of groups) {
    if (group.length < MIN_SIGNALS_PER_COMPETITOR) {
      skippedCompetitors.push(competitor);
      continue;
    }
    competitors += 1;
    const labels = dbscan(await embed(group.map((item) => item.text)), DBSCAN_EPS, DBSCAN_MIN_PTS);
    const clusters = new Map<number, ThemeInput[]>();
    labels.forEach((label, index) => {
      const member = group[index];
      if (label < 0 || !member) return;
      const cluster = clusters.get(label) ?? [];
      cluster.push(member);
      clusters.set(label, cluster);
    });
    for (const members of clusters.values()) {
      const sortedMembers = [...members].sort((left, right) => left.signalId.localeCompare(right.signalId));
      const quotes: ThemeQuote[] = sortedMembers.flatMap((member) => {
        const evidence = member.evidence.find((item) => item.criterion === 'names_competitor') ?? member.evidence[0];
        return evidence ? [{ signalId: member.signalId, criterion: evidence.criterion, quote: evidence.quote }] : [];
      });
      if (quotes.length === 0) continue;
      const memberTexts = sortedMembers.map((member) => member.text);
      const terms = scoreThemeTerms(memberTexts, group.map((item) => item.text), competitorNames);
      drafts.push({
        competitor,
        title: buildThemeTitle(competitor, terms),
        summary: buildThemeSummary(competitor, sortedMembers.length, terms),
        signalIds: sortedMembers.map((member) => member.signalId),
        quotes,
      });
    }
  }
  drafts.sort((left, right) => right.signalIds.length - left.signalIds.length ||
    left.competitor.localeCompare(right.competitor) || left.title.localeCompare(right.title));
  return { drafts, complaintSignals: inputs.length, competitors, skippedCompetitors };
}

export function createDisplaceStage({
  store,
  embed,
  config = { timeoutMs: STAGE_TIMEOUT_MS },
}: {
  store: ThemeStore;
  embed: Embedder;
  config?: { timeoutMs: number };
}): DisplaceStage {
  return async (runId) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const operation = (async () => {
      const inputs = await store.getThemeInputs(runId);
      const result = await buildThemeDrafts(inputs, embed);
      await store.saveThemes(runId, result.drafts);
      return {
        complaintSignals: result.complaintSignals,
        competitors: result.competitors,
        skippedCompetitors: result.skippedCompetitors,
        themeCount: result.drafts.length,
      };
    })();
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Displacement timed out')), config.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}
