/**
 * POST /api/crm/product-lines : l'équipe créée au passage, et les doublons.
 *
 * ── Le défaut que ces tests tiennent ───────────────────────────────────────
 *
 * Une ligne de produit appartient à une équipe, et la route en crée une pour
 * un compte qui n'en a pas. Elle le faisait par deux INSERT en ligne, sans
 * jamais appeler `migrateUserData` comme le fait POST /api/teams : les contacts
 * déjà présents restaient sans `team_id`, définitivement. En prod l'unique
 * équipe était née de cette route, pendant l'analyse d'entreprise de
 * l'onboarding, et 0 contact sur 443 lui était rattaché. Les campagnes équipe
 * filtrant sur `team_id`, elles ne trouvaient rien.
 *
 * Second défaut : aucune unicité. Relancer l'analyse de l'onboarding recréait
 * toutes les lignes détectées en double.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

describe('POST /api/crm/product-lines', () => {
  let solo;
  let db;

  before(async () => {
    await setup();
    db = require('../db');
    solo = await registerAndLogin({ email: `solo-pl-${Date.now()}@bakal.test` });
  });

  after(teardown);

  it('l equipe creee au passage rattache les contacts deja presents', async () => {
    // Un contact existe AVANT que l'équipe existe : c'est le cas de
    // l'onboarding, où l'analyse d'entreprise peut suivre un premier import.
    const contact = await db.opportunities.create({
      userId: solo.user.id, name: 'Claire Martin', email: 'claire@exemple.test',
    });
    const avant = await db.query('SELECT team_id FROM opportunities WHERE id = $1', [contact.id]);
    assert.strictEqual(avant.rows[0].team_id, null, 'le contact ne devait pas avoir d equipe au depart');

    const res = await request('POST', '/api/crm/product-lines', {
      token: solo.token,
      body: { name: 'Logiciel' },
    });
    assert.strictEqual(res.status, 200, `creation refusee : ${JSON.stringify(res.body)}`);

    const equipe = await db.teams.getByUser(solo.user.id);
    assert.ok(equipe, 'aucune equipe creee');
    assert.strictEqual(equipe.role, 'admin', 'le createur doit etre admin de son equipe');

    // LE point tenu : migrateUserData est passé, le contact est rattaché.
    const apres = await db.query('SELECT team_id FROM opportunities WHERE id = $1', [contact.id]);
    assert.strictEqual(apres.rows[0].team_id, equipe.id, 'le contact existant n a pas ete rattache a l equipe');
    assert.strictEqual(res.body.productLine.team_id, equipe.id);
  });

  it('un second appel reutilise l equipe au lieu d en creer une autre', async () => {
    const res = await request('POST', '/api/crm/product-lines', {
      token: solo.token,
      body: { name: 'Formation' },
    });
    assert.strictEqual(res.status, 200);

    const equipes = await db.query('SELECT count(*) AS n FROM team_members WHERE user_id = $1', [solo.user.id]);
    assert.strictEqual(Number(equipes.rows[0].n), 1, 'une seconde equipe a ete creee');
  });

  it('un nom deja pris dans l equipe est refuse, casse et espaces confondus', async () => {
    const res = await request('POST', '/api/crm/product-lines', {
      token: solo.token,
      body: { name: '  logiciel ', description: 'Saisie qui ne doit pas ecraser l existante' },
    });

    assert.strictEqual(res.status, 409, `attendu 409, recu ${res.status}`);
    assert.strictEqual(res.body.code, 'product_line_exists');
    assert.ok(res.body.productLineId, 'la ligne existante doit etre designee');

    const lignes = await db.query(
      `SELECT count(*) AS n FROM product_lines WHERE lower(trim(name)) = 'logiciel'`
    );
    assert.strictEqual(Number(lignes.rows[0].n), 1, 'un doublon a ete cree');
  });

  it('le nom est enregistre sans espaces parasites', async () => {
    const res = await request('POST', '/api/crm/product-lines', {
      token: solo.token,
      body: { name: '  Conseil  ' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.productLine.name, 'Conseil');
  });

  it('un nom vide est refuse', async () => {
    const res = await request('POST', '/api/crm/product-lines', {
      token: solo.token,
      body: { name: '   ' },
    });
    assert.strictEqual(res.status, 400);
  });
});
