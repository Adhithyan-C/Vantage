import type { LeadLabel, LeadView } from '@vantage/shared';

export type LabelFilter = 'all' | LeadLabel;
export type StatusFilter = 'all' | LeadView['status'];

export interface InboxFilters {
  showOtherSignals: boolean;
  label: LabelFilter;
  status: StatusFilter;
  minScore: number | null;
}

export function isRankedLabel(label: LeadLabel): boolean {
  return label === 'buyer_intent' || label === 'competitor_complaint';
}

export function filterSignals(signals: LeadView[], filters: InboxFilters): LeadView[] {
  return signals
    .filter((signal) => filters.showOtherSignals || isRankedLabel(signal.label))
    .filter((signal) => filters.label === 'all' || signal.label === filters.label)
    .filter((signal) => filters.status === 'all' || signal.status === filters.status)
    .filter((signal) =>
      filters.minScore === null || !isRankedLabel(signal.label) || signal.score >= filters.minScore,
    )
    .sort((left, right) => left.rank - right.rank);
}

export function countSignalGroups(signals: LeadView[]): { buying: number; other: number } {
  return signals.reduce(
    (counts, signal) => {
      if (isRankedLabel(signal.label)) {
        counts.buying += 1;
      } else {
        counts.other += 1;
      }
      return counts;
    },
    { buying: 0, other: 0 },
  );
}
