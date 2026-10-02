/**
 * Les requetes qui disaient `DISTINCT ON`, reecrites en fenetre.
 *
 * `DISTINCT ON` est du Postgres pur : 11 requetes du backend ne pouvaient donc
 * pas s'executer sous le miroir SQLite, et aucune n'etait couverte.
 * `ROW_NUMBER() OVER (...)` marche nativement DES DEUX cotes et dit la meme
 * chose, « la derniere ligne par groupe ».
 *
 * Ce fichier ne verifie pas la syntaxe, il verifie la SEMANTIQUE : qu'on prend
 * bien la bonne ligne de chaque groupe, et une seule. Une reecriture fausse
 * rendrait la mauvaise ligne sans rien signaler, et c'est precisement pour ca
 * que ces reecritures se font une par une a la source plutot que dans
 * l'adaptateur.
 *
 * ── Limite assumee de ce fichier ────────────────────────────────────────────
 *
 * Seules deux des 11 requetes sont verifiables ici : les huit tables dont les
 * autres dependent (signals, cron_runs, churn_external_signals,
 * crm_cleaning_reports, campaign_sends, sequence_enrollments,
 * opportunity_product_lines, churn_outcomes) ne sont PAS dans le miroir. La
 * reecriture leve le blocage de dialecte ; la couverture du miroir est la
 * couche suivante, et elle merite son propre lot.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

test('la derniere version de chaque campagne, et une seule', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();

  const camp = async (nom) => (await db.query(
    `INSERT INTO campaigns (user_id, name) VALUES ($1, $2) RETURNING id`, [user.id, nom]
  )).rows[0].id;
  const version = async (campaignId, n, hypo) => db.query(
    `INSERT INTO versions (campaign_id, version, hypotheses) VALUES ($1, $2, $3)`,
    [campaignId, n, hypo]
  );

  const a = await camp('Alpha');
  const b = await camp('Beta');
  // L'ordre d'INSERTION est volontairement l'inverse de l'ordre de version :
  // c'est la seule facon de prouver qu'on trie sur `version` et non sur
  // l'ordre naturel de la table.
  await version(a, 1, 'a-v1');
  await version(a, 3, 'a-v3');
  await version(a, 2, 'a-v2');
  await version(b, 7, 'b-v7');

  const parCampagne = await db.versions.latestForCampaigns([a, b]);

  assert.strictEqual(Object.keys(parCampagne).length, 2, 'une ligne par campagne');
  assert.strictEqual(parCampagne[a].hypotheses, 'a-v3', 'la version la PLUS HAUTE, pas la derniere inseree');
  assert.strictEqual(parCampagne[b].hypotheses, 'b-v7');
});

test('le score passe de chaque contact, pris sur la mesure la plus recente', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();

  const contact = async (nom) => (await db.query(
    `INSERT INTO opportunities (user_id, name, status) VALUES ($1, $2, 'won') RETURNING id`,
    [user.id, nom]
  )).rows[0].id;
  const mesure = async (oppId, score, joursAvant) => db.query(
    `INSERT INTO churn_score_history (user_id, opportunity_id, score, scored_at)
     VALUES ($1, $2, $3, $4)`,
    [user.id, oppId, score, ago(joursAvant)]
  );

  const c1 = await contact('Un');
  const c2 = await contact('Deux');

  // La fenetre de la requete d'origine : entre 75 et 45 jours. On pose donc
  // deux mesures DANS la fenetre pour c1, et une seule pour c2.
  await mesure(c1, 40, 70);
  await mesure(c1, 80, 50);  // la plus recente DANS la fenetre
  await mesure(c1, 10, 2);   // hors fenetre, trop recente
  await mesure(c2, 65, 60);

  // La requete reecrite, telle que routes/analytics.js la porte desormais.
  const r = await db.query(
    `SELECT opportunity_id, past_score FROM (
       SELECT opportunity_id, score AS past_score,
              ROW_NUMBER() OVER (PARTITION BY opportunity_id ORDER BY scored_at DESC) AS rn
         FROM churn_score_history
        WHERE user_id = $1 AND scored_at BETWEEN now() - interval '75 days' AND now() - interval '45 days'
     ) dernier WHERE rn = 1
     ORDER BY past_score DESC`,
    [user.id]
  );

  assert.strictEqual(r.rows.length, 2, 'une ligne par contact, pas une par mesure');
  const parContact = new Map(r.rows.map(x => [x.opportunity_id, Number(x.past_score)]));
  assert.strictEqual(parContact.get(c1), 80, 'la mesure la plus recente DANS la fenetre');
  assert.strictEqual(parContact.get(c2), 65);
});

test('un groupe a une seule ligne reste intact', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();

  // Le cas limite qui casse une reecriture maladroite : avec un seul membre par
  // groupe, une fenetre mal fermee rend zero ligne au lieu d'une.
  const c = (await db.query(
    `INSERT INTO opportunities (user_id, name, status) VALUES ($1, 'Seul', 'won') RETURNING id`,
    [user.id]
  )).rows[0].id;
  await db.query(
    `INSERT INTO churn_score_history (user_id, opportunity_id, score, scored_at)
     VALUES ($1, $2, 55, $3)`,
    [user.id, c, ago(60)]
  );

  const r = await db.query(
    `SELECT opportunity_id, past_score FROM (
       SELECT opportunity_id, score AS past_score,
              ROW_NUMBER() OVER (PARTITION BY opportunity_id ORDER BY scored_at DESC) AS rn
         FROM churn_score_history
        WHERE user_id = $1 AND scored_at BETWEEN now() - interval '75 days' AND now() - interval '45 days'
     ) dernier WHERE rn = 1`,
    [user.id]
  );
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(Number(r.rows[0].past_score), 55);
});
