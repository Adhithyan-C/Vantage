import type { RequestRecord } from '@vantage/shared';
import type { AdapterResult, SourceAdapter, SourceQuery, AdapterContext } from './types.js';

export const PRODUCT_HUNT_GRAPHQL_ENDPOINT = 'https://api.producthunt.com/v2/api/graphql';

export const productHuntAdapter: SourceAdapter = {
  id: 'producthunt',
  async search(_query: SourceQuery, ctx: AdapterContext): Promise<AdapterResult> {
    const configured = Boolean(process.env.PRODUCT_HUNT_TOKEN?.trim());
    const reason = configured
      ? 'Product Hunt is blocked until API use is confirmed as non-commercial or permission is obtained'
      : 'Product Hunt not configured; API token is missing and commercial-use permission is unconfirmed';
    const record: RequestRecord = {
      source: 'producthunt',
      label: 'Product Hunt retrieval blocked by API-use terms',
      status: 'skipped',
      httpStatus: null,
      durationMs: 0,
      itemsReturned: 0,
      error: reason,
      quotaRemaining: null,
      request: { endpoint: PRODUCT_HUNT_GRAPHQL_ENDPOINT, params: {} },
      responseSummary: { reason, requestMade: false },
    };
    try {
      ctx.onRequest?.(record);
    } catch {
      // Request logging failures must not change the skipped source outcome.
    }
    return { signals: [], status: 'skipped', error: reason };
  },
};
