/**
 * Priorities — la liste unifiée « À traiter aujourd'hui ».
 * L'agrégation et le barème vivent dans lib/priorities.js (partagés avec le
 * digest email hebdo, orchestrator/jobs/crm-digest.js).
 */

const express = require('express');
const router = express.Router();
const { buildTodayList } = require('../lib/priorities');

const MAX_ITEMS = 15;

// GET /api/priorities/today
router.get('/today', async (req, res, next) => {
  try {
    const list = await buildTodayList(req.user.id);
    res.json({
      items: list.items.slice(0, MAX_ITEMS),
      counts: list.counts,
      pendingEmailIds: list.pendingEmailIds,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/priorities/digest/test — s'envoyer le digest hebdo tout de suite
// (prévisualisation réelle : même rendu, même canal que le cron du lundi).
router.post('/digest/test', async (req, res, next) => {
  try {
    const { sendDigestToUser } = require('../orchestrator/jobs/crm-digest');
    const result = await sendDigestToUser(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
