import { describe, expect, it } from 'vitest';
import { sanitizeRequestError } from '../src/utils/redact';

describe('sanitizeRequestError', () => {
  it('removes credential fragments and query strings', () => {
    expect(sanitizeRequestError('key=abc api_key=def token=ghi access_token=jkl Authorization: Bearer xyz https://example.test/path?q=secret')).toBe(
      'key=[REDACTED] api_key=[REDACTED] token=[REDACTED] access_token=[REDACTED] Authorization: [REDACTED] https://example.test/path',
    );
  });
  it('redacts provider tokens, truncates at 200 characters and preserves ordinary text', () => {
    expect(sanitizeRequestError('ordinary failure')).toBe('ordinary failure');
    expect(sanitizeRequestError(`AIza${'A'.repeat(30)} gsk_${'b'.repeat(30)}`)).toBe('[REDACTED] [REDACTED]');
    expect(sanitizeRequestError('ordinary text '.repeat(20))).toHaveLength(200);
  });
});
