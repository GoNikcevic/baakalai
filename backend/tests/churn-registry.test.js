const test = require('node:test');
const assert = require('node:assert');
const { scoreOpportunity, AT_RISK_THRESHOLD } = require('../lib/churn-scoring');

// Client sain : won, actif récemment, profil complet — score de base ~0.
const healthyClient = {
  status: 'won',
  last_activity_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  created_at: new Date(Date.now() - 400 * 86400000).toISOString(),
  email: 'ceo@client.fr', company: 'Client SARL', title: 'CEO',
};

test('une procédure collective force la bande critique même sur un client sain', () => {
  const { score, factors } = scoreOpportunity(healthyClient, {
    registrySignals: [{ signal_type: 'insolvency_proceeding', detail: 'Redressement judiciaire — BODACC 12/07/2026' }],
  });
  assert.ok(score >= 76, `score ${score} devrait être >= 76 (critique)`);
  assert.ok(factors.some(f => f.signal === 'insolvency_proceeding'));
});

test('une sauvegarde ajoute +15 sans forcer la bande critique', () => {
  const base = scoreOpportunity(healthyClient, {}).score;
  const { score, factors } = scoreOpportunity(healthyClient, {
    registrySignals: [{ signal_type: 'insolvency_safeguard', detail: 'Procédure de sauvegarde' }],
  });
  assert.strictEqual(score, Math.min(100, base + 15));
  assert.ok(score < 76, `une sauvegarde seule (${score}) ne doit pas être critique`);
  assert.ok(factors.some(f => f.signal === 'insolvency_safeguard'));
});

test('le financial_distress Brave ne s empile pas sur une procédure confirmée par registre', () => {
  const withBoth = scoreOpportunity(healthyClient, {
    registrySignals: [{ signal_type: 'insolvency_proceeding', detail: 'Liquidation judiciaire' }],
    externalSignals: [{ signal_type: 'financial_distress' }],
  });
  const registryOnly = scoreOpportunity(healthyClient, {
    registrySignals: [{ signal_type: 'insolvency_proceeding', detail: 'Liquidation judiciaire' }],
  });
  assert.strictEqual(withBoth.score, registryOnly.score, 'même événement compté deux fois');
  // Un signal Brave d'un AUTRE type continue de compter normalement.
  const withOther = scoreOpportunity(healthyClient, {
    registrySignals: [{ signal_type: 'insolvency_proceeding', detail: 'Liquidation judiciaire' }],
    externalSignals: [{ signal_type: 'layoffs' }],
  });
  assert.ok(withOther.score >= registryOnly.score, 'layoffs doit toujours peser');
});

test('le seuil partagé est bien exporté', () => {
  assert.strictEqual(typeof AT_RISK_THRESHOLD, 'number');
  assert.ok(AT_RISK_THRESHOLD > 25 && AT_RISK_THRESHOLD <= 76);
});
