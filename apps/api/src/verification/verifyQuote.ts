import { CRITERION_IDS } from '@vantage/shared';
import type { ClassifierOutput, CriterionId, LeadLabel } from '@vantage/shared';

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

function normalizeQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function verifyQuote(quote: string, text: string): boolean {
  const normalizedQuote = normalizeQuote(quote);
  return normalizedQuote.length > 0 && normalizeQuote(text).includes(normalizedQuote);
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
