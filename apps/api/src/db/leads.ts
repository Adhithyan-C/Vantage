import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ClassifierOutputSchema,
  ScoreBreakdownSchema,
  SOURCE_IDS,
} from '@vantage/shared';
import type {
  ClassifierOutput,
  CriterionId,
  Enrichment,
  LeadLabel,
  LeadDetail,
  LeadView,
  FeedbackAction,
  RawSignal,
  ScoreBreakdown,
  SellerProfileInput,
  SourceId,
} from '@vantage/shared';
import { findEvidenceSpans } from '../verification/verifyQuote';

export interface ScoringContextItem {
  signal: string;
  text: string;
  source: SourceId;
  community: string | null;
  url: string;
  authorHandle: string;
  createdAtSource: string;
  engagement: RawSignal['engagement'];
  decision: {
    output: ClassifierOutput & { notes?: { unverified?: CriterionId[] } };
    evidenceVerified: boolean;
  };
}

export interface ScoringContext {
  seller: Pick<SellerProfileInput, 'productName' | 'problemDescription' | 'competitors'>;
  items: ScoringContextItem[];
}

export interface LeadUpsertRow {
  signalId: string;
  label: LeadLabel;
  score: number;
  rank: number;
  scoreBreakdown: ScoreBreakdown & { confidence: number | null; enrichment: Enrichment };
}

export interface LeadStore {
  getScoringContext(runId: string): Promise<ScoringContext>;
  saveLeads(runId: string, rows: LeadUpsertRow[]): Promise<void>;
  listLeads(runId: string, includeAll: boolean): Promise<LeadView[]>;
  getLeadDetail(leadId: string): Promise<LeadDetail | null>;
  setLeadStatus(leadId: string, status: 'new' | 'accepted' | 'rejected'): Promise<boolean>;
  addFeedback(leadId: string, action: FeedbackAction): Promise<void>;
}

