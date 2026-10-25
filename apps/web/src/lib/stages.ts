import type { AgentId, RunEvent, RunStatus } from '@vantage/shared';

export type StageState = 'waiting' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'skipped';
export interface StageStatus {
  state: StageState;
  label: string;
  summary: string | null;
  durationMs: number | null;
}

const LABELS: Record<StageState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  completed: 'Completed',
  completed_with_warnings: 'Completed with warnings',
  failed: 'Failed',
  skipped: 'Skipped',
};

const FINAL_PREFIXES: Partial<Record<AgentId, string[]>> = {
  classifier: ['Classified '],
  critic: ['Reviewed '],
  enricher: ['Enriched '],
  scorer: ['Scored '],
  displacement: ['Found ', 'No competitor'],
};

function duration(first: RunEvent | undefined, last: RunEvent | undefined): number | null {
  if (!first || !last) return null;
  const start = Date.parse(first.createdAt);
  const end = Date.parse(last.createdAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function count(event: RunEvent, key: string): number | null {
  const value = event.counts?.[key];
  return typeof value === 'number' ? value : null;
}

function summary(agent: AgentId, event: RunEvent | undefined): string | null {
  if (!event) return null;
  if (agent === 'scout') {
    const value = count(event, 'afterDedupe');
    return value === null ? null : `${value} signals`;
  }
  const fields: Partial<Record<AgentId, [string, string]>> = {
    classifier: ['classified', 'classified'],
    critic: ['reviewed', 'reviewed'],
    enricher: ['enriched', 'enriched'],
    scorer: ['ranked', 'ranked'],
    displacement: ['themeCount', 'themes'],
  };
  if (agent === 'displacement' && count(event, 'complaintSignals') === 0) return 'no complaints';
  const field = fields[agent];
  if (!field) return null;
  const value = count(event, field[0]);
  return value === null ? null : `${value} ${field[1]}`;
}

export function stageStatus(agent: AgentId, events: RunEvent[], runStatus: RunStatus): StageStatus {
  if (agent === 'orchestrator') {
    return { state: runStatus === 'running' ? 'waiting' : 'skipped', label: LABELS[runStatus === 'running' ? 'waiting' : 'skipped'], summary: null, durationMs: null };
  }
  const stageEvents = events.filter((event) => event.agent === agent);
  const displacementSkip = agent === 'displacement'
    ? stageEvents.find((event) => event.kind === 'info' && event.message.startsWith('Displacement skipped:'))
    : undefined;
  let finalEvent: RunEvent | undefined;
  if (agent === 'scout') {
    finalEvent = stageEvents.find((event) => count(event, 'afterDedupe') !== null);
  } else {
    const prefixes = FINAL_PREFIXES[agent] ?? [];
    finalEvent = stageEvents.find((event) =>
      (event.kind === 'info' || event.kind === 'warning') && prefixes.some((prefix) => event.message.startsWith(prefix)),
    );
  }

  let state: StageState;
  if (displacementSkip) {
    state = 'skipped';
  } else if (stageEvents.length === 0) {
    state = runStatus === 'running' ? 'waiting' : 'skipped';
  } else if (agent === 'scout') {
    const sourceStatuses = stageEvents.flatMap((event) => {
      const value = event.counts?.status;
      return typeof value === 'string' ? [value] : [];
    });
    if (sourceStatuses.length > 0 && sourceStatuses.every((value) => value === 'failed')) {
      state = 'failed';
    } else if (!finalEvent && runStatus === 'running') {
      state = 'running';
    } else if (sourceStatuses.some((value) => value === 'degraded' || value === 'failed' || value === 'skipped')) {
      state = 'completed_with_warnings';
    } else {
      state = 'completed';
    }
  } else if (finalEvent) {
    state = stageEvents.some((event) => event.kind === 'warning' || event.kind === 'error')
      ? 'completed_with_warnings' : 'completed';
  } else if (runStatus === 'running') {
    state = 'running';
  } else {
    state = stageEvents.some((event) => event.kind === 'error') ? 'failed' : 'completed_with_warnings';
  }

  return {
    state,
    label: LABELS[state],
    summary: summary(agent, finalEvent),
    durationMs: duration(stageEvents[0], finalEvent),
  };
}
