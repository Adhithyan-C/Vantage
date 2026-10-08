export const SOURCE_CONFIG = {
  enabled: { reddit: false, hackernews: true, devforums: false, snapshot: false },
  maxSignalsPerSource: 100,
  requestTimeoutMs: 10000,
  maxRetries: 3,
  llmConcurrency: 2,
} as const;
