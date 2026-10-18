import express from 'express';
import { FeedbackRequestSchema } from '@vantage/shared';
import type { LeadStore } from '../db/leads';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createLeadsRouter(deps: { store: LeadStore }): express.Router {
  const router = express.Router();

  router.get('/leads/:leadId', async (req, res) => {
    try {
      const leadId = req.params.leadId;
      if (typeof leadId !== 'string' || !UUID_RE.test(leadId)) {
        res.status(400).json({ error: 'Invalid lead id' });
        return;
      }
      const detail = await deps.store.getLeadDetail(leadId);
      if (!detail) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.status(200).json({ detail });
    } catch (err) {
      console.error(`GET /leads/:leadId failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.post('/leads/:leadId/feedback', async (req, res) => {
    try {
      const leadId = req.params.leadId;
      if (typeof leadId !== 'string' || !UUID_RE.test(leadId)) {
        res.status(400).json({ error: 'Invalid lead id' });
        return;
      }
      const parsed = FeedbackRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
        return;
      }
      const status = ({ accept: 'accepted', reject: 'rejected', reset: 'new' } as const)[parsed.data.action];
      if (!(await deps.store.setLeadStatus(leadId, status))) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      await deps.store.addFeedback(leadId, parsed.data.action);
      res.status(200).json({ status });
    } catch (err) {
      console.error(`POST /leads/:leadId/feedback failed: ${errorMessage(err)}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
