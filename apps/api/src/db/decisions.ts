import type { SupabaseClient } from '@supabase/supabase-js';
import { CRITERION_IDS } from '@vantage/shared';
import type {
  ClassifierOutput,
  DecisionView,
  LeadLabel,
  SellerProfileInput,
  SourceId,
} from '@vantage/shared';

export interface RunSignalContext {
  id: string;
  text: string;
  source: SourceId;
  url: string;
  authorHandle: string;
  createdAtSource: string;
  contentHash: string;
}

export interface RunClassificationContext {
  seller: SellerProfileInput;
  signals: RunSignalContext[];
}

export interface DecisionRow {
  runId: string;
  signalId: string;
  agent: 'classifier';
  model: string | null;
  promptVersion: string;
  inputHash: string;
  output: Record<string, unknown>;
  evidence: Array<{ criterion: string; quote: string }>;
  evidenceVerified: boolean;
  status: 'ok' | 'invalid_output' | 'error';
}

export interface ReusableDecision {
  model: string | null;
  promptVersion: string | null;
  output: Record<string, unknown>;
  evidence: Array<{ criterion: string; quote: string }>;
  evidenceVerified: boolean;
}

export interface DecisionStore {
  getRunContext(runId: string): Promise<RunClassificationContext>;
  findReusable(inputHash: string): Promise<ReusableDecision | null>;
  saveDecision(row: DecisionRow): Promise<void>;
  listDecisions(runId: string): Promise<DecisionView[]>;
}

function dbError(method: string, error: { message: string }): Error {
  return new Error(`Supabase error in ${method}: ${error.message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function toDecisionView(
  decision: Record<string, unknown>,
  signal: Record<string, unknown>,
): DecisionView {
  const output = asRecord(decision.output);
  const criteriaValue = Array.isArray(output.criteria) ? output.criteria : [];
  const criteria = criteriaValue.flatMap((item) => {
    const row = asRecord(item);
    if (!CRITERION_IDS.includes(row.id as (typeof CRITERION_IDS)[number])) {
      return [];
    }
    return [{
      id: row.id as (typeof CRITERION_IDS)[number],
      passed: row.passed === true,
      quote: typeof row.quote === 'string' ? row.quote : null,
    }];
  });
  const status = decision.status;
  const label = output.label;
  const rationale = output.rationale;
  return {
    signalId: signal.id as string,
    source: signal.source as SourceId,
    url: signal.url as string,
    authorHandle: signal.author_handle as string,
    createdAtSource: signal.created_at_source as string,
    textPreview: String(signal.text_snapshot ?? '').slice(0, 280),
    label:
      (status === 'ok' && (label === 'buyer_intent' || label === 'competitor_complaint' || label === 'venting' || label === 'noise')
        ? label
        : null) as LeadLabel | null,
    rationale: status === 'ok' && typeof rationale === 'string' ? rationale : '',
    criteria,
    evidenceVerified: decision.evidence_verified === true,
    model: typeof decision.model === 'string' ? decision.model : null,
    promptVersion: typeof decision.prompt_version === 'string' ? decision.prompt_version : null,
    status: status === 'invalid_output' || status === 'error' ? status : 'ok',
  };
}

export function createDecisionStore(db: SupabaseClient): DecisionStore {
  return {
    async getRunContext(runId) {
      const { data: run, error: runError } = await db
        .from('runs')
        .select('seller_profile_id')
        .eq('id', runId)
        .maybeSingle();
      if (runError) {
        throw dbError('getRunContext', runError);
      }
      if (!run) {
        throw new Error('Supabase error in getRunContext: run not found');
      }

      const { data: seller, error: sellerError } = await db
        .from('seller_profiles')
        .select('product_name, problem_description, ideal_customer, competitors')
        .eq('id', run.seller_profile_id)
        .single();
      if (sellerError) {
        throw dbError('getRunContext', sellerError);
      }
      if (!seller) {
        throw new Error('Supabase error in getRunContext: seller profile not found');
      }

      const { data: links, error: linksError } = await db
        .from('run_signals')
        .select('signal_id')
        .eq('run_id', runId);
      if (linksError) {
        throw dbError('getRunContext', linksError);
      }
      const signalIds = (links ?? []).map((link) => link.signal_id as string);
      let signals: RunSignalContext[] = [];
      if (signalIds.length > 0) {
        const { data: rows, error: signalsError } = await db
          .from('signals')
          .select('id, text_snapshot, source, url, author_handle, created_at_source, content_hash')
          .in('id', signalIds)
          .order('created_at_source', { ascending: false });
        if (signalsError) {
          throw dbError('getRunContext', signalsError);
        }
        signals = (rows ?? []).map((row) => ({
          id: row.id as string,
          text: row.text_snapshot as string,
          source: row.source as SourceId,
          url: row.url as string,
          authorHandle: row.author_handle as string,
          createdAtSource: row.created_at_source as string,
          contentHash: row.content_hash as string,
        }));
      }

      return {
        seller: {
          productName: seller.product_name as string,
          problemDescription: seller.problem_description as string,
          idealCustomer: (seller.ideal_customer as string | null) ?? undefined,
          competitors: (seller.competitors as string[] | null) ?? [],
        },
        signals,
      };
    },

    async findReusable(inputHash) {
      const { data, error } = await db
        .from('decisions')
        .select('model, prompt_version, output, evidence, evidence_verified')
        .eq('agent', 'classifier')
        .eq('input_hash', inputHash)
        .eq('status', 'ok')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw dbError('findReusable', error);
      }
      if (!data) {
        return null;
      }
      return {
        model: (data.model as string | null) ?? null,
        promptVersion: (data.prompt_version as string | null) ?? null,
        output: asRecord(data.output),
        evidence: Array.isArray(data.evidence)
          ? (data.evidence as Array<{ criterion: string; quote: string }>)
          : [],
        evidenceVerified: data.evidence_verified === true,
      };
    },

    async saveDecision(row) {
      const { error } = await db.from('decisions').insert({
        run_id: row.runId,
        signal_id: row.signalId,
        agent: row.agent,
        model: row.model,
        prompt_version: row.promptVersion,
        input_hash: row.inputHash,
        output: row.output,
        evidence: row.evidence,
        evidence_verified: row.evidenceVerified,
        status: row.status,
      });
      if (error) {
        throw dbError('saveDecision', error);
      }
    },

    async listDecisions(runId) {
      const { data: decisions, error: decisionsError } = await db
        .from('decisions')
        .select('*')
        .eq('run_id', runId)
        .eq('agent', 'classifier')
        .order('created_at', { ascending: false });
      if (decisionsError) {
        throw dbError('listDecisions', decisionsError);
      }
      const signalIds = (decisions ?? []).map((decision) => decision.signal_id as string);
      if (signalIds.length === 0) {
        return [];
      }
      const { data: signals, error: signalsError } = await db
        .from('signals')
        .select('id, source, url, author_handle, created_at_source, text_snapshot')
        .in('id', signalIds);
      if (signalsError) {
        throw dbError('listDecisions', signalsError);
      }
      const byId = new Map((signals ?? []).map((signal) => [signal.id as string, signal]));
      return (decisions ?? [])
        .flatMap((decision) => {
          const signal = byId.get(decision.signal_id as string);
          return signal ? [toDecisionView(decision, signal)] : [];
        })
        .sort((left, right) => Date.parse(right.createdAtSource) - Date.parse(left.createdAtSource))
        .slice(0, 100);
    },
  };
}
