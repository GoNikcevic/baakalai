/**
 * Billing routes — Stripe Checkout, portail client, webhook.
 *
 * GET  /api/billing            — état du plan + entitlements
 * POST /api/billing/checkout   — session Stripe Checkout {plan} (501 sans clés)
 * POST /api/billing/portal     — session portail client Stripe (501 sans clés)
 * POST /api/webhooks/stripe    — webhook Stripe (monté en RAW dans server.js,
 *                                avant express.json, pour la signature)
 */

const { Router } = require('express');
const db = require('../db');
const logger = require('../lib/logger');
const {
  PLANS,
  isBillingEnabled,
  getStripe,
  priceIdFor,
  planFromPriceId,
  getBillingState,
  setUserPlan,
  findUserByCustomerId,
} = require('../lib/billing');

const router = Router();

router.get('/', async (req, res) => {
  try {
    const state = await getBillingState(req.user.id);
    res.json(state);
  } catch (err) {
    logger.error('billing', `GET state failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to load billing state' });
  }
});

router.post('/checkout', async (req, res) => {
  if (!isBillingEnabled()) {
    return res.status(501).json({ error: 'Billing not configured', code: 'billing_not_configured' });
  }
  const planKey = req.body?.plan;
  if (!PLANS[planKey]) {
    return res.status(400).json({ error: 'Unknown plan', code: 'unknown_plan' });
  }
  const priceId = priceIdFor(planKey);
  if (!priceId) {
    return res.status(501).json({ error: `Missing price ID for plan ${planKey}`, code: 'billing_not_configured' });
  }

  try {
    const stripe = getStripe();
    const state = await getBillingState(req.user.id);

    let customerId = state.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { baakalai_user_id: req.user.id },
      });
      customerId = customer.id;
      await setUserPlan(req.user.id, { customerId });
    }

    const appUrl = process.env.APP_URL || 'https://app.baakal.ai';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/settings?billing=success`,
      cancel_url: `${appUrl}/settings?billing=cancelled`,
      metadata: { baakalai_user_id: req.user.id, plan: planKey },
      subscription_data: { metadata: { baakalai_user_id: req.user.id, plan: planKey } },
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('billing', `Checkout failed for ${req.user.id}: ${err.message}`);
    res.status(502).json({ error: 'Stripe checkout failed', code: 'stripe_error' });
  }
});

router.post('/portal', async (req, res) => {
  if (!isBillingEnabled()) {
    return res.status(501).json({ error: 'Billing not configured', code: 'billing_not_configured' });
  }
  try {
    const state = await getBillingState(req.user.id);
    if (!state.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer', code: 'no_customer' });
    }
    const stripe = getStripe();
    const appUrl = process.env.APP_URL || 'https://app.baakal.ai';
    const session = await stripe.billingPortal.sessions.create({
      customer: state.stripeCustomerId,
      return_url: `${appUrl}/settings`,
    });
    res.json({ url: session.url });
  } catch (err) {
    logger.error('billing', `Portal failed for ${req.user.id}: ${err.message}`);
    res.status(502).json({ error: 'Stripe portal failed', code: 'stripe_error' });
  }
});

/**
 * Webhook Stripe. req.body est un Buffer (express.raw) — obligatoire pour
 * vérifier la signature. Ne JAMAIS monter derrière express.json.
 */
async function stripeWebhook(req, res) {
  if (!isBillingEnabled()) return res.status(501).end();

  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    if (secret) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
    } else {
      // Sans secret configuré on refuse : un webhook non vérifié permettrait
      // de s'attribuer un plan payant avec un simple curl.
      logger.error('billing', 'STRIPE_WEBHOOK_SECRET manquant — webhook rejeté');
      return res.status(501).end();
    }
  } catch (err) {
    logger.warn('billing', `Signature webhook invalide: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.baakalai_user_id
          || await findUserByCustomerId(session.customer);
        if (userId) {
          await setUserPlan(userId, {
            plan: session.metadata?.plan || null,
            planStatus: 'active',
            customerId: session.customer,
            subscriptionId: session.subscription,
          });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.baakalai_user_id
          || await findUserByCustomerId(sub.customer);
        if (userId) {
          const priceId = sub.items?.data?.[0]?.price?.id || null;
          await setUserPlan(userId, {
            plan: planFromPriceId(priceId) || sub.metadata?.plan || null,
            planStatus: sub.status, // active | past_due | canceled | unpaid…
            subscriptionId: sub.id,
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.baakalai_user_id
          || await findUserByCustomerId(sub.customer);
        if (userId) {
          await setUserPlan(userId, { plan: 'trial', planStatus: 'canceled' });
        }
        break;
      }
      default:
        break; // événements non gérés : ack silencieux
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('billing', `Webhook ${event.type} failed: ${err.message}`);
    // 500 → Stripe retentera
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = router;
module.exports.stripeWebhook = stripeWebhook;
