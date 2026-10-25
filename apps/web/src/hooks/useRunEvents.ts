import { useCallback, useEffect, useState } from 'react';
import type { RunEvent, RunView, SourceRequestView } from '@vantage/shared';
import { ApiError, getEvents, getRequests, getRun } from '../lib/api';

const POLL_MS = 1000;
const RETRY_MS = 2000;
const DRAIN_DELAY_MS = 700;
const MAX_FAILURES = 5;
const MAX_STREAM_ERRORS = 3;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface RunEventsState {
  run: RunView | null;
  events: RunEvent[];
  requests: SourceRequestView[];
  error: string | null;
  retry: () => void;
}

export function mergeRunEvents(current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const known = new Set(current.map((item) => item.id));
  const unique = incoming.filter((item) => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  });
  return [...current, ...unique];
}

function parseRunEvent(text: string): RunEvent | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'number' || typeof row.runId !== 'string' || typeof row.agent !== 'string' ||
      typeof row.kind !== 'string' || typeof row.message !== 'string' || typeof row.createdAt !== 'string') return null;
    return value as RunEvent;
  } catch {
    return null;
  }
}

interface EventSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
}

export function connectRunEventStream(
  createSource: ((url: string) => EventSourceLike) | undefined,
  url: string,
  onEvent: (event: RunEvent) => void,
  onDone: () => void,
  onFallback: () => void,
): { close: () => void; healthy: () => boolean } {
  if (!createSource) {
    onFallback();
    return { close: () => {}, healthy: () => false };
  }
  let source: EventSourceLike;
  try {
    source = createSource(url);
  } catch {
    onFallback();
    return { close: () => {}, healthy: () => false };
  }
  let active = true;
  let consecutiveErrors = 0;
  const close = (): void => {
    if (!active) return;
    active = false;
    source.close();
  };
  const fallback = (): void => {
    if (!active) return;
    close();
    onFallback();
  };
  source.addEventListener('run_event', (event: Event) => {
    consecutiveErrors = 0;
    const parsed = parseRunEvent((event as MessageEvent<string>).data);
    if (parsed) onEvent(parsed);
  });
  source.addEventListener('done', () => {
    if (!active) return;
    close();
    onDone();
  });
  source.addEventListener('fatal', fallback);
  source.onerror = () => {
    consecutiveErrors += 1;
    if (consecutiveErrors >= MAX_STREAM_ERRORS) fallback();
  };
  return { close, healthy: () => active };
}

export function useRunEvents(runId: string): RunEventsState {
  const [run, setRun] = useState<RunView | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [requests, setRequests] = useState<SourceRequestView[]>([]);
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
    let closeEventStream: (() => void) | undefined;
    let streamHealthy = false;

    setRun(null);
    setEvents([]);
    setRequests([]);
    setError(null);

    const wait = (ms: number): Promise<void> => new Promise((resolve) => {
      const finish = (): void => {
        wake = undefined;
        timer = undefined;
        resolve();
      };
      wake = () => {
        if (timer !== undefined) clearTimeout(timer);
        finish();
      };
      timer = setTimeout(finish, ms);
    });

    const appendEvents = (fresh: RunEvent[]): void => {
      const last = fresh[fresh.length - 1];
      if (!last) {
        return;
      }
      lastId = Math.max(lastId, ...fresh.map((item) => item.id));
      setEvents((previous) => mergeRunEvents(previous, fresh));
    };

    const closeStream = (): void => {
      streamHealthy = false;
      closeEventStream?.();
      closeEventStream = undefined;
    };

    const drainFinalEvents = async (): Promise<void> => {
      try {
        appendEvents(await getEvents(runId, lastId));
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      }
    };

    const connection = connectRunEventStream(
      typeof EventSource === 'undefined' ? undefined : (url) => new EventSource(url),
      `/api/runs/${encodeURIComponent(runId)}/events/stream?after=${lastId}`,
      (parsed) => {
        if (parsed.id > lastId) appendEvents([parsed]);
      },
      () => {
        closeStream();
        void drainFinalEvents();
      },
      () => {
        streamHealthy = false;
        wake?.();
      },
    );
    closeEventStream = connection.close;
    streamHealthy = connection.healthy();

    const loop = async (): Promise<void> => {
      while (!cancelled) {
        try {
          if (!streamHealthy) appendEvents(await getEvents(runId, lastId));
          setRequests(await getRequests(runId));
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
            closeStream();
            // The final event is written just after the status flips, so read once more.
            await wait(DRAIN_DELAY_MS);
            if (cancelled) {
              return;
            }
            appendEvents(await getEvents(runId, lastId));
            setRequests(await getRequests(runId));
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
      closeStream();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (wake) {
        wake();
      }
    };
  }, [runId, attempt]);

  return { run, events, requests, error, retry };
}
