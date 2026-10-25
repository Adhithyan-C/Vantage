import type { SignalJourney } from '@vantage/shared';

const TITLES: Record<SignalJourney['timeline'][number]['stage'], string> = {
  scout: 'Scout', classifier: 'Classifier', critic: 'Critic', enricher: 'Enricher', scorer: 'Scorer', displacement: 'Displacement', outcome: 'Outcome',
};

function outputSummary(stage: SignalJourney['timeline'][number]['stage'], output: Record<string, unknown> | null): string {
  if (!output) return 'Not recorded for this run.';
  if (stage === 'scout' && typeof output.relevance === 'object' && output.relevance !== null) {
    const relevance = output.relevance as Record<string, unknown>;
    if (relevance.eligible === false && typeof relevance.similarity === 'number' && typeof relevance.threshold === 'number') {
      const reason = typeof relevance.exclusionReason === 'string' ? ` (${relevance.exclusionReason.toLowerCase()})` : '';
      return `Excluded before classification${reason} · similarity ${relevance.similarity.toFixed(3)}; threshold ${relevance.threshold.toFixed(2)}.`;
    }
  }
  if (stage === 'classifier') return `${String(output.label ?? 'Label unavailable')}: ${String(output.rationale ?? 'Rationale not recorded')}`;
  if (stage === 'critic') return `Trust review: ${String(output.verdict ?? 'unavailable')}${Array.isArray(output.issues) && output.issues.length > 0 ? ` · ${output.issues.join('; ')}` : ''}`;
  if (stage === 'scorer') return typeof output.score === 'number' ? `Score ${output.score}; rank ${typeof output.rank === 'number' ? output.rank : 'Not ranked'}` : 'Not recorded for this run.';
  if (stage === 'outcome') return String(output.reason ?? 'Not recorded for this run.');
  if (stage === 'enricher') return `Competitors: ${Array.isArray(output.competitorsMentioned) ? output.competitorsMentioned.join(', ') || 'none' : 'Not recorded'}`;
  if (stage === 'displacement') return typeof output.title === 'string' ? `${String(output.competitor)}: ${output.title}; ${String(output.otherMemberCount ?? 0)} other member(s)` : 'No theme membership was recorded.';
  return `Collected from ${String(output.source ?? 'unknown source')}.`;
}

export function SignalJourneyTimeline({ journey }: { journey: SignalJourney }) {
  return <section className="card signal-journey" aria-labelledby="journey-title">
    <h2 className="card-title" id="journey-title">Journey</h2>
    <blockquote className="journey-post">{journey.text}</blockquote>
    <ol className="journey-timeline">
      {journey.timeline.map((item) => <li className={`journey-step state-${item.status}`} key={item.stage}>
        <div className="journey-step-heading"><strong>{TITLES[item.stage]}</strong><span className={`badge journey-status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span></div>
        {item.reason && <p className="muted">{item.reason}</p>}
        <p>{item.stage === 'displacement' && typeof item.output?.href === 'string'
          ? <a href={item.output.href}>{outputSummary(item.stage, item.output)}</a>
          : outputSummary(item.stage, item.output)}</p>
        {item.stage === 'outcome' && typeof item.output?.theme === 'string' && <p>Also a member of theme: {item.output.theme}</p>}
        {item.stage === 'classifier' && Array.isArray(item.output?.criteria) && <ul>{item.output.criteria.map((criterion, index) => {
          if (typeof criterion !== 'object' || criterion === null) return null;
          const row = criterion as Record<string, unknown>;
          return <li key={index}>{String(row.id)}: {row.passed === true ? 'passed' : 'not passed'}{typeof row.quote === 'string' ? ` — “${row.quote}”` : ''}</li>;
        })}</ul>}
      </li>)}
    </ol>
  </section>;
}
