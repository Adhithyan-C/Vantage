import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentId,
  EventKind,
  RawSignal,
  RequestRecord,
  RunEvent,
  RunParams,
  RunStatus,
  RunView,
  SourceRequestView,
  SellerProfileInput,
  SourceId,
  SourceStatus,
} from '@vantage/shared';
import { upsertSignals } from './queries';

export interface SourcePatch {
  status: SourceStatus;
  fetchedCount?: number;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunStore {
  createSellerProfile(input: SellerProfileInput): Promise<string>;
  createRun(sellerProfileId: string, params: RunParams): Promise<string>;
  getRun(runId: string): Promise<RunView | null>;
  listEvents(runId: string, afterId: number): Promise<RunEvent[]>;
  saveSourceRequests(runId: string, records: RequestRecord[]): Promise<void>;
  listSourceRequests(runId: string): Promise<SourceRequestView[]>;
  setRunStatus(runId: string, status: RunStatus, finished: boolean): Promise<void>;
  upsertRunSource(runId: string, source: SourceId, patch: SourcePatch): Promise<void>;
  addEvent(
    runId: string,
    agent: AgentId,
    kind: EventKind,
    message: string,
    counts?: Record<string, unknown>,
  ): Promise<void>;
  storeSignals(
    runId: string,
    signals: RawSignal[],
  ): Promise<{ inserted: number; updated: number }>;
  failStaleRuns(): Promise<number>;
}

function dbError(method: string, error: { message: string }): Error {
  return new Error(`Supabase error in ${method}: ${error.message}`);
}

export function createRunStore(db: SupabaseClient): RunStore {
  return {
    async createSellerProfile(input) {
      const { data, error } = await db
        .from('seller_profiles')
        .insert({
          product_name: input.productName,
          problem_description: input.problemDescription,
          ideal_customer: input.idealCustomer ?? null,
          competitors: input.competitors,
        })
        .select('id')
        .single();
      if (error) {
        throw dbError('createSellerProfile', error);
      }
      if (!data) {
        throw new Error('Supabase error in createSellerProfile: no row returned');
      }
      return data.id as string;
    },

    async createRun(sellerProfileId, params) {
      const { data, error } = await db
        .from('runs')
        .insert({
          seller_profile_id: sellerProfileId,
          status: 'running',
          demo: false,
          params,
        })
        .select('id')
        .single();
      if (error) {
        throw dbError('createRun', error);
      }
      if (!data) {
        throw new Error('Supabase error in createRun: no row returned');
      }
      return data.id as string;
    },

    async getRun(runId) {
      const { data: run, error: runError } = await db
        .from('runs')
        .select('*')
        .eq('id', runId)
        .maybeSingle();
      if (runError) {
        throw dbError('getRun', runError);
      }
      if (!run) {
        return null;
      }

      const { data: seller, error: sellerError } = await db
        .from('seller_profiles')
        .select('*')
        .eq('id', run.seller_profile_id)
        .single();
      if (sellerError) {
        throw dbError('getRun', sellerError);
      }
      if (!seller) {
        throw new Error('Supabase error in getRun: seller profile not found');
      }

      const { data: sources, error: sourcesError } = await db
        .from('run_sources')
        .select('*')
        .eq('run_id', runId)
        .order('source', { ascending: true });
      if (sourcesError) {
        throw dbError('getRun', sourcesError);
      }

      const { data: signalRows, error: signalsError } = await db
        .from('run_signals')
        .select('signal_id')
        .eq('run_id', runId);
      if (signalsError) {
        throw dbError('getRun', signalsError);
      }

      return {
        id: run.id as string,
        status: run.status as RunStatus,
        demo: Boolean(run.demo),
        params: run.params as RunParams,
        startedAt: run.started_at as string,
        finishedAt: (run.finished_at as string | null) ?? null,
        seller: {
          productName: seller.product_name as string,
          problemDescription: seller.problem_description as string,
          idealCustomer: (seller.ideal_customer as string | null) ?? null,
          competitors: (seller.competitors as string[] | null) ?? [],
        },
        sources: (sources ?? []).map((row) => ({
          source: row.source as SourceId,
          status: row.status as SourceStatus,
          fetchedCount: (row.fetched_count as number | null) ?? 0,
          error: (row.error as string | null) ?? null,
        })),
        signalCount: (signalRows ?? []).length,
      };
    },

    async listEvents(runId, afterId) {
      const { data, error } = await db
        .from('run_events')
        .select('*')
        .eq('run_id', runId)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(500);
      if (error) {
        throw dbError('listEvents', error);
      }
      return (data ?? []).map((row) => ({
        id: Number(row.id),
        runId: row.run_id as string,
        agent: row.agent as AgentId,
        kind: row.kind as EventKind,
        message: row.message as string,
        counts: (row.counts as Record<string, unknown> | null) ?? null,
        createdAt: row.created_at as string,
      }));
    },

    async saveSourceRequests(runId, records) {
      if (records.length === 0) return;
      const rows = records.map((record) => ({
        run_id: runId,
        source: record.source,
        label: record.label,
        status: record.status,
        http_status: record.httpStatus,
        duration_ms: record.durationMs,
        items_returned: record.itemsReturned,
        error: record.error,
        quota_remaining: record.quotaRemaining,
        outcome: record.outcome ?? null,
        request: record.request ?? null,
        response_summary: record.responseSummary ?? null,
      }));
      const { error } = await db.from('source_requests').insert(rows);
      if (error) {
        throw dbError('saveSourceRequests', error);
      }
    },

    async listSourceRequests(runId) {
      const { data, error } = await db
        .from('source_requests')
        .select('id,source,label,status,http_status,duration_ms,items_returned,error,quota_remaining,outcome,request,response_summary,created_at')
        .eq('run_id', runId)
        .order('id', { ascending: true })
        .limit(200);
      if (error) {
        throw dbError('listSourceRequests', error);
      }
      return (data ?? []).map((row) => ({
        id: Number(row.id),
        source: row.source as SourceId,
        label: row.label as string,
        status: row.status as RequestRecord['status'],
        httpStatus: (row.http_status as number | null) ?? null,
        durationMs: Number(row.duration_ms),
        itemsReturned: Number(row.items_returned),
        error: (row.error as string | null) ?? null,
        quotaRemaining: (row.quota_remaining as number | null) ?? null,
        outcome: typeof row.outcome === 'string' ? row.outcome as SourceRequestView['outcome'] : undefined,
        request: row.request && typeof row.request === 'object' ? row.request as SourceRequestView['request'] : null,
        responseSummary: row.response_summary && typeof row.response_summary === 'object' ? row.response_summary as Record<string, unknown> : null,
        createdAt: row.created_at as string,
      }));
    },

    async setRunStatus(runId, status, finished) {
      const update: { status: RunStatus; finished_at?: string } = { status };
      if (finished) {
        update.finished_at = new Date().toISOString();
      }
      const { error } = await db.from('runs').update(update).eq('id', runId);
      if (error) {
        throw dbError('setRunStatus', error);
      }
    },

    async upsertRunSource(runId, source, patch) {
      const row: Record<string, unknown> = {
        run_id: runId,
        source,
        status: patch.status,
      };
      if (patch.fetchedCount !== undefined) {
        row.fetched_count = patch.fetchedCount;
      }
      if (patch.error !== undefined) {
        row.error = patch.error;
      }
      if (patch.startedAt !== undefined) {
        row.started_at = patch.startedAt;
      }
      if (patch.finishedAt !== undefined) {
        row.finished_at = patch.finishedAt;
      }
      const { error } = await db
        .from('run_sources')
        .upsert(row, { onConflict: 'run_id,source' });
      if (error) {
        throw dbError('upsertRunSource', error);
      }
    },

    async addEvent(runId, agent, kind, message, counts) {
      const { error } = await db.from('run_events').insert({
        run_id: runId,
        agent,
        kind,
        message,
        counts: counts ?? null,
      });
      if (error) {
        throw dbError('addEvent', error);
      }
    },

    async storeSignals(runId, signals) {
      const result = await upsertSignals(db, signals);
      if (result.signalIds.length > 0) {
        const rows = result.signalIds.map((signalId) => ({
          run_id: runId,
          signal_id: signalId,
        }));
        const { error } = await db
          .from('run_signals')
          .upsert(rows, { onConflict: 'run_id,signal_id', ignoreDuplicates: true });
        if (error) {
          throw dbError('storeSignals', error);
        }
      }
      return { inserted: result.inserted, updated: result.updated };
    },

    async failStaleRuns() {
      const { data, error } = await db
        .from('runs')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('status', 'running')
        .select('id');
      if (error) {
        throw dbError('failStaleRuns', error);
      }
      return (data ?? []).length;
    },
  };
}
