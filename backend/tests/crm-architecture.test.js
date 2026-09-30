/**
 * Moteur de découverte d'architecture CRM · lot 1.
 *
 * Quatre propriétés portent tout ce lot, et ce sont elles que ces tests
 * gardent.
 *
 * 1. RIEN DE BRUT NE SORT. Ce qui part à l'inférence ne contient que des
 *    agrégats : des noms de champs, des types, des taux, des cardinalités,
 *    des libellés de listes de choix. Aucune valeur d'un enregistrement réel.
 *    C'est la promesse RGPD du module, et elle ne vaut que si elle est testée :
 *    une régression ici n'échoue nulle part ailleurs, elle envoie juste des
 *    données personnelles à un tiers.
 *
 * 2. L'INVENTAIRE EST UN INVENTAIRE D'USAGE. Un objet sans donnée récente est
 *    du décor, même quand son nom le désigne : lui appliquer une règle
 *    propagerait le décor dans tout le reste du produit.
 *
 * 3. UNE CORRECTION TIENT. Une ligne corrigée à la main n'est jamais réécrite
 *    par une passe automatique. Sans ça, la correction saute à l'analyse
 *    suivante et l'utilisateur n'a aucun moyen de la faire tenir.
 *
 * 4. LE REMPLISSAGE SE MESURE VRAIMENT. Les quatre CRM emballent leurs valeurs
 *    différemment. Sans démêlage, un champ parfaitement rempli se mesurerait à
 *    zéro chez trois providers sur quatre, et toutes les déductions bâties
 *    dessus seraient fausses.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { setup, teardown, registerAndLogin } = require('./helpers');

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, path: path.dirname(resolved),
    loaded: true, children: [], paths: [], exports,
  };
}

const HIER = new Date(Date.now() - 86400000).toISOString();
const IL_Y_A_QUATRE_ANS = new Date(Date.now() - 4 * 365 * 86400000).toISOString();

/**
 * Un Pipedrive de fiction, avec ce qu'il faut pour que chaque propriété ci
 * dessus ait quelque chose à mordre : un objet vivant, un objet mort, un champ
 * rempli, un champ à l'abandon, et des valeurs emballées comme Pipedrive les
 * emballe vraiment.
 */
function stubPipedrive() {
  stub('../api/pipedrive', {
    listObjectSchemas: async () => ([
      { name: 'organizations', label: 'Organisations', custom: false },
      { name: 'deals', label: 'Deals', custom: false },
    ]),
    getObjectFields: async (_creds, objet) => {
      if (objet === 'organizations') {
        return [
          { key: 'name', name: 'Nom', type: 'varchar', custom: false, options: [] },
          { key: 'add_time', name: 'Créée le', type: 'date', custom: false, options: [] },
        ];
      }
      return [
        { key: 'title', name: 'Titre', type: 'varchar', custom: false, options: [] },
        { key: 'value', name: 'Montant', type: 'monetary', custom: false, options: [] },
        { key: 'add_time', name: 'Créé le', type: 'date', custom: false, options: [] },
        // Relation emballée · c'est la forme qui piège les mesures naïves.
        { key: 'org_id', name: 'Organisation', type: 'org', custom: false, referenceTo: 'organizations', options: [] },
        // Champ maison quasi vide : du bruit, il ne doit pas atteindre le modèle.
        { key: 'ff4211', name: 'Code interne', type: 'varchar', custom: true, options: [] },
      ];
    },
    sampleRecords: async (_creds, objet) => {
      if (objet === 'organizations') {
        // Rien de récent depuis quatre ans : du décor.
        return [
          { name: 'Acme', add_time: IL_Y_A_QUATRE_ANS },
          { name: 'Globex', add_time: IL_Y_A_QUATRE_ANS },
        ];
      }
      return [
        { title: 'Socle Acme', value: 30000, add_time: HIER, org_id: { value: 10, name: 'Acme' }, ff4211: null },
        { title: 'Extension Acme', value: 8000, add_time: HIER, org_id: { value: 10, name: 'Acme' }, ff4211: null },
        { title: 'Globex', value: 12000, add_time: HIER, org_id: { value: 11, name: 'Globex' }, ff4211: null },
        { title: 'Initech', value: null, add_time: HIER, org_id: null, ff4211: null },
      ];
    },
  });
}

/** Claude, qui ne doit voir que des agrégats. Le prompt reçu est capturé. */
function stubClaude(capture, reponse) {
  stub('../api/claude', {
    callClaude: async (_system, prompt) => {
      capture.prompt = prompt;
      return JSON.stringify(reponse);
    },
  });
}

