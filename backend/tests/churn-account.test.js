const test = require('node:test');
const assert = require('node:assert');
const { scoreOpportunity } = require('../lib/churn-scoring');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

// Le compte tel que scoreAccountsForUser le fabrique : pas d'adresse à lui,
// mais celles de ses contacts, et un drapeau d'injoignabilité dérivé.
const account = (over = {}) => ({
  isAccount: true,
  unreachable: false,
  emailSet: new Set(['ceo@client.fr', 'ops@client.fr']),
  crm_contact_id: '__account__1',
  company: 'Client SARL',
  last_activity_at: ago(5),
  created_at: ago(400),
  status: 'won',
  email_bounced_at: null,
  ...over,
});

test('le compte n est pas silencieux si UN seul de ses contacts a bougé (arbitrage 2026-10-01)', () => {
  // C'est tout l'arbitrage : la date du compte est la plus récente de ses
  // contacts. Un compte à cinq contacts dont quatre dorment reste vivant.
  const vivant = scoreOpportunity(account({ last_activity_at: ago(5) }), {});
  const mort = scoreOpportunity(account({ last_activity_at: ago(130) }), {});

  assert.ok(!vivant.factors.some(f => f.signal === 'inactivity'),
    'un compte actif il y a 5 jours ne doit porter aucun facteur d inactivité');
  assert.ok(mort.factors.some(f => f.signal === 'inactivity'),
    'un compte muet depuis 130 jours doit porter le facteur d inactivité');
  assert.ok(mort.score > vivant.score);
});

test('les seuils du contact sont repris tels quels, aucun barème parallèle', () => {
  // 120 jours = 30 points, 90 = 25, 60 = 18, 30 = 10. Si quelqu'un recalibre un
  // jour les seuils du contact, ce test doit casser ici aussi : c'est le but.
  const poids = j => {
    const f = scoreOpportunity(account({ last_activity_at: ago(j), status: 'open' }), {})
      .factors.find(x => x.signal === 'inactivity');
    return f ? f.weight : 0;
  };
  assert.strictEqual(poids(125), 30);
  assert.strictEqual(poids(95), 25);
  assert.strictEqual(poids(65), 18);
  assert.strictEqual(poids(35), 10);
  assert.strictEqual(poids(10), 0);
});

test('emailSet apparie les emails de TOUS les contacts du compte', () => {
  const emails = [
    { to_email: 'ops@client.fr', status: 'sent', replied_at: null, created_at: ago(10) },
    { to_email: 'ceo@client.fr', status: 'sent', replied_at: null, created_at: ago(12) },
  ];
  const avec = scoreOpportunity(account(), { emails });
  assert.ok(avec.factors.some(f => f.signal === 'no_reply'),
    'deux emails sans réponse à deux contacts du compte doivent compter');

  // Sans emailSet, la comparaison se fait sur `opp.email`, absent d'un compte :
  // le facteur disparaîtrait en silence, soit 20 points sur 100 jamais atteints.
  const sans = scoreOpportunity(account({ emailSet: undefined }), { emails });
  assert.ok(!sans.factors.some(f => f.signal === 'no_reply'),
    'sans emailSet aucun email ne peut matcher, c est bien le piège qu on corrige');
});

test('un compte n écope jamais du facteur incomplete_profile', () => {
  // Un compte n'a ni intitulé de poste ni adresse : le compte de champs
  // manquants du contact lui donnerait +10 systématiques, un décalage constant
  // qui ne mesure rien.
  const r = scoreOpportunity(account({ company: null }), {});
  assert.ok(!r.factors.some(f => f.signal === 'incomplete_profile'));
});

test('un compte sans aucun contact joignable porte account_unreachable (plan §8.1)', () => {
  // `status: open` volontairement : sur un compte `won` encore actif, l'offset
  // de -15 du facteur 5 absorbe les 10 points et masquerait la comparaison.
  const joignable = scoreOpportunity(account({ unreachable: false, status: 'open' }), {});
  const injoignable = scoreOpportunity(account({ unreachable: true, status: 'open' }), {});

  const f = injoignable.factors.find(x => x.signal === 'account_unreachable');
  assert.ok(f, 'le drapeau d injoignabilité doit produire un facteur nommé');
  assert.strictEqual(f.weight, 10);
  assert.strictEqual(injoignable.score, joignable.score + 10);
});

