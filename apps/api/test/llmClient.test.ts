import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLlmClient } from '../src/llm/client';

const config = {
  geminiModel: 'gemini-test',
  groqModel: 'groq-test',
  temperature: 0,
  requestTimeoutMs: 100,
  maxValidationRetries: 2,
};
const schema = z.object({ label: z.string() });
const valid = { label: 'buyer_intent' };

function geminiResponse(text: string, finishReason = 'STOP'): Response {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }));
}

function groqResponse(text: string): Response {
  return new Response(JSON.stringify({
    model: 'openai/gpt-oss-20b',
    choices: [{ finish_reason: 'stop', message: { content: text } }],
  }));
}

function fakeFetch(queue: Array<Response | Error>, urls: string[] = []): typeof fetch {
  return (async (input: string | URL) => {
    urls.push(String(input));
    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error('No fake response queued');
    }
    return next;
  }) as typeof fetch;
}

function client(fetcher: typeof fetch, groqApiKey?: string) {
  return createLlmClient({ fetch: fetcher, geminiApiKey: 'gemini-secret', groqApiKey, config });
}

describe('createLlmClient', () => {
  it('returns a validated Gemini result', async () => {
    const result = await client(fakeFetch([geminiResponse(JSON.stringify(valid))])).generateJson({
      system: 'system', prompt: 'prompt', schema,
    });
    expect(result).toEqual({ ok: true, data: valid, model: 'gemini-test', attempts: 1 });
  });

  it('falls back from Gemini 429 to Groq and reports the Groq model', async () => {
    const result = await client(fakeFetch([
      new Response('{}', { status: 429 }),
      groqResponse(JSON.stringify(valid)),
    ]), 'groq-secret').generateJson({ system: 'system', prompt: 'prompt', schema });
    expect(result).toEqual({ ok: true, data: valid, model: 'groq-test', attempts: 2 });
  });

  it('returns error when both providers fail', async () => {
    const result = await client(fakeFetch([
      new Response('{}', { status: 503 }),
      new Response('{}', { status: 500 }),
    ]), 'groq-secret').generateJson({ system: 'system', prompt: 'prompt', schema });
    expect(result).toMatchObject({ ok: false, kind: 'error', model: null, attempts: 2 });
  });

  it('retries invalid JSON with the same provider and succeeds', async () => {
    const result = await client(fakeFetch([
      geminiResponse('not JSON'),
      geminiResponse(JSON.stringify(valid)),
    ])).generateJson({ system: 'system', prompt: 'prompt', schema });
    expect(result).toEqual({ ok: true, data: valid, model: 'gemini-test', attempts: 2 });
  });

  it('returns invalid_output after the configured retries', async () => {
    const result = await client(fakeFetch([
      geminiResponse('bad'),
      geminiResponse('bad'),
      geminiResponse('bad'),
    ])).generateJson({ system: 'system', prompt: 'prompt', schema });
    expect(result).toMatchObject({ ok: false, kind: 'invalid_output', model: 'gemini-test', attempts: 3 });
  });

  it('accepts JSON inside a code fence', async () => {
    const result = await client(fakeFetch([
      geminiResponse(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``),
    ])).generateJson({ system: 'system', prompt: 'prompt', schema });
    expect(result).toMatchObject({ ok: true, data: valid });
  });

  it('never puts a provider API key in a URL', async () => {
    const urls: string[] = [];
    await client(fakeFetch([
      new Response('{}', { status: 429 }),
      groqResponse(JSON.stringify(valid)),
    ], urls), 'groq-secret').generateJson({ system: 'system', prompt: 'prompt', schema });
    expect(urls.every((url) => !url.includes('secret'))).toBe(true);
  });
});
