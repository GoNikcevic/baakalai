/**
 * Les traductions Postgres du miroir SQLite.
 *
 * ── Pourquoi ces tests existent ─────────────────────────────────────────────
 *
 * Mesure du 2026-10-02 sur le backend : environ 127 occurrences de SQL que le
 * miroir ne savait PAS traduire, dont 46 `= ANY($n)`, 27 `EXTRACT(` et 7
 * `::interval`. Chacune de ces requetes echouait sous le miroir, donc aucune
 * n'etait couverte par un test, et on l'apprenait toujours de la meme facon :
 * en ecrivant un test qui refusait de demarrer.
 *
 * Trois cas reels decouverts comme ca en deux jours : le scoring de churn qui
 * annoncait « scored 1 comptes » sans rien ecrire, la file de reactivation qui
 * ne s'executait pas du tout, et le badge « envoi echoue » jamais verifie.
 *
 * Corriger 127 appels aurait ete absurde. Le levier est ici, dans la couche de
 * traduction, et ces tests sont ce qui la rend fiable : une regle de traduction
 * non testee est une regle qui mentira un jour.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function contact(db, userId, nom, over = {}) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, name, company, status, deal_value,
                                last_activity_at, created_at, won_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, nom, over.company || null, over.status || 'imported', over.dealValue ?? null,
     over.lastActivityAt || ago(10), over.createdAt || ago(100), over.wonDate || null]
  );
  return r.rows[0].id;
}

// ═══════════════════════════════════════════════════════════════════════════
// = ANY($n) · 46 occurrences dans le backend
// ═══════════════════════════════════════════════════════════════════════════

test('= ANY sur un tableau se developpe en IN', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  const a = await contact(db, user.id, 'Un');
  const b = await contact(db, user.id, 'Deux');
  await contact(db, user.id, 'Trois');

  const r = await db.query(
    `SELECT name FROM opportunities WHERE user_id = $1 AND id = ANY($2) ORDER BY name`,
    [user.id, [a, b]]
  );
  assert.deepStrictEqual(r.rows.map(x => x.name), ['Deux', 'Un']);
});

test('= ANY sur un tableau VIDE ne ramene rien, et ne plante pas', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Un');

  // `IN ()` est une erreur de syntaxe en SQLite. Un `= ANY` d'un tableau vide
  // est faux par definition : on le dit en SQL plutot que de laisser casser.
  const r = await db.query(
    `SELECT name FROM opportunities WHERE user_id = $1 AND id = ANY($2)`,
    [user.id, []]
  );
  assert.strictEqual(r.rows.length, 0);
});

test('<> ANY sur un tableau vide est vrai, pas faux', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Un');

  const r = await db.query(
    `SELECT name FROM opportunities WHERE user_id = $1 AND id <> ANY($2)`,
    [user.id, []]
  );
  assert.strictEqual(r.rows.length, 1, 'n appartenir a aucun element d un ensemble vide est vrai');
});

test('l idiome de perimetre repete le meme parametre, et l ordre tient', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  const a = await contact(db, user.id, 'Un');
  await contact(db, user.id, 'Deux');

  // C'est l'idiome du code : `($2::uuid[] IS NULL OR id = ANY($2))`. Le meme
  // parametre apparait DEUX fois, une fois brut et une fois developpe. Deux
  // passes separees pousseraient les elements avant la valeur brute et toute
  // requete de ce type lirait des parametres decales.
  const sql = `SELECT name FROM opportunities
                WHERE user_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2))
                ORDER BY name`;

  const sansFiltre = await db.query(sql, [user.id, null]);
  assert.deepStrictEqual(sansFiltre.rows.map(x => x.name), ['Deux', 'Un'],
    'perimetre NULL : tout remonte');

  const avecFiltre = await db.query(sql, [user.id, [a]]);
  assert.deepStrictEqual(avecFiltre.rows.map(x => x.name), ['Un'],
    'perimetre renseigne : seule la ligne demandee remonte');
});

// ═══════════════════════════════════════════════════════════════════════════
// ::interval · 7 occurrences, dont le verrou des ecritures de memoire
// ═══════════════════════════════════════════════════════════════════════════

test('l arithmetique de dates en ::interval s execute', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Recent', { lastActivityAt: ago(5) });
  await contact(db, user.id, 'Vieux', { lastActivityAt: ago(200) });

  // La forme de lib/reactivation-queue.js avant correction, et celle que
  // lib/db-lock.js et lib/hidden-revenue/detect.js utilisent encore.
  const r = await db.query(
    `SELECT name FROM opportunities
      WHERE user_id = $1 AND last_activity_at < now() - ($2 || ' days')::interval`,
    [user.id, '30']
  );
  assert.deepStrictEqual(r.rows.map(x => x.name), ['Vieux']);
});

test('un interval en SECONDES, et vers le futur', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  await registerAndLogin();

  // La forme exacte de lib/db-lock.js : `now() + ($3 || ' seconds')::interval`.
  // C'est le verrou des ecritures de memoire, et il n'avait jamais pu etre
  // teste sous le miroir.
  const r = await db.query(`SELECT now() + ($1 || ' seconds')::interval AS futur`, ['60']);
  const futur = r.rows[0].futur;
  assert.ok(futur, 'la date est calculee');
  // Le miroir rend le format CANONIQUE partout : de l'ISO-8601 en Z, le meme
  // que `toISOString()`. C'est ce qui rend l'ordre lexical chronologique, donc
  // les comparaisons de dates justes · voir MAINTENANT_ISO dans l'adaptateur.
  assert.match(futur, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    `format inattendu : ${futur}`);
  const dans = (new Date(futur).getTime() - Date.now()) / 1000;
  assert.ok(dans > 55 && dans < 65, `60 secondes attendues, ${Math.round(dans)} obtenues`);
});

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACT · 27 occurrences, dont 15 EPOCH
// ═══════════════════════════════════════════════════════════════════════════

test('EXTRACT(EPOCH FROM (a - b)) rend bien des secondes', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Gagne', { status: 'won', createdAt: ago(100), wonDate: ago(40) });

  // C'est la forme du cycle de vente. Traduite en strftime sur une
  // soustraction de chaines, elle rendait NULL en silence : le cycle aurait
  // ete vide sans que rien ne le signale.
  const r = await db.query(
    `SELECT ROUND(EXTRACT(EPOCH FROM (won_date - created_at)) / 86400) AS jours
       FROM opportunities WHERE user_id = $1 AND status = 'won'`,
    [user.id]
  );
  assert.strictEqual(Number(r.rows[0].jours), 60, '100 jours moins 40 en font 60');
});

test('EXTRACT ne se fait pas couper par une parenthese interne', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Sans date gagnee', { createdAt: ago(90), wonDate: null, lastActivityAt: ago(30) });

  // Un COALESCE dans l'argument : c'est ce qui casse une regex gourmande, qui
  // avale la parenthese fermante de la requete entiere, et une regex
  // paresseuse, qui coupe l'argument en deux.
  const r = await db.query(
    `SELECT ROUND(EXTRACT(EPOCH FROM (COALESCE(won_date, last_activity_at) - created_at)) / 86400) AS jours
       FROM opportunities WHERE user_id = $1`,
    [user.id]
  );
  assert.strictEqual(Number(r.rows[0].jours), 60, '90 jours moins 30 en font 60');
});

test('EXTRACT(DAY FROM une difference) rend des jours', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Un', { createdAt: ago(45), lastActivityAt: ago(15) });

  const r = await db.query(
    `SELECT ROUND(EXTRACT(DAY FROM (last_activity_at - created_at))) AS jours
       FROM opportunities WHERE user_id = $1`,
    [user.id]
  );
  assert.strictEqual(Number(r.rows[0].jours), 30);
});

test('ISODOW met dimanche a 7, pas a 0', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  await registerAndLogin();

  // Postgres : ISODOW va de 1 (lundi) a 7 (dimanche). SQLite met dimanche a 0.
  // Laisser le decalage fausserait toute analyse hebdomadaire d'un jour.
  const dim = await db.query(`SELECT EXTRACT(ISODOW FROM $1) AS j`, ['2026-10-04T12:00:00.000Z']);
  const lun = await db.query(`SELECT EXTRACT(ISODOW FROM $1) AS j`, ['2026-10-05T12:00:00.000Z']);
  assert.strictEqual(Number(dim.rows[0].j), 7, 'le 04/10/2026 est un dimanche');
  assert.strictEqual(Number(lun.rows[0].j), 1, 'le 05/10/2026 est un lundi');

  // DOW, lui, part de 0 le dimanche dans les deux moteurs : on ne le decale pas.
  const dow = await db.query(`SELECT EXTRACT(DOW FROM $1) AS j`, ['2026-10-04T12:00:00.000Z']);
  assert.strictEqual(Number(dow.rows[0].j), 0);
});

test('EXTRACT(HOUR FROM x) rend une heure', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  await registerAndLogin();
  const r = await db.query(`SELECT EXTRACT(HOUR FROM $1) AS h`, ['2026-10-02T14:30:00.000Z']);
  assert.strictEqual(Number(r.rows[0].h), 14);
});

// ═══════════════════════════════════════════════════════════════════════════
// ILIKE
// ═══════════════════════════════════════════════════════════════════════════

test('ILIKE devient un LIKE insensible a la casse', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  await contact(db, user.id, 'Sandrine Chevalier', { company: 'Atelier Vasseur' });

  const r = await db.query(
    `SELECT name FROM opportunities WHERE user_id = $1 AND company ILIKE $2`,
    [user.id, '%vasseur%']
  );
  assert.strictEqual(r.rows.length, 1, 'la recherche ne doit pas dependre de la casse');
});

/* ═══════════ make_interval · l'argument nomme de Postgres ═══════════
 *
 * `make_interval(days => $1)` est la troisieme facon dont ce code ecrit une
 * arithmetique de dates, apres `interval 'N unit'` et `($n || ' days')::interval`.
 * C'est la seule qui utilise la syntaxe d'argument nomme `=>`, que SQLite
 * rejette des l'analyse avec un « near ">" » muet sur la cause.
 *
 * Dix-sept occurrences dans quatre fichiers. Celle qui a fait decouvrir le
 * probleme tient la DEDUPLICATION DE REINSCRIPTION (`enrolledRecently` dans
 * lib/automation-enroll.js) : le garde-fou qui empeche un contact d'entrer deux
 * fois dans le meme workflow n'avait jamais pu s'executer en test.
 */

