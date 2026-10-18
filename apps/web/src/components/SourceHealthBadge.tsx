import type { SourceStatus } from '@vantage/shared';

const LABEL: Record<SourceStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  ok: 'OK',
  degraded: 'Degraded',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function SourceHealthBadge({ status }: { status: SourceStatus }) {
  return (
    <span className={`badge badge-source-${status}`}>
      <span className="badge-dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
