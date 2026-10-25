import type { RequestRecord } from '@vantage/shared';

function isoDateFilter(params: Record<string, string>): string {
  const hnTimestamp = params.numericFilters?.match(/created_at_i>(\d+)/)?.[1];
  const stackExchangeTimestamp = params.fromdate;
  const timestamp = hnTimestamp ?? stackExchangeTimestamp;
  if (!timestamp) return 'none';
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

export function formatVerboseRequest(record: RequestRecord): string {
  const params = record.request?.params ?? {};
  const titles = Array.isArray(record.responseSummary?.sampleTitles)
    ? record.responseSummary.sampleTitles.filter((title): title is string => typeof title === 'string').slice(0, 5)
    : [];
  return [
    `REQUEST source=${record.source}`,
    `form=${record.label.match(/\((quoted|all_words)\)/)?.[1] ?? 'unknown'}`,
    `endpoint=${record.request?.endpoint ?? 'unknown'}`,
    `date_filter=${isoDateFilter(params)}`,
    `http_status=${record.httpStatus ?? 'none'}`,
    `hit_item_count=${record.itemsReturned}`,
    `params=${JSON.stringify(params)}`,
    `top_titles=${titles.length > 0 ? titles.join(' | ') : '(none)'}`,
  ].join(' | ');
}
