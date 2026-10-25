import { performance } from 'node:perf_hooks';
import { embedTexts } from '../agents/displacement';
import { EMBEDDING_DTYPE, EMBEDDING_MODEL } from '../config/displacement';

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  return dot;
}

async function main(): Promise<void> {
  const sentences = [
    'Searching customer tickets is slow and takes too much time.',
    'Our support ticket search is painfully slow for agents.',
    'The annual subscription price increased this quarter.',
    'Billing invoices are missing from the account page.',
  ];
  const started = performance.now();
  const vectors = await embedTexts(sentences);
  const elapsedMs = Math.round(performance.now() - started);
  const similar = vectors[0] && vectors[1] ? cosine(vectors[0], vectors[1]) : 0;
  const unrelated = vectors[0] && vectors[2] ? cosine(vectors[0], vectors[2]) : 0;
  console.log(`Model: ${EMBEDDING_MODEL}`);
  console.log(`Dtype: ${EMBEDDING_DTYPE}`);
  console.log(`Vector length: ${vectors[0]?.length ?? 0} (expected 384)`);
  console.log(`Similar-pair cosine similarity: ${similar.toFixed(4)}`);
  console.log(`Unrelated-pair cosine similarity: ${unrelated.toFixed(4)}`);
  console.log(`Load time: ${elapsedMs} ms`);
  console.log('First run may download model files from Hugging Face and cache them locally.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