test('rien de brut ne part a l inference, et un champ vide n y entre pas', async (t) => {
  await setup();
  t.after(teardown);

  stubPipedrive();
  const { profileArchitecture, buildInferencePayload } = require('../lib/crm-architecture');

  const profil = await profileArchitecture('pipedrive', 'jeton');
  const charge = JSON.stringify(buildInferencePayload(profil));

  // Les VALEURS des enregistrements de fiction. Aucune n'a le droit d'y etre.
  for (const brut of ['Socle Acme', 'Globex', 'Initech', '30000', 'Acme']) {
    assert.ok(
      !charge.includes(brut),
      `la valeur brute "${brut}" ne doit jamais atteindre le modele`
    );
  }

  // Ce qui DOIT y etre : le schema et la mesure.
  assert.ok(charge.includes('taux_remplissage'), 'les taux de remplissage partent bien');
  assert.ok(charge.includes('"champ":"value"'.replace(/"/g, '"')) || charge.includes('value'), 'les noms de champs partent bien');

  // Un champ rempli a 0 % est du bruit : le montrer inviterait le modele a
  // batir une deduction sur du vide.
  assert.ok(!charge.includes('ff4211'), 'un champ vide n atteint pas le modele');
});

test('le remplissage se mesure a travers l emballage du CRM', async (t) => {
  await setup();
  t.after(teardown);

  stubPipedrive();
  const { profileArchitecture } = require('../lib/crm-architecture');

  const profil = await profileArchitecture('pipedrive', 'jeton');
  const deals = profil.objects.find(o => o.name === 'deals');
  const champ = (k) => deals.fields.find(f => f.key === k);

  assert.strictEqual(champ('title').fillRate, 1, 'un champ plat, rempli partout');
  // 3 valeurs sur 4 · la quatrieme est null.
  assert.strictEqual(champ('value').fillRate, 0.75);
  // Relation emballee dans { value, name } · une lecture naive la compterait
  // remplie a 100 % (l'objet existe) ou a 0 % (ce n'est pas un scalaire).
  assert.strictEqual(champ('org_id').fillRate, 0.75, 'la relation emballee est lue, pas devinee');
  assert.strictEqual(champ('org_id').cardinality, 2, 'deux organisations distinctes');
  assert.strictEqual(champ('ff4211').fillRate, 0, 'un champ jamais renseigne vaut zero, pas null');
});

test('un objet sans donnee recente est du decor, meme si son nom le designe', async (t) => {
  await setup();
  t.after(teardown);

  stubPipedrive();
  const capture = {};
  stubClaude(capture, { deductions: [] });

  const db = require('../db');
  const { analyzeCrmArchitecture } = require('../lib/crm-architecture');
  const { user } = await registerAndLogin();

  const rapport = await analyzeCrmArchitecture(user.id, { provider: 'pipedrive', creds: 'jeton' });
  assert.strictEqual(rapport.provider, 'pipedrive');
  assert.strictEqual(rapport.objects, 2);

  const lignes = (await db.query(
    `SELECT object_name, field_name, baakalai_role, source FROM crm_architecture_mappings
      WHERE user_id = $1 AND field_name IS NULL ORDER BY object_name`, [user.id]
  )).rows;

  const orgs = lignes.find(l => l.object_name === 'organizations');
  const deals = lignes.find(l => l.object_name === 'deals');

  // `organizations` EST la societe chez Pipedrive, la regle le sait. Mais rien
  // n'y bouge depuis quatre ans : la regle ne s'applique pas.
  assert.strictEqual(
    orgs.baakalai_role, 'unknown',
    'un objet inactif depuis deux ans ne prend pas de role, meme quand la regle le connait'
  );
  // `deals` est vivant : la regle s'applique, et sans passer par le modele.
  assert.strictEqual(deals.baakalai_role, 'deal');
  assert.strictEqual(deals.source, 'rule');
});

test('une correction manuelle tient, une reanalyse ne la reecrit pas', async (t) => {
  await setup();
  t.after(teardown);

  stubPipedrive();
  const capture = {};
  stubClaude(capture, { deductions: [] });

  const db = require('../db');
  const { analyzeCrmArchitecture, setArchitectureRole } = require('../lib/crm-architecture');
  const { user } = await registerAndLogin();

  await analyzeCrmArchitecture(user.id, { provider: 'pipedrive', creds: 'jeton' });

  const avant = (await db.query(
    `SELECT id FROM crm_architecture_mappings
      WHERE user_id = $1 AND object_name = 'organizations' AND field_name IS NULL`, [user.id]
  )).rows[0];

  // L'utilisateur tranche : cet objet endormi est bien sa table des societes.
  const corrige = await setArchitectureRole(user.id, avant.id, 'account');
  assert.strictEqual(corrige.baakalai_role, 'account');
  assert.strictEqual(corrige.source, 'user');

  const rapport = await analyzeCrmArchitecture(user.id, { provider: 'pipedrive', creds: 'jeton' });
  assert.ok(rapport.kept >= 1, 'la ligne corrigee est comptee comme gardee');

  const apres = (await db.query(
    `SELECT baakalai_role, source FROM crm_architecture_mappings WHERE id = $1`, [avant.id]
  )).rows[0];
  assert.strictEqual(apres.baakalai_role, 'account', 'la correction survit a la reanalyse');
  assert.strictEqual(apres.source, 'user');
});

test('la deuxieme mesure signale ce qui a change', async (t) => {
  await setup();
  t.after(teardown);

  stubPipedrive();
  const capture = {};
  stubClaude(capture, { deductions: [] });

  const { analyzeCrmArchitecture } = require('../lib/crm-architecture');
  const { user } = await registerAndLogin();

  // Premiere mesure · rien a comparer, donc aucune derive.
  const un = await analyzeCrmArchitecture(user.id, { provider: 'pipedrive', creds: 'jeton' });
  assert.deepStrictEqual(un.drift, [], 'une premiere mesure ne derive de rien');

  // Le CRM gagne un objet entre les deux passages.
  const pipedrive = require('../api/pipedrive');
  const objetsInitiaux = pipedrive.listObjectSchemas;
  pipedrive.listObjectSchemas = async () => ([
    ...(await objetsInitiaux()),
    { name: 'products', label: 'Produits', custom: false },
  ]);
  pipedrive.getObjectFields = async (_c, objet) => (objet === 'products'
    ? [{ key: 'name', name: 'Nom', type: 'varchar', custom: false, options: [] }]
    : []);
  pipedrive.sampleRecords = async (_c, objet) => (objet === 'products'
    ? [{ name: 'Abonnement' }]
    : []);

  const deux = await analyzeCrmArchitecture(user.id, { provider: 'pipedrive', creds: 'jeton' });
  const nouveau = deux.drift.find(d => d.type === 'objet_nouveau' && d.object === 'products');
  assert.ok(nouveau, 'un objet apparu est signale');
});
