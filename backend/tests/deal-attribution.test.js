/**
 * Rattachement d'un deal Salesforce à un contact, quand le CRM ne le dit pas.
 *
 * Contexte · le contact d'une Opportunity vient des OpportunityContactRoles,
 * que beaucoup d'orgs ne remplissent pas. Le repli d'origine n'attribuait le
 * deal que si le compte n'avait qu'UN seul contact emailable : mesuré sur l'org
 * d'un beta testeur, 52 comptes tous à deux contacts ou plus, 0 deal rattaché
 * sur 308. Depuis l'arbitrage du 29/09 on répartit.
 *
 * Trois propriétés portent tout, et ce sont elles que ces tests gardent.
 *
 * 1. LA STABILITÉ. Le tri est fait sur la date de création, l'Id départageant
 *    les ex æquo · jamais sur la récence d'activité. Une attribution qui change
 *    d'un sync au suivant fait sauter le statut client d'un contact à l'autre,
 *    et avec lui le montant, l'étape, le score de churn et les relances.
 *
 * 2. UN CONTACT, UN DEAL. La ligne d'opportunité est un CONTACT : un seul
 *    crm_deal_id, un seul montant, une seule étape. Deux deals sur la même
 *    ligne, c'est un écrasement silencieux · c'est ce qui produisait en base
 *    des lignes « gagné » posées sur une étape encore ouverte.
 *
 * 3. UN MONTANT DEVINÉ NE S'AFFIRME PAS. Il compte dans les totaux, il ne se
 *    dit pas au contact : « votre projet à 45 000 € » à quelqu'un qui n'en a
 *    jamais entendu parler grille le contact et le compte avec lui.
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

// ═══════════════════════════════════════════════════════════════════
// api/salesforce.getDeals · la répartition
// ═══════════════════════════════════════════════════════════════════

const salesforce = require('../api/salesforce');

/**
 * Stub de fetch routé par requête SOQL. Les trois requêtes de getDeals sont
 * reconnues à leur objet : Opportunity, Contact, Task.
 */
function stubSalesforce({ opportunities = [], contacts = [] } = {}) {
  global.fetch = async (url) => {
    const soql = decodeURIComponent(url);
    let records = [];
    if (soql.includes('FROM Opportunity')) records = opportunities;
    else if (soql.includes('FROM Contact')) records = contacts;
    // FROM Task · aucune tâche, ce n'est pas le sujet ici
    return { ok: true, status: 200, json: async () => ({ records, done: true }) };
  };
}

/** Une Opportunity sans contact role, telle que l'API la rend. */
function opp(id, accountId, createdDate, extra = {}) {
  return {
    Id: id, Name: `Deal ${id}`, StageName: 'Prospecting', Amount: 1000,
    CloseDate: null, CreatedDate: createdDate, LastModifiedDate: createdDate,
    LastActivityDate: null, IsWon: false, IsClosed: false, AccountId: accountId,
    ...extra,
  };
}

test('un compte à plusieurs contacts rattache quand même ses deals', async () => {
  stubSalesforce({
    opportunities: [
      opp('006A', '001ACME', '2025-03-01T00:00:00Z'),
      opp('006B', '001ACME', '2025-06-01T00:00:00Z'),
    ],
    contacts: [
      { Id: '003C3', AccountId: '001ACME', CreatedDate: '2024-05-01T00:00:00Z' },
      { Id: '003C1', AccountId: '001ACME', CreatedDate: '2024-01-01T00:00:00Z' },
      { Id: '003C2', AccountId: '001ACME', CreatedDate: '2024-03-01T00:00:00Z' },
    ],
  });

  const deals = await salesforce.getDeals('https://x.my.salesforce.com', 'tok');

  const byId = new Map(deals.map(d => [d.id, d]));
  // Le deal le plus ancien au contact le plus ancien, dans l'ordre.
  assert.strictEqual(byId.get('006A').personId, '003C1');
  assert.strictEqual(byId.get('006B').personId, '003C2');
  // Et le lien est marqué comme supposé, sinon tout le reste croira le CRM.
  assert.strictEqual(byId.get('006A').personIdInferred, true);
  assert.strictEqual(byId.get('006B').personIdInferred, true);
});