test('make_interval en soustraction rend une date passee', async (t) => {
  await setup();
  t.after(teardown);
  const db = require('../db');

  const r = await db.query(
    `SELECT now() - make_interval(days => $1::int) AS avant,
            now() AS maintenant`,
    [7]
  );
  const avant = new Date(r.rows[0].avant).getTime();
  const maintenant = new Date(r.rows[0].maintenant).getTime();
  const ecart = (maintenant - avant) / 86400000;
  assert.ok(Math.abs(ecart - 7) < 0.01, `7 jours attendus, ${ecart} obtenus`);
});

test('make_interval en addition rend une date future', async (t) => {
  await setup();
  t.after(teardown);
  const db = require('../db');

  const r = await db.query(
    `SELECT now() + make_interval(days => $1::int) AS apres, now() AS maintenant`,
    [30]
  );
  const ecart = (new Date(r.rows[0].apres).getTime() - new Date(r.rows[0].maintenant).getTime()) / 86400000;
  assert.ok(Math.abs(ecart - 30) < 0.01, `30 jours attendus, ${ecart} obtenus`);
});

test('make_interval accepte une expression, pas seulement un parametre', async (t) => {
  await setup();
  t.after(teardown);
  const db = require('../db');

  // L'idiome reel de lib/automation-state-triggers.js : une borne de fenetre
  // ecrite comme `$2::int + 7`. Une traduction qui ne prendrait que le
  // parametre rendrait 7 jours au lieu de 14, donc une fenetre deux fois trop
  // courte · et personne ne le verrait.
  const r = await db.query(
    `SELECT now() - make_interval(days => $1::int + 7) AS borne, now() AS maintenant`,
    [7]
  );
  const ecart = (new Date(r.rows[0].maintenant).getTime() - new Date(r.rows[0].borne).getTime()) / 86400000;
  assert.ok(Math.abs(ecart - 14) < 0.01, `14 jours attendus, ${ecart} obtenus`);
});

