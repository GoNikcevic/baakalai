/**
 * Le miroir de test, derive des migrations au lieu d'etre tenu a la main.
 *
 * ── Le probleme, mesure le 2026-10-02 ───────────────────────────────────────
 *
 * Les tests ne tapent pas dans Postgres : ils tournent sur une base SQLite
 * jetable dont le schema etait recopie A LA MAIN dans db/sqlite-adapter.js.
 * Resultat mesure : 33 tables miroitees pour 69 declarees par les migrations,
 * et les 44 tables absentes sont TOUTES lues ou ecrites par du code qui tourne
 * en production · prospect_activities dans 17 fichiers, signals dans 8,
 * notifications dans 6, opportunity_product_lines dans 9.
 *
 * Le garde-fou existant (tests/schema-mirror.test.js) ne pouvait pas le voir,
 * et il le disait : « il ne reclame pas que le miroir contienne TOUTES les
 * tables, il ne replique que celles que les tests utilisent ». C'est cette
 * decision qui a produit la dette. Elle avait sa logique · recopier 69 tables a
 * la main est absurde · mais sa consequence est qu'une fonction dont la table
 * manque n'est pas « mal testee », elle est INTESTABLE, et on ne l'apprend
 * qu'en ecrivant un test qui refuse de demarrer.
 *
 * ── Pourquoi deriver, et pas recopier 44 fois de plus ───────────────────────
 *
 * Recopier a la main, c'est refaire exactement le geste qui a creuse l'ecart :
 * un miroir tenu a la main derive a la migration suivante, et il derive en
 * SILENCE. Les migrations sont la source de verite du schema reel · elles sont
 * ce que Postgres a execute. Les lire est donc la seule facon d'etre a jour par
 * construction plutot que par discipline.
 *
 * Le pari a ete verifie avant d'etre pris : ce parseur reproduit les 33 tables
 * ecrites a la main a UNE colonne pres (memory_patterns.embedding, du pgvector
 * volontairement ecarte). C'est ce qui a autorise a continuer.
 *
 * ── Ce que ce module ne fait pas, et pourquoi ───────────────────────────────
 *
 * Il ne traduit PAS tout le DDL Postgres, seulement ce dont un test a besoin
 * pour que les requetes partent : tables, colonnes, types, valeurs par defaut,
 * cles primaires et contraintes d'unicite (celles-la sont indispensables, un
 * `ON CONFLICT (...)` echoue sans index unique correspondant).
 *
 * Volontairement ignores : les REFERENCES (le miroir tourne en
 * `foreign_keys = OFF`, assume par l'adaptateur), les CHECK (leurs predicats
 * appellent parfois du Postgres pur), les triggers, les fonctions et le RLS.
 * Ignorer une contrainte rend le miroir PLUS PERMISSIF que Postgres, ce qui est
 * le bon sens de l'erreur : un test peut alors inserer une ligne que la vraie
 * base refuserait, mais aucun test ne peut echouer sur une contrainte qui
 * n'existe pas en production.
 *
 * ── Pourquoi le bloc ecrit a la main RESTE ──────────────────────────────────
 *
 * Ce module pourrait le remplacer : il reproduit ses 33 tables, toutes
 * colonnes, et en ajoute 45. La question a donc ete posee, et tranchee sur
 * mesure plutot que sur principe. Comparaison colonne par colonne des deux
 * schemas, au-dela des seuls noms :
 *
 *   - 70 `NOT NULL` que le bloc a la main pose et que ce module ne pose pas
 *     (choix assume, voir traduireColonne) ;
 *   - 32 valeurs par defaut qui different, le bloc a la main etant plus
 *     genereux (`touchpoints.body` a '', `campaigns.stops` a 0) ;
 *   - `refresh_tokens.id` qui passerait d'INTEGER a TEXT, donc perdrait son
 *     statut d'alias de rowid et son auto-incrementation.
 *
 * Chacun de ces trois points peut casser un test pour une raison etrangere a
 * ce qu'il mesure, et le gain du remplacement serait la PURETE, pas une
 * capacite de plus. L'ajout seul regle la dette en entier. Donc on ajoute.
 *
 * Tout est emis en `CREATE TABLE IF NOT EXISTS` et applique APRES le bloc ecrit
 * a la main : celui-ci garde la main sur les 33 tables qu'il declare, et aucun
 * des tests existants ne change de base sous lui.
 *
 * La derive future est tenue par un test, pas par la discipline :
 * tests/mirror-coverage.test.js echoue des qu'une migration declare une table
 * ou une colonne que ce module ne sait pas lire.
 *
 * Une seule colonne du bloc a la main n'existe nulle part ailleurs :
 * `user_profiles.created_at`, que la vraie base ne porte pas. Verifie le
 * 2026-10-02, aucun code ne la lit ni ne l'ecrit · un surplus inoffensif, pas
 * une panne qui attend.
 */