test('les affaires du compte lui reviennent toutes via la sentinelle', () => {
  // scoreAccountsForUser apparie par person_id === crm_contact_id. Si la
  // sentinelle ne correspond pas, la stagnation ne se mesure plus et le score
  // plafonne sans que rien ne le signale.
  const deals = [
    { status: 'open', person_id: '__account__1', updatedAt: ago(80), created_at: ago(200) },
  ];
  const r = scoreOpportunity(account({ status: 'open' }), { deals });
  assert.ok(r.factors.some(f => f.signal === 'deal_stagnant'),
    'une affaire ouverte et immobile depuis 80 jours doit peser');

  const orphelines = scoreOpportunity(account({ status: 'open' }), {
    deals: [{ status: 'open', person_id: 'autre-compte', updatedAt: ago(80), created_at: ago(200) }],
  });
  assert.ok(!orphelines.factors.some(f => f.signal === 'deal_stagnant'),
    'une affaire d un autre compte ne doit pas peser sur celui-ci');
});

test('un compte ancien SANS affaire ne porte pas de stagnation fantôme', () => {
  // Le repli « l'opportunité est elle-même le deal » vaut pour un contact, pas
  // pour un compte : `created_at` y est la date d'entrée de la société dans le
  // CRM. Sans ce garde-fou, tout compte un peu ancien prenait +25 à vie.
  const r = scoreOpportunity(account({ status: 'open', created_at: ago(400) }), { deals: [] });
  assert.ok(!r.factors.some(f => f.signal === 'deal_stagnant'),
    'une société connue depuis 400 jours n est pas une affaire ouverte depuis 400 jours');
  assert.strictEqual(r.score, 0);

  // Le repli reste intact pour un CONTACT, c'est lui qui couvre les CRM sans
  // objet affaire avant la migration 128.
  const contact = { status: 'open', last_activity_at: ago(5), created_at: ago(400), email: 'a@b.fr', company: 'C', title: 'CEO' };
  assert.ok(scoreOpportunity(contact, { deals: [] }).factors.some(f => f.signal === 'deal_stagnant'));
});

test('le client silencieux reste le signal le plus lourd, au niveau compte aussi', () => {
  const r = scoreOpportunity(account({ status: 'won', last_activity_at: ago(100) }), {});
  assert.ok(r.factors.some(f => f.signal === 'client_silent'),
    'un client (won) muet depuis 100 jours est LE signal de churn du produit');
});

// ── Non-régression : le scoring de CONTACT ne doit pas avoir bougé ──
test('un contact continue de porter incomplete_profile comme avant', () => {
  const contact = {
    status: 'open',
    last_activity_at: ago(5),
    created_at: ago(10),
    email: null, company: null, title: 'CEO',
  };
  const r = scoreOpportunity(contact, {});
  const f = r.factors.find(x => x.signal === 'incomplete_profile');
  assert.ok(f, 'deux champs manquants sur un contact doivent toujours compter');
  assert.strictEqual(f.weight, 10);
});

test('un contact continue d apparier ses emails par son adresse', () => {
  const contact = {
    status: 'open', last_activity_at: ago(5), created_at: ago(10),
    email: 'ceo@client.fr', company: 'Client SARL', title: 'CEO',
  };
  const emails = [
    { to_email: 'ceo@client.fr', status: 'sent', replied_at: null, created_at: ago(3) },
    { to_email: 'quelquun@ailleurs.fr', status: 'sent', replied_at: null, created_at: ago(3) },
  ];
  const r = scoreOpportunity(contact, { emails });
  const f = r.factors.find(x => x.signal === 'no_reply');
  assert.ok(f, 'un email sans réponse doit compter');
  assert.strictEqual(f.weight, 8, 'un seul email doit matcher, pas deux');
});
