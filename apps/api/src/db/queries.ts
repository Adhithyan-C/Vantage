import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawSignal } from '@vantage/shared';
import { contentHash } from '../utils/hash.js';

export function toSignalRow(signal: RawSignal) {
  return {
    source: signal.source,
    external_id: signal.externalId,
    author_handle: signal.authorHandle,
    community: signal.community ?? null,
    url: signal.url,
    text_snapshot: signal.text,
    created_at_source: signal.createdAt,
    engagement: signal.engagement,
    metadata: signal.metadata ?? {},
    content_completeness: signal.contentCompleteness ?? 'complete',
    content_hash: contentHash(signal.text),
  };
}

export async function upsertSignals(
  db: SupabaseClient,
  signals: RawSignal[]
): Promise<{ inserted: number; updated: number; signalIds: string[] }> {
  if (signals.length === 0) {
    return { inserted: 0, updated: 0, signalIds: [] };
  }

  const rows = signals.map(toSignalRow);

  // Group rows by source
  const bySource = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = bySource.get(row.source) ?? [];
    group.push(row);
    bySource.set(row.source, group);
  }

  const existingIds = new Map<string, string>();

  // For each source, look up which external_ids already exist in chunks of 100
  for (const [source, sourceRows] of bySource) {
    const externalIds = sourceRows.map(r => r.external_id);

    for (let i = 0; i < externalIds.length; i += 100) {
      const chunk = externalIds.slice(i, i + 100);
      const { data, error } = await db
        .from('signals')
        .select('id, external_id')
        .eq('source', source)
        .in('external_id', chunk);

      if (error) {
        throw new Error(`Supabase error in select existing: ${error.message}`);
      }

      if (data) {
        for (const row of data) {
          existingIds.set(`${source}:${row.external_id as string}`, row.id as string);
        }
      }
    }
  }

  // Split rows into insert and update sets
  const toInsert = rows.filter(r => !existingIds.has(`${r.source}:${r.external_id}`));
  const toUpdate = rows
    .filter(r => existingIds.has(`${r.source}:${r.external_id}`))
    .map(r => ({ id: existingIds.get(`${r.source}:${r.external_id}`)!, row: r }));

  // Insert new rows and get their IDs
  let insertedIdsMap = new Map<string, string>();
  if (toInsert.length > 0) {
    const { data: insertedRows, error } = await db
      .from('signals')
      .insert(toInsert)
      .select('id, source, external_id');

    if (error) {
      throw new Error(`Supabase error in insert: ${error.message}`);
    }

    for (const row of insertedRows ?? []) {
      const inserted = toInsert.find((item) => item.source === row.source && item.external_id === row.external_id);
      if (inserted) insertedIdsMap.set(`${inserted.source}:${row.external_id as string}`, row.id as string);
    }
  }

  // Update existing rows (engagement + fetched_at only)
  for (const { id, row } of toUpdate) {
    const { error } = await db
      .from('signals')
      .update({ engagement: row.engagement, metadata: row.metadata, content_completeness: row.content_completeness, fetched_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error(`Supabase error in update: ${error.message}`);
    }
  }

  // Build signalIds array in the same order as input signals
  const signalIds: string[] = [];
  for (const signal of signals) {
    const key = `${signal.source}:${signal.externalId}`;
    const id = existingIds.get(key) ?? insertedIdsMap.get(key);
    if (id === undefined) {
      // This should not happen because every signal is either existing or inserted
      throw new Error(`Could not determine ID for signal ${signal.externalId}`);
    }
    signalIds.push(id);
  }

  return { inserted: toInsert.length, updated: toUpdate.length, signalIds };
}
