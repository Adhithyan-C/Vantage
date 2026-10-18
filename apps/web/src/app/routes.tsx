import { useEffect, useState } from 'react';

export type Route =
  | { name: 'setup' }
  | { name: 'run'; runId: string }
  | { name: 'signals'; runId: string }
  | { name: 'signal'; runId: string; leadId: string }
  | { name: 'not-found' };

const RUN_PATH = /^\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SIGNALS_PATH = /^\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/signals$/i;
const SIGNAL_PATH = /^\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/signals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') {
    return { name: 'setup' };
  }
  const signalMatch = SIGNAL_PATH.exec(path);
  if (signalMatch?.[1] && signalMatch[2]) {
    return { name: 'signal', runId: signalMatch[1], leadId: signalMatch[2] };
  }
  const signalsMatch = SIGNALS_PATH.exec(path);
  if (signalsMatch?.[1]) {
    return { name: 'signals', runId: signalsMatch[1] };
  }
  const match = RUN_PATH.exec(path);
  if (match && match[1]) {
    return { name: 'run', runId: match[1] };
  }
  return { name: 'not-found' };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  return route;
}
