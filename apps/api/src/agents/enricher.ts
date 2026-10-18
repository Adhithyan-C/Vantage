import type { Enrichment, RawSignal, SourceId } from '@vantage/shared';
import { PURCHASE_TERMS, TEAM_TERMS } from '../config/enrich';

export interface EnrichSignalInput {
  text: string;
  source: SourceId;
  community?: string | null;
  createdAtSource: string;
  engagement: RawSignal['engagement'];
  competitors: string[];
  now: Date;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function enrichSignal({
  text,
  source,
  community,
  createdAtSource,
  engagement,
  competitors,
  now,
}: EnrichSignalInput): Enrichment {
  const lowerText = text.toLowerCase();
  const seenCompetitors = new Set<string>();
  const competitorsMentioned = competitors.filter((competitor) => {
    const key = competitor.toLowerCase();
    if (seenCompetitors.has(key)) {
      return false;
    }
    seenCompetitors.add(key);
    return new RegExp(`\\b${escapeRegex(competitor)}\\b`, 'i').test(text);
  });
  const purchaseTermsFound = PURCHASE_TERMS.filter((term) => lowerText.includes(term));
  const teamTermsFound = TEAM_TERMS.filter((term) => lowerText.includes(term));
  const elapsedDays = (now.getTime() - Date.parse(createdAtSource)) / 86_400_000;
  const ageDays = Math.round(Math.max(0, elapsedDays) * 10) / 10;

  return {
    ageDays,
    commentCount: engagement.comments ?? 0,
    upvotes: engagement.score ?? 0,
    source,
    community: community ?? null,
    competitorsMentioned,
    purchaseTermsFound,
    teamTermsFound,
    fit: {
      competitorMentioned: competitorsMentioned.length > 0,
      purchaseLanguage: purchaseTermsFound.length > 0,
      teamOrRoleContext: teamTermsFound.length > 0,
    },
  };
}
