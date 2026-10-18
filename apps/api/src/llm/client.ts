import type { z } from 'zod';

export interface LlmConfig {
  geminiModel: string;
  groqModel: string;
  temperature: number;
  requestTimeoutMs: number;
  maxValidationRetries: number;
}

export type LlmResult<T> =
  | { ok: true; data: T; model: string; attempts: number }
  | {
      ok: false;
      kind: 'invalid_output' | 'error';
      error: string;
      model: string | null;
      attempts: number;
    };

export interface LlmClient {
  generateJson<T>(options: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
  }): Promise<LlmResult<T>>;
}

interface LlmClientOptions {
  fetch: typeof fetch;
  geminiApiKey: string;
  groqApiKey?: string;
  config: LlmConfig;
}

interface ProviderResponse {
  text: string | null;
  model: string;
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
}: LlmClientOptions): LlmClient {
  async function requestProvider(
    provider: 'gemini' | 'groq',
    system: string,
    prompt: string,
  ): Promise<ProviderResponse> {
    const model = provider === 'gemini' ? config.geminiModel : config.groqModel;
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
        headers['x-goog-api-key'] = geminiApiKey;
        body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: config.temperature, responseMimeType: 'application/json' },
        };
      } else {
        headers.Authorization = `Bearer ${groqApiKey ?? ''}`;
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
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          return { text: null, model, error: `Provider returned HTTP ${response.status}` };
        }
        return { text: null, model, error: `Provider rejected the request (HTTP ${response.status})` };
      }
      const responseBody = await readJson(response);
      const text = isGemini ? getGeminiText(responseBody) : getGroqText(responseBody);
      return text
        ? { text, model }
        : { text: null, model, error: 'Provider returned an empty or blocked reply' };
    } catch (err) {
      return { text: null, model, error: errorMessage(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async generateJson<T>({ system, prompt, schema }: {
      system: string;
      prompt: string;
      schema: z.ZodType<T>;
    }): Promise<LlmResult<T>> {
      const providers: Array<'gemini' | 'groq'> = groqApiKey ? ['gemini', 'groq'] : ['gemini'];
      let attempts = 0;
      let lastError = 'No provider returned a response';

      for (const provider of providers) {
        let retryPrompt = prompt;
        const model = provider === 'gemini' ? config.geminiModel : config.groqModel;
        for (let validationAttempt = 0; validationAttempt <= config.maxValidationRetries; validationAttempt += 1) {
          attempts += 1;
          const result = await requestProvider(provider, system, retryPrompt);
          if (!result.text) {
            lastError = result.error ?? 'Provider returned an empty or blocked reply';
            break;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(stripCodeFence(result.text)) as unknown;
          } catch (err) {
            lastError = `Invalid JSON: ${errorMessage(err)}`;
            retryPrompt = `${prompt}\n\nYour previous reply was invalid because it was not valid JSON. Return only valid JSON.`;
            continue;
          }

          const validated = schema.safeParse(parsed);
          if (validated.success) {
            return { ok: true, data: validated.data, model: result.model, attempts };
          }
          lastError = `Invalid output: ${validated.error.issues.map((issue) => issue.message).join('; ')}`;
          retryPrompt = `${prompt}\n\nYour previous reply was invalid because it did not match the required schema. Return only valid JSON matching the schema.`;
        }

        if (attempts > 0 && lastError.startsWith('Invalid ')) {
          return { ok: false, kind: 'invalid_output', error: lastError, model, attempts };
        }
      }

      return { ok: false, kind: 'error', error: lastError, model: null, attempts };
    },
  };
}
