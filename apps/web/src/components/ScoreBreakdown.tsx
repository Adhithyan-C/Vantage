import type { ScoreBreakdown as ScoreBreakdownData } from '@vantage/shared';
import { isRankedLabel } from '../lib/inbox';
import type { LeadView } from '@vantage/shared';

const NAME: Record<ScoreBreakdownData['components'][number]['name'], string> = {
  intent: 'Intent', fit: 'Fit', recency: 'Recency', engagement: 'Engagement',
};

export function ScoreBreakdown({ lead }: { lead: LeadView }) {
  if (!isRankedLabel(lead.label)) {
    return <p>Not ranked: this signal was not classified as a buying signal, so it is not scored.</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th scope="col">Component</th><th scope="col">Value</th><th scope="col">Weight</th><th scope="col">Points</th></tr></thead>
        <tbody>
          {lead.breakdown.components.map((component) => (
            <tr key={component.name}>
              <th scope="row">{NAME[component.name]}</th>
              <td>{(component.value * 100).toFixed(2)}%</td>
              <td>{(component.weight * 100).toFixed(0)}%</td>
              <td>{component.contribution.toFixed(2)}</td>
            </tr>
          ))}
          <tr><th scope="row" colSpan={3}>Total</th><td>{lead.score}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
