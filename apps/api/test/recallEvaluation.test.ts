import { describe, expect, it } from 'vitest';
import { assessRecall } from '../src/evaluation/recall';

describe('recall assessment', () => {
  it('matches expected title and URL with similarity and assigned label', () => {
    const signal = {
      source: 'hackernews' as const, externalId: '123', authorHandle: 'user',
      url: 'https://news.ycombinator.com/item?id=123', text: 'Show HN: Bugsink - Self-Hosted Error Tracking',
      createdAt: '2026-10-01T00:00:00Z', engagement: {},
    };
    const result = assessRecall(
      [{ title: 'Show HN: Bugsink - Self-Hosted Error Tracking' }, { url: signal.url }],
      [signal], new Map([['123', 0.82]]), new Map([['123', 'competitor_complaint']]),
    );
    expect(result.map((item) => [item.retrieved, item.similarity, item.label])).toEqual([
      [true, 0.82, 'competitor_complaint'], [true, 0.82, 'competitor_complaint'],
    ]);
  });

  it('reports the profile similarity for an expected thread that was not retrieved', () => {
    const result = assessRecall([{ title: 'Missing expected post' }], [], new Map(), new Map(), [0.41]);
    expect(result[0]).toMatchObject({ retrieved: false, similarity: 0.41, label: null });
  });
});
