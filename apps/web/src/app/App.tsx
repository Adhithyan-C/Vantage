import { EmptyState } from '../components/EmptyState';
import { RunPage } from '../pages/RunPage';
import { SetupPage } from '../pages/SetupPage';
import { InboxPage } from '../pages/InboxPage';
import { SignalDetailPage } from '../pages/SignalDetailPage';
import { ReportPage } from '../pages/ReportPage';
import { ThemesPage } from '../pages/ThemesPage';
import { DemoBanner } from '../components/DemoBanner';
import { useRoute } from './routes';

type NavigationIcon = 'search' | 'run' | 'signals' | 'report' | 'themes';

function NavigationGlyph({ name }: { name: NavigationIcon }) {
  const paths: Record<NavigationIcon, string> = {
    search: 'M11 19a8 8 0 1 1 5.66-2.34L21 21M11 7v8M7 11h8',
    run: 'M5 4.5v15l14-7.5-14-7.5Z',
    signals: 'M4 19V5m0 14h16M8 15l3-4 3 2 5-7',
    report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
    themes: 'M4 5h6v6H4zM14 5h6v6h-6zM9 14h6v6H9zM10 8h4M7 11v3h5',
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

export function App() {
  const route = useRoute();
  const currentRunId = 'runId' in route ? route.runId : null;
  const currentPage = route.name === 'setup' ? 'New search'
    : route.name === 'run' ? 'Run overview'
      : route.name === 'signals' || route.name === 'signal' ? 'Signal inbox'
        : route.name === 'report' ? 'Report' : route.name === 'themes' ? 'Competitor themes' : 'Page not found';
  const runPath = currentRunId ? `/runs/${encodeURIComponent(currentRunId)}` : null;
  const navItem = (label: string, icon: NavigationIcon, href: string, active: boolean) => (
    <a className={`sidebar-link${active ? ' is-active' : ''}`} href={href} aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
      <NavigationGlyph name={icon} />
      <span className="sidebar-label">{label}</span>
    </a>
  );

  return (
    <div className="app">
      <DemoBanner />
      <div className="app-layout">
        <aside className="app-sidebar">
          <a className="brand" href="#/" aria-label="Vantage home">
            <span className="brand-mark" aria-hidden="true">V</span>
            <span className="brand-name">Vantage</span>
          </a>
          <p className="sidebar-caption">SIGNAL INTELLIGENCE</p>
          <nav className="sidebar-nav" aria-label="Main navigation">
            {navItem('New search', 'search', '#/', route.name === 'setup')}
            {runPath && <>
              {navItem('Run overview', 'run', `#${runPath}`, route.name === 'run')}
              {navItem('Signal inbox', 'signals', `#${runPath}/signals`, route.name === 'signals' || route.name === 'signal')}
              {navItem('Report', 'report', `#${runPath}/report`, route.name === 'report')}
              {navItem('Competitor themes', 'themes', `#${runPath}/themes`, route.name === 'themes')}
            </>}
          </nav>
          <div className="sidebar-footnote">
            <span className="sidebar-live-dot" aria-hidden="true" />
            <span>Public signals · evidence shown</span>
          </div>
        </aside>

        <div className="app-workspace">
          <header className="workspace-header">
            <div className="workspace-crumb"><span>WORKSPACE</span><span aria-hidden="true">/</span><strong>{currentPage}</strong></div>
            {route.name !== 'setup' && <a className="btn btn-secondary header-action" href="#/">New search</a>}
          </header>
          <main className="app-main">
            <div className="page-transition" key={`${route.name}:${currentRunId ?? ''}`}>
              {route.name === 'setup' && <SetupPage />}
              {route.name === 'run' && <RunPage key={route.runId} runId={route.runId} />}
              {route.name === 'signals' && <InboxPage key={route.runId} runId={route.runId} />}
              {route.name === 'signal' && (
                <SignalDetailPage key={route.leadId} runId={route.runId} leadId={route.leadId} />
              )}
              {route.name === 'report' && <ReportPage key={route.runId} runId={route.runId} />}
              {route.name === 'themes' && <ThemesPage key={route.runId} runId={route.runId} />}
              {route.name === 'not-found' && (
                <EmptyState
                  title="Page not found"
                  hint="Return to search to start a run."
                  action={{ label: 'Start a new search', href: '#/' }}
                />
              )}
            </div>
          </main>
          <AppFooter />
        </div>
      </div>
    </div>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <p>Vantage finds public signals. It does not provide contact details or send messages.</p>
      <p>
        Hacker News data: <a href="https://hn.algolia.com">Search by Algolia</a>
      </p>
      <p>Stack Exchange user contributions are licensed under applicable CC BY-SA terms; each signal links to its source and shows its author.</p>
    </footer>
  );
}
