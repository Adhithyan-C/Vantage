import type { SourceId } from '@vantage/shared';

export function parseSourceSelection(
  raw: string | undefined,
  registeredSources: readonly SourceId[],
): { sourceIds: SourceId[] | null; error: string | null } {
  if (raw === undefined) {
    return { sourceIds: null, error: null };
  }

  const sourceIds = [...new Set(raw.split(',').map((source) => source.trim()).filter(Boolean))];
  if (sourceIds.length === 0) {
    return { sourceIds: null, error: '--sources must include at least one registered source id' };
  }

  const unknown = sourceIds.find((source) => !registeredSources.includes(source as SourceId));
  if (unknown) {
    return { sourceIds: null, error: `Unknown source id: ${unknown}` };
  }

  return { sourceIds: sourceIds as SourceId[], error: null };
}
