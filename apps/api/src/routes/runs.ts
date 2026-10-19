import express from 'express';
import { RunCreateRequestSchema } from '@vantage/shared';
import type { DecisionView } from '@vantage/shared';
import type { LeadStore } from '../db/leads';
import { DEMO_RUN_PARAMS, loadDemoSeller } from '../config/demo';
import type { DecisionStore } from '../db/decisions';
import { runPipeline } from '../orchestrator/runPipeline';
import type { PipelineDeps } from '../orchestrator/runPipeline';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createRunsRouter(
  deps: PipelineDeps & { decisionStore?: DecisionStore; leadStore?: LeadStore },
): express.Router {
  const router = express.Router();
  const { store } = deps;

  router.post('/runs', async (req, res) => {
    try {
      const parsed = RunCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.map((part) => String(part)).join('.')}: ${issue.message}`,
        );
        res.status(400).json({ error: 'Invalid request', issues });
        return;
      }

      const { seller, params } = parsed.data;
      const unavailableSource = deps.demoMode ? undefined : params.sources?.find(
        (source) => !deps.adapters.some((adapter) => adapter.id === source),
      );
      if (unavailableSource) {
        res.status(400).json({
          error: 'Invalid request',
          issues: [`params.sources: ${unavailableSource} is not available`],
        });
        return;
      }
      try {
        const sellerId = await store.createSellerProfile(seller);
        const runId = await store.createRun(sellerId, params);
        res.status(202).json({ runId });
        void (deps.runner ?? runPipeline)(deps, runId, params).catch((err: unknown) => {
          console.error(`Pipeline error: ${errorMessage(err)}`);
        });
      } catch (err) {
        console.error(`Could not create run: ${errorMessage(err)}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Could not create run' });
        }
      }
    } catch (err) {
      console.error(`POST /runs failed: ${errorMessage(err)}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error' });
      }
    }
  });

  router.get('/runs/:runId', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }
      const run = await store.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.status(200).json(run);
    } catch (err) {
      console.error(`GET /runs/:runId failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/runs/:runId/events', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }

      const rawAfter = req.query.after;
      let after = 0;
      if (rawAfter !== undefined) {
        if (typeof rawAfter !== 'string' || !/^\d+$/.test(rawAfter)) {
          res.status(400).json({ error: 'Invalid after' });
          return;
        }
        after = Number.parseInt(rawAfter, 10);
      }

      const events = await store.listEvents(runId, after);
      res.status(200).json({ events });
    } catch (err) {
      console.error(`GET /runs/:runId/events failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  if (!deps.demoMode) router.get('/runs/:runId/decisions', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }
      if (!deps.decisionStore) {
        res.status(500).json({ error: 'Internal error' });
        return;
      }
      const decisions: DecisionView[] = await deps.decisionStore.listDecisions(runId);
      res.status(200).json({ decisions });
    } catch (err) {
      console.error(`GET /runs/:runId/decisions failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/runs/:runId/leads', async (req, res) => {
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
      if (!deps.leadStore) {
        res.status(500).json({ error: 'Internal error' });
        return;
      }
      const leads = await deps.leadStore.listLeads(runId, include === 'all');
      res.status(200).json({ leads });
    } catch (err) {
      console.error(`GET /runs/:runId/leads failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/demo-seller', (_req, res) => {
    try {
      res.status(200).json({ seller: loadDemoSeller(), params: DEMO_RUN_PARAMS });
    } catch (err) {
      console.error(`GET /demo-seller failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
