import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RunView, SourceRequestView } from '@vantage/shared';
import { SourceActivity } from './SourceActivity';

const run: RunView = {
  id: '00000000-0000-0000-0000-000000000001', status: 'completed', demo: false,
  params: { keywords: ['helpdesk'], sinceDays: 30, maxResults: 10 },
  startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:01:00Z',
  seller: { productName: 'Support', problemDescription: 'Tickets', idealCustomer: null, competitors: [] },
  sources: [{ source: 'hackernews', status: 'ok', fetchedCount: 2, error: null }], signalCount: 2,
};
const requests: SourceRequestView[] = [
  { id: 1, source: 'hackernews', label: 'helpdesk', status: 'ok', httpStatus: 200, durationMs: 20, itemsReturned: 4, error: null, quotaRemaining: null, outcome: 'success', request: { endpoint: 'https://hn.algolia.com/api/v1/search', params: { query: '"helpdesk"' } }, responseSummary: { returned: 4, totalHits: 4 }, createdAt: '2026-10-01T00:00:00Z' },
  { id: 2, source: 'hackernews', label: 'failed query', status: 'failed', httpStatus: 500, durationMs: 40, itemsReturned: 0, error: 'Temporary failure', quotaRemaining: null, createdAt: '2026-10-01T00:00:01Z' },
];

describe('SourceActivity', () => {
  it('renders source totals and the sanitized failed message', () => {
    const html = renderToString(<SourceActivity requests={requests} run={run} />);
    expect(html).toContain('1<!-- --> requests ok / <!-- -->1<!-- --> failed');
    expect(html).toContain('4<!-- --> items returned');
    expect(html).toContain('2<!-- --> signals kept');
    expect(html).toContain('Temporary failure');
    expect(html).toContain('https://hn.algolia.com/api/v1/search');
    expect(html).toContain('totalHits');
    expect(html.toLowerCase()).not.toContain('lead');
  });

  it('renders the empty state', () => {
    expect(renderToString(<SourceActivity requests={[]} run={run} />)).toContain('No requests recorded for this run.');
  });
});
