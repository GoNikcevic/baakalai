/**
 * Chaîne complète du Hidden Revenue Score, avec un `db` simulé.
 *
 * Ce que ce fichier protège et que les tests de fonctions pures ne voient pas :
 * la numérotation des paramètres des requêtes (une insertion multi-lignes
 * construit ses placeholders à la main), le fait qu'aucune requête n'utilise
 * now() à la place de l'horloge gelée, et la purge du détail des snapshots
 * précédents. Ce sont exactement les erreurs qui ne se voient qu'en production.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Le stub doit être en place AVANT que le moteur ne charge `db`.
const dbPath = require.resolve('../db');
const issued = [];

const DAY_MS = 86400000;
const SNAPSHOT = new Date('2026-09-18T09:00:00Z');
const daysBefore = (n) => new Date(SNAPSHOT.getTime() - n * DAY_MS);

function opportunity(i, overrides = {}) {
  return {
    id: `opp-${i}`,
    name: `Contact ${i}`,
    company: `Société ${i}`,
    email: `contact${i}@exemple.fr`,
    status: 'open',
    deal_value: 10000 + i * 1000,
    crm_stage: 'Proposition',
    lost_reason: null,
    created_at: daysBefore(400),
    last_touch: daysBefore(200),
    email_bounced_at: null,
    ...overrides,
  };
}

const DORMANT = Array.from({ length: 12 }, (_, i) => opportunity(i));
const SILENT_CLIENTS = [
  opportunity(90, { status: 'won', crm_stage: 'Closed Won', won_date: daysBefore(500), last_touch: daysBefore(300) }),
];

let tablesMissing = false;

const fakeDb = {
  async query(sql, params = []) {
    issued.push({ sql, params });

    if (/FROM users WHERE id/.test(sql)) return { rows: [{ settings: { stagnant_days: 30 } }] };
    if (/count\(\*\) FILTER \(WHERE status = 'won'\) AS won/i.test(sql)) {
      return { rows: [{ won: 18, lost: 12, avg_cycle: 88 }] };
    }
    if (/FROM memory_patterns/.test(sql)) return { rows: [] };
    if (/AS oldest_event/.test(sql)) {
      return {
        rows: [{
          total: 300, with_value: 240, with_activity: 270, contactable: 255,
          won_count: 18, lost_count: 12, lost_with_reason: 9,
          zombie_open: 6, won_without_date: 3,
          oldest_event: daysBefore(900),
          open_value: 1170000, valueless_open: 0,
          lost_value: 150000, valueless_lost: 0,
          won_value: 800000, valueless_won: 0,
          won_value_12m: 800000,
        }],
      };
    }
    if (/status = 'won' AND deal_value IS NOT NULL/.test(sql)) {
      return { rows: Array.from({ length: 20 }, (_, i) => ({ deal_value: 20000, crm_stage: 'Proposition' })) };
    }
    if (/FROM nurture_emails/.test(sql)) return { rows: [] };
    if (/status NOT IN \('won', 'lost'\)\s*\n\s*AND COALESCE\(last_activity_at, created_at\)/.test(sql)) {
      return { rows: DORMANT };
    }
    if (/AND status = 'won'\s*\n\s*AND COALESCE\(last_activity_at, won_date/.test(sql)) {
      return { rows: SILENT_CLIENTS };
    }
    if (/INSERT INTO hidden_revenue_snapshots/.test(sql)) {
      if (tablesMissing) {
        const err = new Error('relation "hidden_revenue_snapshots" does not exist');
        err.code = '42P01';
        throw err;
      }
      return { rows: [{ id: 'snapshot-1' }] };
    }
    if (/INSERT INTO hidden_revenue_opportunities/.test(sql)) return { rows: [] };
    if (/DELETE FROM hidden_revenue_opportunities/.test(sql)) return { rows: [] };
    return { rows: [] };
  },
};

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [], exports: fakeDb,
};

const { computeHiddenRevenue } = require('../lib/hidden-revenue');

let result;

test('le calcul complet produit un score, une fourchette et du détail', async () => {
  issued.length = 0;
  result = await computeHiddenRevenue('user-1', { snapshotAt: SNAPSHOT });

  assert.strictEqual(result.scoreVersion, 'hrs-v1');
  assert.strictEqual(result.snapshotAt, SNAPSHOT.toISOString());
  assert.ok(result.hrs > 0 && result.hrs <= 100, `HRS hors bornes : ${result.hrs}`);
  assert.ok(result.confidence > 0 && result.confidence <= 100);
  assert.strictEqual(result.opportunityCount, DORMANT.length + SILENT_CLIENTS.length);
  assert.ok(result.expectedLow < result.expectedValue && result.expectedValue < result.expectedHigh);
  assert.strictEqual(result.snapshotId, 'snapshot-1');
});

test('le montant attendu reste sous la réserve qualifiée', () => {
  assert.ok(result.expectedValue < result.qualifiedValue,
    `attendu ${result.expectedValue} devrait être sous qualifié ${result.qualifiedValue}`);
});

test('la base couvre les trois populations où les candidats sont pris', () => {
  // Ouvertes 1 170 000 + perdues 24 mois 150 000 + gagnées 24 mois 800 000.
  // Sans les perdues et les gagnées, l'intensité dépasserait 100 % dès qu'un
  // deal perdu ou un client dormant entre dans le numérateur.
  assert.strictEqual(result.revenueBase, 2120000);
});

test('les lignes sans montant gonflent aussi le dénominateur', async () => {
  const original = fakeDb.query;
  fakeDb.query = async (sql, params) => {
    if (/AS oldest_event/.test(sql)) {
      const r = await original.call(fakeDb, sql, params);
      return { rows: [{ ...r.rows[0], valueless_open: 10 }] };
    }
    return original.call(fakeDb, sql, params);
  };
  try {
    const r = await computeHiddenRevenue('user-1', { snapshotAt: SNAPSHOT, persist: false });
    // 10 lignes sans montant valorisées à la médiane globale des gagnés (20 000).
    assert.strictEqual(r.revenueBase, 2120000 + 200000);
  } finally {
    fakeDb.query = original;
  }
});

test('l intensité ne peut jamais dépasser 100 pour cent', () => {
  for (const d of Object.values(result.dimensions)) {
    if (d.evaluated) assert.ok(d.intensity <= 1, `intensité hors bornes : ${d.intensity}`);
  }
});

test('seules les dimensions de la V1 sont évaluées', () => {
  assert.strictEqual(result.dimensions.dormant_pipeline.evaluated, true);
  assert.strictEqual(result.dimensions.customer_reactivation.evaluated, true);
  assert.strictEqual(result.dimensions.customer_expansion.evaluated, false);
  assert.strictEqual(result.dimensions.lead_reactivation.evaluated, false);
});

test('aucune requête du moteur ne mesure le temps sur l horloge murale', () => {
  const engineQueries = issued.filter(q => /FROM opportunities|FROM nurture_emails/.test(q.sql));
  assert.ok(engineQueries.length >= 4, 'les requêtes du moteur doivent être passées');
  for (const q of engineQueries) {
    // Seul usage toléré : un now() de repli derrière l'horloge gelée, pour les
    // appelants qui ne fournissent pas de date (le forecast, par exemple).
    const withoutGuard = q.sql.replace(/COALESCE\(\$\d+::timestamptz,\s*now\(\)\)/gi, 'FROZEN');
    assert.ok(!/\bnow\(\)/i.test(withoutGuard), `horloge non gelée dans : ${q.sql.slice(0, 80)}`);
  }
});

test('chaque requête reçoit autant de paramètres qu elle en référence', () => {
  for (const { sql, params } of issued) {
    const referenced = new Set((sql.match(/\$\d+/g) || []).map(p => Number(p.slice(1))));
    if (referenced.size === 0) continue;
    const highest = Math.max(...referenced);
    assert.strictEqual(highest, params.length,
      `placeholder le plus haut $${highest} pour ${params.length} paramètres : ${sql.slice(0, 70)}`);
    for (let i = 1; i <= highest; i++) {
      assert.ok(referenced.has(i), `placeholder $${i} manquant dans : ${sql.slice(0, 70)}`);
    }
  }
});

test('le détail est inséré puis les snapshots précédents sont purgés', () => {
  const insert = issued.find(q => /INSERT INTO hidden_revenue_opportunities/.test(q.sql));
  assert.ok(insert, 'le détail doit être persisté');
  assert.strictEqual(insert.params.length % 14, 0, 'toutes les lignes doivent avoir 14 colonnes');
  assert.strictEqual(insert.params.length / 14, DORMANT.length + SILENT_CLIENTS.length);

  const purge = issued.find(q => /DELETE FROM hidden_revenue_opportunities/.test(q.sql));
  assert.ok(purge, 'le détail des snapshots précédents doit être purgé');
  assert.deepStrictEqual(purge.params, ['user-1', 'snapshot-1']);
  assert.ok(issued.indexOf(purge) > issued.indexOf(insert), 'la purge doit venir après l insertion');
});

test('rejouer le même instantané redonne exactement le même score', async () => {
  const again = await computeHiddenRevenue('user-1', { snapshotAt: SNAPSHOT, persist: false });
  assert.strictEqual(again.hrs, result.hrs);
  assert.strictEqual(again.expectedValue, result.expectedValue);
  assert.strictEqual(again.confidence, result.confidence);
});

test('sans persistance, aucune écriture n est émise', async () => {
  issued.length = 0;
  await computeHiddenRevenue('user-1', { snapshotAt: SNAPSHOT, persist: false });
  assert.ok(!issued.some(q => /INSERT INTO|DELETE FROM/.test(q.sql)));
});

test('avant la migration, le score se calcule sans casser l agent', async () => {
  tablesMissing = true;
  try {
    const partial = await computeHiddenRevenue('user-1', { snapshotAt: SNAPSHOT });
    assert.strictEqual(partial.persisted, false);
    assert.strictEqual(partial.snapshotId, null);
    assert.strictEqual(partial.hrs, result.hrs, 'le score reste calculé et identique');
  } finally {
    tablesMissing = false;
  }
});

test('une vraie erreur d écriture remonte au lieu d être avalée', async () => {
  const original = fakeDb.query;
  fakeDb.query = async (sql, params) => {
    if (/INSERT INTO hidden_revenue_snapshots/.test(sql)) {
      const err = new Error('deadlock detected');
      err.code = '40P01';
      throw err;
    }
    return original.call(fakeDb, sql, params);
  };
  try {
    await assert.rejects(
      () => computeHiddenRevenue('user-1', { snapshotAt: SNAPSHOT }),
      /deadlock/
    );
  } finally {
    fakeDb.query = original;
  }
});
