import { CRITERION_IDS } from '@vantage/shared';
import type { ClassifierOutput, CriterionId, EvidenceSpan, LeadLabel } from '@vantage/shared';

export interface FinalizedClassification {
  output: ClassifierOutput & {
    notes: {
      unverified: CriterionId[];
      downgraded?: true;
      originalLabel?: LeadLabel;
    };
  };
  evidence: Array<{ criterion: CriterionId; quote: string }>;
  evidenceVerified: boolean;
  notes: {
    unverified: CriterionId[];
    downgraded?: true;
    originalLabel?: LeadLabel;
  };
}

export function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  const lowerText = text.toLowerCase();
  const sourceIndexes: number[] = [];
  let lowerIndex = 0;
  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index);
    if (point === undefined) {
      break;
    }
    const original = String.fromCodePoint(point);
    const sourceLength = original.length;
    const lowerLength = original.toLowerCase().length;
    for (let offset = 0; offset < lowerLength; offset += 1) {
      sourceIndexes[lowerIndex] = index + (sourceLength === lowerLength ? offset : 0);
      lowerIndex += 1;
    }
    index += sourceLength;
  }
  let normalized = '';
  const map: number[] = [];
  let pendingSpace: number | null = null;
  for (let index = 0; index < lowerText.length; index += 1) {
    const character = lowerText[index] ?? '';
    const originalIndex = sourceIndexes[index] ?? index;
    if (/\s/.test(character)) {
      if (normalized.length > 0 && pendingSpace === null) {
        pendingSpace = originalIndex;
      }
      continue;
    }
    if (pendingSpace !== null) {
      normalized += ' ';
      map.push(pendingSpace);
      pendingSpace = null;
    }
    const replacement = character
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/[\u2013\u2014]/g, '-');
    normalized += replacement;
    for (let offset = 0; offset < replacement.length; offset += 1) {
      map.push(originalIndex);
    }
  }
  return { normalized, map };
}

export function verifyQuote(quote: string, text: string): boolean {
  const normalizedQuote = normalizeWithMap(quote).normalized;
  return normalizedQuote.length > 0 && normalizeWithMap(text).normalized.includes(normalizedQuote);
}

export function findEvidenceSpans(
  text: string,
  evidence: Array<{ criterion: CriterionId; quote: string }>,
): EvidenceSpan[] {
  const normalizedText = normalizeWithMap(text);
  const spans: EvidenceSpan[] = [];
  for (const item of evidence) {
    const normalizedQuote = normalizeWithMap(item.quote).normalized;
    if (normalizedQuote.length === 0) {
      continue;
    }
    const index = normalizedText.normalized.indexOf(normalizedQuote);
    const start = normalizedText.map[index];
    const last = normalizedText.map[index + normalizedQuote.length - 1];
    if (index < 0 || start === undefined || last === undefined) {
      continue;
    }
    spans.push({ criterion: item.criterion, quote: item.quote, start, end: last + 1 });
  }
  return spans.sort((left, right) => left.start - right.start);
}

export function finalizeClassification(
  raw: ClassifierOutput,
  text: string,
): FinalizedClassification {
  const firstById = new Map<CriterionId, ClassifierOutput['criteria'][number]>();
  for (const criterion of raw.criteria) {
    if (!firstById.has(criterion.id)) {
      firstById.set(criterion.id, criterion);
    }
  }

  const unverified: CriterionId[] = [];
  const criteria = CRITERION_IDS.map((id) => {
    const criterion = firstById.get(id);
    if (!criterion || !criterion.passed) {
      return { id, passed: false, quote: null };
    }
    if (!criterion.quote?.trim()) {
      return { id, passed: false, quote: null };
    }
    if (!verifyQuote(criterion.quote, text)) {
      unverified.push(id);
      return { id, passed: false, quote: null };
    }
    return { id, passed: true, quote: criterion.quote };
  });

  let label = raw.label;
  const notes: FinalizedClassification['notes'] = { unverified };
  if (
    (label === 'buyer_intent' || label === 'competitor_complaint') &&
    criteria.every((criterion) => !criterion.passed)
  ) {
    notes.downgraded = true;
    notes.originalLabel = label;
    label = 'noise';
  }

  const output = { label, criteria, rationale: raw.rationale, notes };
  const evidence = criteria
    .filter((criterion) => criterion.passed && criterion.quote !== null)
    .map((criterion) => ({ criterion: criterion.id, quote: criterion.quote as string }));

  return {
    output,
    evidence,
    evidenceVerified: unverified.length === 0,
    notes,
  };
}
