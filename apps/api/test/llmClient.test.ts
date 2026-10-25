import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseProviderOrder, providerOrder, resolveLlmConfig } from '../src/config/llm';
import type { LlmProvider } from '../src/config/llm';
import { createLlmClient } from '../src/llm/client';
import type { LlmConfig } from '../src/llm/client';

const config: LlmConfig = {
  geminiModel: 'gemini-test',
  groqModel: 'groq-test',
  temperature: 0,
  requestTimeoutMs: 25,
  maxValidationRetries: 2,
  rateLimitRetries: 2,
  retryAfterCapMs: 20_000,
  providerOrder: [...providerOrder],
};
const schema = z.object({ label: z.string() });
const valid = { label: 'buyer_intent' };
type FetchStep = Response | Error | ((signal: AbortSignal | undefined) => Promise<Response>);
interface RequestRecord {
  url: string;
  init: RequestInit | undefined;
}

function geminiResponse(text: string, finishReason = 'STOP'): Response {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }));
}

function groqResponse(text: string): Response {
  return new Response(JSON.stringify({
    model: 'openai/gpt-oss-20b',
    choices: [{ finish_reason: 'stop', message: { content: text } }],
  }));
}

function errorResponse(status: number, message = `HTTP ${status}`, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) {
    headers.set('Retry-After', retryAfter);
  }
  return new Response(JSON.stringify({ error: { message } }), { status, headers });
}

function fakeFetch(queue: FetchStep[], requests: RequestRecord[] = []): typeof fetch {
  const fake = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), init });
    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (typeof next === 'function') {
      return next(init?.signal ?? undefined);
    }
    if (!next) {
      throw new Error('No fake response queued');
    }
    return next;
  };
  return fake as typeof fetch;
}

