import type { FeedbackAction, LeadDetail, LeadView, RunParams, RunView, SignalJourney, SignalRunSummary, SignalStageStatus } from '@vantage/shared';
import type { ThemeView } from '@vantage/shared';
import type { LeadStore } from '../db/leads';
import type { RunStore } from '../db/runs';
import type { DemoRun } from './schema';
import type { ThemeStore } from '../db/themes';
import type { SignalJourneyStore } from '../db/signalJourneys';

interface ReplayOptions {
  fixture: DemoRun;
  now?: () => number;
  maxTotalMs?: number;
}

export function createReplay({ fixture, now = Date.now, maxTotalMs = 30_000 }: ReplayOptions): {
  runStore: RunStore;
  leadStore: LeadStore;
  themeStore: ThemeStore;
  signalJourneyStore: SignalJourneyStore;
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
    criticTrace: lead.criticTrace ?? fixture.details[lead.leadId]?.criticTrace ?? null,
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
  const themeStore: ThemeStore = {
    async getThemeInputs() { throw new Error('Not available in demo mode'); },
    async saveThemes() { throw new Error('Not available in demo mode'); },
    async listThemes(runId) {
      if (runId !== fixture.run.id) return [];
      const elapsed = replayStart === null ? totalMs * scale : Math.max(0, now() - replayStart);
      const displacementVisible = fixture.events.some((event) =>
        event.agent === 'displacement' && event.offsetMs * scale <= elapsed,
      );
      const finished = elapsed >= totalMs * scale;
      return displacementVisible || finished ? fixture.themes : [];
    },
  };
  const fallbackSummary = (lead: LeadView): SignalRunSummary => {
    const detail = fixture.details[lead.leadId];
    const missing = { status: 'not_available' as const };
    const theme = fixture.themes.find((item) => item.members.some((member) => member.signalId === lead.signalId));
    const displacementEvents = fixture.events.filter((event) => event.agent === 'displacement');
    const finalDisplacement = [...displacementEvents].reverse().find((event) => event.kind === 'info' || event.kind === 'warning' || event.kind === 'error');
    const skipReason = typeof finalDisplacement?.counts?.reason === 'string' ? finalDisplacement.counts.reason : finalDisplacement?.message;
    const displacement = lead.label !== 'competitor_complaint'
      ? { status: 'not_run' as const, reason: 'Only competitor complaints are clustered' }
      : theme ? { status: 'completed' as const }
        : finalDisplacement?.kind === 'error' ? { status: 'failed' as const, reason: finalDisplacement.message }
          : finalDisplacement?.message.startsWith('Displacement skipped:') ? { status: 'not_run' as const, reason: skipReason ?? 'Displacement skipped' }
            : finalDisplacement ? { status: 'completed' as const, reason: 'Not placed in a theme: it either did not cluster with similar complaints or its competitor had fewer than 3 complaint signals' }
              : missing;
    return {
      signalId: lead.signalId, leadId: lead.leadId, source: lead.source, authorHandle: lead.authorHandle, url: lead.url,
      textPreview: lead.textPreview, createdAtSource: lead.createdAtSource, label: lead.label, score: lead.score,
      stages: { scout: { status: 'completed' as const }, classifier: { status: detail?.trace.status === 'ok' ? 'completed' as const : 'failed' as const },
        critic: detail?.criticTrace ? { status: detail.criticTrace.status === 'ok' ? 'completed' as const : 'failed' as const } : missing,
        enricher: { status: 'completed' as const }, scorer: { status: 'completed' as const }, displacement, outcome: { status: 'completed' as const } },
    };
  };
  const signalJourneyStore: SignalJourneyStore = {
    async listRunSignals(runId, limit, offset) {
      if (runId !== fixture.run.id) return { signals: [], total: 0 };
      const elapsed = replayStart === null ? totalMs * scale : Math.max(0, now() - replayStart);
      const scoutVisible = fixture.events.some((event) => event.agent === 'scout' && event.offsetMs * scale <= elapsed);
      if (!scoutVisible && elapsed < totalMs * scale) return { signals: [], total: 0 };
      const signals = fixture.collectedSignals ?? fixture.leads.map(fallbackSummary);
      return { signals: signals.slice(offset, offset + limit), total: signals.length };
    },
    async getSignalJourney(runId, signalId): Promise<SignalJourney | null> {
      if (runId !== fixture.run.id) return null;
      const recorded = fixture.journeys?.[signalId];
      if (recorded) return recorded;
      const summary = (fixture.collectedSignals ?? fixture.leads.map(fallbackSummary)).find((item) => item.signalId === signalId);
      if (!summary) return null;
      const leadView = fixture.leads.find((lead) => lead.signalId === signalId);
      const full = leadView ? fixture.details[leadView.leadId] : undefined;
      const theme = fixture.themes.find((item) => item.members.some((member) => member.signalId === signalId));
      const outputs: Record<string, Record<string, unknown> | null> = {
        scout: { source: summary.source, url: summary.url, authorHandle: summary.authorHandle },
        classifier: full ? { ...full.trace.output, model: full.trace.model, promptVersion: full.trace.promptVersion, status: full.trace.status } : null,
        critic: full?.criticTrace ? { ...full.criticTrace.output, model: full.criticTrace.model, promptVersion: full.criticTrace.promptVersion, status: full.criticTrace.status } : null,
        enricher: leadView ? leadView.enrichment as unknown as Record<string, unknown> : null,
        scorer: leadView ? { score: leadView.score, rank: leadView.rank, breakdown: leadView.breakdown } : null,
        displacement: theme ? { themeId: theme.id, title: theme.title, competitor: theme.competitor, otherMemberCount: Math.max(0, theme.members.length - 1), href: `#/runs/${encodeURIComponent(runId)}/themes` } : null,
        outcome: { label: summary.label, included: summary.leadId !== null && (summary.label === 'buyer_intent' || summary.label === 'competitor_complaint'), rank: summary.leadId !== null && (summary.label === 'buyer_intent' || summary.label === 'competitor_complaint') ? leadView?.rank ?? null : null, score: leadView?.score ?? null, reason: summary.label === 'buyer_intent' || summary.label === 'competitor_complaint' ? 'Included in ranked results' : summary.label ? `Excluded: ${summary.label.replaceAll('_', ' ')} label` : 'No classifier result recorded', theme: theme ? theme.title : null },
      };
      return { ...summary, text: full?.text ?? summary.textPreview, timeline: (['scout', 'classifier', 'critic', 'enricher', 'scorer', 'displacement', 'outcome'] as const).map((stage) => ({ stage, status: summary.stages[stage].status, reason: summary.stages[stage].reason ?? null, output: outputs[stage] ?? null })) };
    },
  };
  return { runStore, leadStore, themeStore, signalJourneyStore };
}
