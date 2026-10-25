import type { LeadLabel, RawSignal } from '@vantage/shared';

export interface ExpectedThread {
  title?: string;
  url?: string;
}

export interface RecallAssessment {
  expected: ExpectedThread;
  retrieved: boolean;
  signal: RawSignal | null;
  similarity: number | null;
  label: LeadLabel | null;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/https?:\/\//g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function assessRecall(
  expected: ExpectedThread[],
  signals: RawSignal[],
  similarities: Map<string, number>,
  labels: Map<string, LeadLabel>,
  missingSimilarities: number[] = [],
): RecallAssessment[] {
  return expected.map((thread, index) => {
    const expectedUrl = thread.url ? normalized(thread.url) : '';
    const expectedTitle = thread.title ? normalized(thread.title) : '';
    const signal = signals.find((candidate) => {
      const candidateUrl = normalized(candidate.url);
      const candidateTitle = normalized(candidate.text.split('\n')[0] ?? '');
      return (expectedUrl && (candidateUrl === expectedUrl || candidateUrl.includes(expectedUrl) || expectedUrl.includes(candidateUrl))) ||
        (expectedTitle && (candidateTitle === expectedTitle || candidateTitle.includes(expectedTitle) || expectedTitle.includes(candidateTitle)));
    }) ?? null;
    return {
      expected: thread,
      retrieved: signal !== null,
      signal,
      similarity: signal ? similarities.get(signal.externalId) ?? null : missingSimilarities[index] ?? null,
      label: signal ? labels.get(signal.externalId) ?? null : null,
    };
  });
}
