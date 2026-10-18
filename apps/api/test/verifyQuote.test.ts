import { describe, expect, it } from 'vitest';
import type { ClassifierOutput, CriterionId } from '@vantage/shared';
import { finalizeClassification, verifyQuote } from '../src/verification/verifyQuote';

function rawOutput(
  label: ClassifierOutput['label'] = 'buyer_intent',
  criteria: ClassifierOutput['criteria'] = [],
): ClassifierOutput {
  return { label, criteria, rationale: 'The author asks about support tools.' };
}

describe('verifyQuote', () => {
  it('accepts a verbatim quote', () => {
    expect(verifyQuote('need a better helpdesk', 'We need a better helpdesk this quarter.')).toBe(true);
  });

  it('normalizes curly quotes and whitespace', () => {
    expect(verifyQuote('Need a “better\nhelpdesk”', 'Need a “better   helpdesk” today')).toBe(true);
  });

  it('rejects a quote with a changed word', () => {
    expect(verifyQuote('need a great helpdesk', 'We need a better helpdesk.')).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(verifyQuote('  ', 'Any non-empty post text')).toBe(false);
  });
});

describe('finalizeClassification', () => {
  it('fills missing criteria in rubric order', () => {
    const result = finalizeClassification(rawOutput(), 'A support team needs a better tool.');
    expect(result.output.criteria.map((criterion) => criterion.id)).toEqual([
      'states_problem',
      'asks_for_recommendation',
      'mentions_team_or_budget',
      'shows_urgency',
      'names_competitor',
    ]);
    expect(result.output.criteria.every((criterion) => !criterion.passed && criterion.quote === null)).toBe(true);
  });

  it('keeps the first duplicate criterion', () => {
    const result = finalizeClassification(
      rawOutput('venting', [
        { id: 'states_problem', passed: false, quote: 'not used' },
        { id: 'states_problem', passed: true, quote: 'team needs a better tool' },
      ]),
      'The team needs a better tool.',
    );
    expect(result.output.criteria[0]).toEqual({ id: 'states_problem', passed: false, quote: null });
  });

  it('forces a failed criterion quote to null', () => {
    const result = finalizeClassification(
      rawOutput('venting', [{ id: 'states_problem', passed: false, quote: 'some quote' }]),
      'some quote',
    );
    expect(result.output.criteria[0]?.quote).toBeNull();
  });

  it('drops unverified evidence and records its criterion id', () => {
    const result = finalizeClassification(
      rawOutput('buyer_intent', [{ id: 'states_problem', passed: true, quote: 'a different sentence' }]),
      'The original sentence is here.',
    );
    expect(result.output.criteria[0]).toEqual({ id: 'states_problem', passed: false, quote: null });
    expect(result.notes.unverified).toEqual(['states_problem']);
    expect(result.evidence).toEqual([]);
    expect(result.evidenceVerified).toBe(false);
  });

  it('changes buyer intent to noise when no criterion passes', () => {
    const result = finalizeClassification(rawOutput('buyer_intent'), 'A post with no matches.');
    expect(result.output.label).toBe('noise');
    expect(result.notes).toEqual({ unverified: [], downgraded: true, originalLabel: 'buyer_intent' });
  });

  it('changes competitor complaints to noise only when no criterion passes', () => {
    const result = finalizeClassification(rawOutput('competitor_complaint'), 'Nothing matches.');
    expect(result.output.label).toBe('noise');
    expect(result.notes.originalLabel).toBe('competitor_complaint');
  });

  it.each(['venting', 'noise'] as const)('never downgrades the %s label', (label) => {
    const result = finalizeClassification(rawOutput(label), 'Nothing matches.');
    expect(result.output.label).toBe(label);
    expect(result.notes.downgraded).toBeUndefined();
  });

  it('keeps verified evidence in the output and evidence list', () => {
    const id: CriterionId = 'states_problem';
    const result = finalizeClassification(
      rawOutput('buyer_intent', [{ id, passed: true, quote: 'large ticket backlog' }]),
      'Our team has a large ticket backlog.',
    );
    expect(result.evidence).toEqual([{ criterion: id, quote: 'large ticket backlog' }]);
    expect(result.evidenceVerified).toBe(true);
  });
});
