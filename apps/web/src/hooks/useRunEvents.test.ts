import { describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@vantage/shared';
import { connectRunEventStream, mergeRunEvents } from './useRunEvents';

class FakeEventSource {
  listeners = new Map<string, (event: Event) => void>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  addEventListener(type: string, listener: (event: Event) => void): void { this.listeners.set(type, listener); }
  close(): void { this.closed = true; }
  emit(type: string, event: Event = new Event(type)): void { this.listeners.get(type)?.(event); }
  fail(): void { this.onerror?.(new Event('error')); }
}

const sampleEvent: RunEvent = {
  id: 1, runId: 'run', agent: 'critic', kind: 'info', message: 'Reviewed 1 signal(s)',
  counts: { reviewed: 1 }, createdAt: '2026-10-01T00:00:00Z',
};

function sourceHarness() {
  let source: FakeEventSource | undefined;
  const onEvent = vi.fn();
  const onDone = vi.fn();
  const onFallback = vi.fn();
  const connection = connectRunEventStream(() => {
    source = new FakeEventSource();
    return source;
  }, '/events?after=0', onEvent, onDone, onFallback);
  return { source: () => source, onEvent, onDone, onFallback, connection };
}

describe('run event stream client', () => {
  it('merges frames by id, resets consecutive errors after a frame, and drains on done', () => {
    const harness = sourceHarness();
    const frame = new MessageEvent('run_event', { data: JSON.stringify(sampleEvent) });
    harness.source()?.emit('run_event', frame);
    harness.source()?.emit('run_event', frame);
    expect(mergeRunEvents([], [sampleEvent, sampleEvent])).toEqual([sampleEvent]);
    harness.source()?.emit('done');
    expect(harness.onDone).toHaveBeenCalledOnce();
    expect(harness.source()?.closed).toBe(true);
    expect(harness.connection.healthy()).toBe(false);
  });

  it('falls back on fatal, three consecutive errors, or an undefined EventSource', () => {
    const fatal = sourceHarness();
    fatal.source()?.emit('fatal');
    expect(fatal.onFallback).toHaveBeenCalledOnce();
    expect(fatal.source()?.closed).toBe(true);

    const errors = sourceHarness();
    errors.source()?.fail();
    errors.source()?.fail();
    expect(errors.onFallback).not.toHaveBeenCalled();
    errors.source()?.fail();
    expect(errors.onFallback).toHaveBeenCalledOnce();

    const unavailableFallback = vi.fn();
    const unavailable = connectRunEventStream(undefined, '/events', vi.fn(), vi.fn(), unavailableFallback);
    expect(unavailableFallback).toHaveBeenCalledOnce();
    expect(unavailable.healthy()).toBe(false);
  });
});
