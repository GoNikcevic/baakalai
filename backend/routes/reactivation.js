/**
 * Reactivation Routes — on-demand queue + draft generation for
 * "Deals à relancer" (kind=deal_reactivation) and "Clients à upseller" (kind=auto_upsell).
 *
 * GET   /api/reactivation/queue?kind=&sort=        — list candidates (no AI call)
 * GET   /api/reactivation/:opportunityId/draft?kind=&force=  — generate/fetch a draft on demand
 * PATCH /api/reactivation/emails/:nurtureEmailId    — save edits to a pending draft
 * POST  /api/reactivation/:opportunityId/postpone   — set the planned follow-up date ("Reporter")
 *
 * Sending/cancelling a draft reuses the existing /api/nurture/emails/:id/approve and /cancel
 * routes unchanged.
 */

const { Router } = require('express');
const db = require('../db');
const { listDealsToReactivate, listClientsToUpsell, postponeOpportunity, getHistory } = require('../lib/reactivation-queue');
const dealCoach = require('../lib/agents/deal-coach');
const upsellDetector = require('../lib/agents/upsell-detector');

const router = Router();

const VALID_KINDS = ['deal_reactivation', 'auto_upsell'];

function validateKind(kind) {
  return VALID_KINDS.includes(kind);
}

// GET /api/reactivation/queue?kind=&sort=
router.get('/queue', async (req, res, next) => {
  try {
    const { kind, sort } = req.query;
    if (!validateKind(kind)) return res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });

    const candidates = kind === 'deal_reactivation'
      ? await listDealsToReactivate(req.user.id, sort)
      : await listClientsToUpsell(req.user.id, sort);

    res.json({ candidates });
  } catch (err) {
    next(err);
  }
});

// GET /api/reactivation/history?kind=
router.get('/history', async (req, res, next) => {
  try {
    const { kind } = req.query;
    if (!validateKind(kind)) return res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });

    const events = await getHistory(req.user.id, kind);
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// GET /api/reactivation/:opportunityId/draft?kind=&force=
router.get('/:opportunityId/draft', async (req, res, next) => {
  try {
    const { kind, force } = req.query;
    const { opportunityId } = req.params;
    if (!validateKind(kind)) return res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });

    const existing = await db.query(
      `SELECT * FROM nurture_emails
       WHERE user_id = $1 AND opportunity_id = $2 AND status = 'pending' AND metadata ->> 'chain' = $3
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, opportunityId, kind]
    );
    if (existing.rows[0] && force !== 'true') return res.json({ email: existing.rows[0] });

    const draft = kind === 'deal_reactivation'
      ? await dealCoach.coachAndDraftOne(req.user.id, opportunityId)
      : await upsellDetector.draftOne(req.user.id, opportunityId);

    if (draft.error) return res.status(400).json({ error: draft.error });

    const opp = draft.opportunity;
    const metadata = kind === 'deal_reactivation'
      ? { chain: kind, reason: draft.reason, urgency: draft.urgency }
      : { chain: kind, cross_sell_products: draft.crossSellProducts };

    let email;
    if (existing.rows[0]) {
      // Regenerating (force=true) — overwrite the existing pending row rather than
      // accumulating a duplicate, keeping the same id (and any existing chain-execution link).
      const updated = await db.query(
        `UPDATE nurture_emails SET subject = $1, body = $2, pattern_ids = $3, metadata = $4
         WHERE id = $5 RETURNING *`,
        [draft.subject, draft.body, draft.patternIds || [], JSON.stringify(metadata), existing.rows[0].id]
      );
      email = updated.rows[0];
    } else {
      const inserted = await db.query(
        `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, to_name, subject, body, status, pattern_ids, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
         RETURNING *`,
        [req.user.id, opportunityId, opp.email, opp.name, draft.subject, draft.body, draft.patternIds || [], JSON.stringify(metadata)]
      );
      email = inserted.rows[0];

      await db.query(
        `INSERT INTO agent_chain_executions (user_id, chain_type, trigger_agent, trigger_data, steps_completed, result, status, nurture_email_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
        [
          req.user.id, kind, kind === 'deal_reactivation' ? 'deal_coach' : 'upsell_detector',
          JSON.stringify({ opportunityId }), ['draft_on_demand'],
          JSON.stringify({ subject: draft.subject, contact: opp.name }), email.id,
        ]
      );
    }

    res.json({ email });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reactivation/emails/:nurtureEmailId
router.patch('/emails/:nurtureEmailId', async (req, res, next) => {
  try {
    const { subject, body } = req.body;
    if (!subject && !body) return res.status(400).json({ error: 'subject or body required' });

    const sets = [];
    const values = [req.user.id, req.params.nurtureEmailId];
    if (subject !== undefined) { sets.push(`subject = $${values.length + 1}`); values.push(subject); }
    if (body !== undefined) { sets.push(`body = $${values.length + 1}`); values.push(body); }

    const result = await db.query(
      `UPDATE nurture_emails SET ${sets.join(', ')}
       WHERE user_id = $1 AND id = $2 AND status = 'pending'
       RETURNING *`,
      [...values]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Email not found or already processed' });

    res.json({ email: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/reactivation/:opportunityId/postpone
router.post('/:opportunityId/postpone', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || isNaN(new Date(date).getTime())) return res.status(400).json({ error: 'A valid date is required' });

    const result = await postponeOpportunity(req.user.id, req.params.opportunityId, date);
    if (!result) return res.status(404).json({ error: 'Opportunity not found' });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
