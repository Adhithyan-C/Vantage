import { describe, expect, it } from 'vitest';
import { parseHash } from './routes';

describe('report hash route', () => {
  it('parses a report route without changing the input string', () => {
    const hash = '#/runs/00000000-0000-0000-0000-000000000001/report';
    expect(parseHash(hash)).toEqual({ name: 'report', runId: '00000000-0000-0000-0000-000000000001' });
    expect(hash).toBe('#/runs/00000000-0000-0000-0000-000000000001/report');
  });
});

describe('themes hash route', () => {
  it('parses a themes route without changing the input hash', () => {
    const hash = '#/runs/00000000-0000-0000-0000-000000000001/themes';
    expect(parseHash(hash)).toEqual({ name: 'themes', runId: '00000000-0000-0000-0000-000000000001' });
    expect(hash).toBe('#/runs/00000000-0000-0000-0000-000000000001/themes');
  });
});