function dbError(method: string, error: { message: string }): Error {
  return new Error(`Supabase error in ${method}: ${error.message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function isCriterionId(value: unknown): value is CriterionId {
  return value === 'states_problem' || value === 'asks_for_recommendation' ||
    value === 'mentions_team_or_budget' || value === 'shows_urgency' || value === 'names_competitor';
}

function parseEnrichment(value: unknown): Enrichment | null {
  const row = asRecord(value);
  const fit = asRecord(row.fit);
  if (
    typeof row.ageDays !== 'number' ||
    typeof row.commentCount !== 'number' ||
    typeof row.upvotes !== 'number' ||
    typeof row.source !== 'string' ||
    !SOURCE_IDS.includes(row.source as SourceId) ||
    (row.community !== null && typeof row.community !== 'string') ||
    !Array.isArray(row.competitorsMentioned) ||
    !row.competitorsMentioned.every((item) => typeof item === 'string') ||
    !Array.isArray(row.purchaseTermsFound) ||
    !row.purchaseTermsFound.every((item) => typeof item === 'string') ||
    !Array.isArray(row.teamTermsFound) ||
    !row.teamTermsFound.every((item) => typeof item === 'string') ||
    typeof fit.competitorMentioned !== 'boolean' ||
    typeof fit.purchaseLanguage !== 'boolean' ||
    typeof fit.teamOrRoleContext !== 'boolean'
  ) {
    return null;
  }
  return {
    ageDays: row.ageDays,
    commentCount: row.commentCount,
    upvotes: row.upvotes,
    source: row.source as SourceId,
    community: row.community,
    competitorsMentioned: row.competitorsMentioned,
    purchaseTermsFound: row.purchaseTermsFound,
    teamTermsFound: row.teamTermsFound,
    fit: {
      competitorMentioned: fit.competitorMentioned,
      purchaseLanguage: fit.purchaseLanguage,
      teamOrRoleContext: fit.teamOrRoleContext,
    },
  };
}

function parseClassifierOutput(value: unknown): ClassifierOutput | null {
  const parsed = ClassifierOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createLeadStore(db: SupabaseClient): LeadStore {
  return {
    async getScoringContext(runId) {
      const { data: run, error: runError } = await db
        .from('runs')
        .select('seller_profile_id')
        .eq('id', runId)
        .maybeSingle();
      if (runError) {
        throw dbError('getScoringContext', runError);
      }
      if (!run) {
        throw new Error('Supabase error in getScoringContext: run not found');
      }

      const { data: seller, error: sellerError } = await db
        .from('seller_profiles')
        .select('product_name, problem_description, competitors')
        .eq('id', run.seller_profile_id)
        .single();
      if (sellerError) {
        throw dbError('getScoringContext', sellerError);
      }
      if (!seller) {
        throw new Error('Supabase error in getScoringContext: seller profile not found');
      }

      const { data: links, error: linksError } = await db
        .from('run_signals')
        .select('signal_id')
        .eq('run_id', runId);
      if (linksError) {
        throw dbError('getScoringContext', linksError);
      }
      const signalIds = (links ?? []).map((link) => link.signal_id as string);
      if (signalIds.length === 0) {
        return {
          seller: {
            productName: seller.product_name as string,
            problemDescription: seller.problem_description as string,
            competitors: (seller.competitors as string[] | null) ?? [],
          },
          items: [],
        };
      }

      const [{ data: signals, error: signalsError }, { data: decisions, error: decisionsError }] =
        await Promise.all([
          db
            .from('signals')
            .select('id, text_snapshot, source, community, url, author_handle, created_at_source, engagement')
            .in('id', signalIds)
            .order('created_at_source', { ascending: false }),
          db
            .from('decisions')
            .select('signal_id, output, evidence_verified')
            .eq('run_id', runId)
            .eq('agent', 'classifier')
            .eq('status', 'ok')
            .in('signal_id', signalIds)
            .order('created_at', { ascending: false }),
        ]);
      if (signalsError) {
        throw dbError('getScoringContext', signalsError);
      }
      if (decisionsError) {
        throw dbError('getScoringContext', decisionsError);
      }
      const decisionBySignal = new Map<string, Record<string, unknown>>();
      for (const decision of decisions ?? []) {
        const signalId = decision.signal_id as string;
        if (!decisionBySignal.has(signalId)) {
          decisionBySignal.set(signalId, decision);
        }
      }
      const items: ScoringContextItem[] = [];
      for (const signal of signals ?? []) {
        const decision = decisionBySignal.get(signal.id as string);
        if (!decision) {
          continue;
        }
        const decisionRow = asRecord(decision.output);
        const output = parseClassifierOutput(decisionRow);
        if (!output) {
          throw new Error('Could not parse classifier decision for scoring');
        }
        const notes = asRecord(decisionRow.notes);
        const unverified = Array.isArray(notes.unverified)
          ? notes.unverified.filter((item): item is CriterionId =>
            ['states_problem', 'asks_for_recommendation', 'mentions_team_or_budget', 'shows_urgency', 'names_competitor']
              .includes(item as string),
          )
          : undefined;
        items.push({
          signal: signal.id as string,
          text: signal.text_snapshot as string,
          source: signal.source as SourceId,
          community: (signal.community as string | null) ?? null,
          url: signal.url as string,
          authorHandle: signal.author_handle as string,
          createdAtSource: signal.created_at_source as string,
          engagement: asRecord(signal.engagement) as RawSignal['engagement'],
          decision: {
            output: { ...output, notes: { unverified } },
            evidenceVerified: decision.evidence_verified === true,
          },
        });
      }
      return {
        seller: {
          productName: seller.product_name as string,
          problemDescription: seller.problem_description as string,
          competitors: (seller.competitors as string[] | null) ?? [],
        },
        items,
      };
    },

    async saveLeads(runId, rows) {
      if (rows.length === 0) {
        return;
      }
      const payload = rows.map((row) => ({
        run_id: runId,
        signal_id: row.signalId,
        label: row.label,
        score: row.score,
        score_breakdown: row.scoreBreakdown,
        rank: row.rank,
      }));
      const { error } = await db.from('leads').upsert(payload, { onConflict: 'run_id,signal_id' });
      if (error) {
        throw dbError('saveLeads', error);
      }
    },

    async listLeads(runId, includeAll) {
      let query = db
        .from('leads')
        .select('id, signal_id, label, score, score_breakdown, rank, status')
        .eq('run_id', runId);
      if (!includeAll) {
        query = query.in('label', ['buyer_intent', 'competitor_complaint']);
      }
      const { data: leads, error: leadsError } = await query.order('rank', { ascending: true }).limit(100);
      if (leadsError) {
        throw dbError('listLeads', leadsError);
      }
      const signalIds = (leads ?? []).map((lead) => lead.signal_id as string);
      if (signalIds.length === 0) {
        return [];
      }
      const [{ data: signals, error: signalsError }, { data: decisions, error: decisionsError }] =
        await Promise.all([
          db
            .from('signals')
            .select('id, source, url, author_handle, community, created_at_source, text_snapshot')
            .in('id', signalIds),
          db
            .from('decisions')
            .select('signal_id, output, evidence_verified')
            .eq('run_id', runId)
            .eq('agent', 'classifier')
            .eq('status', 'ok')
            .in('signal_id', signalIds)
            .order('created_at', { ascending: false }),
        ]);
      if (signalsError) {
        throw dbError('listLeads', signalsError);
      }
      if (decisionsError) {
        throw dbError('listLeads', decisionsError);
      }
      const signalById = new Map((signals ?? []).map((signal) => [signal.id as string, signal]));
      const decisionBySignal = new Map<string, Record<string, unknown>>();
      for (const decision of decisions ?? []) {
        const signalId = decision.signal_id as string;
        if (!decisionBySignal.has(signalId)) {
          decisionBySignal.set(signalId, decision);
        }
      }
      return (leads ?? []).flatMap((lead): LeadView[] => {
        const signalId = lead.signal_id as string;
        const signal = signalById.get(signalId);
        const decision = decisionBySignal.get(signalId);
        const storedBreakdown = asRecord(lead.score_breakdown);
        const parsedBreakdown = ScoreBreakdownSchema.safeParse({
          components: storedBreakdown.components,
          total: storedBreakdown.total,
        });
        const enrichment = parseEnrichment(storedBreakdown.enrichment);
        const output = parseClassifierOutput(decision?.output);
        if (!signal || !decision || !parsedBreakdown.success || !enrichment || !output) {
          return [];
        }
        const label = lead.label;
        if (label !== 'buyer_intent' && label !== 'competitor_complaint' && label !== 'venting' && label !== 'noise') {
          return [];
        }
        const status = lead.status;
        if (status !== 'new' && status !== 'accepted' && status !== 'rejected') {
          return [];
        }
        return [{
          leadId: lead.id as string,
          signalId,
          rank: lead.rank as number,
          label,
          score: lead.score as number,
          confidence: typeof storedBreakdown.confidence === 'number' ? storedBreakdown.confidence : null,
          status,
          source: signal.source as SourceId,
          url: signal.url as string,
          authorHandle: signal.author_handle as string,
          community: (signal.community as string | null) ?? null,
          createdAtSource: signal.created_at_source as string,
          textPreview: String(signal.text_snapshot ?? '').slice(0, 280),
          rationale: output.rationale,
          criteria: output.criteria,
          evidenceVerified: decision.evidence_verified === true,
          breakdown: parsedBreakdown.data as ScoreBreakdown,
          enrichment,
        }];
      });
    },

    async getLeadDetail(leadId) {
      const { data: lead, error: leadError } = await db
        .from('leads')
        .select('id, run_id, signal_id, label, score, score_breakdown, rank, status')
        .eq('id', leadId)
        .maybeSingle();
      if (leadError) {
        throw dbError('getLeadDetail', leadError);
      }
      if (!lead) {
        return null;
      }
      const { data: signal, error: signalError } = await db
        .from('signals')
        .select('id, source, url, author_handle, community, created_at_source, text_snapshot')
        .eq('id', lead.signal_id)
        .maybeSingle();
      if (signalError) {
        throw dbError('getLeadDetail', signalError);
      }
      const [{ data: decision, error: decisionError }, { data: criticDecision, error: criticError }] =
        await Promise.all([
          db
            .from('decisions')
            .select('model, prompt_version, created_at, status, output')
            .eq('run_id', lead.run_id)
            .eq('signal_id', lead.signal_id)
            .eq('agent', 'classifier')
            .eq('status', 'ok')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          db
            .from('decisions')
            .select('model, prompt_version, created_at, status, output')
            .eq('run_id', lead.run_id)
            .eq('signal_id', lead.signal_id)
            .eq('agent', 'critic')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (decisionError) {
        throw dbError('getLeadDetail', decisionError);
      }
      if (criticError) {
        throw dbError('getLeadDetail', criticError);
      }
      if (!signal || !decision) {
        return null;
      }
      const label = lead.label;
      const status = lead.status;
      const storedBreakdown = asRecord(lead.score_breakdown);
      const breakdown = ScoreBreakdownSchema.safeParse({
        components: storedBreakdown.components,
        total: storedBreakdown.total,
      });
      const enrichment = parseEnrichment(storedBreakdown.enrichment);
      const output = asRecord(decision.output);
      const classifierOutput = parseClassifierOutput(output);
      if (
        (label !== 'buyer_intent' && label !== 'competitor_complaint' && label !== 'venting' && label !== 'noise') ||
        (status !== 'new' && status !== 'accepted' && status !== 'rejected') ||
        !breakdown.success || !enrichment || !classifierOutput ||
        !SOURCE_IDS.includes(signal.source as SourceId)
      ) {
        return null;
      }
      const notes = asRecord(output.notes);
      const criteria = Array.isArray(output.criteria)
        ? output.criteria.flatMap((item) => {
          const row = asRecord(item);
          if (row.passed !== true || typeof row.quote !== 'string') {
            return [];
          }
          if (!isCriterionId(row.id)) {
            return [];
          }
          return [{ criterion: row.id, quote: row.quote }];
        })
        : [];
      const unverified = Array.isArray(notes.unverified) ? notes.unverified : [];
      const view: LeadView = {
        leadId: lead.id as string,
        signalId: signal.id as string,
        rank: lead.rank as number,
        label,
        score: lead.score as number,
        confidence: typeof storedBreakdown.confidence === 'number' ? storedBreakdown.confidence : null,
        status,
        source: signal.source as SourceId,
        url: signal.url as string,
        authorHandle: signal.author_handle as string,
        community: (signal.community as string | null) ?? null,
        createdAtSource: signal.created_at_source as string,
        textPreview: String(signal.text_snapshot ?? '').slice(0, 280),
        rationale: classifierOutput.rationale,
        criteria: classifierOutput.criteria,
        evidenceVerified: decision.status === 'ok',
        breakdown: breakdown.data,
        enrichment,
      };
      return {
        lead: view,
        runId: lead.run_id as string,
        text: signal.text_snapshot as string,
        evidence: findEvidenceSpans(signal.text_snapshot as string, criteria),
        discardedQuotes: unverified.length,
        trace: {
          model: typeof decision.model === 'string' ? decision.model : null,
          promptVersion: typeof decision.prompt_version === 'string' ? decision.prompt_version : null,
          createdAt: decision.created_at as string,
          status: decision.status as string,
          output,
        },
        criticTrace: criticDecision ? {
          model: typeof criticDecision.model === 'string' ? criticDecision.model : null,
          promptVersion: typeof criticDecision.prompt_version === 'string' ? criticDecision.prompt_version : null,
          createdAt: typeof criticDecision.created_at === 'string' ? criticDecision.created_at : '',
          status: typeof criticDecision.status === 'string' ? criticDecision.status : 'error',
          output: asRecord(criticDecision.output),
        } : null,
      };
    },

    async setLeadStatus(leadId, status) {
      const { data, error } = await db.from('leads').update({ status }).eq('id', leadId).select('id');
      if (error) {
        throw dbError('setLeadStatus', error);
      }
      return (data ?? []).length > 0;
    },

    async addFeedback(leadId, action) {
      const { error } = await db.from('feedback').insert({ lead_id: leadId, action });
      if (error) {
        throw dbError('addFeedback', error);
      }
    },
  };
}
