import type { ThemeView } from '@vantage/shared';

const CRITERION_LABEL: Record<string, string> = {
  states_problem: 'States a problem',
  asks_for_recommendation: 'Asks for a recommendation',
  mentions_team_or_budget: 'Mentions team or budget',
  shows_urgency: 'Shows urgency',
  names_competitor: 'Names a competitor',
};

export function ThemeCard({ theme }: { theme: ThemeView }) {
  const leadBySignal = new Map(theme.members.map((member) => [member.signalId, member.leadId]));
  return (
    <article className="card theme-card">
      <div className="theme-card-heading">
        <div>
          <p className="eyebrow">{theme.competitor}</p>
          <h3>{theme.title}</h3>
        </div>
        <span className="badge">{theme.members.length} signals</span>
      </div>
      {theme.sampleData && <span className="badge">Sample data</span>}
      <p>{theme.summary}</p>
      {theme.quotes.length > 0 && (
        <ul className="theme-quotes">
          {theme.quotes.slice(0, 3).map((item, index) => {
            const leadId = leadBySignal.get(item.signalId);
            const quote = <blockquote>{item.quote}</blockquote>;
            return (
              <li key={`${item.signalId}:${index}`}>
                <span className="evidence-criterion">{CRITERION_LABEL[item.criterion] ?? item.criterion}</span>
                {leadId
                  ? <a href={`#/runs/${encodeURIComponent(theme.runId)}/signals/${encodeURIComponent(leadId)}`}>{quote}</a>
                  : quote}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted theme-disclaimer">Theme labels are keyword summaries computed by code from local text embeddings. They are not written by an AI model and are not proof of intent.</p>
    </article>
  );
}
