import type { z } from 'zod';
import type { LlmProvider } from '../config/llm';

export interface LlmConfig {
  geminiModel: string;
  groqModel: string;
  temperature: number;
  requestTimeoutMs: number;
  maxValidationRetries: number;
  rateLimitRetries: number;
  retryAfterCapMs: number;
  providerOrder: LlmProvider[];
}

export interface ProviderError {
  provider: LlmProvider;
  status: number | null;
  message: string;
}

export type LlmResult<T> =
  | { ok: true; data: T; model: string; attempts: number }
  | {
      ok: false;
      kind: 'invalid_output' | 'error';
      error: string;
      model: string | null;
      attempts: number;
      providerErrors: ProviderError[];
    };

export interface LlmClient {
  generateJson<T>(options: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
  }): Promise<LlmResult<T>>;
  getDisabledProviders(): LlmProvider[];
}

interface LlmClientOptions {
  fetch: typeof fetch;
  geminiApiKey?: string;
  groqApiKey?: string;
  config: LlmConfig;
  sleep?: (ms: number) => Promise<void>;
}

interface ProviderResponse {
  text?: string;
  model: string;
  failure?: ProviderError;
  retryAfter?: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeMessage(
  message: string,
  secrets: Array<string | undefined>,
  privateText: string[],
): string {
  let safe = message;
  for (const value of privateText) {
    if (value) {
      safe = safe.replaceAll(value, '[redacted]');
    }
  }
  for (const secret of secrets) {
    if (secret) {
      safe = safe.replaceAll(secret, '[redacted]');
    }
  }
  return safe
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/gsk_[0-9A-Za-z]+/g, '[redacted]')
    .slice(0, 200);
}

async function providerErrorMessage(response: Response): Promise<string> {
  const body = await readJson(response);
  if (typeof body === 'object' && body !== null) {
    const root = body as { error?: { message?: unknown } };
    if (typeof root.error?.message === 'string' && root.error.message.trim()) {
      return root.error.message;
    }
  }
  return `Provider returned HTTP ${response.status}`;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

async function readJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getGeminiText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const root = body as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const candidate = root.candidates?.[0];
  if (!candidate || candidate.finishReason === 'SAFETY' || candidate.finishReason === 'BLOCKED') {
    return null;
  }
  const text = candidate.content?.parts?.map((part) => part.text ?? '').join('').trim();
  return text || null;
}

function getGroqText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const root = body as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null };
    }>;
  };
  const choice = root.choices?.[0];
  if (!choice || choice.finish_reason === 'content_filter') {
    return null;
  }
  const text = choice.message?.content?.trim();
  return text || null;
}

