import { EmptyState } from '../components/EmptyState';
import { RunPage } from '../pages/RunPage';
import { SetupPage } from '../pages/SetupPage';
import { InboxPage } from '../pages/InboxPage';
import { SignalDetailPage } from '../pages/SignalDetailPage';
import { ReportPage } from '../pages/ReportPage';
import { DemoBanner } from '../components/DemoBanner';
import { useRoute } from './routes';

export function App() {
  const route = useRoute();

  return (
    <div className="app">
      <DemoBanner />
      <header className="app-header">
        <a className="brand" href="#/">
          Vantage
        </a>
        <span className="tagline">Public buying signals, with the evidence shown</span>
        <nav aria-label="Main">
          <a className="nav-link" href="#/">
            New search
          </a>
        </nav>
      </header>

      <main className="app-main">
        {route.name === 'setup' && <SetupPage />}
        {route.name === 'run' && <RunPage key={route.runId} runId={route.runId} />}
        {route.name === 'signals' && <InboxPage key={route.runId} runId={route.runId} />}
        {route.name === 'signal' && (
          <SignalDetailPage key={route.leadId} runId={route.runId} leadId={route.leadId} />
        )}
        {route.name === 'report' && <ReportPage key={route.runId} runId={route.runId} />}
        {route.name === 'not-found' && (
          <EmptyState
            title="Page not found"
            hint="Go back to the search form to start a new run."
          />
        )}
      </main>

      <AppFooter />
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
