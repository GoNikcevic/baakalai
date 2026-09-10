/**
 * Priorities — endpoints autour du barème unifié de lib/priorities.js
 * (partagé avec le digest email hebdo, orchestrator/jobs/crm-digest.js).
 * L'ancienne route GET /today (widget "À traiter aujourd'hui" du Dashboard)
 * a été retirée — son contenu vit désormais scopé dans les onglets
 * Deals/Clients du Dashboard, et sa partie emails en attente faisait doublon
 * avec Activation → En attente.
 */

const express = require('express');
const router = express.Router();

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
