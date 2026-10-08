import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('when REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are given along with the 4 required variables, loadEnv returns them', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      REDDIT_CLIENT_ID: 'id123',
      REDDIT_CLIENT_SECRET: 'secret123'
    });
    expect(env.REDDIT_CLIENT_ID).toBe('id123');
    expect(env.REDDIT_CLIENT_SECRET).toBe('secret123');
  });

  it('all 4 required variables given: returns PORT 3001 and DEMO_MODE false', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x'
    });
    expect(env.PORT).toBe(3001);
    expect(env.DEMO_MODE).toBe(false);
  });

  it('GEMINI_API_KEY missing: throws an error whose message contains GEMINI_API_KEY', () => {
    expect(() => {
      loadEnv({
        SUPABASE_URL: 'x',
        SUPABASE_SERVICE_ROLE_KEY: 'x',
        REDDIT_USER_AGENT: 'x'
      });
    }).toThrow(/GEMINI_API_KEY/);
  });

  it('GROQ_API_KEY set to an empty string: does not throw', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      GROQ_API_KEY: '   '
    });
    expect(env.GROQ_API_KEY).toBeUndefined();
  });

  it('DEMO_MODE \'true\': returns DEMO_MODE true', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      DEMO_MODE: 'true'
    });
    expect(env.DEMO_MODE).toBe(true);
  });

  it('PORT \'4000\': returns PORT 4000', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      PORT: '4000'
    });
    expect(env.PORT).toBe(4000);
  });
});