const fs = require('fs');
const path = require('path');

const DOSSIER_MIGRATIONS = path.join(__dirname, 'migrations');

/**
 * Le socle, pose avant la premiere migration.
 *
 * Le dossier `migrations/` n'est PAS la source de verite complete, et c'est un
 * piege qu'il a fallu heurter deux fois pour le voir en entier : neuf tables
 * (users, campaigns, opportunities, user_profiles, touchpoints, versions,
 * memory_patterns, chat_threads, documents) n'y ont aucun `CREATE TABLE`, les
 * migrations ne font que les ALTER. Leur forme initiale vit dans les deux
 * fichiers ci-dessous, et `opportunities` · la table centrale du produit · est
 * dans le SECOND, pas le premier.
 *
 * Lire les migrations seules donnait un schema a 126 colonnes de moins sur ces
 * neuf tables. Le generateur avait l'air de marcher, et il perdait les tables
 * les plus utilisees du produit : c'est exactement la panne silencieuse que ce
 * module existe pour supprimer, et elle s'est presentee pendant son ecriture.
 *
 * L'ordre est celui dans lequel ces fichiers ont ete joues sur la vraie base.
 */
const SOCLES = [
  path.join(__dirname, 'supabase-schema.sql'),
  path.join(__dirname, 'supabase-rls-and-extras.sql'),
];

/** Un UUID v4 en SQLite pur, le meme que celui du bloc ecrit a la main. */
const UUID_SQLITE =
  "(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || " +
  "hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))))";

/**
 * L'horloge du miroir, en ISO-8601 Z.
 *
 * Doit rester identique a MAINTENANT_ISO dans sqlite-adapter.js. Le format
 * n'est pas cosmetique : SQLite compare des dates comme des CHAINES, et le
 * « 2026-10-02 18:00:00 » de CURRENT_TIMESTAMP se classe AVANT le
 * « 2026-10-02T17:00:00.000Z » qu'ecrit l'application, parce que l'espace pese
 * moins que le T. Une date passee y paraissait donc future.
 */
const MAINTENANT_ISO = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Postgres vers SQLite. Le vocabulaire reellement utilise par les migrations. */
const TYPES = {
  uuid: 'TEXT',
  text: 'TEXT',
  varchar: 'TEXT',
  'character varying': 'TEXT',
  char: 'TEXT',
  inet: 'TEXT',
  json: 'TEXT',
  jsonb: 'TEXT',
  timestamptz: 'TEXT',
  timestamp: 'TEXT',
  'timestamp with time zone': 'TEXT',
  'timestamp without time zone': 'TEXT',
  date: 'TEXT',
  time: 'TEXT',
  interval: 'TEXT',
  boolean: 'INTEGER',
  bool: 'INTEGER',
  smallint: 'INTEGER',
  integer: 'INTEGER',
  int: 'INTEGER',
  int4: 'INTEGER',
  bigint: 'INTEGER',
  int8: 'INTEGER',
  serial: 'INTEGER',
  bigserial: 'INTEGER',
  numeric: 'REAL',
  decimal: 'REAL',
  real: 'REAL',
  'double precision': 'REAL',
  float: 'REAL',
};

