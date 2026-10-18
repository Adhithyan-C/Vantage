import type { RunCreateRequest, RunEvent, RunView } from '@vantage/shared';

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly issues: string[];

  constructor(message: string, status: number, issues: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the Vantage API. Is it running on port 3001?', 0);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const record = (typeof body === 'object' && body !== null ? body : {}) as {
      error?: unknown;
      issues?: unknown;
    };
    const message =
      typeof record.error === 'string'
        ? record.error
        : `Request failed with status ${response.status}`;
    const issues = Array.isArray(record.issues)
      ? record.issues.filter((item): item is string => typeof item === 'string')
      : [];
    throw new ApiError(message, response.status, issues);
  }

  return body as T;
}

export function getDemoSeller(): Promise<RunCreateRequest> {
  return request<RunCreateRequest>('/demo-seller');
}

export function createRun(input: RunCreateRequest): Promise<{ runId: string }> {
  return request<{ runId: string }>('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getRun(runId: string): Promise<RunView> {
  return request<RunView>(`/runs/${encodeURIComponent(runId)}`);
}

export async function getEvents(runId: string, after: number): Promise<RunEvent[]> {
  const body = await request<{ events: RunEvent[] }>(
    `/runs/${encodeURIComponent(runId)}/events?after=${after}`,
  );
  return body.events;
}
