import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ThemeView } from '@vantage/shared';
import { ThemesContent } from './ThemesPage';

const runId = '00000000-0000-0000-0000-000000000001';
const theme: ThemeView = { id: 't', runId, competitor: 'Acme', title: 'Acme: slow', summary: '3 signals', quotes: [], members: [], sampleData: false };

describe('ThemesPage states', () => {
  it('shows loading state', () => {
    expect(renderToString(<ThemesContent runId={runId} themes={[]} loading error={null} retry={() => {}} />)).toContain('Loading competitor themes');
  });
  it('shows retryable error state', () => {
    const html = renderToString(<ThemesContent runId={runId} themes={[]} loading={false} error="offline" retry={() => {}} />);
    expect(html).toContain('Could not load competitor themes');
    expect(html).toContain('offline');
    expect(html).toContain('Try again');
  });
  it('shows empty guidance and renders themes when present', () => {
    const empty = renderToString(<ThemesContent runId={runId} themes={[]} loading={false} error={null} retry={() => {}} />);
    expect(empty).toContain('No competitor themes in this run');
    expect(empty).toContain('Themes need at least 3 complaint signals about the same competitor.');
    const populated = renderToString(<ThemesContent runId={runId} themes={[theme]} loading={false} error={null} retry={vi.fn()} />);
    expect(populated).toContain('Acme: slow');
  });
});