/**
 * Types sans equivalent, et ce qu'on en fait.
 *
 * `vector` est du pgvector : la colonne est EMISE quand meme, en TEXT, parce
 * qu'une colonne absente fait echouer un `INSERT` qui la nomme alors qu'une
 * colonne TEXT inutilisee ne gene personne. Aucun test ne lit un embedding, et
 * s'il en lisait un il obtiendrait une chaine, pas un vecteur : c'est pour ca
 * que schema-mirror.test.js la garde en exception documentee.
 */
const TYPES_SANS_EQUIVALENT = new Set(['vector']);

/** Decoupe sur les virgules de PREMIER niveau · `NUMERIC(12, 2)` ne doit pas
 *  etre coupe en deux, ni `CHECK (x IN ('a', 'b'))`. */
function decouperTopLevel(corps) {
  const morceaux = [];
  let profondeur = 0;
  let courant = '';
  let chaine = null;
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i];
    if (chaine) {
      courant += c;
      if (c === chaine) chaine = null;
      continue;
    }
    if (c === "'" || c === '"') { chaine = c; courant += c; continue; }
    if (c === '(') profondeur++;
    if (c === ')') profondeur--;
    if (c === ',' && profondeur === 0) { morceaux.push(courant); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim()) morceaux.push(courant);
  return morceaux.map(m => m.trim()).filter(Boolean);
}

/** Retire les commentaires `--` sans casser une chaine qui en contiendrait. */
function sansCommentaires(sql) {
  return sql.split('\n').map(ligne => {
    let chaine = null;
    for (let i = 0; i < ligne.length; i++) {
      const c = ligne[i];
      if (chaine) { if (c === chaine) chaine = null; continue; }
      if (c === "'" || c === '"') { chaine = c; continue; }
      if (c === '-' && ligne[i + 1] === '-') return ligne.slice(0, i);
    }
    return ligne;
  }).join('\n');
}

const MOTS_CONTRAINTE = /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i;

/**
 * Le vocabulaire qu'un predicat d'index partiel peut utiliser pour etre recopie
 * tel quel : noms de colonnes, litteraux, comparaisons, IS [NOT] NULL, IN, AND,
 * OR, NOT. Rien d'autre · surtout pas un appel de fonction ni un cast `::`,
 * qui ne voudraient pas dire la meme chose des deux cotes.
 */
const PREDICAT_SUR = /^(?:[a-z_][a-z_0-9]*|'(?:[^']|'')*'|-?\d+(?:\.\d+)?|IS|NOT|NULL|AND|OR|IN|TRUE|FALSE|=|<>|!=|<|>|<=|>=|\(|\)|,|\s)+$/i;

/** La valeur par defaut, traduite · null quand on ne sait pas la traduire. */
function traduireDefaut(reste) {
  const m = reste.match(/\bDEFAULT\s+(.+)$/is);
  if (!m) return null;
  let v = m[1].trim();

  // Couper ce qui suit le defaut sur la meme definition de colonne.
  v = v.replace(/\s+(NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|GENERATED)\b[\s\S]*$/i, '').trim();
  v = v.replace(/;+$/, '').trim();
  v = v.replace(/::[a-z_]+(\[\])?/gi, '').trim();   // '{}'::jsonb devient '{}'

  if (/^(gen_random_uuid|uuid_generate_v4)\s*\(\s*\)$/i.test(v)) return UUID_SQLITE;
  if (/^(now|current_timestamp|clock_timestamp|statement_timestamp)\s*(\(\s*\))?$/i.test(v)) return `(${MAINTENANT_ISO})`;
  if (/^current_date$/i.test(v)) return `(strftime('%Y-%m-%d','now'))`;
  if (/^true$/i.test(v)) return '1';
  if (/^false$/i.test(v)) return '0';
  if (/^null$/i.test(v)) return 'NULL';
  if (/^ARRAY\s*\[\s*\]$/i.test(v)) return "'[]'";
  if (/^'([^']|'')*'$/.test(v)) return v;                     // litteral texte
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;                    // litteral numerique
  // Tout le reste (appel de fonction, expression) est abandonne : un defaut
  // qu'on traduirait mal vaut moins qu'un defaut absent, parce que le test
  // ecrirait alors une valeur FAUSSE sans rien signaler.
  return null;
}