test('deux contacts créés la même seconde ne font pas varier l\'attribution', async () => {
  // Cas courant : un import en masse crée tous les contacts d'un compte à la
  // même date. Sans départage par Id, l'ordre serait celui de l'API, qui ne
  // garantit rien · l'attribution changerait à chaque sync.
  const contacts = [
    { Id: '003ZZ', AccountId: '001ACME', CreatedDate: '2024-01-01T00:00:00Z' },
    { Id: '003AA', AccountId: '001ACME', CreatedDate: '2024-01-01T00:00:00Z' },
  ];

  stubSalesforce({ opportunities: [opp('006A', '001ACME', '2025-03-01T00:00:00Z')], contacts });
  const first = await salesforce.getDeals('https://x.my.salesforce.com', 'tok');

  // Même données, ordre d'API inversé : le résultat doit être identique.
  stubSalesforce({ opportunities: [opp('006A', '001ACME', '2025-03-01T00:00:00Z')], contacts: [...contacts].reverse() });
  const second = await salesforce.getDeals('https://x.my.salesforce.com', 'tok');

  assert.strictEqual(first[0].personId, '003AA');
  assert.strictEqual(second[0].personId, first[0].personId);
});

test('un contact déjà nommé par le CRM garde son deal', async () => {
  stubSalesforce({
    opportunities: [
      // Celui-ci a un contact role : le CRM désigne 003C1.
      opp('006REAL', '001ACME', '2025-01-01T00:00:00Z', {
        OpportunityContactRoles: { records: [{ ContactId: '003C1' }] },
      }),
      opp('006GUESS', '001ACME', '2025-02-01T00:00:00Z'),
    ],
    contacts: [
      { Id: '003C1', AccountId: '001ACME', CreatedDate: '2024-01-01T00:00:00Z' },
      { Id: '003C2', AccountId: '001ACME', CreatedDate: '2024-02-01T00:00:00Z' },
    ],
  });

  const deals = await salesforce.getDeals('https://x.my.salesforce.com', 'tok');
  const byId = new Map(deals.map(d => [d.id, d]));

  assert.strictEqual(byId.get('006REAL').personId, '003C1');
  assert.strictEqual(byId.get('006REAL').personIdInferred, undefined);
  // 003C1 est pris : la déduction passe au suivant plutôt que d'écraser.
  assert.strictEqual(byId.get('006GUESS').personId, '003C2');
});

test('plus de deals que de contacts : le surplus reste orphelin', async () => {
  stubSalesforce({
    opportunities: [
      opp('006A', '001ACME', '2025-01-01T00:00:00Z'),
      opp('006B', '001ACME', '2025-02-01T00:00:00Z'),
      opp('006C', '001ACME', '2025-03-01T00:00:00Z'),
    ],
    contacts: [{ Id: '003C1', AccountId: '001ACME', CreatedDate: '2024-01-01T00:00:00Z' }],
  });

  const deals = await salesforce.getDeals('https://x.my.salesforce.com', 'tok');
  const attached = deals.filter(d => d.personId);

  // Doubler un porteur ferait disparaître un montant sans le dire : mieux vaut
  // un deal non rattaché qu'un montant écrasé.
  assert.strictEqual(attached.length, 1);
  assert.strictEqual(attached[0].id, '006A');
  assert.strictEqual(new Set(attached.map(d => d.personId)).size, attached.length);
});

test('un compte sans contact emailable ne rattache rien', async () => {
  // La requête Contact filtre Email != null · un compte dont personne n'a
  // d'email ne remonte pas, et son deal reste orphelin. Rattacher un contact
  // injoignable ne servirait qu'à fausser les compteurs.
  stubSalesforce({
    opportunities: [opp('006A', '001ACME', '2025-01-01T00:00:00Z')],
    contacts: [{ Id: '003OTHER', AccountId: '001OTHER', CreatedDate: '2024-01-01T00:00:00Z' }],
  });

  const deals = await salesforce.getDeals('https://x.my.salesforce.com', 'tok');
  assert.strictEqual(deals[0].personId, null);
  assert.strictEqual(deals[0].personIdInferred, undefined);
});

// ═══════════════════════════════════════════════════════════════════
// lib/deal-attribution · ce qu'un rattachement deviné interdit de dire
// ═══════════════════════════════════════════════════════════════════

const { assertableDealValue, isAttributionTrusted } = require('../lib/deal-attribution');

test('le montant d\'un deal deviné ne sort pas vers le contact', () => {
  assert.strictEqual(assertableDealValue({ deal_value: 45000, crm_deal_attribution: 'inferred' }), null);
  assert.strictEqual(isAttributionTrusted({ crm_deal_attribution: 'inferred' }), false);
});

