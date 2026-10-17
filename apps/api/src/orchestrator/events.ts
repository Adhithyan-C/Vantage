
import type { AgentId, EventKind } from '@vantage/shared';
import type { RunStore } from '../db/runs';

export type EmitFn = (
  agent: AgentId,
  message: string,
  counts?: Record<string, unknown>,
) => Promise<void>;

export interface Emitter {
  info: EmitFn;
  progress: EmitFn;
  warning: EmitFn;
  error: EmitFn;
}

export function createEmitter(store: RunStore, runId: string): Emitter {
  const make = (kind: EventKind): EmitFn => {
    return async (agent, message, counts) => {
      try {
        await store.addEvent(runId, agent, kind, message, counts);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        console.error(`Failed to write ${kind} event: ${text}`);
      }
    };
  };

  return {
    info: make('info'),
    progress: make('progress'),
    warning: make('warning'),
    error: make('error'),
  };
}