/**
 * Une definition de colonne Postgres vers sa definition SQLite.
 * @returns {{nom: string, type: string, sql: string, json: boolean}|null}
 */
function traduireColonne(def) {
  if (MOTS_CONTRAINTE.test(def)) return null;
  const m = def.match(/^"?([a-z_][a-z_0-9]*)"?\s+([\s\S]+)$/i);
  if (!m) return null;
  const nom = m[1].toLowerCase();
  const reste = m[2];

  // Le type, avec sa precision eventuelle et son suffixe de tableau.
  const mt = reste.match(/^([a-z_][a-z_ ]*?)\s*(\(\s*[\d,\s]*\s*\))?\s*(\[\s*\])?(?=\s|$|,)/i);
  if (!mt) return null;
  const brut = mt[1].trim().toLowerCase();
  const tableau = Boolean(mt[3]);

  let type;
  if (tableau) {
    // Un tableau Postgres arrive en chaine cote miroir · c'est deja ce que fait
    // toSqliteValue dans l'adaptateur pour les parametres.
    type = 'TEXT';
  } else if (TYPES_SANS_EQUIVALENT.has(brut)) {
    type = 'TEXT';
  } else {
    type = TYPES[brut];
    if (!type) return null;   // type inconnu : on prefere omettre la colonne et le dire
  }

  const morceaux = [`${nom} ${type}`];
  // Une cle primaire monocolonne se garde : elle sert aux ON CONFLICT.
  if (/\bPRIMARY\s+KEY\b/i.test(reste)) morceaux.push('PRIMARY KEY');
  else if (/\bUNIQUE\b/i.test(reste) && !/\bREFERENCES\b[\s\S]*\bUNIQUE\b/i.test(reste)) morceaux.push('UNIQUE');

  // NOT NULL n'est JAMAIS recopie · ni ici, ni ailleurs dans ce module.
  //
  // Un test qui n'alimente pas une colonne obligatoire echouerait sur le miroir
  // pour une raison qui n'a rien a voir avec ce qu'il mesure, et le plus souvent
  // il ne l'alimente pas parce qu'elle ne compte pas pour lui. La contrainte
  // vit dans la vraie base, et c'est elle qui l'applique aux vraies ecritures.
  //
  // Comme pour les CHECK et les REFERENCES, l'omission va dans le bon sens :
  // le miroir est plus PERMISSIF que Postgres. Ce qui veut dire qu'un test ne
  // peut pas prouver qu'une colonne est bien obligatoire · c'est le prix, et il
  // est assume.
  const defaut = traduireDefaut(reste);
  if (defaut !== null) morceaux.push(`DEFAULT ${defaut}`);

  return { nom, type, sql: morceaux.join(' '), json: brut === 'json' || brut === 'jsonb' };
}

/**
 * Rejoue le socle puis toutes les migrations, dans l'ordre, et rend le schema
 * qu'ils decrivent ensemble.
 *
 * L'ordre compte : une colonne ajoutee par la 058 puis retiree par la 093 ne
 * doit pas figurer dans le miroir, et un index redeclare doit prendre sa
 * derniere forme. On rejoue donc la sequence plutot que de fusionner des
 * declarations.
 *
 * @returns {{tables: Map<string, {colonnes: Map, contraintes: string[]}>,
 *            colonnesJson: Set<string>, ignorees: string[], indexUniques: object[]}}
 */
/**
 * Lecture mise en cache.
 *
 * Le schema est relu trois fois par mise en place de base de test (le DDL,
 * la completion des colonnes, le registre JSONB), et il y a une mise en place
 * par fichier de test. A 27 ms la lecture, ca se voit sur la suite · et les
 * fichiers SQL ne changent pas pendant une execution.
 *
 * Le cache est contourne des qu'un appelant passe ses propres chemins, ce qui
 * est le cas des tests du lecteur lui-meme.
 */
let cache = null;

function lireSchema(dossier = DOSSIER_MIGRATIONS, socles = SOCLES) {
  const parDefaut = dossier === DOSSIER_MIGRATIONS && socles === SOCLES;
  if (parDefaut && cache) return cache;
  const resultat = lireSchemaSansCache(dossier, socles);
  if (parDefaut) cache = resultat;
  return resultat;
}

