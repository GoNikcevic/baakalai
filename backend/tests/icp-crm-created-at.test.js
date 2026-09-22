/**
 * Test d'intégration · la date de création CRM traverse vraiment la pile.
 *
 * Les tests unitaires de `crm-origin-owner.test.js` vérifient l'EXTRACTION.
 * Celui-ci vérifie la PERSISTANCE, c'est-à-dire précisément ce qui manquait :
 * la valeur était correctement lue par la couche api/ puis jetée faute de
 * colonne, et une colonne présente dans l'INSERT mais absente du mapping de
 * `update()` se perd sans lever la moindre erreur. Le piège s'est déjà produit
 * sur quatre colonnes (last_activity_at, deal_value, won_date, lost_date).
 *
 * On écrit donc par les deux chemins, create() et update(), puis on relit.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

test('la date CRM et l owner survivent a create(), update() et au calcul ICP', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { computeIcpSignals } = require('../lib/icp-signals');

  const { user } = await registerAndLogin();
  assert.ok(user?.id, 'utilisateur de test cree');

  // ── create() doit écrire crm_created_at, pas le laisser tomber ──
  const ancien = await db.opportunities.create({
    userId: user.id,
    name: 'Contact ancien',
    email: 'ancien@acme.io',
    status: 'won',
    wonDate: '2024-01-15T00:00:00.000Z',
    crmProvider: 'pipedrive',
    crmContactId: '1',
    crmCreatedAt: '2019-06-01T00:00:00.000Z',
    crmOwnerId: '77',
    ownerEmail: 'lea@acme.io',
  });
  assert.ok(ancien.crm_created_at, 'create() persiste crm_created_at');
  assert.strictEqual(new Date(ancien.crm_created_at).toISOString().slice(0, 10), '2019-06-01');
  assert.strictEqual(ancien.crm_owner_id, '77');

  // La date d'insertion chez nous reste distincte de la date CRM : c'est toute
  // la raison d'être de la colonne.
  assert.notStrictEqual(
    new Date(ancien.created_at).toISOString().slice(0, 10),
    new Date(ancien.crm_created_at).toISOString().slice(0, 10)
  );

  // ── update() doit connaître la colonne, sinon le rattrapage du cron est muet ──
  const sansDate = await db.opportunities.create({
    userId: user.id,
    name: 'Contact importe avant la 113',
    email: 'orphelin@acme.io',
    status: 'imported',
    crmProvider: 'pipedrive',
    crmContactId: '2',
    crmOwnerId: '88',
  });
  assert.strictEqual(sansDate.crm_created_at, null, 'aucune date CRM a l import');

  const rattrape = await db.opportunities.update(sansDate.id, {
    crmCreatedAt: '2021-09-01T00:00:00.000Z',
  });
  assert.ok(rattrape, 'update() reconnait crmCreatedAt et ne rend pas null');
  assert.strictEqual(
    new Date(rattrape.crm_created_at).toISOString().slice(0, 10),
    '2021-09-01',
    'update() ecrit bien la colonne · si le mapping l oubliait, la valeur serait perdue sans erreur'
  );

  // ── Le calcul ICP lit ces deux champs ──
  const signaux = await computeIcpSignals(user.id);
  assert.ok(signaux, 'les signaux sont calcules');

  // Ancienneté prise sur le PLUS ANCIEN contact (2019), pas sur le plus récent.
  const moisAttendus = (() => {
    const from = new Date('2019-06-01T00:00:00.000Z');
    const now = new Date();
    let m = (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + (now.getUTCMonth() - from.getUTCMonth());
    if (now.getUTCDate() < from.getUTCDate()) m -= 1;
    return m;
  })();
  assert.strictEqual(signaux.crmHistoryMonths, moisAttendus);
  assert.ok(signaux.crmHistoryMonths >= 12, 'un CRM ouvert en 2019 franchit le seuil ICP');

  // Deux owners distincts (77 et 88), pas deux lignes comptées bêtement.
  assert.strictEqual(signaux.crmSeatCount, 2);
  assert.strictEqual(signaux.hasClientBase, true, 'un deal gagne suffit');
});

test('sans aucune date CRM, l anciennete ressort inconnue et jamais zero', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { computeIcpSignals } = require('../lib/icp-signals');
  const { user } = await registerAndLogin();

  await db.opportunities.create({
    userId: user.id,
    name: 'Sans date ni owner',
    email: 'muet@acme.io',
    status: 'imported',
    crmProvider: 'notion',
    crmContactId: 'n1',
  });

  const signaux = await computeIcpSignals(user.id);
  // NULL veut dire inconnu. Un zero ferait ressortir « CRM ouvert ce mois-ci »
  // et disqualifierait le compte sur une lacune de notre propre import.
  assert.strictEqual(signaux.crmHistoryMonths, null);
  assert.strictEqual(signaux.crmSeatCount, null);
  assert.strictEqual(signaux.dealsCount, 1, 'la ligne existe bel et bien');
});
