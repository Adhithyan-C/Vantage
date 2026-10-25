import { describe, expect, it } from 'vitest';
import { embedTexts, validateEmbeddingOutput } from '../src/agents/displacement';

describe('validateEmbeddingOutput', () => {
  it('returns an empty result without loading the model for empty input', async () => {
    await expect(embedTexts([])).resolves.toEqual([]);
  });
  it('accepts finite, consistently shaped unit vectors', () => {
    expect(validateEmbeddingOutput([[0.6, 0.8], [1, 0]], 2)).toEqual([[0.6, 0.8], [1, 0]]);
  });

  it('rejects malformed batch and vector shapes', () => {
    expect(() => validateEmbeddingOutput([[1, 0]], 2)).toThrow('invalid batch shape');
    expect(() => validateEmbeddingOutput([[]], 1)).toThrow('invalid vector');
    expect(() => validateEmbeddingOutput([[1, 'x']], 1)).toThrow('non-numeric value');
    expect(() => validateEmbeddingOutput([[1, 0], [0, 1, 0]], 2)).toThrow('inconsistent vector dimensions');
    expect(() => validateEmbeddingOutput([[0, 0]], 1)).toThrow('non-normalized vector');
  });
});
