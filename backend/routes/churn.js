/**
 * Churn Outcomes Routes
 *
 * POST /api/churn/outcomes         — Log one outcome (true_positive/false_positive/false_negative)
 * POST /api/churn/outcomes/import  — Bulk-import a historical seed list of past churns
 * GET  /api/churn/outcomes         — List outcomes for audit/review
 *
 * The churn list/summary itself is served by existing routes (dashboard/opportunities,
 * crm/churn/score, crm/churn/summary) — this file only covers the feedback-loop surface.
 */

const { Router } = require('express');
const db = require('../db');

const router = Router();

const OUTCOME_TYPES = ['true_positive', 'false_positive', 'false_negative'];
const REASON_CATEGORIES = ['prix', 'concurrent', 'support', 'produit_inadapte', 'budget_coupe', 'autre'];

function validateOutcome(o) {
  if (!o || typeof o !== 'object') return 'Invalid outcome';
  if (!OUTCOME_TYPES.includes(o.outcomeType)) return `outcomeType must be one of: ${OUTCOME_TYPES.join(', ')}`;
  if (o.reasonCategory && !REASON_CATEGORIES.includes(o.reasonCategory)) return `reasonCategory must be one of: ${REASON_CATEGORIES.join(', ')}`;
  return null;
}

async function insertOutcome(userId, o) {
  let predictedScore = null;
  if (o.opportunityId) {
    const opp = await db.query('SELECT churn_score FROM opportunities WHERE id = $1 AND user_id = $2', [o.opportunityId, userId]);
    predictedScore = opp.rows[0]?.churn_score ?? null;
  }

  const result = await db.query(
    `INSERT INTO churn_outcomes (opportunity_id, user_id, client_name, client_email, outcome_type, reason_category, reason_text, predicted_score_at_time, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      o.opportunityId || null,
      userId,
      o.clientName || null,
      o.clientEmail || null,
      o.outcomeType,
      o.reasonCategory || null,
      o.reasonText || null,
      predictedScore,
      o.occurredAt || null,
    ]
  );
  return result.rows[0];
}

// POST /api/churn/outcomes — log one outcome
router.post('/outcomes', async (req, res, next) => {
  try {
    const err = validateOutcome(req.body);
    if (err) return res.status(400).json({ error: err });

    const outcome = await insertOutcome(req.user.id, req.body);
    res.json({ outcome });
  } catch (err) {
    next(err);
  }
});

// POST /api/churn/outcomes/import — bulk historical seed list
router.post('/outcomes/import', async (req, res, next) => {
  try {
    const { outcomes } = req.body;
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      return res.status(400).json({ error: 'outcomes must be a non-empty array' });
    }

    const inserted = [];
    const errors = [];
    for (let i = 0; i < outcomes.length; i++) {
      const err = validateOutcome(outcomes[i]);
      if (err) { errors.push({ index: i, error: err }); continue; }
      try {
        inserted.push(await insertOutcome(req.user.id, outcomes[i]));
      } catch (e) {
        errors.push({ index: i, error: e.message });
      }
    }

    res.json({ imported: inserted.length, outcomes: inserted, errors });
  } catch (err) {
    next(err);
  }
});

// GET /api/churn/outcomes — list for audit/review
router.get('/outcomes', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const result = await db.query(
      `SELECT * FROM churn_outcomes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ outcomes: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
