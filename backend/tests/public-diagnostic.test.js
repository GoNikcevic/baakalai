/**
 * Rapport de l'audit public · ce qu'il calcule et surtout ce qu'il ne montre pas.
 */

const test = require('node:test');
const assert = require('node:assert');
const { computeReport } = require('../routes/public-diagnostic');
const { computeFromDeals } = require('../lib/hidden-revenue/from-deals');

const DAY_MS = 86400000;
const AT = new Date('2026-09-18T09:00:00Z');
const ago = (n) => new Date(AT.getTime() - n * DAY_MS).toISOString();

function crm() {
  const deals = [];
  for (let i = 0; i < 20; i++) {
    deals.push({ name: `Deal ${i}`, company: `Societe ${i}`, value: 10000 + i * 500, status: 'open', addTime: ago(400), lastActivity: ago(120 + i) });
  }
  for (let i = 0; i < 10; i++) {
    deals.push({ name: `Won ${i}`, company: `Client ${i}`, value: 25000, status: 'won', addTime: ago(600), lastActivity: ago(200 + i * 10) });
  }
  for (let i = 0; i < 8; i++) {
    deals.push({ name: `Lost ${i}`, company: `Perdu ${i}`, value: 18000, status: 'lost', addTime: ago(500), lastActivity: ago(300) });
  }
  for (let i = 0; i < 5; i++) {
    deals.push({ name: `Actif ${i}`, company: `Chaud ${i}`, value: 12000, status: 'open', addTime: ago(60), lastActivity: ago(3) });
  }
  return deals;
}

const report = computeReport(crm(), { snapshotAt: AT });

test('le rapport porte le score, la fourchette et la version', () => {
  assert.strictEqual(report.scoreVersion, 'hrs-v1');
  assert.ok(report.hrs > 0 && report.hrs <= 100);
  assert.ok(report.confidence > 0);
  assert.ok(report.expectedLow < report.expectedValue && report.expectedValue < report.expectedHigh);
  assert.ok(report.opportunityCount > 0);
});

test('les deals encore actifs ne sont pas comptés comme dormants', () => {
  const dims = report.dimensions.dormant_pipeline;
  assert.strictEqual(dims.evaluated, true);
  // 20 dormants + 8 perdus, jamais les 5 deals touchés il y a 3 jours.
  assert.strictEqual(dims.count, 28);
});

test('exactement trois opportunités sont nommées, le reste est compté', () => {
  assert.strictEqual(report.top.length, 3);
  assert.strictEqual(report.lockedCount, report.opportunityCount - 3);
  for (const t of report.top) {
    assert.ok(t.company, 'le propriétaire voit bien les sociétés');
    assert.ok(t.reasonCodes.length >= 1);
    assert.ok(t.recommendedAction);
  }
});

test('aucun montant par dimension ne fuite dans le rapport public', () => {
  for (const d of Object.values(report.dimensions)) {
    assert.strictEqual(d.qualifiedValue, undefined);
    assert.strictEqual(d.expectedValue, undefined);
    assert.strictEqual(d.intensity, undefined);
  }
});

test('le détail ligne à ligne ne quitte jamais le serveur', () => {
  assert.strictEqual(report.candidates, undefined);
  assert.strictEqual(report.confidenceFactors, undefined);
  assert.strictEqual(report.revenueBase, undefined);
  assert.strictEqual(JSON.stringify(report).includes('"factors"'), false);
});

test('l audit public et le moteur annoncent le même chiffre', () => {
  const engine = computeFromDeals(crm(), { snapshotAt: AT });
  assert.strictEqual(report.hrs, engine.hrs);
  assert.strictEqual(report.expectedValue, engine.expectedValue);
  assert.strictEqual(report.expectedLow, engine.expectedLow);
  assert.strictEqual(report.confidence, engine.confidence);
  assert.strictEqual(report.opportunityCount, engine.opportunityCount);
});

test('la confiance se renormalise sur ce qu une lecture API peut mesurer', () => {
  const engine = computeFromDeals(crm(), { snapshotAt: AT });
  const keys = engine.confidenceFactors.map(f => f.key);
  assert.ok(!keys.includes('contactability'), 'aucune adresse email n est lue');
  assert.ok(!keys.includes('lostReasonCoverage'), 'aucune raison de perte n est lue');
  const total = engine.confidenceFactors.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(total - 100) < 0.5, `les poids doivent se renormaliser sur 100, obtenu ${total}`);
});

test('ne pas lire les adresses ne fait pas décoter tout le monde', () => {
  const engine = computeFromDeals(crm(), { snapshotAt: AT });
  // Aucune décote de contactabilité ne doit apparaître : la surface ne sait
  // pas, elle ne punit pas.
  for (const c of engine.candidates) {
    assert.ok(!c.factors.some(f => f.signal === 'uncontactable'),
      'une absence de champ ne doit jamais valoir une adresse invalide');
  }
});

test('un CRM vide ne produit ni score ni montant inventé', () => {
  const empty = computeReport([], { snapshotAt: AT });
  assert.strictEqual(empty.hrs, 0);
  assert.strictEqual(empty.expectedValue, 0);
  assert.strictEqual(empty.opportunityCount, 0);
  assert.strictEqual(empty.lockedCount, 0);
  assert.strictEqual(empty.quantifiable, false);
});

test('un CRM sans aucun montant se compte sans se chiffrer', () => {
  const noValue = Array.from({ length: 15 }, (_, i) => ({
    name: `Deal ${i}`, company: `Societe ${i}`, value: 0, status: 'open',
    addTime: ago(300), lastActivity: ago(150),
  }));
  const r = computeReport(noValue, { snapshotAt: AT });
  assert.strictEqual(r.opportunityCount, 15);
  assert.strictEqual(r.expectedValue, 0);
  assert.strictEqual(r.context.countWithoutValue, 15);
  assert.strictEqual(r.quantifiable, false, 'sans le moindre montant, on ne prétend pas chiffrer');
});

test('rejouer le même instantané redonne le même rapport', () => {
  const again = computeReport(crm(), { snapshotAt: AT });
  assert.deepStrictEqual(again, report);
});
