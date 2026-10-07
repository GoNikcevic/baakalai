/**
 * La facturation AU SIEGE.
 *
 * ── Ce que ces tests tiennent, et pourquoi ils n'existaient pas avant ───────
 *
 * Le socle Stripe etait repute « inerte faute de cles ». Il l'etait pour une
 * seconde raison que personne ne voyait : il declarait trois paliers a 49, 149
 * et 349 €, la grille morte depuis l'arbitrage du 2026-09-21, et le checkout
 * envoyait `quantity: 1` EN DUR. Les cles posees, une equipe de cinq aurait
 * paye un siege · une facture quatre fois trop basse, tous les mois, sans que
 * rien ne le signale.
 *
 * C'est exactement le genre de defaut qu'aucun test ne pouvait attraper,
 * puisqu'il n'y avait aucun test. Ceux-ci tiennent les trois faits qui
 * decident du montant preleve sur une vraie carte :
 *
 *   · la QUANTITE facturee est le nombre de sieges, jamais 1 ;
 *   · elle SUIT l'equipe · un membre ajoute ou retire change la facture ;
 *   · un compte solo vaut UN siege, jamais zero, que Stripe refuserait.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

/**
 * Un faux Stripe, pose AVANT de charger le module de facturation.
 *
 * On observe ce qui lui est demande · c'est la seule facon de verifier un
 * montant sans prelever quoi que ce soit.
 */
function faireFauxStripe() {
  // La quantite est MEMORISEE, comme chez le vrai Stripe. Un faux qui
  // annoncerait toujours 1 ferait echouer le test du retrait pour une raison
  // etrangere au code : la synchro saute volontairement l'appel quand la
  // quantite est deja la bonne, et un faux amnesique la pousserait a agir sans
  // raison a chaque fois.
  const vu = { sessions: [], majQuantite: [], quantite: 1 };
  const stripe = {
    customers: { async create() { return { id: 'cus_test' }; } },
    checkout: {
      sessions: {
        async create(args) { vu.sessions.push(args); return { url: 'https://stripe.test/session' }; },
      },
    },
    subscriptions: {
      async retrieve(id) {
        return { id, items: { data: [{ id: 'si_1', quantity: vu.quantite }] } };
      },
    },
    subscriptionItems: {
      async update(itemId, args) {
        vu.majQuantite.push({ itemId, ...args });
        if (typeof args.quantity === 'number') vu.quantite = args.quantity;
        return { id: itemId, ...args };
      },
    },
    billingPortal: { sessions: { async create() { return { url: 'https://stripe.test/portal' }; } } },
  };
  return { vu, stripe };
}

/**
 * Le module `stripe` est remplace, une fois pour toutes.
 *
 * Et PAS la fonction `getStripe` : `routes/billing.js` la destructure au
 * chargement, donc remplacer la propriete sur les exports apres coup
 * n'atteindrait jamais la liaison deja capturee · le test aurait passe en
 * croyant observer un faux, tout en appelant le vrai.
 *
 * L'instance delegue a `globalThis.__fauxStripe` A CHAQUE APPEL, ce qui permet
 * a chaque test de poser le sien malgre la memoisation de `_stripe`.
 */
const cheminStripe = (() => { try { return require.resolve('stripe'); } catch { return null; } })();
if (cheminStripe) {
  const delegue = (chemin) => (...args) => {
    let cible = globalThis.__fauxStripe;
    for (const p of chemin) cible = cible?.[p];
    if (typeof cible !== 'function') throw new Error(`faux stripe: ${chemin.join('.')} absent`);
    return cible(...args);
  };
  class FauxStripe {
    constructor() {
      this.customers = { create: delegue(['customers', 'create']) };
      this.checkout = { sessions: { create: delegue(['checkout', 'sessions', 'create']) } };
      this.subscriptions = { retrieve: delegue(['subscriptions', 'retrieve']) };
      this.subscriptionItems = { update: delegue(['subscriptionItems', 'update']) };
      this.billingPortal = { sessions: { create: delegue(['billingPortal', 'sessions', 'create']) } };
    }
  }
  require.cache[cheminStripe] = {
    id: cheminStripe, filename: cheminStripe, loaded: true, exports: FauxStripe,
  };
}

