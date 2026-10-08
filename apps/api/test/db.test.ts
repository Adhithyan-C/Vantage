import { describe, it, expect } from 'vitest';
import { toSignalRow } from '../src/db/queries.js';
import type { RawSignal } from '@vantage/shared';

describe('toSignalRow', () => {
  it('maps all fields to snake_case, community undefined becomes null, content_hash has length 64', () => {
    const signal: RawSignal = {
      source: 'hackernews',
      externalId: 'abc123',
      authorHandle: 'testuser',
      community: undefined,
      url: 'https://news.ycombinator.com/item?id=abc123',
      text: 'This is some test signal text',
      createdAt: '2026-10-01T00:00:00Z',
      engagement: { score: 42, comments: 7 },
    };

    const row = toSignalRow(signal);

    expect(row.source).toBe('hackernews');
    expect(row.external_id).toBe('abc123');
    expect(row.author_handle).toBe('testuser');
    expect(row.community).toBeNull();
    expect(row.url).toBe('https://news.ycombinator.com/item?id=abc123');
    expect(row.text_snapshot).toBe('This is some test signal text');
    expect(row.created_at_source).toBe('2026-10-01T00:00:00Z');
    expect(row.engagement).toEqual({ score: 42, comments: 7 });
    expect(row.content_hash).toHaveLength(64);
  });

  it('community string is preserved as string', () => {
    const signal: RawSignal = {
      source: 'hackernews',
      externalId: 'abc123',
      authorHandle: 'testuser',
      community: 'Ask HN',
      url: 'https://news.ycombinator.com/item?id=abc123',
      text: 'This is some test signal text',
      createdAt: '2026-10-01T00:00:00Z',
      engagement: { score: 42, comments: 7 },
    };

    const row = toSignalRow(signal);

    expect(row.community).toBe('Ask HN');
  });

  it('engagement is passed through unchanged', () => {
    const engagement = { score: 99, comments: 42 };
    const signal: RawSignal = {
      source: 'hackernews',
      externalId: 'abc123',
      authorHandle: 'testuser',
      community: undefined,
      url: 'https://news.ycombinator.com/item?id=abc123',
      text: 'This is some test signal text',
      createdAt: '2026-10-01T00:00:00Z',
      engagement,
    };

    const row = toSignalRow(signal);

    expect(row.engagement).toBe(engagement);
  });
});
