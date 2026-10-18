import type { EventKind, RunStatus, SourceId } from '@vantage/shared';

export const SOURCE_LABEL: Record<SourceId, string> = {
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  devforums: 'Developer forums',
  snapshot: 'Saved snapshot',
};

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  info: 'Info',
  progress: 'Progress',
  warning: 'Warning',
  error: 'Error',
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  completed_with_warnings: 'Completed with warnings',
  failed: 'Failed',
};

export function formatDuration(
  startedAt: string,
  finishedAt: string | null,
  nowMs: number,
): string {
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString();
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
