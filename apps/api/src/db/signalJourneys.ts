import type { SupabaseClient } from '@supabase/supabase-js';
import type { DecisionTrace, LeadLabel, SignalJourney, SignalRunSummary, SignalJourneyStage, SignalStageStatus, SourceId } from '@vantage/shared';

export interface SignalJourneyStore {
  listRunSignals(runId: string, limit: number, offset: number): Promise<{ signals: SignalRunSummary[]; total: number }>;
  getSignalJourney(runId: string, signalId: string): Promise<SignalJourney | null>;
}

type Row = Record<string, unknown>;
const stages: SignalJourneyStage[] = ['scout', 'classifier', 'critic', 'enricher', 'scorer', 'displacement', 'outcome'];

function record(value: unknown): Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {};
}

function dbError(method: string, error: { message: string }): Error {
  return new Error(`Supabase error in ${method}: ${error.message}`);
}

function decisionTrace(row: Row | undefined): DecisionTrace | null {
  if (!row) return null;
  return {
    model: typeof row.model === 'string' ? row.model : null,
    promptVersion: typeof row.prompt_version === 'string' ? row.prompt_version : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    status: typeof row.status === 'string' ? row.status : 'error',
    output: record(row.output),
  };
}

function stageStatus(status: SignalStageStatus, reason?: string): { status: SignalStageStatus; reason?: string } {
  return reason ? { status, reason } : { status };
}

function labelOf(value: unknown): LeadLabel | null {
  return value === 'buyer_intent' || value === 'competitor_complaint' || value === 'venting' || value === 'noise' ? value : null;
}

