import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { parseProviderOrder, resolveLlmConfig } from '../src/config/llm';

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

  it('accepts optional GitHub and Product Hunt source credentials', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', REDDIT_USER_AGENT: 'x',
      GITHUB_TOKEN: 'github-token', PRODUCT_HUNT_TOKEN: 'product-hunt-token',
    });
    expect(env.GITHUB_TOKEN).toBe('github-token');
    expect(env.PRODUCT_HUNT_TOKEN).toBe('product-hunt-token');
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
    expect(env.ENABLE_CRITIC).toBe(true);
    expect(env.ENABLE_DISPLACEMENT).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses ENABLE_CRITIC=%s as %s', (value, expected) => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      ENABLE_CRITIC: value,
    });
    expect(env.ENABLE_CRITIC).toBe(expected);
  });

  it('rejects ENABLE_CRITIC values other than literal true or false', () => {
    expect(() => loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      ENABLE_CRITIC: 'yes',
    })).toThrow('ENABLE_CRITIC');
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses ENABLE_DISPLACEMENT=%s as %s', (value, expected) => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      ENABLE_DISPLACEMENT: value,
    });
    expect(env.ENABLE_DISPLACEMENT).toBe(expected);
  });

  it('rejects ENABLE_DISPLACEMENT values other than literal true or false', () => {
    expect(() => loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      ENABLE_DISPLACEMENT: 'yes',
    })).toThrow('ENABLE_DISPLACEMENT');
  });

  it('resolves the critic defaults and literal enable override', () => {
    expect(resolveLlmConfig({ ENABLE_CRITIC: 'true' })).toMatchObject({
      enableCritic: true,
      maxCriticPerRun: 8,
      criticConcurrency: 2,
      criticPromptVersion: 'critic.v1',
    });
    expect(resolveLlmConfig({ ENABLE_CRITIC: 'false' }).enableCritic).toBe(false);
  });

  it('allows a Groq-only configuration without a Gemini API key', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      GROQ_API_KEY: 'groq-key',
    });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GROQ_API_KEY).toBe('groq-key');
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

  it('treats an empty STACKEXCHANGE_SITES value as unset', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      STACKEXCHANGE_SITES: '',
    });
    expect(env.STACKEXCHANGE_SITES).toBeUndefined();
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

  it('accepts model overrides and a configured provider order', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      GEMINI_MODEL: 'gemini-custom',
      GROQ_MODEL: 'groq-custom',
      LLM_PROVIDER_ORDER: 'gemini,groq',
    });
    expect(env.GEMINI_MODEL).toBe('gemini-custom');
    expect(env.GROQ_MODEL).toBe('groq-custom');
    expect(parseProviderOrder(env.LLM_PROVIDER_ORDER)).toEqual(['gemini', 'groq']);
  });

  it('treats empty model and provider-order values as unset', () => {
    const env = loadEnv({
      SUPABASE_URL: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      GEMINI_API_KEY: 'x',
      REDDIT_USER_AGENT: 'x',
      GEMINI_MODEL: ' ',
      GROQ_MODEL: '',
      LLM_PROVIDER_ORDER: '  ',
    });
    expect(env.GEMINI_MODEL).toBeUndefined();
    expect(env.GROQ_MODEL).toBeUndefined();
    expect(env.LLM_PROVIDER_ORDER).toBeUndefined();
    expect(parseProviderOrder(env.LLM_PROVIDER_ORDER)).toEqual(['groq', 'gemini']);
  });

  it('drops unknown providers and falls back to Groq then Gemini when none are valid', () => {
    expect(parseProviderOrder('unknown,gemini,wrong')).toEqual(['gemini']);
    expect(parseProviderOrder('unknown,wrong')).toEqual(['groq', 'gemini']);
    expect(parseProviderOrder('groq,groq,gemini')).toEqual(['groq', 'gemini']);
  });
});
