import { describe, it, expect } from 'vitest';
import { ClassifierOutputSchema, RawSignalSchema, SellerProfileInputSchema, RunCreateRequestSchema } from '../src';
import seller from '../../../fixtures/seller-helpdesk.json';

describe('schemas', () => {
  it('a valid ClassifierOutput passes ClassifierOutputSchema.safeParse', () => {
    const valid = {
      label: 'buyer_intent',
      criteria: [{ id: 'states_problem', passed: true, quote: 'I have a problem' }],
      rationale: 'Looks like a lead'
    };
    expect(ClassifierOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('a ClassifierOutput with label \'hot_lead\' fails', () => {
    const invalid = {
      label: 'hot_lead',
      criteria: [],
      rationale: 'x'
    };
    expect(ClassifierOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('a criterion with id \'made_up_id\' fails', () => {
    const invalid = {
      label: 'buyer_intent',
      criteria: [{ id: 'made_up_id', passed: true, quote: 'x' }],
      rationale: 'x'
    };
    expect(ClassifierOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('a criterion quote of 301 characters fails', () => {
    const invalid = {
      label: 'buyer_intent',
      criteria: [{ id: 'states_problem', passed: true, quote: 'a'.repeat(301) }],
      rationale: 'x'
    };
    expect(ClassifierOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('a rationale of 281 characters fails', () => {
    const invalid = {
      label: 'buyer_intent',
      criteria: [],
      rationale: 'a'.repeat(281)
    };
    expect(ClassifierOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it('a valid RawSignal passes RawSignalSchema.safeParse', () => {
    const valid = {
      source: 'reddit',
      externalId: '123',
      authorHandle: 'user1',
      url: 'http://x.com',
      text: 'text',
      createdAt: '2023-01-01T00:00:00Z',
      engagement: {}
    };
    expect(RawSignalSchema.safeParse(valid).success).toBe(true);
  });

  it('a RawSignal with createdAt \'not a date\' fails', () => {
    const invalid = {
      source: 'reddit',
      externalId: '123',
      authorHandle: 'user1',
      url: 'http://x.com',
      text: 'text',
      createdAt: 'not a date',
      engagement: {}
    };
    expect(RawSignalSchema.safeParse(invalid).success).toBe(false);
  });

  it('the fixture seller passes SellerProfileInputSchema.safeParse', () => {
    expect(SellerProfileInputSchema.safeParse(seller).success).toBe(true);
  });

  it('a valid RunCreateRequest (the fixture seller plus keywords ["zendesk alternative"], sinceDays 90, maxResults 50) passes RunCreateRequestSchema.safeParse', () => {
    const valid = {
      seller,
      params: {
        keywords: ['zendesk alternative'],
        sinceDays: 90,
        maxResults: 50,
      },
    };
    expect(RunCreateRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('an empty keywords array fails', () => {
    const invalid = {
      seller,
      params: {
        keywords: [],
        sinceDays: 90,
        maxResults: 50,
      },
    };
    expect(RunCreateRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('a keyword made only of spaces fails', () => {
    const invalid = {
      seller,
      params: {
        keywords: ['   '],
        sinceDays: 90,
        maxResults: 50,
      },
    };
    expect(RunCreateRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('sinceDays 0 fails', () => {
    const invalid = {
      seller,
      params: {
        keywords: ['zendesk alternative'],
        sinceDays: 0,
        maxResults: 50,
      },
    };
    expect(RunCreateRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('maxResults 101 fails', () => {
    const invalid = {
      seller,
      params: {
        keywords: ['zendesk alternative'],
        sinceDays: 90,
        maxResults: 101,
      },
    };
    expect(RunCreateRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('11 keywords fails', () => {
    const invalid = {
      seller,
      params: {
        keywords: Array(11).fill('keyword'),
        sinceDays: 90,
        maxResults: 50,
      },
    };
    expect(RunCreateRequestSchema.safeParse(invalid).success).toBe(false);
  });
});
