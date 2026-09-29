/**
 * Après un import de contacts, il faut lire les DEALS.
 *
 * Le produit a trois chemins qui importent des contacts, et un seul faisait ce
 * travail. Celui qui ne le faisait pas, `routes/crm.js /import/:provider`, est
 * celui que l'utilisateur déclenche le plus souvent : le bouton « Actualiser »
 * de la page Deals, le wizard d'onboarding, les raccourcis du chat.
 *
 * Le coût mesuré le 29/09 : 443 lignes sur 443 en production avec
 * `crm_deal_id` à NULL, tous CRM confondus, et 47 deals Pipedrive parfaitement
 * visibles dans le CRM mais absents de baakalai. Aucun défaut de connecteur,
 * un appel manquant.
 *
 * Ces tests gardent ce que la factorisation doit garantir : l'ordre des deux
 * passes, la transmission du rapport, et le refus d'agir avec les mauvaises
 * identités.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, path: path.dirname(resolved),
    loaded: true, children: [], paths: [], exports,
  };
}

/** Recharge le module sous test avec des doublures fraîches. */
function load({ resolved, ordre = [], lifecycle = {}, arch = {}, applied = {} } = {}) {
  stub('../lib/crm-token', { async resolveCrmForUser() { return resolved; } });
  stub('../lib/accounts', {
    async importCrmAccounts() { ordre.push('societes'); return { fetched: 52, upserted: 52, absorbed: 3, error: null }; },
    async syncAccountsForUser() { ordre.push('comptes'); return { accounts: 4, created: 4, linked: 9, skipped: 0 }; },
  });
  stub('../lib/deal-lifecycle-sync', {
    async syncDealLifecycle(userId, creds, provider, report) {
      ordre.push('lifecycle');
      if (report) report.reactivations = 3;
      return { fetched: 0, processed: 0, updated: 0, unlinked: 0, unmatched: 0, error: null, ...lifecycle };
    },
  });
  stub('../lib/crm-stage-mapper', {
    async analyzeStageArchitecture() { ordre.push('stages'); return { stages: 16, byRule: 2, byAi: 6, ...arch }; },
    async applyStageMapping() { ordre.push('apply'); return { updated: 12, ...applied }; },
  });
  delete require.cache[require.resolve('../lib/crm-deal-refresh')];
  return require('../lib/crm-deal-refresh');
}

test('le cycle de vie passe AVANT le mappage d\'étapes', async () => {
  // L'ordre n'est pas cosmétique : le lifecycle tranche gagné/perdu sur les
  // drapeaux natifs, le mappage ne réécrit que les statuts ouverts. Inversés,
  // un deal conclu repasserait par « négociation » le temps d'une synchro.
  const ordre = [];
  const { refreshDealsAndStages } = load({ resolved: { provider: 'pipedrive', creds: 'cle' }, ordre });

  const out = await refreshDealsAndStages('u1', 'pipedrive');

  // Les comptes d'abord : ils valent pour tous les CRM, les deals seulement
  // pour les quatre qui en ont.
  assert.deepStrictEqual(ordre, ['societes', 'comptes', 'lifecycle', 'stages', 'apply']);
  assert.strictEqual(out.ran, true);
});

test('étapes lues et étapes comprises sont deux nombres différents', async () => {
  // Annoncer « 16 étapes comprises » sur un pipeline dont la moitié est restée
  // sans traduction, c'est mentir à l'utilisateur sur ce que baakalai sait.
  const { refreshDealsAndStages } = load({ resolved: { provider: 'salesforce', creds: {} } });

  const out = await refreshDealsAndStages('u1', 'salesforce');

  assert.strictEqual(out.stages, 16);
  assert.strictEqual(out.mapped, 8);
  assert.strictEqual(out.repositioned, 12);
});

test('le rapport de l\'agent recueille bien les réactivations', async () => {
  // Signal d'apprentissage le plus fort du produit : un deal mort redevenu
  // gagné avec l'email causal identifié. Le refactor ne doit pas le perdre.
  const { refreshDealsAndStages } = load({ resolved: { provider: 'hubspot', creds: {} } });
  const report = {};

  await refreshDealsAndStages('u1', 'hubspot', { creds: {}, report });

  assert.strictEqual(report.reactivations, 3);
});

test('un CRM qui ne résout pas le même provider ne touche à rien', async () => {
  // Un utilisateur peut avoir deux CRM connectés. Lire les deals de l'un avec
  // les identifiants de contact de l'autre rattacherait n'importe quoi.
  const ordre = [];
  const { refreshDealsAndStages } = load({ resolved: { provider: 'salesforce', creds: {} }, ordre });

  const out = await refreshDealsAndStages('u1', 'pipedrive');

  assert.strictEqual(out.ran, false);
  // Sans jeton, les vraies sociétés ne peuvent pas être lues. Le regroupement
  // par nom, lui, part de la base : il passe quand même.
  assert.deepStrictEqual(ordre, ['comptes']);
  assert.match(out.error, /creds indisponibles/);
});

test('un CRM sans notion de deal a quand même des comptes', async () => {
  // Notion, Airtable et Folk n'ont qu'une propriété texte libre : il n'y a ni
  // deal ni étape à lire. Mais ils ont bien des SOCIÉTÉS, et les comptes se
  // reconstruisent depuis la base, pas depuis le CRM. Les en priver reviendrait
  // à réserver le modèle compte aux quatre CRM structurés.
  const ordre = [];
  const { refreshDealsAndStages } = load({ resolved: { provider: 'notion', creds: {} }, ordre });

  const out = await refreshDealsAndStages('u1', 'notion');

  assert.strictEqual(out.ran, false);
  assert.strictEqual(out.error, null);
  assert.deepStrictEqual(ordre, ['comptes']);
  assert.strictEqual(out.accounts.created, 4);
});
