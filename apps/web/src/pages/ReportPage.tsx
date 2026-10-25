import { useCallback, useEffect, useState } from 'react';
import type { LeadView, ReportView, ThemeView } from '@vantage/shared';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { ApiError, getReport, getThemes } from '../lib/api';
import { LABEL_TEXT, shortId, SOURCE_LABEL, formatAge } from '../lib/format';
import { ScoreMeter } from '../components/ScoreMeter';
import { LoadingState } from '../components/LoadingState';
import { ThemeCard } from '../components/ThemeCard';

const CRITERION_TEXT: Record<string, string> = {
  states_problem: 'States a problem',
  asks_for_recommendation: 'Asks for a recommendation',
  mentions_team_or_budget: 'Mentions team or budget',
  shows_urgency: 'Shows urgency',
  names_competitor: 'Names a competitor',
};

function isRanked(signal: LeadView): boolean {
  return signal.label === 'buyer_intent' || signal.label === 'competitor_complaint';
}

function RankedSignal({ signal }: { signal: LeadView }) {
  return (
    <tr className="report-signal-row">
      <td className="mono">{signal.rank}</td>
      <td className="report-signal-cell">
        <span className={`badge label-${signal.label}`}>{LABEL_TEXT[signal.label]}</span>
        <p>@{signal.authorHandle} · {SOURCE_LABEL[signal.source]}{signal.community ? ` · ${signal.community}` : ''}</p>
        <p className="report-meta mono">{formatAge(signal.createdAtSource, Date.now())}</p>
        {signal.confidence === 1 ? <p className="verification-note">Quotes verified</p>
          : signal.confidence !== null && signal.confidence < 1 ? <p className="verification-note">Some quotes could not be verified</p> : null}
        {signal.source === 'snapshot'
          ? <p>Sample post (not a real link)</p>
          : <a href={signal.url} target="_blank" rel="noopener noreferrer">Open original post</a>}
      </td>
      <td><ScoreMeter score={signal.score} /></td>
      <td>
        <details className="why-disclosure">
          <summary>Why this rank?</summary>
          <div className="report-why">
            <h4>Reasoning</h4>
            <p>{signal.rationale}</p>
            <h4>Verified evidence</h4>
            {signal.criteria.some((criterion) => criterion.passed && criterion.quote !== null) ? (
              <ul className="report-evidence">
                {signal.criteria.filter((criterion) => criterion.passed && criterion.quote !== null).map((criterion) => (
                  <li key={criterion.id}><span className="evidence-criterion">{CRITERION_TEXT[criterion.id]}</span>
                    {signal.source === 'snapshot'
                      ? <blockquote>“{criterion.quote}”</blockquote>
                      : <a href={signal.url} target="_blank" rel="noopener noreferrer"><blockquote>“{criterion.quote}”</blockquote></a>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No verified evidence quotes.</p>}
            <h4>Score breakdown</h4>
            <div className="table-scroll">
              <table className="score-breakdown-table">
                <thead><tr><th>Component</th><th>Value</th><th>Weight</th><th>Points</th></tr></thead>
                <tbody>
                  {signal.breakdown.components.map((component) => (
                    <tr key={component.name}><td>{component.name}</td><td className="mono">{(component.value * 100).toFixed(0)}%</td><td className="mono">{(component.weight * 100).toFixed(0)}%</td><td className="mono">{component.contribution}</td></tr>
                  ))}
                  <tr><th>Total</th><th colSpan={2}></th><th className="mono">{signal.score}</th></tr>
                </tbody>
              </table>
            </div>
            <p className="report-facts">Competitors mentioned: {signal.enrichment.competitorsMentioned.join(', ') || 'None'} · Purchase terms: {signal.enrichment.purchaseTermsFound.join(', ') || 'None'}</p>
          </div>
        </details>
      </td>
    </tr>
  );
}

export function ReportContent({ report, themes = [], themesError, retryThemes }: {
  report: ReportView;
  themes?: ThemeView[];
  themesError?: string | null;
  retryThemes?: () => void;
}) {
  const rankedSignals = report.signals.filter(isRanked);
  const otherSignals = report.signals.filter((signal) => !isRanked(signal));
  const sourceNames = report.run.sources.map((source) => SOURCE_LABEL[source.source]);
  return (
    <div className="stack report-page">
      {report.summary.sampleData && (
        <div className="report-sample-banner" role="note">
          This report includes synthetic sample data written for testing. Those signals are not real posts.
        </div>
      )}
      <header className="card report-header">
        <h1 className="page-title">Signal report: {report.run.seller.productName}</h1>
        <p>Generated {new Date(report.generatedAt).toLocaleString()}</p>
        <p className="muted">Run {shortId(report.run.id)}</p>
        <p>Search terms: {report.run.params.keywords.join(', ')} · Window: last {report.run.params.sinceDays} days</p>
        <p>Sources: {sourceNames.length ? sourceNames.join(', ') : 'None recorded'}</p>
      </header>

      <section className="card" aria-labelledby="report-summary-title">
        <h2 className="card-title" id="report-summary-title">Summary</h2>
        <dl className="stats">
          <div><dt>Signals found</dt><dd>{report.summary.signalsFound}</dd></div>
          <div><dt>Buying signals</dt><dd>{report.summary.buyingSignals}</dd></div>
          <div><dt>Buyer intent</dt><dd>{report.summary.byLabel.buyer_intent}</dd></div>
        </dl>
        <p>Competitor complaints: {report.summary.byLabel.competitor_complaint} · Venting: {report.summary.byLabel.venting} · Noise: {report.summary.byLabel.noise}</p>
      </section>

      <section className="card" aria-labelledby="report-sources-title">
        <h2 className="card-title" id="report-sources-title">Data sources</h2>
        {report.sources.length === 0 ? <p className="muted">No source request data recorded.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Source</th><th>Requests ok</th><th>Requests failed</th><th>Items returned</th><th>Signals kept</th></tr></thead>
              <tbody>{report.sources.map((source) => <tr key={source.source}>
                <td>{SOURCE_LABEL[source.source]}</td><td>{source.requestsOk}</td><td>{source.requestsFailed}</td>
                <td>{source.itemsReturned}</td><td>{source.signalsKept}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {report.sources.flatMap((source) => source.errors.map((error) => (
          <p className="source-error" key={`${source.source}:${error}`}>{SOURCE_LABEL[source.source]}: {error}</p>
        )))}
      </section>

      <section className="stack" aria-labelledby="ranked-signals-title">
        <h2 className="card-title" id="ranked-signals-title">Ranked signals</h2>
        {rankedSignals.length > 0 ? (
          <div className="table-scroll report-table-scroll">
            <table className="report-table">
              <thead><tr><th scope="col">Rank</th><th scope="col">Signal</th><th scope="col">Score</th><th scope="col">Why</th></tr></thead>
              <tbody>{rankedSignals.map((signal) => <RankedSignal key={signal.leadId} signal={signal} />)}</tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No buying signals in this run" hint="Other signals in this run were classified as venting or noise." action={{ label: 'Review all signals', href: `#/runs/${encodeURIComponent(report.run.id)}/signals` }} />
        )}
      </section>

      {(themes.length > 0 || themesError) && (
        <section className="stack" aria-labelledby="competitor-themes-title">
          <h2 className="card-title" id="competitor-themes-title">Competitor themes</h2>
          {themesError ? <ErrorState title="Could not load competitor themes" message={themesError} onRetry={retryThemes} />
            : themes.map((theme) => <ThemeCard key={theme.id} theme={theme} />)}
        </section>
      )}

      <section className="card" aria-labelledby="other-signals-title">
        <h2 className="card-title" id="other-signals-title">Other signals</h2>
        {otherSignals.length === 0 ? <p className="muted">No other signals. <a href="#ranked-signals-title">Review ranked signals</a></p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Label</th><th>Score</th><th>Source</th><th>Handle</th><th>Age</th><th>Summary</th></tr></thead>
              <tbody>{otherSignals.map((signal) => (
                <tr key={signal.leadId}>
                  <td>{LABEL_TEXT[signal.label]}</td><td>Not ranked</td><td>{SOURCE_LABEL[signal.source]}{signal.source === 'snapshot' && <> · <span className="badge">Sample data</span></>}</td>
                  <td>@{signal.authorHandle}</td><td>{formatAge(signal.createdAtSource, Date.now())}</td><td>{signal.rationale}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card report-method" aria-labelledby="report-method-title">
        <h2 className="card-title" id="report-method-title">How to read this report</h2>
        <p>Buying-intent signals are listed before competitor complaints; within each group, signals are ordered by score.</p>
        <p>Quotes were checked in code against the stored post text. The summary is written by a model and is not evidence. The score combines intent ({Math.round(report.method.weights.intent * 100)}%), fit ({Math.round(report.method.weights.fit * 100)}%), recency ({Math.round(report.method.weights.recency * 100)}%) and engagement ({Math.round(report.method.weights.engagement * 100)}%), with a recency half-life of {report.method.recencyHalfLifeDays} days.</p>
        <p>Vantage shows public posts only and does not provide contact details or send messages.</p>
      </section>

      <div className="report-actions">
        <a className="btn btn-primary" href={`/api/runs/${encodeURIComponent(report.run.id)}/report.csv`}>Download CSV</a>
        <a className="btn btn-secondary" href={`/api/runs/${encodeURIComponent(report.run.id)}/report.csv?include=all`}>Download CSV with all signals</a>
        <button className="btn btn-secondary" type="button" onClick={() => window.print()}>Print or save as PDF</button>
        <a className="btn btn-secondary" href={`#/runs/${encodeURIComponent(report.run.id)}/signals`}>Back to signals</a>
      </div>
    </div>
  );
}

export function ReportPage({ runId }: { runId: string }) {
  const [report, setReport] = useState<ReportView | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [themes, setThemes] = useState<ThemeView[]>([]);
  const [themesError, setThemesError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getReport(runId));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const loadThemes = useCallback(async () => {
    setThemesError(null);
    try {
      setThemes(await getThemes(runId));
    } catch (err) {
      setThemesError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadThemes(); }, [loadThemes]);

  if (loading) {
    return <LoadingState label="Loading report" />;
  }
  if (error instanceof ApiError && error.status === 409) {
    return <div className="card" role="status">The report is available when the run has finished.</div>;
  }
  if (error instanceof ApiError && error.status === 404) {
    return <ErrorState title="Run not found" message="Run not found." onRetry={() => void load()} />;
  }
  if (error) {
    return <ErrorState title="Could not load report" message={error.message} onRetry={() => void load()} />;
  }
  return report ? <ReportContent report={report} themes={themes} themesError={themesError} retryThemes={() => void loadThemes()} /> : null;
}
