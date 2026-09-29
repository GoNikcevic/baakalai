/**
 * Qui décide dans un compte · lot 3 (migration 125).
 *
 * Un compte à huit contacts sans rôles est une liste de huit noms
 * équivalents : le produit relance au hasard et l'écran ne sait pas qui mettre
 * en avant. C'est aussi ce qui bloque le lot 6, où un envoi multi-threadé qui
 * ne distingue pas le décideur de l'utilisateur final envoie le même message
 * aux deux.
 *
 * Deux choses sont gardées ici.
 *
 * 1. L'HEURISTIQUE est calibrée PME, et c'est un choix. Dans une boîte de
 *    trente personnes un « Directeur Marketing » signe ; dans un groupe de dix
 *    mille, non. Ces tests figent le petit bout, parce que c'est l'ICP.
 *
 * 2. L'ÉLECTION du principal doit être STABLE. Si elle dépend de l'ordre de
 *    lecture, la personne que le produit relance change d'une synchro à
 *    l'autre sans que rien n'ait bougé côté client.
 */

const test = require('node:test');
const assert = require('node:assert');
const { roleFromTitle, roleFromCrm, electPrimary } = require('../lib/contact-role');

// ── L'heuristique ──

test('un intitulé de direction décide, en français comme en anglais', () => {
  // Intitulés relevés le 29/09 dans les vraies données de prod et de staging.
  assert.strictEqual(roleFromTitle('Directrice Marketing'), 'decision_maker');
  assert.strictEqual(roleFromTitle('CEO'), 'decision_maker');
  assert.strictEqual(roleFromTitle('Head of Sales'), 'decision_maker');
  assert.strictEqual(roleFromTitle('VP, Facilities'), 'decision_maker');
  assert.strictEqual(roleFromTitle('Responsable Achats'), 'decision_maker');
  assert.strictEqual(roleFromTitle('Gérant'), 'decision_maker');
});

test('les sigles courts se comparent comme des mots, pas en sous-chaîne', () => {
  // Sans ça « dg » se déclenche sur « budget » et « vp » sur « developpement ».
  assert.strictEqual(roleFromTitle('DG'), 'decision_maker');
  assert.strictEqual(roleFromTitle('Responsable budget'), 'decision_maker'); // par « responsable »
  assert.strictEqual(roleFromTitle('Analyste budget'), 'operational');
  assert.strictEqual(roleFromTitle('Ingenieur developpement'), 'operational');
});

test('celui qui porte le dossier sans le signer est un influenceur', () => {
  assert.strictEqual(roleFromTitle('Chef de projet'), 'influencer');
  assert.strictEqual(roleFromTitle('Office Manager'), 'influencer');
  assert.strictEqual(roleFromTitle('Acheteur'), 'influencer');
});

test('« directeur de projet » reste un décideur, pas un influenceur', () => {
  // Les décideurs sont testés AVANT les influenceurs · dans l'ordre inverse,
  // « chef de » ou « manager » happerait la moitié des directions.
  assert.strictEqual(roleFromTitle('Directeur de projet'), 'decision_maker');
  assert.strictEqual(roleFromTitle('Directeur des achats'), 'decision_maker');
});

test('un intitulé absent rend null, jamais « opérationnel »', () => {
  // « On ne sait pas » n'est pas « exécutant ». Ranger par défaut tous les
  // contacts sans titre dans la dernière catégorie en ferait une majorité
  // d'opérationnels qui n'en sont pas, et l'élection s'appuierait dessus.
  assert.strictEqual(roleFromTitle(null), null);
  assert.strictEqual(roleFromTitle(''), null);
  assert.strictEqual(roleFromTitle('   '), null);
  assert.strictEqual(roleFromTitle(42), null);
});

test('les accents et la casse ne changent pas le rôle', () => {
  assert.strictEqual(roleFromTitle('DIRECTRICE GÉNÉRALE'), 'decision_maker');
  assert.strictEqual(roleFromTitle('directrice generale'), 'decision_maker');
});

// ── Le rôle déclaré par Salesforce ──

test('les rôles standards de Salesforce sont reconnus', () => {
  assert.strictEqual(roleFromCrm('Decision Maker'), 'decision_maker');
  assert.strictEqual(roleFromCrm('Economic Buyer'), 'decision_maker');
  assert.strictEqual(roleFromCrm('Executive Sponsor'), 'decision_maker');
  assert.strictEqual(roleFromCrm('Influencer'), 'influencer');
  assert.strictEqual(roleFromCrm('Technical Buyer'), 'influencer');
  assert.strictEqual(roleFromCrm('Business User'), 'operational');
});

test('un rôle personnalisé tombe dans « autre », jamais en erreur', () => {
  // La liste de valeurs est modifiable par chaque org. Laisser passer une
  // valeur inconnue ferait échouer la contrainte CHECK de la migration 125.
  assert.strictEqual(roleFromCrm('Sponsor interne'), 'other');
  assert.strictEqual(roleFromCrm(null), null);
});

// ── L'élection du principal ──

const DAY = 86400000;
const iso = (joursAvant) => new Date(Date.now() - joursAvant * DAY).toISOString();

test('à rôles égaux, le plus récemment actif gagne', () => {
  const elu = electPrimary([
    { id: 'b', account_role: 'decision_maker', role_source: 'inferred', last_activity_at: iso(200) },
    { id: 'a', account_role: 'decision_maker', role_source: 'inferred', last_activity_at: iso(3) },
  ]);
  // Un décideur muet depuis deux ans n'est pas le bon interlocuteur, même
  // s'il a le bon titre.
  assert.strictEqual(elu.id, 'a');
});

test('le rôle déclaré par le CRM passe devant le rôle déduit', () => {
  const elu = electPrimary([
    { id: 'deduit', account_role: 'decision_maker', role_source: 'inferred', last_activity_at: iso(1) },
    { id: 'declare', account_role: 'decision_maker', role_source: 'crm', last_activity_at: iso(90) },
  ]);
  assert.strictEqual(elu.id, 'declare');
});

test('un choix de l\'utilisateur ne se rediscute pas', () => {
  const elu = electPrimary([
    { id: 'choisi', account_role: 'operational', role_source: 'user', is_primary_contact: true, last_activity_at: iso(300) },
    { id: 'autre', account_role: 'decision_maker', role_source: 'crm', last_activity_at: iso(1) },
  ]);
  assert.strictEqual(elu.id, 'choisi');
});

test('l\'élection ne dépend pas de l\'ordre de lecture', () => {
  // Deux contacts en tous points identiques : sans départage par identifiant,
  // l'élu changerait au gré de l'ordre renvoyé par la base, et avec lui la
  // personne que le produit relance.
  const contacts = [
    { id: 'zzz', account_role: 'decision_maker', role_source: 'inferred', last_activity_at: null },
    { id: 'aaa', account_role: 'decision_maker', role_source: 'inferred', last_activity_at: null },
  ];
  assert.strictEqual(electPrimary(contacts).id, 'aaa');
  assert.strictEqual(electPrimary([...contacts].reverse()).id, 'aaa');
});

test('sans aucun décideur, le plus récemment actif fait l\'affaire', () => {
  const elu = electPrimary([
    { id: 'vieux', account_role: 'operational', role_source: 'inferred', last_activity_at: iso(100) },
    { id: 'frais', account_role: null, role_source: null, last_activity_at: iso(2) },
  ]);
  assert.strictEqual(elu.id, 'frais');
});

test('un compte sans contact n\'élit personne', () => {
  assert.strictEqual(electPrimary([]), null);
  assert.strictEqual(electPrimary(null), null);
});
