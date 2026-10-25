import { useCallback, useEffect, useState } from 'react';
import type { ThemeView } from '@vantage/shared';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ThemeCard } from '../components/ThemeCard';
import { getThemes } from '../lib/api';

export function ThemesPage({ runId }: { runId: string }) {
  const [themes, setThemes] = useState<ThemeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setThemes(await getThemes(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId]);
  useEffect(() => { void load(); }, [load]);

  return <ThemesContent runId={runId} themes={themes} loading={loading} error={error} retry={() => void load()} />;
}

export function ThemesContent({ runId, themes, loading, error, retry }: {
  runId: string;
  themes: ThemeView[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  if (loading) return <LoadingState label="Loading competitor themes" />;
  if (error) return <ErrorState title="Could not load competitor themes" message={error} onRetry={retry} />;
  if (themes.length === 0) {
    return <EmptyState title="No competitor themes in this run" hint="Themes need at least 3 complaint signals about the same competitor." action={{ label: 'Back to run', href: `#/runs/${encodeURIComponent(runId)}` }} />;
  }
  return (
    <div className="stack themes-page">
      <a className="back-link" href={`#/runs/${encodeURIComponent(runId)}`}>Back to run</a>
      <header className="page-heading"><p className="eyebrow">RUN THEMES</p><h1 className="page-title">Competitor themes</h1></header>
      {themes.map((theme) => <ThemeCard key={theme.id} theme={theme} />)}
    </div>
  );
}
