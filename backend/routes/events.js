/**
 * POST /api/events — point d'entrée frontend de l'instrumentation produit.
 *
 * Fire-and-forget côté client (trackEvent dans api-client.js). Validation
 * stricte : nom d'événement [a-z0-9_], metadata < 2 ko. On répond 204 même
 * quand l'insert échoue — l'analytics ne doit jamais faire de bruit côté UX.
 */

const { Router } = require('express');
const { track, EVENT_RE } = require('../lib/track');

const router = Router();

router.post('/', async (req, res) => {
  const { event, metadata } = req.body || {};

  if (typeof event !== 'string' || !EVENT_RE.test(event)) {
    return res.status(400).json({ error: 'invalid event name' });
  }
  let meta = null;
  if (metadata !== undefined && metadata !== null) {
    const raw = JSON.stringify(metadata);
    if (typeof metadata !== 'object' || raw.length > 2048) {
      return res.status(400).json({ error: 'invalid metadata' });
    }
    meta = metadata;
  }

  await track(req.user.id, event, meta);
  res.json({ ok: true });
});

module.exports = router;