test('le montant sort quand le CRM nomme le contact, ou quand le user a confirmé', () => {
  assert.strictEqual(assertableDealValue({ deal_value: 45000, crm_deal_attribution: 'crm_role' }), 45000);
  assert.strictEqual(assertableDealValue({ deal_value: 45000, crm_deal_attribution: 'user' }), 45000);
});

test('une ligne antérieure à la migration 123 reste citable', () => {
  // NULL veut dire « rattaché avant que la question se pose », sur des orgs qui
  // remplissaient leurs contact roles. Traiter ces lignes comme douteuses
  // ferait taire le montant chez tous les users existants.
  assert.strictEqual(assertableDealValue({ deal_value: 45000, crm_deal_attribution: null }), 45000);
  assert.strictEqual(assertableDealValue({ deal_value: 45000 }), 45000);
});

// ═══════════════════════════════════════════════════════════════════
// lib/deal-lifecycle-sync · un contact, un deal
// ═══════════════════════════════════════════════════════════════════

/**
 * Doublure de db : une table d'opportunités en mémoire, indexée par
 * crm_contact_id, plus la trace des UPDATE de la passe de libération.
 */
function stubDb(rows) {
  const state = new Map(rows.map(r => [r.crm_contact_id, { ...r }]));
  const released = [];
  stub('../db', {
    async query(sql, params) {
      // Les comptes déjà importés, que la synchro lit une fois par passe pour
      // rattacher les contacts par l'identifiant que porte le deal.
      if (sql.includes('FROM accounts')) {
        return { rows: [{ id: 'acc-77', crm_account_id: '77', name: 'Dunelia Systemes' }], rowCount: 1 };
      }
      if (sql.includes('FROM opportunities WHERE user_id') && sql.includes('crm_contact_id')) {
        const row = state.get(String(params[1]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('UPDATE opportunities') && sql.includes("crm_deal_attribution IN ('inferred', 'user')")) {
        const keep = new Set(params[2] || []);
        let count = 0;
        for (const row of state.values()) {
          if (['inferred', 'user'].includes(row.crm_deal_attribution) && !keep.has(row.id)) {
            released.push(row.id);
            row.crm_deal_attribution = null;
            row.crm_deal_id = null;
            count++;
          }
        }
        return { rows: [], rowCount: count };
      }
      // nurture_emails (attribution de réactivation) et le reste : vide
      return { rows: [], rowCount: 0 };
    },
    opportunities: {
      async update(id, updates) {
        for (const row of state.values()) {
          if (row.id === id) Object.assign(row, updates);
        }
        return { id };
      },
    },
  });
  stub('../lib/reactivation-queue', { async setPlannedFollowupDate() { return null; } });
  return { state, released };
}

function loadSync(deals, { throws = null } = {}) {
  stub('../api/salesforce', {
    async getDeals() { if (throws) throw new Error(throws); return deals; },
    async getStages() { return []; },
  });
  stub('../lib/stage-tracking', {
    async getStageLabelMap() { return new Map(); },
    extractStage(provider, deal) { return { id: deal.stage, label: deal.stage }; },
    async trackStage(userId, o, stage) { return { crm_stage: stage.label, crm_stage_id: stage.id }; },
  });
  delete require.cache[require.resolve('../lib/deal-lifecycle-sync')];
  return require('../lib/deal-lifecycle-sync');
}

test('deux deals sur le même contact : un seul tient, l\'autre est compté', async () => {
  const { state } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'imported', deal_value: null, crm_deal_id: null, crm_deal_attribution: null },
  ]);
  // Le plus récemment modifié réclame la ligne · c'est celui sur lequel
  // l'équipe travaille. L'ancien deal gagné ne doit plus poser son dénouement
  // par-dessus l'étape du nouveau.
  const { syncDealLifecycle } = loadSync([
    { id: '006OLD', personId: '003C1', status: 'won', value: 9000, stage: 'Closed Won', updatedAt: '2025-01-01T00:00:00Z' },
    { id: '006NEW', personId: '003C1', status: 'open', value: 5000, stage: 'Negotiation', updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(result.collisions, 1);
  assert.strictEqual(result.processed, 1);
  const row = state.get('003C1');
  assert.strictEqual(row.crm_deal_id, '006NEW');
  assert.strictEqual(Number(row.deal_value), 5000);
  // La ligne est cohérente : l'étape et le statut viennent du MÊME deal.
  assert.strictEqual(row.crm_stage_id, 'Negotiation');
  assert.notStrictEqual(row.status, 'won');
});

test('le rattachement est persisté avec son origine', async () => {
  const { state } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'imported', crm_deal_id: null, crm_deal_attribution: null },
    { id: 'opp2', crm_contact_id: '003C2', status: 'imported', crm_deal_id: null, crm_deal_attribution: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006REAL', personId: '003C1', status: 'open', value: 1000, updatedAt: '2025-09-01T00:00:00Z' },
    { id: '006GUESS', personId: '003C2', personIdInferred: true, status: 'open', value: 2000, updatedAt: '2025-09-02T00:00:00Z' },
  ]);

  await syncDealLifecycle('u1', {}, 'salesforce');

  // crm_deal_id n'était écrit que par le push vers le CRM : NULL sur 100% des
  // lignes importées, donc impossible de savoir d'où venait un montant.
  assert.strictEqual(state.get('003C1').crm_deal_id, '006REAL');
  assert.strictEqual(state.get('003C1').crm_deal_attribution, 'crm_role');
  assert.strictEqual(state.get('003C2').crm_deal_id, '006GUESS');
  assert.strictEqual(state.get('003C2').crm_deal_attribution, 'inferred');
});

