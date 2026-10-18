import { describe, expect, it } from 'vitest';
import { enrichSignal } from '../src/agents/enricher';
import { PURCHASE_TERMS, TEAM_TERMS } from '../src/config/enrich';

const now = new Date('2026-10-18T00:00:00.000Z');

describe('enrichSignal', () => {
  it('matches competitor names case-insensitively as whole words and escapes regex characters', () => {
    const matched = enrichSignal({
      text: "We're replacing ZENDESK's pricing, not discussing ZenXdesk.",
      source: 'hackernews',
      createdAtSource: '2026-10-17T00:00:00.000Z',
      engagement: {},
      competitors: ['Zendesk', 'zendesk', 'Zen.desk'],
      now,
    });
    expect(matched.competitorsMentioned).toEqual(['Zendesk']);
    expect(matched.fit.competitorMentioned).toBe(true);
    expect(enrichSignal({
      text: 'Zendesks is a longer name and should not match.',
      source: 'hackernews',
      createdAtSource: '2026-10-17T00:00:00.000Z',
      engagement: {},
      competitors: ['Zendesk'],
      now,
    }).competitorsMentioned).toEqual([]);
  });

  it('finds purchase and team terms in configured order without duplicates', () => {
    const result = enrichSignal({
      text: 'Our team has an EXPENSIVE per seat subscription; we have a small team and need pricing.',
      source: 'hackernews',
      createdAtSource: '2026-10-18T00:00:00.000Z',
      engagement: {},
      competitors: [],
      now,
    });
    expect(result.purchaseTermsFound).toEqual(
      PURCHASE_TERMS.filter((term) => ['expensive', 'pricing', 'subscription', 'per seat'].includes(term)),
    );
    expect(result.teamTermsFound).toEqual(
      TEAM_TERMS.filter((term) => ['our team', 'small team', 'we have'].includes(term)),
    );
    expect(result.purchaseTermsFound.filter((term) => term === 'pricing')).toHaveLength(1);
    expect(result.fit.purchaseLanguage).toBe(true);
    expect(result.fit.teamOrRoleContext).toBe(true);
  });

  it('clamps future timestamps to zero age and rounds age to one decimal', () => {
    expect(enrichSignal({
      text: 'hello',
      source: 'hackernews',
      createdAtSource: '2026-10-19T00:00:00.000Z',
      engagement: {},
      competitors: [],
      now,
    }).ageDays).toBe(0);
    expect(enrichSignal({
      text: 'hello',
      source: 'hackernews',
      createdAtSource: '2026-10-17T12:00:00.000Z',
      engagement: {},
      competitors: [],
      now,
    }).ageDays).toBe(0.5);
  });

  it('defaults missing engagement and community values and derives all fit flags', () => {
    const result = enrichSignal({
      text: 'A Zendesk support team is looking for a cheaper alternative.',
      source: 'hackernews',
      community: undefined,
      createdAtSource: '2026-10-18T00:00:00.000Z',
      engagement: {},
      competitors: ['Zendesk'],
      now,
    });
    expect(result).toMatchObject({
      commentCount: 0,
      upvotes: 0,
      community: null,
      fit: { competitorMentioned: true, purchaseLanguage: true, teamOrRoleContext: true },
    });
  });
});
