import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createThemeStore } from '../src/db/themes';

class Query {
  private readonly equals = new Map<string, unknown>();
  private readonly included = new Map<string, unknown[]>();
  private action: 'select' | 'delete' | 'insert' = 'select';
  private inserted: Record<string, unknown>[] = [];

  constructor(private readonly table: string, private readonly rows: Record<string, Record<string, unknown>[]>, private readonly calls: string[]) {}
  select(): this { this.action = 'select'; return this; }
  eq(key: string, value: unknown): this { this.equals.set(key, value); return this; }
  in(key: string, values: unknown[]): this { this.included.set(key, values); return this; }
  order(): this { return this; }
  delete(): this { this.action = 'delete'; this.calls.push(`delete:${this.table}`); return this; }
  insert(values: Record<string, unknown>[]): this { this.action = 'insert'; this.inserted = values; this.calls.push(`insert:${this.table}`); return this; }
  then<TResult1 = { data: Record<string, unknown>[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.action === 'delete') {
      this.rows[this.table] = (this.rows[this.table] ?? []).filter((row) => row.run_id !== this.equals.get('run_id'));
    }
    if (this.action === 'insert') this.rows[this.table] = [...(this.rows[this.table] ?? []), ...this.inserted];
    const data = (this.rows[this.table] ?? []).filter((row) =>
      [...this.equals].every(([key, value]) => row[key] === value) &&
      [...this.included].every(([key, values]) => values.includes(row[key])),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function makeDb() {
  const rows: Record<string, Record<string, unknown>[]> = {
    themes: [
      { id: 't-small', run_id: 'r', competitor: 'Beta', title: 'Beta: slow', summary: '2 signals', signal_ids: ['s1', 's2'], quotes: [] },
      { id: 't-large', run_id: 'r', competitor: 'Acme', title: 'Acme: search', summary: '3 signals', signal_ids: ['s1', 's2', 's3'], quotes: [{ signalId: 's1', criterion: 'names_competitor', quote: 'Acme search' }] },
    ],
    leads: [{ id: 'l1', run_id: 'r', signal_id: 's1' }],
    signals: [{ id: 's1', source: 'snapshot' }, { id: 's2', source: 'hackernews' }, { id: 's3', source: 'hackernews' }],
    decisions: [],
  };
  const calls: string[] = [];
  const db = { from(table: string) { return new Query(table, rows, calls); } } as unknown as SupabaseClient;
  return { db, rows, calls };
}

describe('ThemeStore', () => {
  it('deletes existing themes before inserting the run drafts', async () => {
    const { db, rows, calls } = makeDb();
    await createThemeStore(db).saveThemes('r', [{
      competitor: 'Gamma', title: 'Gamma: outage', summary: '3 signal(s) complaining about Gamma.',
      signalIds: ['s4', 's5', 's6'], quotes: [],
    }]);
    expect(calls).toEqual(['delete:themes', 'insert:themes']);
    expect(rows.themes).toEqual([expect.objectContaining({ run_id: 'r', competitor: 'Gamma', signal_ids: ['s4', 's5', 's6'] })]);
  });

  it('deletes without inserting when no drafts are produced', async () => {
    const { db, calls } = makeDb();
    await createThemeStore(db).saveThemes('r', []);
    expect(calls).toEqual(['delete:themes']);
  });

  it('loads only complaint leads with current-run verified classifier evidence', async () => {
    const { db, rows } = makeDb();
    rows.leads?.push({
      id: 'complaint-lead', run_id: 'r', signal_id: 'complaint-signal', label: 'competitor_complaint',
      score_breakdown: { enrichment: { competitorsMentioned: ['Acme', 'Beta'] } },
    });
    rows.signals?.push({ id: 'complaint-signal', source: 'hackernews', text_snapshot: 'Acme search is slow.' });
    rows.decisions?.push({
      run_id: 'r', signal_id: 'complaint-signal', agent: 'classifier', status: 'ok', created_at: '2026-10-01T00:00:00Z',
      output: { criteria: [
        { id: 'names_competitor', passed: true, quote: 'Acme search' },
        { id: 'shows_urgency', passed: false, quote: null },
      ] },
    });
    const input = await createThemeStore(db).getThemeInputs('r');
    expect(input).toEqual([{
      signalId: 'complaint-signal', source: 'hackernews', text: 'Acme search is slow.',
      competitorsMentioned: ['Acme', 'Beta'], evidence: [{ criterion: 'names_competitor', quote: 'Acme search' }],
    }]);
  });

  it('sorts by member count and resolves lead ids and sample data', async () => {
    const { db } = makeDb();
    const themes = await createThemeStore(db).listThemes('r');
    expect(themes.map((theme) => theme.id)).toEqual(['t-large', 't-small']);
    expect(themes[0]).toMatchObject({
      members: [{ signalId: 's1', leadId: 'l1' }, { signalId: 's2', leadId: null }, { signalId: 's3', leadId: null }],
      sampleData: true,
      quotes: [{ signalId: 's1', criterion: 'names_competitor', quote: 'Acme search' }],
    });
  });
});
