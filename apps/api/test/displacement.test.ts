import { describe, expect, it, vi } from 'vitest';
import {
  buildThemeDrafts,
  buildThemeSummary,
  buildThemeTitle,
  createDisplaceStage,
  scoreThemeTerms,
} from '../src/agents/displacement';
import type { ThemeInput } from '../src/agents/displacement';
import type { ThemeStore } from '../src/db/themes';

function item(signalId: string, competitor: string, quote = true): ThemeInput {
  return {
    signalId,
    source: 'hackernews',
    text: 'Acme ticket search stays slow.',
    competitorsMentioned: competitor ? [competitor] : [],
    evidence: quote ? [{ criterion: 'names_competitor', quote: 'Acme ticket search' }] : [],
  };
}

describe('theme term scoring and wording', () => {
  it('scores common member terms with the corpus IDF and deterministic tie order', () => {
    expect(scoreThemeTerms([
      'Acme ticket search stays slow.',
      'Acme ticket search stays slow.',
      'Acme ticket search stays slow.',
    ], [
      'Acme ticket search stays slow.',
      'Acme ticket search stays slow.',
      'Acme ticket search stays slow.',
    ], ['Acme'])).toEqual(['search', 'slow', 'stays', 'ticket']);
    expect(buildThemeTitle('Acme', ['search', 'slow', 'stays', 'ticket'])).toBe('Acme: search, slow, stays');
    expect(buildThemeSummary('Acme', 3, ['search', 'slow', 'stays', 'ticket']))
      .toBe('3 signal(s) complaining about Acme, mentioning: search, slow, stays, ticket.');
    expect(buildThemeTitle('Acme', [])).toBe('Acme: shared complaint');
    expect(buildThemeSummary('Acme', 2, [])).toBe('2 signal(s) complaining about Acme.');
  });
});

describe('buildThemeDrafts', () => {
  it('clusters the primary competitor, skips small groups, ignores missing competitors, and drops clusters without quotes', async () => {
    const inputs = [
      item('a1', 'Acme'), item('a2', 'Acme'), item('a3', 'Acme'),
      item('b1', 'Beta'), item('b2', 'Beta'),
      item('c1', 'Contoso', false), item('c2', 'Contoso', false), item('c3', 'Contoso', false),
      item('ignored', ''),
    ];
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const result = await buildThemeDrafts(inputs, embed);
    expect(result.complaintSignals).toBe(9);
    expect(result.competitors).toBe(2);
    expect(result.skippedCompetitors).toEqual(['Beta']);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      competitor: 'Acme',
      title: 'Acme: search, slow, stays',
      summary: '3 signal(s) complaining about Acme, mentioning: search, slow, stays, ticket.',
      signalIds: ['a1', 'a2', 'a3'],
      quotes: [
        { signalId: 'a1', criterion: 'names_competitor', quote: 'Acme ticket search' },
        { signalId: 'a2', criterion: 'names_competitor', quote: 'Acme ticket search' },
        { signalId: 'a3', criterion: 'names_competitor', quote: 'Acme ticket search' },
      ],
    });
  });

  it('persists generated themes and returns stage counts', async () => {
    const inputs = [item('a1', 'Acme'), item('a2', 'Acme'), item('a3', 'Acme')];
    let savedRun = '';
    let savedCount = 0;
    const store: ThemeStore = {
      async getThemeInputs() { return inputs; },
      async saveThemes(runId, drafts) { savedRun = runId; savedCount = drafts.length; },
      async listThemes() { return []; },
    };
    const stage = createDisplaceStage({ store, embed: async (texts) => texts.map(() => [1, 0]) });
    await expect(stage('run-1')).resolves.toEqual({ complaintSignals: 3, competitors: 1, skippedCompetitors: [], themeCount: 1 });
    expect([savedRun, savedCount]).toEqual(['run-1', 1]);
  });

  it('enforces the configured stage timeout', async () => {
    const store: ThemeStore = {
      async getThemeInputs() { return new Promise<ThemeInput[]>(() => {}); },
      async saveThemes() {},
      async listThemes() { return []; },
    };
    const stage = createDisplaceStage({ store, embed: async () => [], config: { timeoutMs: 1 } });
    await expect(stage('run-1')).rejects.toThrow('Displacement timed out');
  });
});
