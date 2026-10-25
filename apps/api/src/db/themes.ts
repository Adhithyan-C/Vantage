import type { SupabaseClient } from '@supabase/supabase-js';
import { CRITERION_IDS } from '@vantage/shared';
import type { CriterionId, SourceId, ThemeQuote, ThemeView } from '@vantage/shared';
import type { ThemeDraft, ThemeInput } from '../agents/displacement';

export interface ThemeStore {
  getThemeInputs(runId: string): Promise<ThemeInput[]>;
  saveThemes(runId: string, drafts: ThemeDraft[]): Promise<void>;
  listThemes(runId: string): Promise<ThemeView[]>;
}

function dbError(method: string, error: { message: string }): Error {
  return new Error(`Supabase error in ${method}: ${error.message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function parseCriterion(value: unknown): CriterionId | null {
  return typeof value === 'string' && CRITERION_IDS.includes(value as CriterionId)
    ? value as CriterionId
    : null;
}

function parseCompetitors(value: unknown): string[] {
  const enrichment = asRecord(asRecord(value).enrichment);
  return Array.isArray(enrichment.competitorsMentioned)
    ? enrichment.competitorsMentioned.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseEvidence(value: unknown): ThemeInput['evidence'] {
  const output = asRecord(value);
  return Array.isArray(output.criteria) ? output.criteria.flatMap((candidate) => {
    const row = asRecord(candidate);
    const criterion = parseCriterion(row.id);
    return row.passed === true && typeof row.quote === 'string' && criterion
      ? [{ criterion, quote: row.quote }]
      : [];
  }) : [];
}

function parseQuotes(value: unknown): ThemeQuote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const row = asRecord(candidate);
    const criterion = parseCriterion(row.criterion);
    return typeof row.signalId === 'string' && typeof row.quote === 'string' && criterion
      ? [{ signalId: row.signalId, criterion, quote: row.quote }]
      : [];
  });
}

export function createThemeStore(db: SupabaseClient): ThemeStore {
  return {
    async getThemeInputs(runId) {
      const { data: leads, error: leadsError } = await db.from('leads')
        .select('signal_id, score_breakdown')
        .eq('run_id', runId)
        .eq('label', 'competitor_complaint');
      if (leadsError) throw dbError('getThemeInputs', leadsError);
      const leadRows = leads ?? [];
      const ids = leadRows.map((row) => row.signal_id as string);
      if (ids.length === 0) return [];
      const [{ data: signals, error: signalsError }, { data: decisions, error: decisionsError }] = await Promise.all([
        db.from('signals').select('id, source, text_snapshot').in('id', ids),
        db.from('decisions').select('signal_id, output, created_at')
          .eq('run_id', runId).eq('agent', 'classifier').eq('status', 'ok')
          .in('signal_id', ids).order('created_at', { ascending: false }),
      ]);
      if (signalsError) throw dbError('getThemeInputs', signalsError);
      if (decisionsError) throw dbError('getThemeInputs', decisionsError);
      const leadBySignal = new Map(leadRows.map((row) => [row.signal_id as string, row]));
      const decisionBySignal = new Map<string, Record<string, unknown>>();
      for (const decision of decisions ?? []) {
        if (!decisionBySignal.has(decision.signal_id as string)) {
          decisionBySignal.set(decision.signal_id as string, decision);
        }
      }
      return (signals ?? []).flatMap((signal): ThemeInput[] => {
        const id = signal.id as string;
        const lead = leadBySignal.get(id);
        const decision = decisionBySignal.get(id);
        if (!lead || !decision) return [];
        return [{
          signalId: id,
          source: signal.source as SourceId,
          text: signal.text_snapshot as string,
          competitorsMentioned: parseCompetitors(lead.score_breakdown),
          evidence: parseEvidence(decision.output),
        }];
      });
    },

    async saveThemes(runId, drafts) {
      const { error: deleteError } = await db.from('themes').delete().eq('run_id', runId);
      if (deleteError) throw dbError('saveThemes', deleteError);
      if (drafts.length === 0) return;
      const { error } = await db.from('themes').insert(drafts.map((draft) => ({
        run_id: runId,
        competitor: draft.competitor,
        title: draft.title,
        summary: draft.summary,
        signal_ids: draft.signalIds,
        quotes: draft.quotes,
      })));
      if (error) throw dbError('saveThemes', error);
    },

    async listThemes(runId) {
      const { data: themes, error: themesError } = await db.from('themes')
        .select('id, run_id, competitor, title, summary, signal_ids, quotes')
        .eq('run_id', runId);
      if (themesError) throw dbError('listThemes', themesError);
      const themeRows = themes ?? [];
      const signalIds = [...new Set(themeRows.flatMap((row) => Array.isArray(row.signal_ids)
        ? row.signal_ids.filter((id): id is string => typeof id === 'string') : []))];
      const [{ data: leads, error: leadsError }, { data: signals, error: signalsError }] = signalIds.length > 0
        ? await Promise.all([
          db.from('leads').select('id, signal_id').eq('run_id', runId).in('signal_id', signalIds),
          db.from('signals').select('id, source').in('id', signalIds),
        ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (leadsError) throw dbError('listThemes', leadsError);
      if (signalsError) throw dbError('listThemes', signalsError);
      const leadIds = new Map((leads ?? []).map((lead) => [lead.signal_id as string, lead.id as string]));
      const sourceById = new Map((signals ?? []).map((signal) => [signal.id as string, signal.source as string]));
      return themeRows.map((row): ThemeView => {
        const members = (Array.isArray(row.signal_ids) ? row.signal_ids : [])
          .filter((id): id is string => typeof id === 'string')
          .map((signalId) => ({ signalId, leadId: leadIds.get(signalId) ?? null }));
        return {
          id: row.id as string,
          runId: row.run_id as string,
          competitor: row.competitor as string,
          title: row.title as string,
          summary: row.summary as string,
          quotes: parseQuotes(row.quotes),
          members,
          sampleData: members.some((member) => sourceById.get(member.signalId) === 'snapshot'),
        };
      }).sort((left, right) => right.members.length - left.members.length ||
        left.competitor.localeCompare(right.competitor) || left.title.localeCompare(right.title));
    },
  };
}