/** Active le billing et branche le faux client, le temps d'un test. */
function activerBilling(t, stripe) {
  const avant = { ...process.env };
  process.env.STRIPE_SECRET_KEY = 'sk_test_faux';
  process.env.STRIPE_PRICE_SEAT = 'price_seat_mensuel';
  process.env.STRIPE_PRICE_SEAT_ANNUAL = 'price_seat_annuel';
  globalThis.__fauxStripe = stripe;

  t.after(() => {
    delete globalThis.__fauxStripe;
    for (const c of ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_SEAT', 'STRIPE_PRICE_SEAT_ANNUAL']) {
      if (avant[c] === undefined) delete process.env[c]; else process.env[c] = avant[c];
    }
  });
  return require('../lib/billing');
}

test('un compte solo vaut UN siege, jamais zero', async (t) => {
  await setup();
  t.after(teardown);

  const { countSeats } = require('../lib/billing');
  const { user } = await registerAndLogin();

  // Zero creerait un abonnement a quantite nulle, que Stripe refuse · et le
  // refus arriverait pendant le paiement, au pire moment.
  assert.strictEqual(await countSeats(user.id), 1);
});

test('les sieges suivent le nombre de membres de l equipe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { countSeats } = require('../lib/billing');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });

  assert.strictEqual(await countSeats(proprietaire.user.id), 1, 'le createur occupe deja un siege');

  const second = await registerAndLogin();
  await db.teams.addMember(equipe.id, second.user.id, 'viewer');
  assert.strictEqual(await countSeats(proprietaire.user.id), 2);

  const troisieme = await registerAndLogin();
  await db.teams.addMember(equipe.id, troisieme.user.id, 'viewer');
  assert.strictEqual(await countSeats(proprietaire.user.id), 3);
});

test('le checkout facture le nombre de sieges, PAS 1', async (t) => {
  await setup();
  t.after(teardown);

  const { vu, stripe } = faireFauxStripe();
  activerBilling(t, stripe);

  const db = require('../db');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });
  for (let i = 0; i < 4; i++) {
    const m = await registerAndLogin();
    await db.teams.addMember(equipe.id, m.user.id, 'viewer');
  }

  const res = await request('POST', '/api/billing/checkout', {
    token: proprietaire.token, body: { cycle: 'monthly' },
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(vu.sessions.length, 1);
  // LE test. Cinq membres, cinq sieges. `quantity: 1` ici serait une facture
  // cinq fois trop basse, tous les mois, sans aucun signal.
  assert.strictEqual(vu.sessions[0].line_items[0].quantity, 5);
  assert.strictEqual(vu.sessions[0].line_items[0].price, 'price_seat_mensuel');
});

test('le cycle annuel passe par un AUTRE price', async (t) => {
  await setup();
  t.after(teardown);

  const { vu, stripe } = faireFauxStripe();
  activerBilling(t, stripe);
  const { token } = await registerAndLogin();

  const res = await request('POST', '/api/billing/checkout', { token, body: { cycle: 'annual' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(vu.sessions[0].line_items[0].price, 'price_seat_annuel');
});

test('un cycle inconnu est refuse, et aucun palier n est accepte', async (t) => {
  await setup();
  t.after(teardown);

  const { stripe } = faireFauxStripe();
  activerBilling(t, stripe);
  const { token } = await registerAndLogin();

  // « growth » etait un palier valide avant la refonte. Il ne doit plus rien
  // declencher · sinon un ancien appelant creerait un abonnement au hasard.
  const res = await request('POST', '/api/billing/checkout', { token, body: { cycle: 'growth' } });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'unknown_cycle');
});

test('ajouter un membre resynchronise la quantite facturee', async (t) => {
  await setup();
  t.after(teardown);

  const { vu, stripe } = faireFauxStripe();
  activerBilling(t, stripe);

  const db = require('../db');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });
  await db.query(`UPDATE users SET stripe_subscription_id = 'sub_test' WHERE id = $1`, [proprietaire.user.id]);

  const second = await registerAndLogin();
  await db.teams.addMember(equipe.id, second.user.id, 'viewer');

  // Un membre ajoute et jamais facture est un manque a gagner que personne ne
  // voit · d'ou la synchro posee dans le DAO et non dans une route.
  assert.strictEqual(vu.majQuantite.length, 1);
  assert.strictEqual(vu.majQuantite[0].quantity, 2);
  assert.strictEqual(vu.majQuantite[0].proration_behavior, 'create_prorations');
});

