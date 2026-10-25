export const geminiModel = 'gemini-3.8-flash';
export const groqModel = 'openai/gpt-oss-20b';
export type LlmProvider = 'gemini' | 'groq';
export const providerOrder: LlmProvider[] = ['groq', 'gemini'];
export const rateLimitRetries = 2;
export const retryAfterCapMs = 20_000;
export const temperature = 0;
export const requestTimeoutMs = 30_000;
export const maxValidationRetries = 2;
export const concurrency = 2;
export const maxClassifyPerRun = 25;
export const maxPostChars = 2_000;
export const promptVersion = 'classifier.v3';
export const maxCriticPerRun = 8;
export const criticConcurrency = 2;
export const criticPromptVersion = 'critic.v1';
export const enableCritic = true;

export function parseProviderOrder(raw?: string): LlmProvider[] {
  const providers = raw
    ?.split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is LlmProvider => provider === 'groq' || provider === 'gemini');
  return providers?.length ? [...new Set(providers)] : [...providerOrder];
}

export const LLM_CONFIG = {
  get geminiModel() {
    return process.env.GEMINI_MODEL?.trim() || geminiModel;
  },
  get groqModel() {
    return process.env.GROQ_MODEL?.trim() || groqModel;
  },
  get providerOrder() {
    return parseProviderOrder(process.env.LLM_PROVIDER_ORDER);
  },
  rateLimitRetries,
  retryAfterCapMs,
  temperature,
  requestTimeoutMs,
  maxValidationRetries,
  concurrency,
  maxClassifyPerRun,
  maxPostChars,
  promptVersion,
  maxCriticPerRun,
  criticConcurrency,
  criticPromptVersion,
  get enableCritic() {
    return process.env.ENABLE_CRITIC !== 'false';
  },
};

export function resolveLlmConfig(overrides: {
  GEMINI_MODEL?: string;
  GROQ_MODEL?: string;
  LLM_PROVIDER_ORDER?: string;
  ENABLE_CRITIC?: string | boolean;
} = {}) {
  const providerSetting = overrides.LLM_PROVIDER_ORDER ?? process.env.LLM_PROVIDER_ORDER;
  const criticSetting = overrides.ENABLE_CRITIC ?? process.env.ENABLE_CRITIC;
  return {
    ...LLM_CONFIG,
    geminiModel: overrides.GEMINI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || geminiModel,
    groqModel: overrides.GROQ_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || groqModel,
    providerOrder: parseProviderOrder(providerSetting),
    maxCriticPerRun,
    criticConcurrency,
    criticPromptVersion,
    enableCritic: typeof criticSetting === 'boolean'
      ? criticSetting
      : criticSetting !== 'false',
  };
}