test('une confirmation du user n\'est jamais redescendue par une resynchro', async () => {
  const { state } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'imported', crm_deal_id: '006GUESS', crm_deal_attribution: 'user' },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006GUESS', personId: '003C1', personIdInferred: true, status: 'open', value: 1000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(state.get('003C1').crm_deal_attribution, 'user');
});

test('un contact role qui apparaît rend la main sur le porteur deviné', async () => {
  // 006X était deviné sur 003C1. Le CRM nomme maintenant 003C2 : sans cette
  // libération, 003C1 garderait pour toujours un montant et un dénouement qui
  // ne lui appartiennent pas.
  const { state, released } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'won', deal_value: 4000, crm_deal_id: '006X', crm_deal_attribution: 'inferred' },
    { id: 'opp2', crm_contact_id: '003C2', status: 'imported', crm_deal_id: null, crm_deal_attribution: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006X', personId: '003C2', status: 'won', value: 4000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(result.released, 1);
  assert.deepStrictEqual(released, ['opp1']);
  assert.strictEqual(state.get('003C1').crm_deal_attribution, null);
  assert.strictEqual(state.get('003C2').crm_deal_attribution, 'crm_role');
});

test('un deal deviné qui change de porteur ne compte pas deux fois', async () => {
  // La répartition se décale dès qu'un contact du compte est supprimé côté CRM.
  // Le deal reste deviné, mais sur quelqu'un d'autre · comparer par id de DEAL
  // laisserait les deux lignes le revendiquer, et son montant serait compté
  // deux fois dans les totaux et les prévisions.
  const { state, released } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'imported', deal_value: 4000, crm_deal_id: '006X', crm_deal_attribution: 'inferred' },
    { id: 'opp2', crm_contact_id: '003C2', status: 'imported', crm_deal_id: null, crm_deal_attribution: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006X', personId: '003C2', personIdInferred: true, status: 'open', value: 4000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(result.released, 1);
  assert.deepStrictEqual(released, ['opp1']);
  assert.strictEqual(state.get('003C1').crm_deal_id, null);
  assert.strictEqual(state.get('003C2').crm_deal_id, '006X');
  assert.strictEqual(state.get('003C2').crm_deal_attribution, 'inferred');
});

test('une ligne confirmée dont le deal part ailleurs rend la main aussi', async () => {
  // Ce que le user a confirmé, c'est CE deal sur CE contact. Le CRM nomme
  // maintenant un autre interlocuteur : il n'y a plus rien à confirmer, et
  // garder la ligne compterait le montant sur les deux.
  const { state, released } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'won', deal_value: 4000, crm_deal_id: '006X', crm_deal_attribution: 'user' },
    { id: 'opp2', crm_contact_id: '003C2', status: 'imported', crm_deal_id: null, crm_deal_attribution: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006X', personId: '003C2', status: 'won', value: 4000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(result.released, 1);
  assert.deepStrictEqual(released, ['opp1']);
  assert.strictEqual(state.get('003C2').crm_deal_attribution, 'crm_role');
});

