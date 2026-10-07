/**
 * Billing · un seul prix, par SIÈGE.
 *
 * ── Ce que ce module remplace ───────────────────────────────────────────────
 *
 * Il déclarait trois paliers à 49, 149 et 349 € avec des plafonds de contacts
 * et de membres. Cette grille est morte depuis l'arbitrage du 2026-09-21 :
 * **79 € par siège et par mois, produit complet, aucun plafond de sièges**.
 *
 * Le socle était donc inerte pour deux raisons, pas une. Tout le monde savait
 * qu'il manquait les clés Stripe. Personne ne voyait que, les clés posées, il
 * aurait facturé le MAUVAIS PRIX pour la MAUVAISE QUANTITÉ : le checkout
 * envoyait `quantity: 1` en dur, donc une équipe de cinq aurait payé un siège.
 *
 * Les `ENTITLEMENTS` ont disparu avec les paliers. Ils plafonnaient les membres
 * à 1, 3 et 5 selon le palier, ce qui contredit frontalement « aucun plafond de
 * sièges », et personne ne les lisait · leur seul effet possible était de
 * devenir vrais un jour par accident.
 *
 * ── La règle de facturation ─────────────────────────────────────────────────
 *
 * Un abonnement, un prix, une quantité. La quantité est le nombre de membres
 * de l'équipe de celui qui paie. Elle doit suivre l'équipe : ajouter un membre
 * sans le facturer est un manque à gagner silencieux, en retirer un sans le
 * déduire est une facture fausse envoyée à un client. D'où `syncSeatsForTeam`,
 * appelé aux deux endroits qui touchent la composition d'une équipe.
 *
 * Tout reste inerte tant que `STRIPE_SECRET_KEY` est absente (patron 501, comme
 * les OAuth CRM avant la création des apps).
 */

const db = require('../db');
const logger = require('./logger');

/** 79 € par siège et par mois · arbitrage Goran du 2026-09-21. */
const SEAT_PRICE_EUR = 79;

/**
 * Annuel : deux mois offerts, donc dix mois facturés.
 *
 * Le chiffre sert à AFFICHER l'économie, pas à calculer la facture : c'est le
 * price Stripe annuel qui fait foi. Les garder séparés évite le pire cas, un
 * écran qui annonce un montant et une carte qui en débite un autre.
 */
const ANNUAL_MONTHS_BILLED = 10;

/**
 * Les deux cycles, et le nom de la variable d'environnement qui porte leur
 * price Stripe. Un seul produit, deux périodicités · plus aucun palier.
 */
