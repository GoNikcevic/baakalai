/**
 * Les déclencheurs d'ÉTAT : « cette condition est vraie depuis N jours ».
 *
 * Ce sont les quatre jobs du produit, rapatriés depuis l'ancien système de
 * règles. Ce que ces tests protègent :
 *
 *  1. On n'interroge QUE des contacts CRM et joignables. Un prospect froid de
 *     campagne ne doit jamais recevoir une relance écrite pour quelqu'un avec
 *     qui on a un historique (lib/crm-scope).
 *  2. Les contacts déjà engagés sont exclus du COMPTE affiché, pas seulement
 *     de l'inscription. Annoncer 240 concernés puis n'en inscrire que 3 est
 *     exactement l'écart qu'on ne rattrape pas.
 *  3. Le renouvellement regarde DEVANT, tous les autres regardent derrière.
 *  4. Le plafond par passage existe : armer « inactif depuis 60 jours » peut
 *     correspondre à toute la base d'un coup.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbPath = require.resolve('../db');

const queries = [];
const state = { rows: [], triggers: [] };

const fakeDb = {
  async query(sql, params) {
    queries.push({ sql, params });
    if (/FROM automation_triggers/.test(sql)) return { rows: state.triggers };
    if (/FROM opportunities o/.test(sql)) return { rows: state.rows };
    return { rows: [] };
  },
};

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [], exports: fakeDb,
};

const stateTriggers = require('../lib/automation-state-triggers');

function reset() { queries.length = 0; state.rows = []; state.triggers = []; }

test('les neuf types sont declares avec un defaut et une donnee requise', () => {
  assert.equal(stateTriggers.STATE_KEYS.length, 9);
  for (const key of stateTriggers.STATE_KEYS) {
    const def = stateTriggers.STATE_TRIGGERS[key];
    assert.ok(typeof def.defaultDays === 'number', key);
    assert.ok(def.needs, key);
    assert.ok(def.sql.includes('$2::int') || key === 'churn_risk', key);
  }
});

test('les deux types newsletter ne sont pas repris, et c est assume', () => {
  // Ils lisent l activite d emailing Salesforce, absente des donnees
  // synchronisees. Les declarer produirait un declencheur muet de plus.
  assert.deepEqual(stateTriggers.NOT_PORTED, ['newsletter_inactive', 'newsletter_engaged']);
  assert.equal(stateTriggers.isStateKey('newsletter_inactive'), false);
});

test('la requete ne vise que des contacts CRM joignables', async () => {
  reset();
  await stateTriggers.listMatching('u1', 'inactive_contact', { days: 60 });

  const sql = queries.at(-1).sql;
  // La frontiere crm-scope : jamais un prospect de campagne.
  assert.match(sql, /campaign_id IS NULL/);
  // Sans email, rien ne peut partir : inutile de le compter comme concerne.
  assert.match(sql, /o\.email IS NOT NULL/);
});

test('les contacts deja engages sont exclus du compte, pas seulement de l inscription', async () => {
  reset();
  await stateTriggers.listMatching('u1', 'deal_stagnant', { days: 30 });
  assert.match(queries.at(-1).sql, /NOT EXISTS[\s\S]*sequence_enrollments/);

  reset();
  await stateTriggers.listMatching('u1', 'deal_stagnant', { days: 30 }, { excludeEnrolled: false });
  assert.doesNotMatch(queries.at(-1).sql, /NOT EXISTS/);
});

test('le renouvellement regarde devant, les autres derriere', () => {
  const renewal = stateTriggers.STATE_TRIGGERS.renewal_reminder.sql;
  assert.match(renewal, /now\(\) \+ make_interval/);
  assert.match(renewal, /renewal_date > now\(\)/);

  const stagnant = stateTriggers.STATE_TRIGGERS.deal_stagnant.sql;
  assert.match(stagnant, /<= now\(\) - make_interval/);
});

test('un lead stagnant ne compte que les deals encore ouverts', () => {
  // Un deal gagne ou perdu n est pas « stagnant », il est termine. Sans ce
  // filtre, chaque deal clos serait relance indefiniment.
  const sql = stateTriggers.STATE_TRIGGERS.deal_stagnant.sql;
  assert.match(sql, /won_date IS NULL/);
  assert.match(sql, /lost_date IS NULL/);
});

test('le seuil en jours est borne et retombe sur le defaut', () => {
  assert.equal(stateTriggers.daysFor('deal_stagnant', { days: 45 }), 45);
  assert.equal(stateTriggers.daysFor('deal_stagnant', {}), 30);
  assert.equal(stateTriggers.daysFor('deal_stagnant', { days: -5 }), 30);
  assert.equal(stateTriggers.daysFor('deal_stagnant', { days: 99999 }), 30);
  assert.equal(stateTriggers.daysFor('inactive_contact', { days: 'abc' }), 60);
});

test('un type d etat inconnu ne produit aucune requete', async () => {
  reset();
  const rows = await stateTriggers.listMatching('u1', 'pas_un_type', {});
  assert.deepEqual(rows, []);
  assert.equal(queries.length, 0);
});

test('le contexte dit ce que chaque type fournit aux etapes', () => {
  // Un etat sur un deal fournit le montant et le proprietaire, un contact
  // inactif non : c est ce qui barre les variables dans l editeur.
  assert.equal(stateTriggers.contextFor('deal_stagnant').deal, true);
  assert.equal(stateTriggers.contextFor('inactive_contact').deal, false);
  assert.equal(stateTriggers.contextFor('churn_risk').deal, false);
  assert.equal(stateTriggers.contextFor('upsell_opportunity').owner, true);
});

test('le catalogue rend un compte par type, meme quand une requete casse', async () => {
  reset();
  state.rows = [{ id: 'o1' }, { id: 'o2' }];
  const cat = await stateTriggers.catalogWithCounts('u1');

  assert.equal(cat.length, 9);
  assert.ok(cat.every(c => typeof c.matching === 'number'));
  assert.ok(cat.every(c => c.needs));
  assert.equal(cat[0].matching, 2);
});
