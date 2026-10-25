import type { RawSignal, RequestRecord, SourceId } from '@vantage/shared';
import type { SellerProfileInput } from '@vantage/shared';
import type { SearchVariant } from '../agents/queryVariants.js';

export interface SourceQuery {
  keywords: string[];
  sinceDays: number;
  maxResults: number;          // total cap per adapter call
  seller?: SellerProfileInput;
  variants?: SearchVariant[];
}

export interface AdapterContext {
  fetch: typeof fetch;         // injected so tests never touch the network
  now: () => Date;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  onRequest?: (record: RequestRecord) => void;
  onRateLimitWait?: (source: SourceId, waitMs: number) => void | Promise<void>;
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
