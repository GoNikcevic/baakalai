/**
 * Le miroir de test couvre-t-il le schema reel, en entier ?
 *
 * ── Ce que ce fichier remplace ──────────────────────────────────────────────
 *
 * tests/schema-mirror.test.js verifie que les tables DEJA miroitees sont
 * completes, et il le disait franchement : « il ne reclame pas que le miroir
 * contienne TOUTES les tables, il ne replique que celles que les tests
 * utilisent ». Cette phrase etait la dette. Mesure le 2026-10-02 : 33 tables
 * miroitees sur 78 reelles, et les 45 absentes toutes lues ou ecrites par du
 * code qui tourne en production.
 *
 * Une fonction dont la table manque n'est pas « mal testee », elle est
 * INTESTABLE · et on ne l'apprend qu'en ecrivant un test qui refuse de
 * demarrer, souvent des mois plus tard. Les deux garde-fous se completent
 * desormais : l'autre tient les colonnes, celui-ci tient la COUVERTURE.
 *
 * Il ne compare pas le miroir a une liste ecrite a la main · une liste derive
 * comme le reste. Il le compare au schema reel tel que le socle et les
 * migrations le decrivent, c'est-a-dire a ce que Postgres a execute.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lireSchema } = require('../db/mirror-from-migrations');
const { setup, teardown, registerAndLogin } = require('./helpers');

describe('couverture du miroir', () => {
  it('toute table du schema reel existe dans le miroir, avec toutes ses colonnes', async (t) => {
    await setup();
    t.after(teardown);

    const { getDb } = require('../db/sqlite-adapter');
    const d = getDb();
    const presentes = new Map(
      d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map(r => [r.name, new Set(d.prepare('SELECT name FROM pragma_table_info(?)').all(r.name).map(c => c.name))])
    );

    const reel = lireSchema();
    const tablesManquantes = [];
    const colonnesManquantes = [];

    for (const [table, def] of reel.tables) {
      if (def.colonnes.size === 0) continue;
      const vues = presentes.get(table);
      if (!vues) { tablesManquantes.push(table); continue; }
      for (const colonne of def.colonnes.keys()) {
        if (!vues.has(colonne)) colonnesManquantes.push(`${table}.${colonne}`);
      }
    }

    assert.deepEqual(tablesManquantes, [],
      `Tables du schema reel absentes du miroir. Tant qu'elles manquent, toute requete qui les nomme est intestable : un test qui en ecrit un echoue sur « no such table », loin de toute vraie regression.`);
    assert.deepEqual(colonnesManquantes, [],
      `Colonnes du schema reel absentes du miroir.`);

    // Le chiffre sert de reperage : s'il chute, quelque chose a cesse d'etre lu.
    assert.ok(reel.tables.size >= 78, `Le schema reel declare ${reel.tables.size} tables, on en attendait au moins 78 · si le compte baisse, c'est le LECTEUR qui est casse, pas le schema.`);
  });

  it('aucune declaration du schema reel n est passee sous silence', () => {
    const { ignorees } = lireSchema();

    // C'est LE test qui tient la dette fermee. Le generateur ne devine pas : il
    // signale tout ce qu'il n'a pas su traduire · un type inconnu, un index
    // partiel dont le predicat sort de son vocabulaire. Si une future migration
    // introduit une construction qu'il ne lit pas, ce test echoue en la nommant,
    // au lieu de laisser le miroir se construire incomplet et vert.
    assert.deepEqual(ignorees, [],
      `Declarations non traduites. Chacune est une colonne ou un index que le miroir N'AURA PAS, donc du code qui redevient intestable sans bruit. Les traiter dans db/mirror-from-migrations.js.`);
  });

  it('les noms de colonnes JSONB ambigus sont exactement ceux que l adaptateur ecarte', () => {
    // Le decodage JSONB de l'adaptateur se fait par NOM de colonne, parce qu'un
    // resultat de SELECT ne dit pas de quelle table vient chaque colonne. Ca ne
    // tient que si un nom designe TOUJOURS du JSONB. Deux noms ne le font pas
    // (`content` est TEXT dans chat_messages, `result` est TEXT dans versions),
    // et l'adaptateur les ecarte nommement.
    //
    // Ce test est ce qui empeche la liste de pourrir : si une migration rend un
    // TROISIEME nom ambigu, il echoue · sinon l'adaptateur transformerait
    // silencieusement du texte en objet.
    const { colonnesJson } = lireSchema();
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'db', 'supabase-schema.sql'), 'utf8')
      + fs.readFileSync(path.join(__dirname, '..', 'db', 'supabase-rls-and-extras.sql'), 'utf8')
      + fs.readdirSync(path.join(__dirname, '..', 'db', 'migrations'))
        .filter(f => f.endsWith('.sql'))
        .map(f => fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', f), 'utf8'))
        .join('\n');

    const ambigus = [];
    for (const nom of colonnesJson) {
      // Le meme nom declare avec un type qui n'est pas du JSON, n'importe ou.
      const re = new RegExp(`\\b${nom}\\s+(?!JSONB?\\b)(TEXT|UUID|INTEGER|BOOLEAN|NUMERIC|TIMESTAMPTZ|DATE|REAL|DECIMAL)\\b`, 'i');
      if (re.test(src)) ambigus.push(nom);
    }

    assert.deepEqual(ambigus.sort(), ['content', 'result'],
      `Les noms de colonnes JSONB ambigus ont change. L'adaptateur en ecarte deux (COLONNES_JSON_AMBIGUES) · cette liste doit suivre, sinon il decode du texte comme du JSON ou prive une colonne de son decodage.`);
  });

  it('une colonne JSONB se lit comme un objet, pas comme une chaine', async (t) => {
    await setup();
    t.after(teardown);

    const db = require('../db');
    const { user } = await registerAndLogin();

    // Le bug de classe que ce lot ferme : `getStagnantDays` lisait
    // `users.settings.stagnant_days` et rendait TOUJOURS 30 sous le miroir,
    // parce que `row.settings` y etait une chaine et que l'acces de propriete
    // valait `undefined` sans erreur. Le test passait, le defaut etait celui
    // qu'on attendait, et le reglage n'etait jamais lu.
    await db.query(`UPDATE users SET settings = $1 WHERE id = $2`,
      [JSON.stringify({ stagnant_days: 45, account_weekly_cap: 3 }), user.id]);

    const { rows } = await db.query('SELECT settings FROM users WHERE id = $1', [user.id]);
    assert.equal(typeof rows[0].settings, 'object', 'la colonne doit arriver decodee, comme la rend Postgres');
    assert.equal(rows[0].settings.stagnant_days, 45, 'et l acces direct doit donner la valeur enregistree');

    // Et le reglage est maintenant reellement lu par le code qui en depend.
    const { getStagnantDays } = require('../lib/stagnation');
    assert.equal(await getStagnantDays(user.id), 45,
      'le reglage de l utilisateur doit l emporter sur le defaut de 30 jours');

    const { getWeeklyCap } = require('../lib/account-cadence');
    assert.equal(await getWeeklyCap(user.id), 3,
      'le plafond d envoi par societe doit lire le reglage, pas son defaut de 2');
  });

  it('une colonne TEXT qui ressemble a du JSON reste une chaine', async (t) => {
    await setup();
    t.after(teardown);

    const db = require('../db');
    const { user } = await registerAndLogin();

    // Le revers du decodage par nom : il ne doit pas toucher ce qui n'est pas
    // du JSONB. `versions.result` est TEXT, et son homonyme est JSONB ailleurs.
    const campagne = await db.query(
      `INSERT INTO campaigns (user_id, name) VALUES ($1, 'Essai') RETURNING id`, [user.id]
    );
    await db.query(
      `INSERT INTO versions (campaign_id, version, result) VALUES ($1, 1, $2)`,
      [campagne.rows[0].id, '{ceci n est pas du JSON}']
    );
    const { rows } = await db.query('SELECT result FROM versions WHERE campaign_id = $1', [campagne.rows[0].id]);
    assert.equal(typeof rows[0].result, 'string', 'une colonne TEXT doit rester une chaine');
    assert.equal(rows[0].result, '{ceci n est pas du JSON}');
  });

  it('les tables qui etaient absentes acceptent maintenant une requete', async (t) => {
    await setup();
    t.after(teardown);

    const db = require('../db');
    const { user } = await registerAndLogin();

    // Six des quarante-cinq tables ajoutees, choisies parce que ce sont celles
    // qui bloquaient le plus de code : chacune de ces requetes echouait sur
    // « no such table » avant ce lot.
    const contact = await db.query(
      `INSERT INTO opportunities (user_id, name, status) VALUES ($1, 'Contact', 'open') RETURNING id`, [user.id]
    );
    const oppId = contact.rows[0].id;

    await db.query(
      `INSERT INTO signals (user_id, signal_type, title, opportunity_id) VALUES ($1, 'hiring', 'Recrute', $2)`,
      [user.id, oppId]
    );
    await db.query(
      `INSERT INTO prospect_activities (user_id, opportunity_id, type) VALUES ($1, $2, 'email_sent')`,
      [user.id, oppId]
    );
    await db.query(
      `INSERT INTO notifications (user_id, type, title) VALUES ($1, 'reply', 'Une reponse')`, [user.id]
    );
    // `product_lines` est portee par l'EQUIPE, pas par l'utilisateur, et
    // `cron_runs` nomme ses colonnes `job` et `ok`. Deux formes qu'aucun test
    // ne pouvait etablir avant ce lot, faute de pouvoir interroger les tables.
    const equipe = await db.query(
      `INSERT INTO teams (name, created_by) VALUES ('Equipe', $1) RETURNING id`, [user.id]
    );
    await db.query(
      `INSERT INTO product_lines (team_id, name) VALUES ($1, 'Abonnement')`, [equipe.rows[0].id]
    );
    await db.query(
      `INSERT INTO cron_runs (job, ok) VALUES ('crm-agent', true)`, []
    );

    const signaux = await db.query('SELECT signal_type, status FROM signals WHERE user_id = $1', [user.id]);
    assert.equal(signaux.rows.length, 1);
    assert.equal(signaux.rows[0].status, 'new', 'le defaut du schema reel doit s appliquer');

    const activites = await db.query(
      'SELECT count(*) AS n FROM prospect_activities WHERE opportunity_id = $1', [oppId]
    );
    assert.equal(Number(activites.rows[0].n), 1);

    // Et une des requetes reecrites ce matin, qui n'etait verifiable par aucun
    // test faute de table · la fenetre sur signals de routes/signals.js.
    const fenetre = await db.query(
      `SELECT signal_type, titre FROM (
         SELECT signal_type, title AS titre,
                ROW_NUMBER() OVER (PARTITION BY signal_type ORDER BY detected_at DESC) AS rn
           FROM signals WHERE user_id = $1
       ) d WHERE rn = 1`,
      [user.id]
    );
    assert.equal(fenetre.rows.length, 1, 'une ligne par type de signal');
    assert.equal(fenetre.rows[0].titre, 'Recrute');
  });

  it('un upsert sur index partiel fonctionne', async (t) => {
    await setup();
    t.after(teardown);

    const db = require('../db');
    const { user } = await registerAndLogin();

    // Les index uniques ne sont pas la pour la performance : `ON CONFLICT (...)`
    // s'adosse a eux, et SQLite refuse la requete sans index correspondant.
    // ONZE des quinze index uniques du schema sont PARTIELS, donc les emettre
    // sans leur clause `WHERE` aurait rendu le miroir plus strict que Postgres
    // et aurait interdit des lignes que la vraie base accepte.
    await db.query(
      `INSERT INTO accounts (user_id, name, name_normalized, crm_provider, crm_account_id)
       VALUES ($1, 'Acme', 'acme', 'pipedrive', '7')`, [user.id]
    );
    await db.query(
      `INSERT INTO accounts (user_id, name, name_normalized, crm_provider, crm_account_id)
       VALUES ($1, 'Acme Corp', 'acme corp', 'pipedrive', '7')
       ON CONFLICT (user_id, crm_provider, crm_account_id) WHERE crm_account_id IS NOT NULL
       DO UPDATE SET name = excluded.name`, [user.id]
    );

    const { rows } = await db.query('SELECT count(*) AS n, max(name) AS nom FROM accounts WHERE user_id = $1', [user.id]);
    assert.equal(Number(rows[0].n), 1, 'une seule societe, pas deux');
    assert.equal(rows[0].nom, 'Acme Corp', 'et c est la mise a jour qui a gagne');
  });
});
