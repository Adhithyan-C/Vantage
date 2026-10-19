import type { LeadLabel, ReportView } from '@vantage/shared';

const RANKED_LABELS: LeadLabel[] = ['buyer_intent', 'competitor_complaint'];

function escapeCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[,"\r\n]/.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue;
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return `\uFEFF${rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')}`;
}

const HEADER = [
  'rank', 'label', 'score', 'confidence_percent', 'status', 'source', 'community', 'author',
  'posted_at', 'age_days', 'link', 'summary', 'evidence_quotes', 'criteria_passed',
  'competitors_mentioned', 'purchase_terms', 'team_terms', 'comments', 'upvotes',
  'data_origin', 'post_preview',
];

export function buildReportCsv(report: ReportView, includeAll: boolean): string {
  const signals = includeAll
    ? report.signals
    : report.signals.filter((signal) => RANKED_LABELS.includes(signal.label));
  const rows: Array<Array<string | number | null>> = [HEADER];
  for (const signal of signals) {
    const ranked = RANKED_LABELS.includes(signal.label);
    rows.push([
      ranked ? signal.rank : null,
      signal.label,
      ranked ? signal.score : null,
      ranked && signal.confidence !== null ? Math.round(signal.confidence * 100) : null,
      signal.status,
      signal.source,
      signal.community,
      signal.authorHandle,
      signal.createdAtSource,
      signal.enrichment.ageDays,
      signal.source === 'snapshot' ? '' : signal.url,
      signal.rationale,
      signal.criteria.filter((criterion) => criterion.passed && criterion.quote !== null)
        .map((criterion) => criterion.quote as string).join(' | '),
      signal.criteria.filter((criterion) => criterion.passed).map((criterion) => criterion.id).join(';'),
      signal.enrichment.competitorsMentioned.join(';'),
      signal.enrichment.purchaseTermsFound.join(';'),
      signal.enrichment.teamTermsFound.join(';'),
      signal.enrichment.commentCount,
      signal.enrichment.upvotes,
      signal.source === 'snapshot' ? 'sample (synthetic)' : 'live',
      signal.textPreview,
    ]);
  }
  return toCsv(rows);
}
