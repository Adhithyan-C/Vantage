import type { CompetitorGraphView, FeedbackAction, LeadDetail, LeadView, ReportView, RunCreateRequest, RunEvent, RunView, SourceRequestView, ThemeView } from '@vantage/shared';

const BASE = '/api';

export function getHealth(): Promise<{ status: string; demo: boolean }> {
  return request<{ status: string; demo: boolean }>('/health');
}

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

export function getReport(runId: string): Promise<ReportView> {
  return request<ReportView>(`/runs/${encodeURIComponent(runId)}/report.json`);
}

export async function getThemes(runId: string): Promise<ThemeView[]> {
  const body = await request<{ themes: ThemeView[] }>(`/runs/${encodeURIComponent(runId)}/themes`);
  return body.themes;
}

export async function getCompetitorGraph(runId: string): Promise<CompetitorGraphView> {
  const body = await request<{ graph: CompetitorGraphView }>(`/runs/${encodeURIComponent(runId)}/competitor-graph`);
  return body.graph;
}

export async function getEvents(runId: string, after: number): Promise<RunEvent[]> {
  const body = await request<{ events: RunEvent[] }>(
    `/runs/${encodeURIComponent(runId)}/events?after=${after}`,
  );
  return body.events;
}

export async function getRequests(runId: string): Promise<SourceRequestView[]> {
  const body = await request<{ requests: SourceRequestView[] }>(`/runs/${encodeURIComponent(runId)}/requests`);
  return body.requests;
}

export async function getLeads(runId: string): Promise<LeadView[]> {
  const body = await request<{ leads: LeadView[] }>(
    `/runs/${encodeURIComponent(runId)}/leads?include=all`,
  );
  return body.leads;
}

export async function getLeadDetail(leadId: string): Promise<LeadDetail> {
  const body = await request<{ detail: LeadDetail }>(`/leads/${encodeURIComponent(leadId)}`);
  return body.detail;
}

export function sendFeedback(leadId: string, action: FeedbackAction): Promise<{ status: LeadView['status'] }> {
  return request<{ status: LeadView['status'] }>(`/leads/${encodeURIComponent(leadId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}
