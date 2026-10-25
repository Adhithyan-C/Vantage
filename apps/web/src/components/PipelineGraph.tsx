import type { AgentId, RunEvent, RunStatus } from '@vantage/shared';
import { stageStatus } from '../lib/stages';

const STAGES: Array<{ agent: Exclude<AgentId, 'orchestrator'>; name: string }> = [
  { agent: 'scout', name: 'Scout' },
  { agent: 'classifier', name: 'Classifier' },
  { agent: 'critic', name: 'Critic' },
  { agent: 'enricher', name: 'Enricher' },
  { agent: 'scorer', name: 'Scorer' },
  { agent: 'displacement', name: 'Displacement' },
];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function PipelineGraph({ runStatus, events, motionReduced }: { runStatus: RunStatus; events: RunEvent[]; motionReduced?: boolean }) {
  const stages = STAGES.map((stage) => ({
    ...stage,
    status: stageStatus(stage.agent, events, runStatus),
  }));
  const ariaLabel = stages.map((stage) => `${stage.name}: ${stage.status.label}`).join('; ');
  const noMotion = motionReduced ?? reducedMotion();
  return (
    <section className="card pipeline-graph-card" aria-labelledby="live-pipeline-title">
      <h2 id="live-pipeline-title" className="card-title">Live pipeline</h2>
      <div className="pipeline-graph-scroll">
        <svg className="pipeline-graph-svg" viewBox="0 0 900 190" role="img" aria-label={ariaLabel}>
          <defs>
            <marker id="pipeline-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="currentColor" />
            </marker>
          </defs>
          {stages.slice(0, -1).map((stage, index) => {
            const next = stages[index + 1];
            if (!next) return null;
            const active = stage.status.state === 'completed' && next.status.state === 'running';
            const startX = index * 154 + 130;
            const endX = startX + 24;
            return <line key={`${stage.agent}:${next.agent}`} className={`pipeline-graph-edge${active ? ' is-active' : ''}`}
              x1={startX} y1="95" x2={endX} y2="95" markerEnd="url(#pipeline-arrow)" />;
          })}
          {stages.map((stage, index) => {
            const x = index * 154;
            const animate = stage.status.state === 'running' && !noMotion;
            const duration = stage.status.durationMs === null ? null : `${(stage.status.durationMs / 1000).toFixed(1)} s`;
            return <g key={stage.agent} className={`pipeline-graph-node state-${stage.status.state}${animate ? ' is-pulsing' : ''}`}>
              <rect x={x} y="28" width="130" height="134" rx="10" />
              <text x={x + 65} y="54" textAnchor="middle" className="pipeline-graph-name">{stage.name}</text>
              <text x={x + 65} y="80" textAnchor="middle" className="pipeline-graph-state">{stage.status.label}</text>
              {stage.status.summary && <text x={x + 65} y="106" textAnchor="middle" className="pipeline-graph-summary">{stage.status.summary}</text>}
              {duration && <text x={x + 65} y="130" textAnchor="middle" className="pipeline-graph-duration">{duration}</text>}
            </g>;
          })}
        </svg>
      </div>
    </section>
  );
}
