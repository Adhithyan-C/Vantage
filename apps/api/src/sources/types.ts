import type { RawSignal, RequestRecord, SourceId } from '@vantage/shared';

export interface SourceQuery {
  keywords: string[];
  sinceDays: number;
  maxResults: number;          // total cap per adapter call
}

export interface AdapterContext {
  fetch: typeof fetch;         // injected so tests never touch the network
  now: () => Date;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  onRequest?: (record: RequestRecord) => void;
}

export interface AdapterResult {
  signals: RawSignal[];
  status: 'ok' | 'degraded' | 'failed' | 'skipped';
  error?: string;              // first error message, if any
}

export interface SourceAdapter {
  readonly id: SourceId;
  search(query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult>;
}
