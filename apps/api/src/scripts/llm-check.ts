import dotenv from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { getEnv } from '../config/env';
import { resolveLlmConfig } from '../config/llm';
import type { LlmProvider } from '../config/llm';
import { createLlmClient } from '../llm/client';

dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const env = getEnv();
const config = resolveLlmConfig(env);
const configured = new Set<LlmProvider>();
if (env.GROQ_API_KEY) {
  configured.add('groq');
}
if (env.GEMINI_API_KEY) {
  configured.add('gemini');
}

const diagnosticOrder = [
  ...config.providerOrder.filter((provider) => configured.has(provider)),
  ...(['groq', 'gemini'] as const).filter(
    (provider) => configured.has(provider) && !config.providerOrder.includes(provider),
  ),
];
const schema = z.object({ ok: z.boolean() });
const disabled = new Set<LlmProvider>();
let successes = 0;

console.log(`Effective provider order: ${config.providerOrder.join(', ')}`);

for (const provider of ['groq', 'gemini'] as const) {
  const model = provider === 'groq' ? config.groqModel : config.geminiModel;
  if (!configured.has(provider)) {
    console.log(`${provider} (${model}): not configured`);
  }
}

for (const provider of diagnosticOrder) {
  const client = createLlmClient({
    fetch: globalThis.fetch,
    geminiApiKey: env.GEMINI_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    config: { ...config, providerOrder: [provider], rateLimitRetries: 0, maxValidationRetries: 0 },
    sleep: async () => {},
  });
  const model = provider === 'groq' ? config.groqModel : config.geminiModel;
  const result = await client.generateJson({
    system: 'Return the requested JSON object only.',
    prompt: 'Return exactly {"ok": true}.',
    schema,
  });
  for (const name of client.getDisabledProviders()) {
    disabled.add(name);
  }
  if (result.ok) {
    successes += 1;
    console.log(`${provider} (${model}): OK`);
  } else {
    const failure = result.providerErrors.at(-1);
    const status = failure?.status === null || failure?.status === undefined
      ? 'network error'
      : `HTTP ${failure.status}`;
    const message = failure?.message ?? result.error;
    console.log(`${provider} (${model}): ${status} - ${message}`);
  }
}

console.log(`Disabled providers: ${disabled.size > 0 ? [...disabled].join(', ') : 'none'}`);
if (successes === 0) {
  process.exitCode = 1;
}