function lireSchemaSansCache(dossier, socles) {
  const tables = new Map();
  const colonnesJson = new Set();
  const ignorees = [];
  const indexUniques = new Map();

  const fichiers = fs.readdirSync(dossier).filter(f => f.endsWith('.sql')).sort()
    .map(f => path.join(dossier, f));
  fichiers.unshift(...socles.filter(f => fs.existsSync(f)));

  for (const chemin of fichiers) {
    const fichier = path.basename(chemin);
    const sql = sansCommentaires(fs.readFileSync(chemin, 'utf8'));

    // CREATE TABLE · le corps va jusqu'a la parenthese fermante de meme niveau.
    const reCreate = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z_0-9]*)"?\s*\(/gi;
    let m;
    while ((m = reCreate.exec(sql))) {
      const nomTable = m[1].toLowerCase();
      let profondeur = 1;
      let i = m.index + m[0].length;
      let chaine = null;
      while (i < sql.length && profondeur > 0) {
        const c = sql[i];
        if (chaine) { if (c === chaine) chaine = null; }
        else if (c === "'" || c === '"') chaine = c;
        else if (c === '(') profondeur++;
        else if (c === ')') profondeur--;
        i++;
      }
      const corps = sql.slice(m.index + m[0].length, i - 1);

      if (!tables.has(nomTable)) tables.set(nomTable, { colonnes: new Map(), contraintes: [] });
      const t = tables.get(nomTable);

      for (const def of decouperTopLevel(corps)) {
        // Contraintes de table gardees : unicite et cle primaire composite.
        const mc = def.match(/^(?:CONSTRAINT\s+"?[a-z_0-9]+"?\s+)?(UNIQUE|PRIMARY\s+KEY)\s*\(([^)]+)\)/i);
        if (mc) {
          const cols = mc[2].split(',').map(c => c.trim().replace(/"/g, '').toLowerCase());
          t.contraintes.push(`${/^UNIQUE$/i.test(mc[1]) ? 'UNIQUE' : 'PRIMARY KEY'} (${cols.join(', ')})`);
          continue;
        }
        const col = traduireColonne(def);
        if (col) {
          t.colonnes.set(col.nom, col);
          if (col.json) colonnesJson.add(col.nom);
        } else if (!MOTS_CONTRAINTE.test(def)) {
          const nom = def.match(/^"?([a-z_][a-z_0-9]*)"?/i);
          if (nom) ignorees.push(`${nomTable}.${nom[1]} (${fichier})`);
        }
      }
    }

    // ALTER TABLE · une SEULE instruction peut porter plusieurs actions,
    // separees par des virgules :
    //
    //   ALTER TABLE users
    //     ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial',
    //     ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    //     ...
    //
    // Un premier jet ne lisait que la premiere action de chaque instruction. Il
    // perdait donc CINQ des six colonnes de facturation de la migration 078, et
    // treize colonnes en tout · un trou invisible, puisque le miroir se
    // construisait quand meme. On decoupe sur les virgules de premier niveau,
    // ce qui traite les instructions simples et composees du meme geste.
    const reAlter = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z_0-9]*)"?\s+((?:ADD|DROP|ALTER|RENAME|VALIDATE|ENABLE|DISABLE|SET)[\s\S]*?);/gi;
    while ((m = reAlter.exec(sql))) {
      const nomTable = m[1].toLowerCase();
      for (const action of decouperTopLevel(m[2])) {
        const ajout = action.match(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i);
        if (ajout) {
          if (!tables.has(nomTable)) tables.set(nomTable, { colonnes: new Map(), contraintes: [] });
          const col = traduireColonne(ajout[1].trim());
          if (col) {
            tables.get(nomTable).colonnes.set(col.nom, col);
            if (col.json) colonnesJson.add(col.nom);
          } else {
            const nom = ajout[1].match(/^"?([a-z_][a-z_0-9]*)"?/i);
            if (nom) ignorees.push(`${nomTable}.${nom[1]} · type non traduit (${fichier})`);
          }
          continue;
        }
        const retrait = action.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z_0-9]*)"?/i);
        if (retrait) { tables.get(nomTable)?.colonnes.delete(retrait[1].toLowerCase()); continue; }

        const renomme = action.match(/^RENAME\s+COLUMN\s+"?([a-z_][a-z_0-9]*)"?\s+TO\s+"?([a-z_][a-z_0-9]*)"?/i);
        if (renomme) {
          const t = tables.get(nomTable);
          const avant = renomme[1].toLowerCase();
          const apres = renomme[2].toLowerCase();
          const col = t?.colonnes.get(avant);
          if (col) {
            t.colonnes.delete(avant);
            t.colonnes.set(apres, { ...col, nom: apres, sql: col.sql.replace(/^[a-z_0-9]+/, apres) });
          }
          continue;
        }
        const renommeTable = action.match(/^RENAME\s+TO\s+"?([a-z_][a-z_0-9]*)"?/i);
        if (renommeTable) {
          const t = tables.get(nomTable);
          if (t) { tables.delete(nomTable); tables.set(renommeTable[1].toLowerCase(), t); }
          continue;
        }
        const contrainte = action.match(/^ADD\s+(?:CONSTRAINT\s+"?[a-z_0-9]+"?\s+)?(UNIQUE|PRIMARY\s+KEY)\s*\(([^)]+)\)/i);
        if (contrainte && tables.has(nomTable)) {
          const cols = contrainte[2].split(',').map(c => c.trim().replace(/"/g, '').toLowerCase());
          tables.get(nomTable).contraintes.push(`${/^UNIQUE$/i.test(contrainte[1]) ? 'UNIQUE' : 'PRIMARY KEY'} (${cols.join(', ')})`);
        }
        // Tout le reste est ignore sans bruit : ALTER COLUMN SET DEFAULT,
        // SET NOT NULL, DROP CONSTRAINT, ENABLE ROW LEVEL SECURITY. Aucun ne
        // change la FORME d'une table, et les ignorer rend le miroir plus
        // permissif que Postgres · le bon sens de l'erreur.
      }
    }

    const reDropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z_0-9]*)"?/gi;
    while ((m = reDropTable.exec(sql))) tables.delete(m[1].toLowerCase());

    // `ALTER TABLE ... RENAME TO` est traite dans la boucle d'actions ci-dessus.

    // Index uniques · indispensables, et pas pour la performance : c'est a eux
    // que `ON CONFLICT (...)` s'adosse. Sans l'index correspondant, SQLite
    // refuse la requete avec « ON CONFLICT clause does not match any PRIMARY
    // KEY or UNIQUE constraint », donc tout upsert devient intestable.
    //
    // ONZE des seize sont PARTIELS (accounts_crm_unique, deals_crm_unique,
    // idx_enrollments_dedup...). Les emettre sans leur clause serait pire que
    // de les omettre : l'index deviendrait plus STRICT que celui de Postgres et
    // interdirait des lignes que la vraie base accepte. SQLite sait faire des
    // index partiels, et les onze predicats de ce depot sont dans son
    // vocabulaire · on les recopie donc, derriere une liste blanche.
    //
    // La liste de colonnes peut contenir des EXPRESSIONS · `lower(raw_text)`,
    // `coalesce(pipeline_id, '')`. SQLite sait indexer une expression, mais une
    // decoupe naive sur la virgule couperait `coalesce(a, '')` en deux. D'ou la
    // lecture a profondeur de parentheses, la meme que pour un corps de table.
    const reIdx = /CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z_0-9]*)"?\s+ON\s+(?:public\.)?"?([a-z_][a-z_0-9]*)"?\s*\(/gi;
    while ((m = reIdx.exec(sql))) {
      let prof = 1;
      let j = m.index + m[0].length;
      let chaineIdx = null;
      while (j < sql.length && prof > 0) {
        const c = sql[j];
        if (chaineIdx) { if (c === chaineIdx) chaineIdx = null; }
        else if (c === "'" || c === '"') chaineIdx = c;
        else if (c === '(') prof++;
        else if (c === ')') prof--;
        j++;
      }
      const listeCols = sql.slice(m.index + m[0].length, j - 1);
      const finInstruction = sql.indexOf(';', j);
      const suffixe = sql.slice(j, finInstruction === -1 ? sql.length : finInstruction);
      const cols = decouperTopLevel(listeCols).map(c => c.replace(/"/g, '').toLowerCase());
      const mw = suffixe.match(/\bWHERE\b([\s\S]+)$/i);
      let predicat = null;
      if (mw) {
        predicat = mw[1].trim();
        if (!PREDICAT_SUR.test(predicat)) {
          // Un predicat qu'on ne sait pas recopier mot pour mot : on abandonne
          // l'index entier plutot que d'en poser une version approchee.
          ignorees.push(`index partiel ${m[1]} · predicat hors vocabulaire (${fichier})`);
          continue;
        }
      }
      // Indexes par NOM, et la derniere declaration l'emporte · exactement
      // comme pour les colonnes. Deux migrations redeclarent un index deja pose
      // (idx_automation_triggers_one_per_event en 114 puis 115,
      // idx_sector_norm_cache_unique) : Postgres l'a alors remplace, et c'est
      // la nouvelle definition qui compte. Un simple `IF NOT EXISTS` aurait
      // garde l'ANCIENNE, et un `ON CONFLICT` doit correspondre exactement a
      // son index · la mauvaise version fait echouer l'upsert.
      indexUniques.set(m[1].toLowerCase(), { nom: m[1].toLowerCase(), table: m[2].toLowerCase(), cols, predicat });
    }
  }

  return { tables, colonnesJson, ignorees, indexUniques: [...indexUniques.values()] };
}

