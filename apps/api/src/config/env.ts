import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1).optional(),
  REDDIT_USER_AGENT: z.string().min(1),
  REDDIT_CLIENT_ID: z.string().min(1).optional(),
  REDDIT_CLIENT_SECRET: z.string().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).optional(),
  LLM_PROVIDER_ORDER: z.string().min(1).optional(),
  STACKEXCHANGE_KEY: z.string().min(1).optional(),
  STACKEXCHANGE_SITES: z.string().optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  PRODUCT_HUNT_TOKEN: z.string().min(1).optional(),
  ENABLE_CRITIC: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  ENABLE_DISPLACEMENT: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform((val) => val === 'true'),
  PORT: z.string().optional().default('3001').transform(Number).pipe(z.number().int().min(1).max(65535))
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: Record<string, string | undefined>): Env {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value.trim() !== '') {
      cleaned[key] = value;
    }
  }

  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cachedEnv: Env | null = null;
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv(process.env);
  }
  return cachedEnv;
}
