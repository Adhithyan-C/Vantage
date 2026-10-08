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
    content_hash: contentHash(signal.text),
  };
}

export async function upsertSignals(
  db: SupabaseClient,
  signals: RawSignal[]
): Promise<{ inserted: number; updated: number }> {
  if (signals.length === 0) return { inserted: 0, updated: 0 };

  const rows = signals.map(toSignalRow);

  // Group rows by source
  const bySource = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = bySource.get(row.source) ?? [];
    group.push(row);
    bySource.set(row.source, group);
  }

  const existingIds = new Map<string, string>(); // external_id -> id

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
          existingIds.set(row.external_id as string, row.id as string);
        }
      }
    }
  }

  // Split rows into insert and update sets
  const toInsert = rows.filter(r => !existingIds.has(r.external_id));
  const toUpdate = rows
    .filter(r => existingIds.has(r.external_id))
    .map(r => ({ id: existingIds.get(r.external_id)!, engagement: r.engagement }));

  // Insert new rows
  if (toInsert.length > 0) {
    const { error } = await db.from('signals').insert(toInsert);
    if (error) {
      throw new Error(`Supabase error in insert: ${error.message}`);
    }
  }

  // Update existing rows (engagement + fetched_at only)
  for (const { id, engagement } of toUpdate) {
    const { error } = await db
      .from('signals')
      .update({ engagement, fetched_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error(`Supabase error in update: ${error.message}`);
    }
  }

  return { inserted: toInsert.length, updated: toUpdate.length };
}
