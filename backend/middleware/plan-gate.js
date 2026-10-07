/**
 * Paywall / gating par palier de plan.
 *
 * Permissif par conception tant que STRIPE_SECRET_KEY est absente : rien ne
 * change pour les comptes actuels avant le branchement du billing. Les comptes
 * avec trial_ends_at NULL (fondateurs, beta gratuits) ne sont jamais bloqués.
 *
 * requireActivePlan() · bloque (402) quand l'essai est expiré sans abonnement.
 *
 * Non câblé par défaut : le choix des routes à protéger est un arbitrage
 * produit. Il n'y a plus de gating PAR PALIER, puisqu'il n'y a plus de palier :
 * un seul produit complet à 79 € par siège.
 */

const { getBillingState, isBillingEnabled } = require('../lib/billing');
const logger = require('../lib/logger');

function requireActivePlan() {
  return async (req, res, next) => {
    if (!isBillingEnabled()) return next();
    try {
      const state = await getBillingState(req.user.id);
      if (state.locked) {
        return res.status(402).json({ error: 'Trial expired', code: 'trial_expired' });
      }
      next();
    } catch (err) {
      logger.error('plan-gate', `requireActivePlan failed: ${err.message}`);
      next(); // en cas d'erreur billing, ne jamais bloquer le produit
    }
  };
}

/* `requirePlan(minPlan)` a ete SUPPRIME le 2026-10-07.
 *
 * Il exigeait un palier minimum parmi starter / growth / scale, une grille
 * morte depuis l'arbitrage du 2026-09-21 : un seul produit complet a 79 € par
 * siege. Il n'y a plus de palier a exiger · tout abonne a tout.
 *
 * Il n'etait cable sur aucune route, donc le retirer ne change rien a chaud.
 * Le garder aurait ete pire que mort : du code qui rend credible une notion de
 * palier que le produit ne vend plus, et qu'on finirait par rebrancher. */

module.exports = { requireActivePlan };