function makeClient(
  queue: FetchStep[],
  options: {
    order?: LlmProvider[];
    geminiApiKey?: string;
    groqApiKey?: string;
    requestConfig?: Partial<LlmConfig>;
    requests?: RequestRecord[];
    sleeps?: number[];
  } = {},
) {
  const requests = options.requests ?? [];
  const sleeps = options.sleeps ?? [];
  const llm = createLlmClient({
    fetch: fakeFetch(queue, requests),
    geminiApiKey: options.geminiApiKey ?? 'gemini-configured-key',
    groqApiKey: options.groqApiKey,
    config: { ...config, ...options.requestConfig, providerOrder: options.order ?? config.providerOrder },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { llm, requests, sleeps };
}

function generate(llm: ReturnType<typeof createLlmClient>) {
  return llm.generateJson({ system: 'system text', prompt: 'prompt with private post text', schema });
}

function urlProvider(request: RequestRecord): LlmProvider {
  return request.url.includes('generativelanguage.googleapis.com') ? 'gemini' : 'groq';
}

describe('createLlmClient resilience and configuration', () => {
  it('defaults to Groq then Gemini and parses the configured order', () => {
    expect(providerOrder).toEqual(['groq', 'gemini']);
    expect(parseProviderOrder('gemini,groq')).toEqual(['gemini', 'groq']);
    expect(parseProviderOrder('unknown, Gemini ,wrong')).toEqual(['gemini']);
    expect(parseProviderOrder('unknown,wrong')).toEqual(['groq', 'gemini']);
  });

  it('uses the default provider order for actual requests', async () => {
    const { llm, requests } = makeClient([groqResponse(JSON.stringify(valid))], { groqApiKey: 'groq-key' });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: true, model: 'groq-test' });
    expect(requests.map(urlProvider)).toEqual(['groq']);
  });

  it('respects a reversed provider order and falls through on HTTP 403', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, requests } = makeClient([
      errorResponse(403, 'forbidden'),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: true, model: 'groq-test', attempts: 2 });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'groq']);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('LLM provider gemini disabled after HTTP 403');
    warning.mockRestore();
  });

  it('falls through to Groq after a Gemini network error', async () => {
    const { llm, requests } = makeClient([
      new Error('network is unavailable'),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true, model: 'groq-test', attempts: 2 });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'groq']);
    expect(llm.getDisabledProviders()).toEqual([]);
  });

  it('retries HTTP 429 after the numeric Retry-After delay', async () => {
    const { llm, sleeps } = makeClient([
      errorResponse(429, 'rate limited', '1'),
      geminiResponse(JSON.stringify(valid)),
    ], { order: ['gemini'] });
    expect(await generate(llm)).toMatchObject({ ok: true, attempts: 2 });
    expect(sleeps).toEqual([1000]);
  });

  it('reports rate-limit waits before sleeping while retaining the retry', async () => {
    const { llm } = makeClient([
      errorResponse(429, 'rate limited', '0.5'),
      geminiResponse(JSON.stringify(valid)),
    ], { order: ['gemini'] });
    const waits: Array<[LlmProvider, number]> = [];
    const result = await llm.generateJson({
      system: 'system text',
      prompt: 'prompt',
      schema,
      onRateLimitWait: (provider, waitMs) => { waits.push([provider, waitMs]); },
    });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(waits).toEqual([['gemini', 500]]);
  });

  it('uses 2000 ms and 4000 ms fallback delays before provider fallback', async () => {
    const { llm, requests, sleeps } = makeClient([
      errorResponse(429),
      errorResponse(429),
      errorResponse(429),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true, attempts: 4 });
    expect(sleeps).toEqual([2000, 4000]);
    expect(requests.map(urlProvider)).toEqual(['gemini', 'gemini', 'gemini', 'groq']);
  });

  it('caps numeric Retry-After waits at 20000 ms', async () => {
    const { llm, sleeps } = makeClient([
      errorResponse(429, 'slow down', '3600'),
      geminiResponse(JSON.stringify(valid)),
    ], { order: ['gemini'] });
    expect(await generate(llm)).toMatchObject({ ok: true });
    expect(sleeps).toEqual([20_000]);
  });

  it('retries HTTP 503 on the same provider before trying Groq', async () => {
    const { llm, requests, sleeps } = makeClient([
      errorResponse(503),
      errorResponse(503),
      errorResponse(503),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true, attempts: 4 });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'gemini', 'gemini', 'groq']);
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('preserves one provider error for each failed attempt when all providers fail', async () => {
    const { llm } = makeClient([
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      errorResponse(500, 'busy'),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: false, kind: 'error', attempts: 4 });
    if (!result.ok) {
      expect(result.providerErrors.map(({ provider, status }) => [provider, status])).toEqual([
        ['gemini', 429], ['gemini', 429], ['gemini', 429],
        ['groq', 500],
      ]);
    }
  });

  it('does not retry non-rate-limit HTTP errors', async () => {
    const { llm, requests, sleeps } = makeClient([errorResponse(400, 'bad request')], {
      order: ['gemini'],
      groqApiKey: undefined,
    });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: false, kind: 'error', attempts: 1 });
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('falls through immediately on other non-2xx HTTP statuses', async () => {
    const { llm, requests, sleeps } = makeClient([
      errorResponse(400, 'invalid request'),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true, model: 'groq-test', attempts: 2 });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'groq']);
    expect(sleeps).toEqual([]);
  });

  it('falls through on blocked replies', async () => {
    const { llm, requests } = makeClient([
      geminiResponse('', 'SAFETY'),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true, model: 'groq-test' });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'groq']);
  });

  it('falls through on an empty reply', async () => {
    const { llm } = makeClient([
      geminiResponse(''),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true, model: 'groq-test' });
  });

  it('redacts configured keys, key-shaped secrets, and prompt text from provider errors', async () => {
    const prompt = 'prompt with private post text';
    const echoed = `failed ${prompt} gemini-private groq-private gsk_ABC123 AIza12345678901234567890`;
    const { llm } = makeClient([errorResponse(400, echoed)], {
      order: ['gemini'],
      geminiApiKey: 'gemini-private',
      groqApiKey: 'groq-private',
    });
    const result = await llm.generateJson({ system: 'system text', prompt, schema });
    expect(result).toMatchObject({ ok: false, kind: 'error' });
    if (!result.ok) {
      expect(result.providerErrors).toHaveLength(1);
      const message = result.providerErrors[0]?.message ?? '';
      expect(message).not.toContain('gemini-private');
      expect(message).not.toContain('groq-private');
      expect(message).not.toContain('gsk_ABC123');
      expect(message).not.toContain('AIza12345678901234567890');
      expect(message).not.toContain(prompt);
      expect(message.length).toBeLessThanOrEqual(200);
    }
  });

  it('uses model overrides in the actual provider URL and request body', async () => {
    const overridden = resolveLlmConfig({ GEMINI_MODEL: 'gemini-override', GROQ_MODEL: 'groq-override' });
    const geminiRequests: RequestRecord[] = [];
    const gemini = createLlmClient({
      fetch: fakeFetch([geminiResponse(JSON.stringify(valid))], geminiRequests),
      geminiApiKey: 'gemini-key',
      config: { ...config, ...overridden, providerOrder: ['gemini'] },
      sleep: async () => {},
    });
    await generate(gemini);
    expect(geminiRequests[0]?.url).toContain('/models/gemini-override:generateContent');

    const groqRequests: RequestRecord[] = [];
    const groq = createLlmClient({
      fetch: fakeFetch([groqResponse(JSON.stringify(valid))], groqRequests),
      groqApiKey: 'groq-key',
      config: { ...config, ...overridden, providerOrder: ['groq'] },
      sleep: async () => {},
    });
    await generate(groq);
    expect(JSON.parse(String(groqRequests[0]?.init?.body))).toMatchObject({ model: 'groq-override' });
  });

  it('never puts configured provider API keys in request URLs', async () => {
    const requests: RequestRecord[] = [];
    const groq = createLlmClient({
      fetch: fakeFetch([groqResponse(JSON.stringify(valid))], requests),
      geminiApiKey: 'AIza12345678901234567890',
      groqApiKey: 'gsk_ABC123',
      config: { ...config, providerOrder: ['groq'] },
      sleep: async () => {},
    });
    await generate(groq);
    expect(requests.every(({ url }) => !url.includes('AIza') && !url.includes('gsk_'))).toBe(true);
  });

  it('never calls a provider that has no configured API key', async () => {
    const { llm, requests } = makeClient([geminiResponse(JSON.stringify(valid))], {
      order: ['groq', 'gemini'],
    });
    expect(await generate(llm)).toMatchObject({ ok: true });
    expect(requests.map(urlProvider)).toEqual(['gemini']);
  });

  it('returns a failure without fetching when no provider key is configured', async () => {
    const { llm, requests } = makeClient([], {
      order: ['groq', 'gemini'],
      geminiApiKey: '',
      groqApiKey: '',
    });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: false, kind: 'error', attempts: 0, providerErrors: [] });
    expect(requests).toHaveLength(0);
  });

  it.each([404, 401, 403])('trips the circuit breaker on HTTP %s only once', async (status) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, requests } = makeClient([
      errorResponse(status, 'not allowed'),
      groqResponse(JSON.stringify(valid)),
      groqResponse(JSON.stringify(valid)),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    expect(await generate(llm)).toMatchObject({ ok: true });
    expect(await generate(llm)).toMatchObject({ ok: true });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'groq', 'groq']);
    expect(llm.getDisabledProviders()).toEqual(['gemini']);
    expect(warning).toHaveBeenCalledExactlyOnceWith(`LLM provider gemini disabled after HTTP ${status}`);
    warning.mockRestore();
  });

  it('does not trip the breaker on HTTP 429 or 500', async () => {
    const { llm } = makeClient([
      errorResponse(429), errorResponse(429), errorResponse(429),
      errorResponse(500),
      geminiResponse(JSON.stringify(valid)),
    ], { order: ['gemini'] });
    expect((await generate(llm)).ok).toBe(false);
    expect((await generate(llm)).ok).toBe(false);
    expect(await generate(llm)).toMatchObject({ ok: true });
    expect(llm.getDisabledProviders()).toEqual([]);
  });

  it('does not trip the breaker on network errors or timeouts', async () => {
    const queue: FetchStep[] = [
      new Error('connection reset'),
      (signal) => new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
      geminiResponse(JSON.stringify(valid)),
    ];
    const { llm, requests } = makeClient(queue, {
      order: ['gemini'],
      requestConfig: { requestTimeoutMs: 1, rateLimitRetries: 0 },
    });
    const first = await generate(llm);
    const second = await generate(llm);
    expect(first).toMatchObject({ ok: false, providerErrors: [{ status: null }] });
    expect(second).toMatchObject({ ok: false, providerErrors: [{ status: null, message: 'Request timed out' }] });
    expect(await generate(llm)).toMatchObject({ ok: true });
    expect(requests).toHaveLength(3);
    expect(llm.getDisabledProviders()).toEqual([]);
  });

  it('falls through to Groq after a Gemini timeout', async () => {
    const queue: FetchStep[] = [
      (signal) => new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
      groqResponse(JSON.stringify(valid)),
    ];
    const { llm, requests } = makeClient(queue, {
      order: ['gemini', 'groq'],
      groqApiKey: 'groq-key',
      requestConfig: { requestTimeoutMs: 1, rateLimitRetries: 0 },
    });
    expect(await generate(llm)).toMatchObject({ ok: true, model: 'groq-test', attempts: 2 });
    expect(requests.map(urlProvider)).toEqual(['gemini', 'groq']);
    expect(llm.getDisabledProviders()).toEqual([]);
  });

  it('preserves the final HTTP 429 status after exhausting retries', async () => {
    const { llm } = makeClient([
      errorResponse(429), errorResponse(429), errorResponse(429),
    ], { order: ['gemini'] });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: false, kind: 'error', attempts: 3 });
    if (!result.ok) {
      expect(result.providerErrors.at(-1)).toMatchObject({ provider: 'gemini', status: 429 });
    }
  });

  it('uses one request per provider in the requested order and reports failure status', async () => {
    const { llm, requests, sleeps } = makeClient([
      errorResponse(429, 'rate limited', 'not numeric'),
      errorResponse(429, 'rate limited', 'not numeric'),
      errorResponse(429, 'rate limited', 'not numeric'),
      errorResponse(404, 'missing model'),
    ], { order: ['groq', 'gemini'], groqApiKey: 'groq-key' });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: false, kind: 'error' });
    expect(sleeps).toEqual([2000, 4000]);
    expect(requests.map(urlProvider)).toEqual(['groq', 'groq', 'groq', 'gemini']);
    if (!result.ok) {
      expect(result.providerErrors.at(-1)).toMatchObject({ provider: 'gemini', status: 404 });
    }
  });

  it('returns stored breaker errors when every provider has been disabled', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, requests } = makeClient([
      errorResponse(401, 'unauthorized'),
      errorResponse(403, 'forbidden'),
    ], { order: ['gemini', 'groq'], groqApiKey: 'groq-key' });
    const first = await generate(llm);
    const second = await generate(llm);
    expect(first).toMatchObject({ ok: false, kind: 'error' });
    expect(second).toMatchObject({ ok: false, kind: 'error', attempts: 0 });
    if (!second.ok) {
      expect(second.providerErrors.map(({ provider, status }) => [provider, status]))
        .toEqual([['gemini', 401], ['groq', 403]]);
    }
    expect(requests).toHaveLength(2);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenNthCalledWith(1, 'LLM provider gemini disabled after HTTP 401');
    expect(warning).toHaveBeenNthCalledWith(2, 'LLM provider groq disabled after HTTP 403');
    warning.mockRestore();
  });

  it('retries invalid JSON with the same provider and succeeds', async () => {
    const { llm } = makeClient([
      geminiResponse('not JSON'),
      geminiResponse(JSON.stringify(valid)),
    ], { order: ['gemini'] });
    expect(await generate(llm)).toMatchObject({ ok: true, attempts: 2 });
  });

  it('returns invalid_output after the configured validation retries', async () => {
    const { llm } = makeClient([
      geminiResponse('bad'), geminiResponse('bad'), geminiResponse('bad'),
    ], { order: ['gemini'] });
    const result = await generate(llm);
    expect(result).toMatchObject({ ok: false, kind: 'invalid_output', model: 'gemini-test', attempts: 3 });
    if (!result.ok) {
      expect(result.providerErrors).toHaveLength(3);
      expect(result.providerErrors.every((error) => error.status === 200)).toBe(true);
    }
  });

  it('accepts JSON inside a code fence', async () => {
    const { llm } = makeClient([
      geminiResponse(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``),
    ], { order: ['gemini'] });
    expect(await generate(llm)).toMatchObject({ ok: true, data: valid });
  });
});
