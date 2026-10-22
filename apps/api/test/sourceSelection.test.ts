import { describe, expect, it } from 'vitest';
import { parseSourceSelection } from '../src/scripts/sourceSelection.js';

describe('parseSourceSelection', () => {
  it('leaves the default selection unspecified when the option is absent', () => {
    expect(parseSourceSelection(undefined, ['hackernews', 'snapshot', 'stackexchange']))
      .toEqual({ sourceIds: null, error: null });
  });

  it('parses valid registered ids and removes duplicates', () => {
    expect(parseSourceSelection('hackernews, stackexchange,hackernews', [
      'hackernews', 'snapshot', 'stackexchange',
    ])).toEqual({ sourceIds: ['hackernews', 'stackexchange'], error: null });
  });

  it('returns an error for an unknown id', () => {
    expect(parseSourceSelection('reddit', ['hackernews', 'stackexchange']))
      .toEqual({ sourceIds: null, error: 'Unknown source id: reddit' });
  });
});
