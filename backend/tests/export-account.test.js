/**
 * Test de non-régression · l'export RGPD répond.
 *
 * POURQUOI CE TEST EXISTE
 * -----------------------
 * `GET /api/export/account` a répondu 500 à tous les utilisateurs pendant des
 * mois. La requête sur `opportunities` listait une colonne `phone` qui n'a
 * jamais existé, et comme les dix requêtes de l'export tournent dans un seul
 * `Promise.all`, une seule colonne fantôme suffisait à faire tomber l'export
 * ENTIER. Rien ne le signalait : aucun test ne montait ce routeur.
 *
 * Le risque est structurel et se reproduira : ces requêtes énumèrent leurs
 * colonnes une par une au lieu de faire `SELECT *`, donc toute colonne
 * renommée ou supprimée par une migration les casse silencieusement. Ce test
 * exécute les dix requêtes pour de vrai.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

test('l export RGPD repond 200 et contient les dix sections', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { token, user } = await registerAndLogin();

  // Au moins une opportunité : c'est la requête qui portait la colonne fantôme.
  await db.opportunities.create({
    userId: user.id,
    name: 'Contact exporte',
    email: 'export@acme.io',
    title: 'DAF',
    company: 'Acme',
    status: 'imported',
    linkedinUrl: 'https://linkedin.com/in/exporte',
  });

  const res = await request('GET', '/api/export/account', { token });

  assert.strictEqual(res.status, 200, 'une seule colonne fantome suffisait a faire tomber tout l export');

  // Les dix sections doivent être présentes : une requête qui échoue en ferait
  // disparaître une, ou ferait tomber l'ensemble.
  for (const section of [
    'user', 'profile', 'campaigns', 'contacts', 'chat_threads', 'documents',
    'nurture_triggers', 'nurture_emails', 'reports', 'integrations',
  ]) {
    assert.ok(section in res.body, `section « ${section} » presente dans l export`);
  }

  assert.strictEqual(res.body.contacts.length, 1, 'le contact cree ressort dans l export');
  assert.strictEqual(res.body.contacts[0].email, 'export@acme.io');

  // Le téléphone n'est pas stocké (décision Goran du 2026-09-22) : il doit
  // rester absent de l'export, et surtout ne pas le faire échouer.
  assert.ok(!('phone' in res.body.contacts[0]), 'le telephone n est pas exporte, faute d etre stocke');
});
