import { useCallback, useEffect, useState } from 'react';
import type { RunEvent, RunView } from '@vantage/shared';
import { ApiError, getEvents, getRun } from '../lib/api';

const POLL_MS = 1000;
const RETRY_MS = 2000;
const DRAIN_DELAY_MS = 700;
const MAX_FAILURES = 5;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface RunEventsState {
  run: RunView | null;
  events: RunEvent[];
  error: string | null;
  retry: () => void;
}

export function useRunEvents(runId: string): RunEventsState {
  const [run, setRun] = useState<RunView | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let lastId = 0;
    let failures = 0;

    setRun(null);
    setEvents([]);
    setError(null);

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
      });

    const appendEvents = (fresh: RunEvent[]): void => {
      const last = fresh[fresh.length - 1];
      if (!last) {
        return;
      }
      lastId = last.id;
      setEvents((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...fresh.filter((item) => !known.has(item.id))];
      });
    };

    const loop = async (): Promise<void> => {
      while (!cancelled) {
        try {
          appendEvents(await getEvents(runId, lastId));
          if (cancelled) {
            return;
          }
          const fresh = await getRun(runId);
          if (cancelled) {
            return;
          }
          failures = 0;
          setError(null);
          setRun(fresh);

          if (fresh.status !== 'running') {
            // The final event is written just after the status flips, so read once more.
            await wait(DRAIN_DELAY_MS);
            if (cancelled) {
              return;
            }
            appendEvents(await getEvents(runId, lastId));
            return;
          }
          await wait(POLL_MS);
        } catch (err) {
          if (cancelled) {
            return;
          }
          setError(messageOf(err));
          failures += 1;
          const fatal = err instanceof ApiError && (err.status === 400 || err.status === 404);
          if (fatal || failures >= MAX_FAILURES) {
            return;
          }
          await wait(RETRY_MS);
        }
      }
    };

    void loop();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (wake) {
        wake();
      }
    };
  }, [runId, attempt]);

  return { run, events, error, retry };
}
