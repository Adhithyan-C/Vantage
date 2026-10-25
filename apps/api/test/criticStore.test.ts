import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CRITERION_IDS } from '@vantage/shared';
import { createDecisionStore } from '../src/db/decisions';

interface QueryResult {
  data: Array<Record<string, unknown>>;
  error: null;
}

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly equals: Array<[string, unknown]> = [];
  private included: { column: string; values: unknown[] } | null = null;
  private ordering: { column: string; ascending: boolean } | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select(): this { return this; }
  eq(column: string, value: unknown): this { this.equals.push([column, value]); return this; }
  in(column: string, values: unknown[]): this { this.included = { column, values }; return this; }
  order(column: string, options: { ascending: boolean }): this {
    this.ordering = { column, ascending: options.ascending };
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    let rows = this.rows.filter((row) => this.equals.every(([column, value]) => row[column] === value));
    if (this.included) {
      const { column, values } = this.included;
      rows = rows.filter((row) => values.includes(row[column]));
    }
    if (this.ordering) {
      const { column, ascending } = this.ordering;
      rows = [...rows].sort((left, right) => {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        return ascending ? comparison : -comparison;
      });
    }
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

function classifierOutput(rationale: string) {
  return {
    label: 'buyer_intent',
    rationale,
    criteria: CRITERION_IDS.map((id) => ({ id, passed: true, quote: 'quoted text' })),
  };
}

describe('DecisionStore.listCriticCandidates', () => {
  it('returns only the latest valid ok classifier decision per signal with its stored post text', async () => {
    const db = {
      from(table: string) {
        if (table === 'decisions') {
          return new FakeQuery([
            { id: 'new-decision', run_id: 'run-1', signal_id: 'signal-1', agent: 'classifier', status: 'ok', output: classifierOutput('Latest'), created_at: '2026-02-01' },
            { id: 'old-decision', run_id: 'run-1', signal_id: 'signal-1', agent: 'classifier', status: 'ok', output: classifierOutput('Old'), created_at: '2026-01-01' },
            { id: 'critic-row', run_id: 'run-1', signal_id: 'signal-1', agent: 'critic', status: 'ok', output: {} },
            { id: 'failed-row', run_id: 'run-1', signal_id: 'signal-2', agent: 'classifier', status: 'error', output: classifierOutput('Failed') },
          ]);
        }
        return new FakeQuery([{ id: 'signal-1', text_snapshot: 'The stored public post.' }]);
      },
    } as unknown as SupabaseClient;
    const store = createDecisionStore(db);

    await expect(store.listCriticCandidates('run-1')).resolves.toEqual([{
      decisionId: 'new-decision',
      signalId: 'signal-1',
      output: classifierOutput('Latest'),
      text: 'The stored public post.',
    }]);
  });
});
