import type { CompetitorGraphView } from '@vantage/shared';
import { EmptyState } from './EmptyState';
import { layoutCircle } from '../lib/graphLayout';

export function CompetitorGraph({ graph }: { graph: CompetitorGraphView }) {
  if (graph.nodes.length < 2) {
    return <EmptyState title="Not enough competitor mentions" hint="This view needs at least two competitors mentioned in buying signals." />;
  }
  const layout = layoutCircle(graph, 360);
  const positionByName = new Map(layout.nodes.map((node) => [node.competitor, node]));
  const strongest = graph.edges[0];
  const label = strongest
    ? `Competitor co-mentions. Strongest pair: ${strongest.a} and ${strongest.b}, ${strongest.weight} signals.`
    : 'Competitor mentions. No signal mentions two competitors together in this run.';
  return (
    <div className="competitor-graph">
      {graph.sampleData && <p><span className="badge">Sample data</span></p>}
      <svg className="competitor-graph-svg" viewBox="0 0 360 360" role="img" aria-label={label}>
        {layout.edges.map((edge) => {
          const left = positionByName.get(edge.a);
          const right = positionByName.get(edge.b);
          if (!left || !right) return null;
          return <g key={`${edge.a}:${edge.b}`}>
            <line x1={left.x} y1={left.y} x2={right.x} y2={right.y} stroke="var(--accent)" strokeWidth={edge.strokeWidth} opacity="0.7" />
            {edge.weight > 1 && <text x={(left.x + right.x) / 2} y={(left.y + right.y) / 2} className="graph-edge-label">{edge.weight}</text>}
          </g>;
        })}
        {layout.nodes.map((node) => {
          const toRight = node.x <= 180;
          return <g key={node.competitor}>
            <circle cx={node.x} cy={node.y} r={node.radius} fill="var(--surface-raised)" stroke="var(--accent)" strokeWidth="2" />
            <text x={node.x} y={node.y + 4} textAnchor="middle" className="graph-node-count">{node.mentionCount}</text>
            <text x={node.x + (toRight ? node.radius + 5 : -node.radius - 5)} y={node.y + 4} textAnchor={toRight ? 'start' : 'end'} className="graph-node-label">{node.competitor}</text>
          </g>;
        })}
      </svg>
      {graph.edges.length === 0 && <p className="muted">No signal mentions two competitors together in this run.</p>}
      <p className="muted">Counts are signals that mention each competitor. A line means the same signal mentions both.</p>
      <details>
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Competitor pair</th><th>Signals</th></tr></thead>
            <tbody>
              {graph.edges.map((edge) => <tr key={`${edge.a}:${edge.b}`}><td>{edge.a} + {edge.b}</td><td>{edge.weight}</td></tr>)}
              {graph.nodes.map((node) => <tr key={`node:${node.competitor}`}><td>{node.competitor}</td><td>{node.mentionCount} mentions</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
