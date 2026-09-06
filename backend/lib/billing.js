/**
 * Billing — plans, entitlements, client Stripe.
 *
 * Tout est inerte tant que STRIPE_SECRET_KEY n'est pas posée (pattern 501,
 * comme les OAuth CRM avant la création des apps). Les price IDs Stripe se
 * posent en env : STRIPE_PRICE_STARTER / STRIPE_PRICE_GROWTH / STRIPE_PRICE_SCALE.
 */

const db = require('../db');
const logger = require('./logger');

const PLANS = {
  starter: { key: 'starter', price: 49, priceIdEnv: 'STRIPE_PRICE_STARTER' },
  growth: { key: 'growth', price: 149, priceIdEnv: 'STRIPE_PRICE_GROWTH' },
  scale: { key: 'scale', price: 349, priceIdEnv: 'STRIPE_PRICE_SCALE' },
};

// Ordre pour requirePlan() : chaque palier inclut les précédents.
const PLAN_ORDER = ['trial', 'starter', 'growth', 'scale'];

// Ce que chaque palier débloque. Valeurs par défaut raisonnables — l'arbitrage
// produit définitif (L2/L3/L4) pourra les ajuster sans toucher au reste.
const ENTITLEMENTS = {
  trial: { maxContacts: 500, teamMembers: 1, chainsAutonomous: false },
  starter: { maxContacts: 2000, teamMembers: 1, chainsAutonomous: false },
  growth: { maxContacts: 10000, teamMembers: 3, chainsAutonomous: true },
  scale: { maxContacts: null, teamMembers: 5, chainsAutonomous: true },
};

function isBillingEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let _stripe = null;
function getStripe() {
  if (!isBillingEnabled()) return null;
  if (!_stripe) {
    // Lazy : le module stripe n'est chargé que si la clé existe.
    const Stripe = require('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

function priceIdFor(planKey) {
  const plan = PLANS[planKey];
  return plan ? process.env[plan.priceIdEnv] || null : null;
}

function planFromPriceId(priceId) {
  if (!priceId) return null;
  for (const key of Object.keys(PLANS)) {
    if (priceIdFor(key) === priceId) return key;
  }
  return null;
}

async function getBillingState(userId) {
  const r = await db.query(
    `SELECT plan, plan_status, trial_ends_at, stripe_customer_id, stripe_subscription_id
     FROM users WHERE id = $1`,
    [userId]
  );
  const u = r.rows[0] || {};
  const plan = u.plan || 'trial';
  const trialEndsAt = u.trial_ends_at || null;
  const trialExpired = Boolean(trialEndsAt && new Date(trialEndsAt).getTime() < Date.now());
  const active = u.plan_status === 'active' || u.plan_status === 'trialing';

  return {
    billingEnabled: isBillingEnabled(),
    plan,
    planStatus: u.plan_status || 'trialing',
    trialEndsAt,
    // Le paywall ne se déclenche que si le billing est branché ET l'essai
    // expiré sans abonnement actif. trial_ends_at NULL = compte exempté.
    locked: isBillingEnabled() && plan === 'trial' && trialExpired,
    subscribed: plan !== 'trial' && active,
    entitlements: ENTITLEMENTS[plan] || ENTITLEMENTS.trial,
    stripeCustomerId: u.stripe_customer_id || null,
    stripeSubscriptionId: u.stripe_subscription_id || null,
    prices: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, p.price])),
  };
}

async function setUserPlan(userId, { plan, planStatus, customerId, subscriptionId }) {
  await db.query(
    `UPDATE users SET
       plan = COALESCE($2, plan),
       plan_status = COALESCE($3, plan_status),
       stripe_customer_id = COALESCE($4, stripe_customer_id),
       stripe_subscription_id = COALESCE($5, stripe_subscription_id),
       plan_updated_at = now()
     WHERE id = $1`,
    [userId, plan || null, planStatus || null, customerId || null, subscriptionId || null]
  );
  logger.info('billing', `User ${userId}: plan=${plan || '(inchangé)'} status=${planStatus || '(inchangé)'}`);
}

async function findUserByCustomerId(customerId) {
  const r = await db.query(`SELECT id FROM users WHERE stripe_customer_id = $1`, [customerId]);
  return r.rows[0]?.id || null;
}

module.exports = {
  PLANS,
  PLAN_ORDER,
  ENTITLEMENTS,
  isBillingEnabled,
  getStripe,
  priceIdFor,
  planFromPriceId,
  getBillingState,
  setUserPlan,
  findUserByCustomerId,
};
