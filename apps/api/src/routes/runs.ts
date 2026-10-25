import express from 'express';
import { RunCreateRequestSchema } from '@vantage/shared';
import type { DecisionView } from '@vantage/shared';
import type { LeadStore } from '../db/leads';
import { DEMO_RUN_PARAMS, loadDemoSeller } from '../config/demo';
import type { DecisionStore } from '../db/decisions';
import type { SignalJourneyStore } from '../db/signalJourneys';
import { runPipeline } from '../orchestrator/runPipeline';
import type { PipelineDeps } from '../orchestrator/runPipeline';
import { SSE_HEARTBEAT_MS, SSE_MAX_MS, SSE_TICK_MS } from '../config/stream';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createRunsRouter(
  deps: PipelineDeps & { decisionStore?: DecisionStore; leadStore?: LeadStore; signalJourneyStore?: SignalJourneyStore },
  streamTimings: { tickMs?: number; heartbeatMs?: number; maxMs?: number } = {},
): express.Router {
  const router = express.Router();
  const { store } = deps;
  const tickMs = streamTimings.tickMs ?? SSE_TICK_MS;
  const heartbeatMs = streamTimings.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const maxMs = streamTimings.maxMs ?? SSE_MAX_MS;

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

  router.get('/runs/:runId/signals', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }
      const limitValue = req.query.limit ?? '50';
      const offsetValue = req.query.offset ?? '0';
      if (typeof limitValue !== 'string' || !/^\d+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 100 ||
        typeof offsetValue !== 'string' || !/^\d+$/.test(offsetValue) || !Number.isSafeInteger(Number(offsetValue))) {
        res.status(400).json({ error: 'Invalid paging values' });
        return;
      }
      const run = await store.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      if (!deps.signalJourneyStore) {
        res.status(500).json({ error: 'Internal error' });
        return;
      }
      const result = await deps.signalJourneyStore.listRunSignals(runId, Number(limitValue), Number(offsetValue));
      res.status(200).json(result);
    } catch (err) {
      console.error(`GET /runs/:runId/signals failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/runs/:runId/signals/:signalId/trace', async (req, res) => {
    try {
      const { runId, signalId } = req.params;
      if (typeof runId !== 'string' || !UUID_RE.test(runId) || typeof signalId !== 'string' || !UUID_RE.test(signalId)) {
        res.status(400).json({ error: 'Invalid run or signal id' });
        return;
      }
      const run = await store.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      if (!deps.signalJourneyStore) {
        res.status(500).json({ error: 'Internal error' });
        return;
      }
      const journey = await deps.signalJourneyStore.getSignalJourney(runId, signalId);
      if (!journey) {
        res.status(404).json({ error: 'Signal not found in this run' });
        return;
      }
      res.status(200).json({ journey });
    } catch (err) {
      console.error(`GET /runs/:runId/signals/:signalId/trace failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/runs/:runId/events/stream', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (typeof runId !== 'string' || !UUID_RE.test(runId)) {
        res.status(400).json({ error: 'Invalid run id' });
        return;
      }
      const rawAfter = req.query.after;
      let lastId = 0;
      if (rawAfter !== undefined) {
        if (typeof rawAfter !== 'string' || !/^\d+$/.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter))) {
          res.status(400).json({ error: 'Invalid after' });
          return;
        }
        lastId = Number(rawAfter);
      }
      const lastEventId = req.get('Last-Event-ID');
      if (lastEventId && /^\d+$/.test(lastEventId) && Number.isSafeInteger(Number(lastEventId))) {
        lastId = Math.max(lastId, Number(lastEventId));
      }
      const initialRun = await store.getRun(runId);
      if (!initialRun) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      let ended = false;
      let timersCleared = false;
      let ticking = false;
      const cleanup = (): void => {
        if (timersCleared) return;
        timersCleared = true;
        ended = true;
        clearInterval(tickTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(maxTimer);
      };
      const end = (status?: string): void => {
        if (ended) return;
        ended = true;
        cleanup();
        if (status !== undefined && !res.writableEnded) {
          res.write(`event: done\ndata: ${JSON.stringify({ status })}\n\n`);
        }
        if (!res.writableEnded) res.end();
      };
      const sendEvents = async (): Promise<void> => {
        const events = await store.listEvents(runId, lastId);
        for (const event of [...events].sort((left, right) => left.id - right.id)) {
          if (ended) return;
          if (event.id <= lastId) continue;
          res.write(`id: ${event.id}\nevent: run_event\ndata: ${JSON.stringify(event)}\n\n`);
          lastId = event.id;
        }
      };
      const tick = async (): Promise<void> => {
        if (ended || ticking) return;
        ticking = true;
        try {
          await sendEvents();
          const run = await store.getRun(runId);
          if (!run || run.status !== 'running') {
            await sendEvents();
            end(run?.status ?? 'failed');
          }
        } catch (err) {
          console.error(`GET /runs/:runId/events/stream failed: ${errorMessage(err)}`);
          if (!ended) {
            res.write('event: fatal\ndata: {}\n\n');
            end();
          }
        } finally {
          ticking = false;
        }
      };
      const tickTimer = setInterval(() => { void tick(); }, tickMs);
      const heartbeatTimer = setInterval(() => {
        if (!ended) res.write(': keepalive\n\n');
      }, heartbeatMs);
      const maxTimer = setTimeout(() => end(), maxMs);
      res.on('close', cleanup);
      req.on('aborted', cleanup);
      void tick();
    } catch (err) {
      console.error(`GET /runs/:runId/events/stream failed: ${errorMessage(err)}`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
      else res.end();
    }
  });

  router.get('/runs/:runId/requests', async (req, res) => {
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
      const requests = await store.listSourceRequests(runId);
      res.status(200).json({ requests });
    } catch (err) {
      console.error(`GET /runs/:runId/requests failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.get('/runs/:runId/themes', async (req, res) => {
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
      const themes = deps.themes ? await deps.themes.listThemes(runId) : [];
      res.status(200).json({ themes });
    } catch (err) {
      console.error(`GET /runs/:runId/themes failed: ${errorMessage(err)}`);
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