export function createSignalJourneyStore(db: SupabaseClient): SignalJourneyStore {
  async function readSignal(runId: string, signalId: string): Promise<SignalJourney | null> {
    const { data: links, error: linkError } = await db.from('run_signals').select('signal_id').eq('run_id', runId).eq('signal_id', signalId).limit(1);
    if (linkError) throw dbError('getSignalJourney', linkError);
    if (!links?.length) return null;
    const [{ data: signal, error: signalError }, { data: decisions, error: decisionError }, { data: leads, error: leadError }, { data: events, error: eventError }, { data: themes, error: themeError }] = await Promise.all([
      db.from('signals').select('id, source, url, author_handle, created_at_source, text_snapshot, community, engagement, metadata, content_completeness').eq('id', signalId).maybeSingle(),
      db.from('decisions').select('agent, model, prompt_version, created_at, status, output, evidence_verified').eq('run_id', runId).eq('signal_id', signalId).order('created_at', { ascending: false }),
      db.from('leads').select('id, label, score, rank, score_breakdown').eq('run_id', runId).eq('signal_id', signalId).maybeSingle(),
      db.from('run_events').select('agent, kind, message, counts').eq('run_id', runId).order('id', { ascending: true }).limit(500),
      db.from('themes').select('id, competitor, title, signal_ids').eq('run_id', runId).contains('signal_ids', [signalId]),
    ]);
    if (signalError) throw dbError('getSignalJourney', signalError);
    if (decisionError) throw dbError('getSignalJourney', decisionError);
    if (leadError) throw dbError('getSignalJourney', leadError);
    if (eventError) throw dbError('getSignalJourney', eventError);
    if (themeError) throw dbError('getSignalJourney', themeError);
    if (!signal) return null;

    const decisionRows = (decisions ?? []) as Row[];
    const latest = (agent: string): Row | undefined => decisionRows.find((row) => row.agent === agent);
    const classifier = decisionTrace(latest('classifier'));
    const relevance = decisionTrace(latest('scout'));
    const critic = decisionTrace(latest('critic'));
    const lead = leads ? record(leads) : null;
    const label = labelOf(lead?.label ?? classifier?.output.label);
    const breakdown = record(lead?.score_breakdown);
    const enrichment = record(breakdown.enrichment);
    const eventsRows = (events ?? []) as Row[];
    const classifierDisabled = eventsRows.some((row) => row.agent === 'classifier' && typeof row.message === 'string' && row.message.includes('disabled'));
    const criticDisabled = eventsRows.some((row) => row.agent === 'critic' && typeof row.message === 'string' && row.message.includes('disabled'));
    const classifierCapped = eventsRows.some((row) => row.agent === 'classifier' && typeof row.message === 'string' && row.message.toLowerCase().includes('cap'));
    const criticCapped = eventsRows.some((row) => row.agent === 'critic' && typeof row.message === 'string' && row.message.toLowerCase().includes('cap'));
    const relevanceExcluded = relevance?.output.eligible === false;
    const relevanceExclusionReason = typeof relevance?.output.exclusionReason === 'string'
      ? relevance.output.exclusionReason
      : 'Excluded before classification';
    const decisionStage = (trace: DecisionTrace | null, disabled: boolean, capped: boolean) => trace
      ? stageStatus(trace.status === 'ok' ? 'completed' : 'failed', trace.status === 'ok' ? undefined : trace.status)
      : disabled ? stageStatus('not_run', 'Disabled by configuration')
        : capped ? stageStatus('not_run', 'This signal was not included by the recorded stage cap')
          : relevanceExcluded ? stageStatus('not_run', relevanceExclusionReason)
          : stageStatus('not_available');
    const enrichmentStatus = lead ? stageStatus('completed') : stageStatus('not_available');
    const ranked = label === 'buyer_intent' || label === 'competitor_complaint';
    const scoreStatus = lead ? stageStatus('completed') : stageStatus('not_available');
    const themeRow = ((themes ?? []) as Row[])[0];
    const themeSignalIds = Array.isArray(themeRow?.signal_ids) ? themeRow.signal_ids.filter((value): value is string => typeof value === 'string') : [];
    const displacementEvent = [...eventsRows].reverse().find((row) => row.agent === 'displacement' && typeof row.message === 'string');
    let displacementStatus: { status: SignalStageStatus; reason?: string };
    if (label !== null && label !== 'competitor_complaint') {
      displacementStatus = stageStatus('not_run', 'Only competitor complaints are clustered');
    } else if (displacementEvent?.kind === 'error') {
      displacementStatus = stageStatus('failed', typeof displacementEvent.message === 'string' ? displacementEvent.message : 'Displacement failed');
    } else if (displacementEvent && typeof displacementEvent.message === 'string' && displacementEvent.message.startsWith('Displacement skipped:')) {
      const eventCounts = record(displacementEvent.counts);
      displacementStatus = stageStatus('not_run', typeof eventCounts.reason === 'string' ? eventCounts.reason : displacementEvent.message);
    } else if (label === null) {
      displacementStatus = stageStatus('not_available');
    } else if (themeRow) {
      displacementStatus = stageStatus('completed');
    } else if (displacementEvent && displacementEvent.kind !== 'progress') {
      displacementStatus = stageStatus('completed', 'Not placed in a theme: it either did not cluster with similar complaints or its competitor had fewer than 3 complaint signals');
    } else {
      displacementStatus = stageStatus('not_available');
    }
    const outcomeStatus = label ? stageStatus('completed') : stageStatus('not_available');
    const statuses: Record<SignalJourneyStage, { status: SignalStageStatus; reason?: string }> = {
      scout: stageStatus('completed'),
      classifier: decisionStage(classifier, classifierDisabled, classifierCapped),
      critic: decisionStage(critic, criticDisabled, criticCapped),
      enricher: enrichmentStatus,
      scorer: scoreStatus,
      displacement: displacementStatus,
      outcome: outcomeStatus,
    };
    const summary: SignalRunSummary = {
      signalId,
      leadId: typeof lead?.id === 'string' ? lead.id : null,
      source: signal.source as SourceId,
      authorHandle: typeof signal.author_handle === 'string' ? signal.author_handle : 'Unknown author',
      url: typeof signal.url === 'string' ? signal.url : '',
      textPreview: String(signal.text_snapshot ?? '').slice(0, 280),
      createdAtSource: typeof signal.created_at_source === 'string' ? signal.created_at_source : '',
      label,
      score: typeof lead?.score === 'number' ? lead.score : null,
      stages: statuses,
      ...(Object.keys(record(signal.metadata)).length > 0 ? { metadata: record(signal.metadata) } : {}),
      ...(signal.content_completeness === 'complete' || signal.content_completeness === 'snippet' || signal.content_completeness === 'title_only'
        ? { contentCompleteness: signal.content_completeness } : {}),
    };
    const sourceMetadata = record(signal.metadata);
    const contentCompleteness = signal.content_completeness === 'complete' || signal.content_completeness === 'snippet' || signal.content_completeness === 'title_only'
      ? signal.content_completeness : null;
    const metadata = {
      source: signal.source,
      url: signal.url,
      authorHandle: signal.author_handle,
      community: signal.community,
      createdAtSource: signal.created_at_source,
      engagement: signal.engagement,
      ...(Object.keys(sourceMetadata).length > 0 ? { sourceMetadata } : {}),
      ...(contentCompleteness ? { contentCompleteness } : {}),
    };
    const outputs: Record<SignalJourneyStage, Record<string, unknown> | null> = {
      scout: relevance ? { ...metadata, relevance: relevance.output } : metadata,
      classifier: classifier ? { ...classifier.output, model: classifier.model, promptVersion: classifier.promptVersion, status: classifier.status, evidenceVerified: latest('classifier')?.evidence_verified === true } : null,
      critic: critic ? { ...critic.output, model: critic.model, promptVersion: critic.promptVersion, status: critic.status } : null,
      enricher: lead ? enrichment : null,
      scorer: lead ? { score: lead.score, breakdown: { components: breakdown.components, total: breakdown.total }, rank: ranked ? lead.rank : null } : null,
      displacement: themeRow ? { themeId: themeRow.id, title: themeRow.title, competitor: themeRow.competitor, otherMemberCount: Math.max(0, themeSignalIds.length - 1), href: `#/runs/${encodeURIComponent(runId)}/themes` } : null,
      outcome: { label, included: Boolean(ranked && lead), rank: ranked && lead ? lead.rank : null, score: ranked && lead ? lead.score : null, reason: ranked ? (lead ? 'Included in ranked results' : 'Ranked label recorded; score row unavailable') : label ? `Excluded: ${label.replaceAll('_', ' ')} label` : 'No classifier result recorded', theme: themeRow ? String(themeRow.title) : null },
    };
    return { ...summary, text: String(signal.text_snapshot ?? ''), timeline: stages.map((stage) => ({ stage, status: statuses[stage].status, reason: statuses[stage].reason ?? null, output: outputs[stage] })) };
  }

  return {
    async listRunSignals(runId, limit, offset) {
      const { data: links, error, count } = await db.from('run_signals').select('signal_id', { count: 'exact' }).eq('run_id', runId);
      if (error) throw dbError('listRunSignals', error);
      const linkedIds = ((links ?? []) as Row[]).map((row) => row.signal_id).filter((value): value is string => typeof value === 'string');
      if (linkedIds.length === 0) return { signals: [], total: count ?? 0 };
      const { data: storedSignals, error: storedSignalsError } = await db.from('signals').select('id, fetched_at').in('id', linkedIds)
        .order('fetched_at', { ascending: true }).order('id', { ascending: true });
      if (storedSignalsError) throw dbError('listRunSignals', storedSignalsError);
      // run_signals has no run-specific insertion timestamp; fetched_at is the closest stored collection-order evidence.
      const signalIds = ((storedSignals ?? []) as Row[]).map((row) => row.id).filter((value): value is string => typeof value === 'string').slice(offset, offset + limit);
      const items = await Promise.all(signalIds.map((signalId) => readSignal(runId, signalId)));
      return { signals: items.filter((item): item is SignalJourney => item !== null).map(({ text: _text, timeline: _timeline, ...item }) => item), total: count ?? 0 };
    },
    getSignalJourney: readSignal,
  };
}
