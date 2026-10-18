import type { CriterionId, EvidenceSpan } from '@vantage/shared';

export interface TextSegment {
  text: string;
  highlighted: boolean;
  criterion?: CriterionId;
}

export function segmentText(text: string, spans: EvidenceSpan[]): TextSegment[] {
  const valid = spans
    .filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end) &&
      span.start >= 0 && span.end <= text.length && span.start < span.end)
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: EvidenceSpan[] = [];
  for (const span of valid) {
    const previous = merged[merged.length - 1];
    if (previous && span.start < previous.end) {
      merged[merged.length - 1] = {
        ...previous,
        end: Math.max(previous.end, span.end),
      };
    } else {
      merged.push({ ...span });
    }
  }
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), highlighted: false });
    }
    segments.push({ text: text.slice(span.start, span.end), highlighted: true, criterion: span.criterion });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }
  if (segments.length === 0 && text.length > 0) {
    segments.push({ text, highlighted: false });
  }
  return segments;
}
