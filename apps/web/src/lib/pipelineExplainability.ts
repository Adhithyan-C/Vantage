import type { LeadView, RunEvent, RunView } from '@vantage/shared';

export interface FunnelStep {
  key: 'collected' | 'relevance' | 'classified' | 'buying' | 'ranked' | 'themes';
  label: string;
  count: number | null;
  note: string | null;
}

export interface RunOutcome {
  title: string;
  hint: string;
}

function finalEvent(events: RunEvent[], agent: RunEvent['agent'], prefix: string): RunEvent | undefined {
  return [...events].reverse().find((event) => event.agent === agent &&
    (event.kind === 'info' || event.kind === 'warning') && event.message.startsWith(prefix));
}

function numberCount(event: RunEvent | undefined, key: string): number | null {
  const value = event?.counts?.[key];
  return typeof value === 'number' ? value : null;
}

export function buildFunnel(run: RunView, events: RunEvent[]): FunnelStep[] {
  const scout = [...events].reverse().find((event) => event.agent === 'scout' && typeof event.counts?.afterDedupe === 'number');
  const classifier = finalEvent(events, 'classifier', 'Classified ');
  const relevance = [...events].reverse().find((event) => event.agent === 'scout' &&
    typeof event.counts?.relevanceTotal === 'number');
  const scorer = finalEvent(events, 'scorer', 'Scored ');
  const displacement = [...events].reverse().find((event) => event.agent === 'displacement' &&
    typeof event.counts?.themeCount === 'number');
  const labels = classifier?.counts;
  const buying = typeof labels?.buyer_intent === 'number' && typeof labels.competitor_complaint === 'number'
    ? labels.buyer_intent + labels.competitor_complaint
    : null;
  const cap = events.find((event) => event.agent === 'classifier' && event.kind === 'warning' &&
    event.message.startsWith('Classifying the newest '));
  const failed = numberCount(classifier, 'failed');
  const nonBuying = typeof labels?.venting === 'number' && typeof labels.noise === 'number'
    ? labels.venting + labels.noise
    : null;
  const notes = [
    cap?.message ?? null,
    failed && failed > 0 ? `${failed} classification(s) failed.` : null,
  ].filter((note): note is string => note !== null);
  const ranked = numberCount(scorer, 'ranked');
  const complaintSignals = numberCount(displacement, 'complaintSignals');
  return [
    { key: 'collected', label: 'Collected', count: numberCount(scout, 'afterDedupe') ?? (run.signalCount > 0 ? run.signalCount : null), note: null },
    { key: 'relevance', label: 'Relevant', count: numberCount(relevance, 'eligible'), note: relevance
      ? `${numberCount(relevance, 'excluded') ?? 0} excluded before classification at similarity threshold ${numberCount(relevance, 'threshold') ?? 'unknown'}.`
      : null },
    { key: 'classified', label: 'Classified', count: numberCount(classifier, 'classified'), note: notes.length > 0 ? notes.join(' ') : null },
    { key: 'buying', label: 'Buying signals', count: buying, note: nonBuying !== null && nonBuying > 0
      ? `${labels?.venting} venting and ${labels?.noise} noise signal(s) were not ranked.`
      : null },
    { key: 'ranked', label: 'Ranked', count: ranked, note: buying !== null && ranked !== null && buying > ranked
      ? `${buying - ranked} classified buying signal(s) have no recorded rank.`
      : null },
    { key: 'themes', label: 'Themes', count: numberCount(displacement, 'themeCount'), note: complaintSignals !== null
      ? `${complaintSignals} competitor complaint signal(s) were evaluated for themes.`
      : null },
  ];
}

export function runOutcome(run: RunView, events: RunEvent[], funnel = buildFunnel(run, events)): RunOutcome | null {
  if (run.status === 'running') return null;
  const collected = funnel.find((step) => step.key === 'collected')?.count ?? 0;
  const ranked = funnel.find((step) => step.key === 'ranked')?.count;
  if (collected === 0) {
    if (run.sources.length > 0 && run.sources.every((source) => source.status === 'failed')) {
      return { title: 'Sources could not collect posts', hint: 'Every configured source failed. This run provides no evidence about demand.' };
    }
    const emptySources = run.sources.filter((source) => source.status === 'ok' && source.fetchedCount === 0);
    if (emptySources.length > 0) {
      return { title: 'No matching posts were returned', hint: `${emptySources.map((source) => source.source).join(', ')} returned no posts for this search. An empty result is not evidence of no demand.` };
    }
    return { title: 'No posts were collected', hint: 'The available source results did not produce a stored signal. This is not evidence of no demand.' };
  }
  const failedStage = events.find((event) => event.kind === 'error');
  if (failedStage) {
    return { title: 'A pipeline stage failed', hint: `${failedStage.agent}: ${failedStage.message}. Collected signals and completed stage output remain available below.` };
  }
  const cap = events.find((event) => event.agent === 'classifier' && event.kind === 'warning' && event.message.startsWith('Classifying the newest '));
  if (cap) {
    return { title: 'Classification was capped', hint: `${cap.message}. Review the collected posts or change keywords for another run.` };
  }
  if (ranked === 0) {
    const classified = funnel.find((step) => step.key === 'classified')?.count;
    return classified === null || classified === undefined
      ? { title: 'Posts were collected, but none were ranked', hint: 'No completed classifier and scorer counts are recorded for this run. This is not evidence of no demand.' }
      : { title: 'Posts were collected, but none were ranked', hint: 'The recorded labels did not produce ranked buying signals. This is not evidence of no demand.' };
  }
  if (run.status === 'completed_with_warnings') {
    return { title: 'Run completed with warnings', hint: 'Some recorded source or stage work was incomplete. Open Diagnostics to review the details.' };
  }
  return null;
}

export function criticReviewSpread(leads: LeadView[]): Record<'supported' | 'weak' | 'unsupported', number> {
  const spread = { supported: 0, weak: 0, unsupported: 0 };
  for (const lead of leads) {
    const trace = lead.criticTrace;
    if (trace?.status !== 'ok') continue;
    const verdict = trace.output.verdict;
    if (verdict === 'supported' || verdict === 'weak' || verdict === 'unsupported') spread[verdict] += 1;
  }
  return spread;
}
