/**
 * Paywall / gating par palier de plan.
 *
 * Permissif par conception tant que STRIPE_SECRET_KEY est absente : rien ne
 * change pour les comptes actuels avant le branchement du billing. Les comptes
 * avec trial_ends_at NULL (fondateurs, beta gratuits) ne sont jamais bloqués.
 *
 * requireActivePlan() — bloque (402) quand l'essai est expiré sans abonnement.
 * requirePlan('growth') — exige un palier minimum (402 sinon, code plan_required).
 *
 * Non câblé par défaut : le choix des routes à protéger est un arbitrage
 * produit (voir ENTITLEMENTS dans lib/billing.js).
 */

const { getBillingState, PLAN_ORDER, isBillingEnabled } = require('../lib/billing');
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

function requirePlan(minPlan) {
  return async (req, res, next) => {
    if (!isBillingEnabled()) return next();
    try {
      const state = await getBillingState(req.user.id);
      if (state.locked) {
        return res.status(402).json({ error: 'Trial expired', code: 'trial_expired' });
      }
      if (PLAN_ORDER.indexOf(state.plan) < PLAN_ORDER.indexOf(minPlan)) {
        return res.status(402).json({ error: `Plan ${minPlan} required`, code: 'plan_required', requiredPlan: minPlan });
      }
      next();
    } catch (err) {
      logger.error('plan-gate', `requirePlan failed: ${err.message}`);
      next();
    }
  };
}

module.exports = { requireActivePlan, requirePlan };