export function createLlmClient({
  fetch: fetcher,
  geminiApiKey,
  groqApiKey,
  config,
  sleep: injectedSleep,
}: LlmClientOptions): LlmClient {
  const disabledProviders = new Set<LlmProvider>();
  const breakerErrors = new Map<LlmProvider, ProviderError>();
  const secrets = [geminiApiKey, groqApiKey];
  const sleep = injectedSleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function requestProvider(
    provider: LlmProvider,
    system: string,
    prompt: string,
  ): Promise<ProviderResponse> {
    const model = provider === 'gemini' ? config.geminiModel : config.groqModel;
    const apiKey = provider === 'gemini' ? geminiApiKey : groqApiKey;
    if (!apiKey) {
      return {
        model,
        failure: { provider, status: null, message: 'Provider API key is not configured' },
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const isGemini = provider === 'gemini';
      const url = isGemini
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
        : 'https://api.groq.com/openai/v1/chat/completions';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: Record<string, unknown>;
      if (isGemini) {
        headers['x-goog-api-key'] = apiKey;
        body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: config.temperature, responseMimeType: 'application/json' },
        };
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
        body = {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: config.temperature,
          response_format: { type: 'json_object' },
        };
      }

      const response = await fetcher(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = sanitizeMessage(
          await providerErrorMessage(response),
          secrets,
          [system, prompt],
        );
        return {
          model,
          retryAfter: response.headers.get('Retry-After'),
          failure: { provider, status: response.status, message },
        };
      }
      const responseBody = await readJson(response);
      const text = isGemini ? getGeminiText(responseBody) : getGroqText(responseBody);
      if (!text) {
        return {
          model,
          failure: {
            provider,
            status: response.status,
            message: 'Provider returned an empty or blocked reply',
          },
        };
      }
      return { text, model };
    } catch (err) {
      const message = controller.signal.aborted ? 'Request timed out' : errorMessage(err);
      return {
        model,
        failure: {
          provider,
          status: null,
          message: sanitizeMessage(message, secrets, [system, prompt]),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  function tripBreaker(error: ProviderError): void {
    if (error.status !== 404 && error.status !== 401 && error.status !== 403) {
      return;
    }
    if (!disabledProviders.has(error.provider)) {
      disabledProviders.add(error.provider);
      breakerErrors.set(error.provider, error);
      console.warn(`LLM provider ${error.provider} disabled after HTTP ${error.status}`);
    }
  }

  function retryDelay(retryAfter: string | null | undefined, retryIndex: number): number {
    const validNumber = retryAfter?.trim() !== '' && retryAfter !== null && retryAfter !== undefined
      && /^\d+(?:\.\d+)?$/.test(retryAfter.trim());
    const parsed = validNumber ? Number(retryAfter) : Number.NaN;
    const waitMs = Number.isFinite(parsed) && parsed >= 0
      ? parsed * 1000
      : 2000 * (2 ** retryIndex);
    return Math.min(waitMs, config.retryAfterCapMs);
  }

  async function requestWithRateRetries(
    provider: LlmProvider,
    system: string,
    prompt: string,
  ): Promise<{ result: ProviderResponse; attempts: number; errors: ProviderError[] }> {
    const errors: ProviderError[] = [];
    let attempts = 0;
    let retryIndex = 0;
    while (true) {
      attempts += 1;
      const result = await requestProvider(provider, system, prompt);
      if (!result.failure) {
        return { result, attempts, errors };
      }
      errors.push(result.failure);
      tripBreaker(result.failure);
      const retryable = result.failure.status === 429 || result.failure.status === 503;
      if (!retryable || retryIndex >= config.rateLimitRetries) {
        return { result, attempts, errors };
      }
      await sleep(retryDelay(result.retryAfter, retryIndex));
      retryIndex += 1;
    }
  }

  function rememberedBreakerErrors(): ProviderError[] {
    return config.providerOrder.flatMap((provider) => {
      const error = breakerErrors.get(provider);
      return error ? [error] : [];
    });
  }

  return {
    getDisabledProviders(): LlmProvider[] {
      return config.providerOrder.filter((provider) => disabledProviders.has(provider));
    },
    async generateJson<T>({ system, prompt, schema }: {
      system: string;
      prompt: string;
      schema: z.ZodType<T>;
    }): Promise<LlmResult<T>> {
      const availableProviders = config.providerOrder.filter((provider) => {
        const hasKey = provider === 'gemini' ? Boolean(geminiApiKey) : Boolean(groqApiKey);
        return hasKey && !disabledProviders.has(provider);
      });
      const providerErrors = availableProviders.length === 0 ? rememberedBreakerErrors() : [];
      let attempts = 0;

      for (const provider of availableProviders) {
        let retryPrompt = prompt;
        let providerInvalid: { message: string } | null = null;
        for (let validationAttempt = 0; validationAttempt <= config.maxValidationRetries; validationAttempt += 1) {
          const request = await requestWithRateRetries(provider, system, retryPrompt);
          attempts += request.attempts;
          providerErrors.push(...request.errors);
          if (request.result.failure) {
            providerInvalid = null;
            break;
          }

          const text = request.result.text ?? '';
          let parsed: unknown;
          try {
            parsed = JSON.parse(stripCodeFence(text)) as unknown;
          } catch {
            providerInvalid = { message: 'Provider returned invalid JSON' };
            providerErrors.push({
              provider,
              status: 200,
              message: providerInvalid.message,
            });
            retryPrompt = `${prompt}\n\nYour previous reply was invalid because it was not valid JSON. Return only valid JSON.`;
            continue;
          }

          const validated = schema.safeParse(parsed);
          if (validated.success) {
            return { ok: true, data: validated.data, model: request.result.model, attempts };
          }
          providerInvalid = { message: 'Provider output did not match the required schema' };
          providerErrors.push({ provider, status: 200, message: providerInvalid.message });
          retryPrompt = `${prompt}\n\nYour previous reply was invalid because it did not match the required schema. Return only valid JSON matching the schema.`;
        }

        if (providerInvalid) {
          return {
            ok: false,
            kind: 'invalid_output',
            error: providerInvalid.message,
            model: provider === 'gemini' ? config.geminiModel : config.groqModel,
            attempts,
            providerErrors,
          };
        }
      }
      const errors = providerErrors.length > 0 ? providerErrors : rememberedBreakerErrors();
      const lastError = errors.at(-1)?.message ?? 'No configured provider is available';
      return { ok: false, kind: 'error', error: lastError, model: null, attempts, providerErrors: errors };
    },
  };
}
