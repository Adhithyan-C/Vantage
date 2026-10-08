import { describe, it, expect } from 'vitest';
import { normalizeForHash, contentHash } from '../src/utils/hash';

describe('hash utilities', () => {
  it('gives the same hash for differently spaced/cased text', () => {
    const h1 = contentHash('Hello   World');
    const h2 = contentHash('hello world');
    expect(h1).toBe(h2);
  });
  it('gives different hashes for different texts', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
  it('hash length is 64', () => {
    expect(contentHash('test').length).toBe(64);
  });
});