const CYCLES = {
  monthly: { key: 'monthly', priceIdEnv: 'STRIPE_PRICE_SEAT', monthsBilled: 1 },
  annual: { key: 'annual', priceIdEnv: 'STRIPE_PRICE_SEAT_ANNUAL', monthsBilled: ANNUAL_MONTHS_BILLED },
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

function priceIdFor(cycleKey) {
  const cycle = CYCLES[cycleKey];
  return cycle ? process.env[cycle.priceIdEnv] || null : null;
}

function cycleFromPriceId(priceId) {
  if (!priceId) return null;
  for (const key of Object.keys(CYCLES)) {
    if (priceIdFor(key) === priceId) return key;
  }
  return null;
}

/**
 * Combien de sièges cet utilisateur paie-t-il ?
 *
 * Le nombre de membres de son équipe, et UN quand il n'en a pas : un compte
 * solo est un siège, pas zéro. Rendre zéro créerait un abonnement à quantité
 * nulle, que Stripe refuse, et le refus arriverait au pire moment · pendant le
 * paiement.
 */
async function countSeats(userId) {
  try {
    const team = await db.teams.getByUser(userId);
    if (!team) return 1;
    const membres = await db.teams.getMembers(team.id);
    return Math.max(1, membres.length);
  } catch (err) {
    // Comptage impossible : on facture UN siège plutôt que de bloquer le
    // paiement. Sous-facturer se rattrape à la synchro suivante ; un checkout
    // qui échoue fait perdre le client.
    logger.warn('billing', `Comptage des sièges impossible pour ${userId}: ${err.message}`);
    return 1;
  }
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
  const seats = await countSeats(userId);

  return {
    billingEnabled: isBillingEnabled(),
    plan,
    planStatus: u.plan_status || 'trialing',
    trialEndsAt,
    // Le paywall ne se déclenche que si le billing est branché ET l'essai
    // expiré sans abonnement actif. `trial_ends_at` NULL = compte exempté
    // (fondateurs, beta gratuits), et ça le reste.
    locked: isBillingEnabled() && plan === 'trial' && trialExpired,
    subscribed: plan !== 'trial' && active,
    // Ce que l'écran a besoin de savoir pour annoncer un montant juste.
    seats,
    seatPrice: SEAT_PRICE_EUR,
    monthlyTotal: SEAT_PRICE_EUR * seats,
    annualTotal: SEAT_PRICE_EUR * ANNUAL_MONTHS_BILLED * seats,
    annualMonthsFree: 12 - ANNUAL_MONTHS_BILLED,
    stripeCustomerId: u.stripe_customer_id || null,
    stripeSubscriptionId: u.stripe_subscription_id || null,
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

/**
 * Aligne la quantité facturée sur la composition réelle de l'équipe.
 *
 * ── Pourquoi ça ne peut pas attendre ────────────────────────────────────────
 *
 * Une facturation au siège qui ne suit pas les sièges est fausse dans les deux
 * sens, et les deux coûtent : un membre ajouté et jamais facturé est un manque
 * à gagner que personne ne voit, un membre retiré et toujours facturé est une
 * facture injustifiée envoyée à un client qui la lira.
 *
 * Appelé depuis `db.teams.addMember` et `db.teams.removeMember`, c'est-à-dire
 * aux DEUX seuls endroits qui changent la composition d'une équipe. Le poser
 * ailleurs, dans les routes par exemple, laisserait le prochain chemin d'appel
 * le contourner sans bruit.
 *
 * NE LÈVE JAMAIS. Une synchro Stripe en échec ne doit pas faire échouer l'ajout
 * d'un membre : l'équipe est la vérité, la facture la suit. L'écart se rattrape
 * à la synchro suivante ou depuis le portail client.
 *
 * @returns {Promise<{synced: boolean, seats?: number, reason?: string}>}
 */
async function syncSeatsForTeam(teamId) {
  if (!isBillingEnabled()) return { synced: false, reason: 'billing_disabled' };
  try {
    const team = await db.teams.get(teamId);
    if (!team) return { synced: false, reason: 'no_team' };

    // Celui qui paie est celui qui a créé l'équipe. Les autres membres
    // occupent un siège sans en porter l'abonnement.
    const payeur = team.created_by;
    if (!payeur) return { synced: false, reason: 'no_owner' };

    const r = await db.query(
      `SELECT stripe_subscription_id FROM users WHERE id = $1`, [payeur]
    );
    const subscriptionId = r.rows[0]?.stripe_subscription_id || null;
    if (!subscriptionId) return { synced: false, reason: 'no_subscription' };

    const membres = await db.teams.getMembers(teamId);
    const seats = Math.max(1, membres.length);

    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const item = sub.items?.data?.[0];
    if (!item) return { synced: false, reason: 'no_subscription_item' };
    if (item.quantity === seats) return { synced: true, seats };

    await stripe.subscriptionItems.update(item.id, {
      quantity: seats,
      // Proratisation explicite : un siège ajouté le 15 se facture au prorata,
      // un siège retiré rend du crédit. Laisser le défaut implicite rendrait
      // le comportement dépendant d'un réglage de compte Stripe, donc
      // invisible depuis le code.
      proration_behavior: 'create_prorations',
    });
    logger.info('billing', `Équipe ${teamId}: quantité passée à ${seats} siège(s)`);
    return { synced: true, seats };
  } catch (err) {
    logger.warn('billing', `Synchro des sièges impossible (équipe ${teamId}): ${err.message}`);
    return { synced: false, reason: 'stripe_error' };
  }
}

module.exports = {
  SEAT_PRICE_EUR,
  ANNUAL_MONTHS_BILLED,
  CYCLES,
  isBillingEnabled,
  getStripe,
  priceIdFor,
  cycleFromPriceId,
  countSeats,
  getBillingState,
  setUserPlan,
  findUserByCustomerId,
  syncSeatsForTeam,
};