test('un rattachement affirmé par le CRM n\'est jamais libéré', async () => {
  // Le CRM en est la source · une ligne 'crm_role' que la passe n'a pas revue
  // (deal hors du plafond de lecture, par exemple) ne doit pas perdre ses
  // chiffres pour autant.
  const { state, released } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'won', deal_value: 4000, crm_deal_id: '006OLD', crm_deal_attribution: 'crm_role' },
    { id: 'opp2', crm_contact_id: '003C2', status: 'imported', crm_deal_id: null, crm_deal_attribution: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006NEW', personId: '003C2', status: 'open', value: 1000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  await syncDealLifecycle('u1', {}, 'salesforce');

  assert.deepStrictEqual(released, []);
  assert.strictEqual(state.get('003C1').crm_deal_id, '006OLD');
  assert.strictEqual(Number(state.get('003C1').deal_value), 4000);
});

test('la société portée par le deal rattache le contact au bon compte', async () => {
  // Pipedrive a deux associations distinctes, deal -> organisation et
  // personne -> organisation. Beaucoup d'équipes ne remplissent que la
  // première. Sans ce repli, une base entièrement renseignée côté deals
  // produit zéro compte · constaté le 29/09.
  const { state } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'imported', company: null, account_id: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006A', personId: '003C1', accountId: '77', status: 'open', value: 1000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  await syncDealLifecycle('u1', {}, 'salesforce');

  const row = state.get('003C1');
  assert.strictEqual(row.account_id, 'acc-77');
  assert.strictEqual(row.company, 'Dunelia Systemes');
});

test('le deal n\'écrase jamais une société déjà affirmée par le CRM', async () => {
  // Si le CRM a dit où travaille cette personne, c'est lui qui a raison.
  const { state } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'imported', company: 'Trivelo Technologies', account_id: null },
  ]);
  const { syncDealLifecycle } = loadSync([
    { id: '006A', personId: '003C1', accountId: '77', status: 'open', value: 1000, updatedAt: '2025-09-01T00:00:00Z' },
  ]);

  await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(state.get('003C1').company, 'Trivelo Technologies');
  // Le rattachement au compte se fait quand même : c'est un identifiant, pas
  // un nom, et il ne contredit rien.
  assert.strictEqual(state.get('003C1').account_id, 'acc-77');
});

test('un connecteur qui refuse la lecture le dit, au lieu de passer pour un CRM vide', async () => {
  // C'est ce qui a coûté deux enquêtes sur les 47 deals Pipedrive : le catch de
  // fin couvrait aussi la lecture du CRM, donc un jeton refusé ou un endpoint
  // changé se lisait exactement comme « ce CRM n'a pas de deals ».
  const { state, released } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'won', deal_value: 4000, crm_deal_id: '006X', crm_deal_attribution: 'inferred' },
  ]);
  const { syncDealLifecycle } = loadSync([], { throws: 'Pipedrive API 401' });

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.match(result.error, /401/);
  assert.strictEqual(result.fetched, 0);
  // Et surtout : une lecture refusée ne libère aucun rattachement.
  assert.deepStrictEqual(released, []);
  assert.strictEqual(state.get('003C1').crm_deal_attribution, 'inferred');
});

test('un deal nommant une personne inconnue de nos contacts est compté à part', async () => {
  // `unlinked` (le CRM ne nomme personne) et `unmatched` (la personne est
  // nommée mais absente de l'import) n'appellent pas le même remède. Les
  // confondre dans un continue muet, c'est chercher au mauvais endroit.
  stubDb([{ id: 'opp1', crm_contact_id: '003C1', status: 'imported' }]);
  const { syncDealLifecycle } = loadSync([
    { id: '006A', personId: '003INCONNU', status: 'open', value: 1000, updatedAt: '2025-09-01T00:00:00Z' },
    { id: '006B', status: 'open', value: 2000, updatedAt: '2025-09-02T00:00:00Z' },
  ]);

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(result.fetched, 2);
  assert.strictEqual(result.unmatched, 1);
  assert.strictEqual(result.unlinked, 1);
  assert.strictEqual(result.processed, 0);
});

test('un appel CRM qui ne rend aucun deal ne libère rien', async () => {
  // Une liste vide peut être un échec silencieux côté connecteur · la lire
  // comme « plus aucun deal deviné » effacerait les rattachements de tout le
  // monde à la première panne d'API.
  const { state, released } = stubDb([
    { id: 'opp1', crm_contact_id: '003C1', status: 'won', deal_value: 4000, crm_deal_id: '006X', crm_deal_attribution: 'inferred' },
  ]);
  const { syncDealLifecycle } = loadSync([]);

  const result = await syncDealLifecycle('u1', {}, 'salesforce');

  assert.strictEqual(result.released, 0);
  assert.deepStrictEqual(released, []);
  assert.strictEqual(state.get('003C1').crm_deal_attribution, 'inferred');
});