/** Mots qui apparaissent dans une expression d'index sans etre des colonnes. */
const MOTS_SQL = new Set(['lower', 'upper', 'coalesce', 'trim', 'btrim', 'asc', 'desc', 'nulls', 'first', 'last', 'collate', 'and', 'or', 'not', 'is', 'null', 'true', 'false', 'in']);

/** Les colonnes qu'une entree de liste d'index nomme · `coalesce(a, '')` rend ['a']. */
function colonnesCitees(expr) {
  const sansChaines = expr.replace(/'(?:[^']|'')*'/g, ' ');
  return [...sansChaines.matchAll(/[a-z_][a-z_0-9]*/gi)]
    .map(m => m[0].toLowerCase())
    .filter(n => !MOTS_SQL.has(n));
}

/**
 * Le DDL SQLite correspondant.
 *
 * Tout est en `IF NOT EXISTS` : ce DDL s'applique APRES le bloc ecrit a la main
 * de l'adaptateur, qui garde donc la main sur les tables qu'il declare deja.
 * C'est ce qui rend ce module additif · aucun des 630 tests existants ne change
 * de base sous lui.
 */
function genererDDL(schema = lireSchema()) {
  const lignes = [];
  for (const [nom, t] of [...schema.tables].sort(([a], [b]) => a.localeCompare(b))) {
    if (t.colonnes.size === 0) continue;
    const corps = [...[...t.colonnes.values()].map(c => `  ${c.sql}`), ...t.contraintes.map(c => `  ${c}`)];
    lignes.push(`CREATE TABLE IF NOT EXISTS ${nom} (\n${corps.join(',\n')}\n);`);
  }
  for (const idx of schema.indexUniques) {
    const t = schema.tables.get(idx.table);
    // Un index sur une colonne que le miroir n'a pas ferait echouer TOUT le
    // schema d'un coup, et donc chaque test · on ne l'emet que si toutes les
    // colonnes qu'il nomme existent, expressions comprises.
    if (!t || !idx.cols.every(c => colonnesCitees(c).every(n => t.colonnes.has(n)))) continue;
    const ou = idx.predicat ? ` WHERE ${idx.predicat}` : '';
    lignes.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx.nom} ON ${idx.table} (${idx.cols.join(', ')})${ou};`);
  }
  return lignes.join('\n');
}

module.exports = { lireSchema, genererDDL, traduireColonne, traduireDefaut, decouperTopLevel, sansCommentaires, MAINTENANT_ISO, UUID_SQLITE };
