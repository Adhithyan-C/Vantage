import type { FeedbackAction, LeadDetail, LeadView, RunParams, RunView } from '@vantage/shared';
import type { LeadStore } from '../db/leads';
import type { RunStore } from '../db/runs';
import type { DemoRun } from './schema';

interface ReplayOptions {
  fixture: DemoRun;
  now?: () => number;
  maxTotalMs?: number;
}

export function createReplay({ fixture, now = Date.now, maxTotalMs = 30_000 }: ReplayOptions): {
  runStore: RunStore;
  leadStore: LeadStore;
} {
  const totalMs = Math.max(...fixture.events.map((event) => event.offsetMs), 0) + 1500;
  const scale = totalMs > maxTotalMs ? maxTotalMs / totalMs : 1;
  let replayStart: number | null = null;
  const statuses = new Map<string, LeadView['status']>();
  const originalLead = (leadId: string): LeadView | undefined =>
    fixture.leads.find((lead) => lead.leadId === leadId);
  const withStatus = (lead: LeadView): LeadView => ({
    ...lead,
    status: statuses.get(lead.leadId) ?? lead.status,
  });
  const runStore: RunStore = {
    async createSellerProfile() {
      return '00000000-0000-4000-8000-000000000001';
    },
    async createRun(_sellerProfileId: string, _params: RunParams) {
      replayStart = now();
      return fixture.run.id;
    },
    async getRun(runId) {
      if (runId !== fixture.run.id) return null;
      const elapsed = replayStart === null ? totalMs * scale : Math.max(0, now() - replayStart);
      const finished = elapsed >= totalMs * scale;
      const sources = finished ? fixture.run.sources : fixture.run.sources.map((source) => ({
        ...source,
        status: 'running' as const,
        fetchedCount: 0,
      }));
      return {
        ...fixture.run,
        status: finished ? fixture.run.status : 'running',
        startedAt: replayStart === null ? fixture.run.startedAt : new Date(replayStart).toISOString(),
        finishedAt: finished && replayStart !== null
          ? new Date(replayStart + totalMs * scale).toISOString()
          : replayStart === null ? fixture.run.finishedAt : null,
        signalCount: finished ? fixture.run.signalCount : 0,
        sources,
      } satisfies RunView;
    },
    async listEvents(runId, afterId) {
      if (runId !== fixture.run.id) return [];
      const elapsed = replayStart === null ? totalMs * scale : Math.max(0, now() - replayStart);
      return fixture.events
        .filter((event) => event.id > afterId && event.offsetMs * scale <= elapsed)
        .map((event) => ({
          id: event.id,
          runId,
          agent: event.agent,
          kind: event.kind,
          message: event.message,
          counts: event.counts,
          createdAt: replayStart === null
            ? event.createdAt
            : new Date(replayStart + event.offsetMs * scale).toISOString(),
        }));
    },
    async saveSourceRequests() {},
    async listSourceRequests(runId) {
      if (runId !== fixture.run.id) return [];
      const elapsed = replayStart === null ? totalMs * scale : Math.max(0, now() - replayStart);
      const scoutVisible = fixture.events.some(
        (event) => event.agent === 'scout' && event.offsetMs * scale <= elapsed,
      );
      return scoutVisible ? fixture.requests : [];
    },
    async setRunStatus() {},
    async upsertRunSource() {},
    async addEvent() {},
    async storeSignals() {
      return { inserted: 0, updated: 0 };
    },
    async failStaleRuns() {
      return 0;
    },
  };
  const leadStore: LeadStore = {
    async getScoringContext() {
      throw new Error('Not available in demo mode');
    },
    async saveLeads() {
      throw new Error('Not available in demo mode');
    },
    async listLeads(runId, includeAll) {
      if (runId !== fixture.run.id) return [];
      return fixture.leads
        .filter((lead) => includeAll || lead.label === 'buyer_intent' || lead.label === 'competitor_complaint')
        .map(withStatus);
    },
    async getLeadDetail(leadId) {
      const detail: LeadDetail | undefined = fixture.details[leadId];
      if (!detail) return null;
      return { ...detail, lead: withStatus(detail.lead) };
    },
    async setLeadStatus(leadId, status) {
      if (!originalLead(leadId)) return false;
      statuses.set(leadId, status);
      return true;
    },
    async addFeedback(leadId, action: FeedbackAction) {
      const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'new';
      if (originalLead(leadId)) statuses.set(leadId, status);
    },
  };
  return { runStore, leadStore };
}
