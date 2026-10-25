import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ThemeView } from '@vantage/shared';
import { ThemeCard } from './ThemeCard';

const theme: ThemeView = {
  id: 'theme-1', runId: '00000000-0000-0000-0000-000000000001', competitor: 'Acme',
  title: 'Acme: slow search', summary: '3 signal(s) complaining about Acme, mentioning: slow, search.',
  quotes: [
    { signalId: 'signal-1', criterion: 'names_competitor', quote: 'Acme search is slow.' },
    { signalId: 'signal-2', criterion: 'states_problem', quote: 'Search takes too long.' },
    { signalId: 'signal-3', criterion: 'shows_urgency', quote: 'We need it fixed now.' },
    { signalId: 'signal-4', criterion: 'states_problem', quote: 'A fourth quote is hidden.' },
  ],
  members: [{ signalId: 'signal-1', leadId: 'lead-1' }, { signalId: 'signal-2', leadId: null }, { signalId: 'signal-3', leadId: null }],
  sampleData: true,
};

describe('ThemeCard', () => {
  it('renders summary, up to three labelled quotes, linked evidence and sample badge', () => {
    const html = renderToString(<ThemeCard theme={theme} />);
    expect(html).toContain('Acme: slow search');
    expect(html).toMatch(/3(?:<!-- -->)? signals/);
    expect(html).toContain('Names a competitor');
    expect(html).toContain('#/runs/00000000-0000-0000-0000-000000000001/signals/lead-1');
    expect(html).toContain('Sample data');
    expect(html).not.toContain('A fourth quote is hidden');
    expect(html).toContain('not proof of intent');
  });
});
