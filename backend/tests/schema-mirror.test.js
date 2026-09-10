/**
 * Garde-fou : le miroir SQLite doit suivre le schéma réel.
 *
 * Les tests d'API ne tapent pas dans Postgres, ils tournent sur une base SQLite
 * jetable dont le schéma est écrit à la main dans db/sqlite-adapter.js. Ce
 * schéma est un miroir : quand une migration ajoute une colonne à la vraie
 * base, il faut la recopier là-bas. Personne ne le faisait, et le miroir avait
 * fini avec 53 colonnes de retard sur 9 tables — dont 34 sur opportunities.
 * Les tests interrogeaient alors une maquette qui ne ressemblait plus à
 * l'original : ils échouaient sur « no such column », loin de toute vraie
 * régression.
 *
 * Ce test compare les deux et échoue dès qu'une colonne manque. Il ne réclame
 * pas que le miroir contienne TOUTES les tables — il ne réplique que celles que
 * les tests utilisent — mais toute table qu'il réplique doit être complète.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'db');

// Colonnes volontairement absentes du miroir, avec la raison.
const EXCEPTIONS = {
  // Vecteur pgvector : pas d'équivalent SQLite, et aucun test ne le lit.
  memory_patterns: ['embedding'],
};

/** Colonnes déclarées dans un corps de CREATE TABLE (hors contraintes). */
function parseColumns(body) {
  const cols = new Set();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^(UNIQUE|PRIMARY KEY|FOREIGN KEY|CHECK|CONSTRAINT)\b/i.test(line)) continue;
    const name = line.split(/[\s(]/)[0].toLowerCase();
    if (name) cols.add(name);
  }
  return cols;
}

/** Le miroir : les CREATE TABLE du template SQL de sqlite-adapter.js. */
function readMirror() {
  const src = fs.readFileSync(path.join(DB_DIR, 'sqlite-adapter.js'), 'utf8');
  const tables = new Map();
  for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\);/g)) {
    tables.set(m[1].toLowerCase(), parseColumns(m[2]));
  }
  return tables;
}

/**
 * Le schéma réel : les deux fichiers de schéma (les tables ne sont pas toutes
 * dans supabase-schema.sql — reports et chart_data vivent dans
 * supabase-rls-and-extras.sql), puis chaque migration dans l'ordre.
 */
function readRealSchema() {
  const files = [
    path.join(DB_DIR, 'supabase-schema.sql'),
    path.join(DB_DIR, 'supabase-rls-and-extras.sql'),
    ...fs.readdirSync(path.join(DB_DIR, 'migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort()
      .map(f => path.join(DB_DIR, 'migrations', f)),
  ];

  const tables = new Map();
  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8');

    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(([\s\S]*?)\n\);/g)) {
      const name = m[1].toLowerCase();
      if (!tables.has(name)) tables.set(name, new Set());
      for (const c of parseColumns(m[2])) tables.get(name).add(c);
    }

    for (const m of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?(\w+)([\s\S]*?);/g)) {
      const name = m[1].toLowerCase();
      const body = m[2];
      for (const c of body.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
        if (!tables.has(name)) tables.set(name, new Set());
        tables.get(name).add(c[1].toLowerCase());
      }
      for (const c of body.matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?(\w+)/gi)) {
        tables.get(name)?.delete(c[1].toLowerCase());
      }
    }
  }
  return tables;
}

describe('Miroir SQLite vs schéma réel', () => {
  const mirror = readMirror();
  const real = readRealSchema();

  // Si l'un des deux analyseurs casse (format du fichier modifié, migrations
  // déplacées), les comparaisons suivantes passeraient toutes silencieusement.
  // Ces deux assertions font échouer le test bruyamment à la place.
  it('lit les deux schémas', () => {
    assert.ok(mirror.size >= 20, `miroir illisible : ${mirror.size} table(s) trouvée(s)`);
    assert.ok(real.size >= 20, `schéma réel illisible : ${real.size} table(s) trouvée(s)`);
    assert.ok(mirror.get('users')?.has('email'), 'miroir illisible : users.email introuvable');
    assert.ok(real.get('users')?.has('email'), 'schéma réel illisible : users.email introuvable');
  });

  it('ne réplique que des tables qui existent vraiment', () => {
    const inconnues = [...mirror.keys()].filter(t => !real.has(t));
    assert.deepEqual(inconnues, [],
      `Tables présentes dans le miroir mais absentes du schéma réel : ${inconnues.join(', ')}`);
  });

  it('réplique toutes les colonnes des tables qu il couvre', () => {
    const manques = [];
    for (const [table, colonnes] of mirror) {
      const attendues = real.get(table);
      if (!attendues) continue;
      const exceptions = EXCEPTIONS[table] || [];
      const absentes = [...attendues]
        .filter(c => !colonnes.has(c) && !exceptions.includes(c))
        .sort();
      if (absentes.length) manques.push(`  ${table} : ${absentes.join(', ')}`);
    }

    assert.deepEqual(manques, [],
      'Le miroir SQLite a pris du retard sur les migrations.\n' +
      'Colonnes à ajouter dans le CREATE TABLE correspondant de db/sqlite-adapter.js :\n' +
      manques.join('\n') +
      '\n(si une colonne n a volontairement pas d equivalent SQLite, l inscrire dans EXCEPTIONS)');
  });
});