test('make_interval traduit aussi les minutes', async (t) => {
  await setup();
  t.after(teardown);
  const db = require('../db');

  // `mins` chez Postgres, `minutes` chez SQLite · db/index.js s'en sert pour
  // le disjoncteur horaire des automatisations.
  const r = await db.query(
    `SELECT now() - make_interval(mins => $1::int) AS avant, now() AS maintenant`,
    [90]
  );
  const ecart = (new Date(r.rows[0].maintenant).getTime() - new Date(r.rows[0].avant).getTime()) / 60000;
  assert.ok(Math.abs(ecart - 90) < 1, `90 minutes attendues, ${ecart} obtenues`);
});

test('la deduplication de reinscription s execute enfin', async (t) => {
  await setup();
  t.after(teardown);
  const db = require('../db');
  const { user } = await registerAndLogin();

  const wf = await db.query(
    `INSERT INTO workflows (user_id, name, reenroll_policy, reenroll_days)
     VALUES ($1, 'Relance', 'period', 90) RETURNING id`, [user.id]
  );
  const o = await db.query(
    `INSERT INTO opportunities (user_id, name, email, status)
     VALUES ($1, 'Contact', 'c@x.fr', 'open') RETURNING id`, [user.id]
  );

  // Une inscription vieille de 10 jours : dans la fenetre de 90, donc la
  // reinscription doit etre refusee.
  await db.query(
    `INSERT INTO sequence_enrollments (user_id, opportunity_id, workflow_id, goal, status, created_at)
     VALUES ($1, $2, $3, 'automation', 'completed', $4)`,
    [user.id, o.rows[0].id, wf.rows[0].id, new Date(Date.now() - 10 * 86400000).toISOString()]
  );

  const dedans = await db.query(
    `SELECT 1 FROM sequence_enrollments
      WHERE workflow_id = $1 AND opportunity_id = $2
        AND created_at > now() - make_interval(days => $3::int)
      LIMIT 1`,
    [wf.rows[0].id, o.rows[0].id, 90]
  );
  assert.strictEqual(dedans.rows.length, 1, 'inscrit il y a 10 jours, fenetre de 90 : trouve');

  const dehors = await db.query(
    `SELECT 1 FROM sequence_enrollments
      WHERE workflow_id = $1 AND opportunity_id = $2
        AND created_at > now() - make_interval(days => $3::int)
      LIMIT 1`,
    [wf.rows[0].id, o.rows[0].id, 5]
  );
  assert.strictEqual(dehors.rows.length, 0, 'fenetre de 5 jours : hors fenetre, donc absent');
});