test('retirer un membre resynchronise aussi', async (t) => {
  await setup();
  t.after(teardown);

  const { vu, stripe } = faireFauxStripe();
  activerBilling(t, stripe);

  const db = require('../db');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });
  await db.query(`UPDATE users SET stripe_subscription_id = 'sub_test' WHERE id = $1`, [proprietaire.user.id]);

  const second = await registerAndLogin();
  await db.teams.addMember(equipe.id, second.user.id, 'viewer');
  vu.majQuantite.length = 0;

  // Continuer a facturer quelqu'un qui est parti est une facture fausse
  // envoyee a un client qui la lira.
  await db.teams.removeMember(equipe.id, second.user.id);
  assert.strictEqual(vu.majQuantite.length, 1);
  assert.strictEqual(vu.majQuantite[0].quantity, 1);
});

test('sans abonnement, la synchro ne tente rien', async (t) => {
  await setup();
  t.after(teardown);

  const { vu, stripe } = faireFauxStripe();
  const billing = activerBilling(t, stripe);

  const db = require('../db');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });

  const r = await billing.syncSeatsForTeam(equipe.id);
  assert.strictEqual(r.synced, false);
  assert.strictEqual(r.reason, 'no_subscription');
  assert.strictEqual(vu.majQuantite.length, 0);
});

test('une synchro en echec ne fait PAS echouer l ajout du membre', async (t) => {
  await setup();
  t.after(teardown);

  const { stripe } = faireFauxStripe();
  stripe.subscriptions.retrieve = async () => { throw new Error('Stripe indisponible'); };
  activerBilling(t, stripe);

  const db = require('../db');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });
  await db.query(`UPDATE users SET stripe_subscription_id = 'sub_test' WHERE id = $1`, [proprietaire.user.id]);

  // L'equipe est la verite, la facture la suit. Faire echouer l'ajout d'un
  // membre parce que Stripe repond mal punirait l'utilisateur pour une panne
  // qui ne le concerne pas.
  const second = await registerAndLogin();
  const membre = await db.teams.addMember(equipe.id, second.user.id, 'viewer');
  assert.ok(membre, 'le membre est bien ajoute');
  assert.strictEqual((await db.teams.getMembers(equipe.id)).length, 2);
});

test('l etat annonce le total juste, mensuel et annuel', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getBillingState, SEAT_PRICE_EUR } = require('../lib/billing');
  const proprietaire = await registerAndLogin();
  const equipe = await db.teams.create({ name: 'Acme', createdBy: proprietaire.user.id });
  const second = await registerAndLogin();
  await db.teams.addMember(equipe.id, second.user.id, 'viewer');

  const etat = await getBillingState(proprietaire.user.id);
  assert.strictEqual(SEAT_PRICE_EUR, 79, 'arbitrage Goran du 2026-09-21');
  assert.strictEqual(etat.seats, 2);
  assert.strictEqual(etat.monthlyTotal, 158);
  // Deux mois offerts : dix mois factures, pas douze.
  assert.strictEqual(etat.annualTotal, 79 * 10 * 2);
  assert.strictEqual(etat.annualMonthsFree, 2);
});

test('sans cles Stripe, le checkout repond 501 et ne facture rien', async (t) => {
  await setup();
  t.after(teardown);

  const avant = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  t.after(() => { if (avant !== undefined) process.env.STRIPE_SECRET_KEY = avant; });

  const { token } = await registerAndLogin();
  const res = await request('POST', '/api/billing/checkout', { token, body: { cycle: 'monthly' } });
  assert.strictEqual(res.status, 501);
  assert.strictEqual(res.body.code, 'billing_not_configured');
});
