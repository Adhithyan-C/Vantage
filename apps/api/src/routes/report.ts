import express from 'express';
import type { LeadLabel, ReportView } from '@vantage/shared';
import { SCORE_WEIGHTS, RECENCY_HALF_LIFE_DAYS } from '../config/scoring';
import { promptVersion } from '../config/llm';
import type { LeadStore } from '../db/leads';
import type { RunStore } from '../db/runs';
import { buildReportCsv } from '../report/csv';
import { sanitizeRequestError } from '../utils/redact';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABELS: LeadLabel[] = ['buyer_intent', 'competitor_complaint', 'venting', 'noise'];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function buildReport(
  runStore: RunStore,
  leadStore: LeadStore,
  runId: string,
): Promise<ReportView | 'not_found' | 'running'> {
  const run = await runStore.getRun(runId);
  if (!run) {
    return 'not_found';
  }
  if (run.status === 'running') {
    return 'running';
  }
  const signals = await leadStore.listLeads(runId, true);
  const requests = await runStore.listSourceRequests(runId);
  const byLabel: Record<LeadLabel, number> = {
    buyer_intent: 0,
    competitor_complaint: 0,
    venting: 0,
    noise: 0,
  };
  for (const signal of signals) {
    byLabel[signal.label] += 1;
  }
  const bySource: Record<string, number> = {};
  for (const signal of signals) bySource[signal.source] = (bySource[signal.source] ?? 0) + 1;
  const sources = [...new Set([...requests.map((request) => request.source), ...signals.map((signal) => signal.source)])]
    .map((source) => {
      const sourceRequests = requests.filter((request) => request.source === source);
      const errors = [...new Set(sourceRequests.flatMap((request) => request.error ? [sanitizeRequestError(request.error)] : []))].slice(0, 5);
      return {
        source,
        requestsOk: sourceRequests.filter((request) => request.status === 'ok').length,
        requestsFailed: sourceRequests.filter((request) => request.status === 'failed').length,
        itemsReturned: sourceRequests.reduce((total, request) => total + request.itemsReturned, 0),
        signalsKept: signals.filter((signal) => signal.source === source).length,
        errors,
      };
    });
  return {
    generatedAt: new Date().toISOString(),
    run,
    summary: {
      signalsFound: signals.length,
      buyingSignals: byLabel.buyer_intent + byLabel.competitor_complaint,
      byLabel,
      bySource,
      sampleData: run.params.sources?.includes('snapshot') === true ||
        run.sources.some((source) => source.source === 'snapshot') ||
        signals.some((signal) => signal.source === 'snapshot'),
    },
    sources,
    method: {
      weights: SCORE_WEIGHTS,
      recencyHalfLifeDays: RECENCY_HALF_LIFE_DAYS,
      promptVersion,
    },
    signals: signals.filter((signal) => LABELS.includes(signal.label)),
  };
}

export function createReportRouter(deps: { runStore: RunStore; leadStore: LeadStore }): express.Router {
  const router = express.Router();

  router.get('/runs/:runId/report.json', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }
      const report = await buildReport(deps.runStore, deps.leadStore, runId);
      if (report === 'not_found') {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      if (report === 'running') {
        res.status(409).json({ error: 'Run is still running' });
        return;
      }
      res.status(200).json(report);
    } catch (err) {
      console.error(`GET /runs/:runId/report.json failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/runs/:runId/report.csv', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }
      const include = req.query.include;
      if (include !== undefined && (typeof include !== 'string' || include !== 'all')) {
        res.status(400).json({ error: 'Invalid include' });
        return;
      }
      const report = await buildReport(deps.runStore, deps.leadStore, runId);
      if (report === 'not_found') {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      if (report === 'running') {
        res.status(409).json({ error: 'Run is still running' });
        return;
      }
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="vantage-report-${runId.slice(0, 8)}.csv"`);
      res.status(200).send(buildReportCsv(report, include === 'all'));
    } catch (err) {
      console.error(`GET /runs/:runId/report.csv failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
