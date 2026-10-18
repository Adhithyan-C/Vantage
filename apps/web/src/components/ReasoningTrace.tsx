import type { DecisionTrace } from '@vantage/shared';

export function ReasoningTrace({ trace }: { trace: DecisionTrace }) {
  return (
    <details className="raw-trace">
      <summary>Raw trace</summary>
      <dl>
        <dt>Model</dt><dd>{trace.model ?? 'Unknown'}</dd>
        <dt>Prompt version</dt><dd>{trace.promptVersion ?? 'Unknown'}</dd>
        <dt>Timestamp</dt><dd>{trace.createdAt}</dd>
        <dt>Status</dt><dd>{trace.status}</dd>
      </dl>
      <pre>{JSON.stringify(trace.output, null, 2)}</pre>
    </details>
  );
}
