/**
 * Instrumentation produit — écriture best-effort dans product_events.
 *
 * Répond à une seule question : où les beta testers décrochent-ils entre le
 * signup et la première valeur ? Lecture via scripts/funnel-report.js.
 *
 * Contrat : track() ne lève JAMAIS — un événement perdu vaut mieux qu'un
 * signup qui échoue à cause de l'analytics.
 */

const db = require('../db');

const EVENT_RE = /^[a-z0-9_]{1,64}$/;

async function track(userId, event, metadata = null) {
  try {
    if (!EVENT_RE.test(event)) {
      console.warn('[track] nom d\'événement invalide, ignoré:', event);
      return;
    }
    await db.query(
      'INSERT INTO product_events (user_id, event, metadata) VALUES ($1, $2, $3)',
      [userId || null, event, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.warn('[track]', event, err.message);
  }
}

module.exports = { track, EVENT_RE };
