export const geminiModel = 'gemini-2.5-flash';
export const groqModel = 'openai/gpt-oss-20b';
export const temperature = 0;
export const requestTimeoutMs = 30_000;
export const maxValidationRetries = 2;
export const concurrency = 2;
export const maxClassifyPerRun = 30;
export const maxPostChars = 4_000;
export const promptVersion = 'classifier.v1';

export const LLM_CONFIG = {
  geminiModel,
  groqModel,
  temperature,
  requestTimeoutMs,
  maxValidationRetries,
  concurrency,
  maxClassifyPerRun,
  maxPostChars,
  promptVersion,
};
