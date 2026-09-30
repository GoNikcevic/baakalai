/**
 * Les 30 premiers caracteres d'un pattern sont son IDENTITE.
 *
 * `db.memoryPatterns.replaceOrCreate` reconnait un souvenir deja connu en trois
 * temps : egalite exacte du texte, puis prefixe de 30 caracteres, puis proximite
 * vectorielle. Un chiffre place dans ces 30 caracteres donne donc une identite
 * DIFFERENTE a chaque valeur. « taux de conversion 67 % » et « taux de conversion
 * 65 % » deviennent deux souvenirs concurrents au lieu d'un seul fait qui evolue :
 * les confirmations ne montent jamais, les seuils de promotion a 3 et 8 restent
 * hors d'atteinte, et la memoire enfle sans apprendre.
 *
 * Ce que ce test protege est donc la capacite d'apprendre, pas une convention de
 * redaction. Il echoue si quelqu'un reformule une phrase en remontant sa partie
 * variable, ce qui est exactement le genre de retouche innocente qu'on fait sans
 * y penser.
 *
 * Il y a un precedent, et c'est ce qui a motive le test. Ce fichier se protegeait
 * des doublons avec des gardes maison du genre
 * `existing.some(p => p.pattern.includes('taux de conversion CRM'))`, alors que la
 * phrase ecrite commencait par « Taux » avec une majuscule. `includes` est sensible
 * a la casse : la garde n'a jamais matche une seule fois. Mesure en production le
 * 30/09/2026 : 29 lignes strictement identiques, une par passage du cron depuis le
 * 2 septembre. Trois gardes sur six etaient mortes ainsi, deux par une majuscule,
 * une par une formulation qui avait derive de son test.
 */

const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pour-les-patterns-crm';

const { CRM_PATTERN_TEXTS } = require('../lib/crm-agent');

// Deux jeux de valeurs aussi differents que possible · tout ce qui varie d'un
// passage de l'agent a l'autre doit changer entre les deux.
const JEU_A = {
  winRate: 67, won: 12, closed: 18,
  avgDays: 42, sampleSize: 12,
  avgStagnation: 38,
  size: 'PME', count: 7,
  title: 'Directeur financier',
  avgTouches: 4.2,
};
const JEU_B = {
  winRate: 3, won: 1, closed: 400,
  avgDays: 9, sampleSize: 250,
  avgStagnation: 1,
  size: 'Grand compte', count: 91,
  title: 'Responsable achats',
  avgTouches: 11.8,
};

const PREFIXE = 30;

test('chaque libelle existe et rend une phrase non vide', () => {
  const attendus = ['winRate', 'velocity', 'stagnation', 'companySize', 'jobTitle', 'touches'];
  assert.deepStrictEqual(Object.keys(CRM_PATTERN_TEXTS).sort(), attendus.sort());
  for (const [nom, f] of Object.entries(CRM_PATTERN_TEXTS)) {
    const texte = f(JEU_A);
    assert.strictEqual(typeof texte, 'string', `${nom} ne rend pas une chaine`);
    assert.ok(texte.length > PREFIXE, `${nom} est trop court pour porter un prefixe stable`);
  }
});

test('le prefixe de 30 caracteres ne bouge pas quand les valeurs changent', () => {
  for (const [nom, f] of Object.entries(CRM_PATTERN_TEXTS)) {
    const a = f(JEU_A).slice(0, PREFIXE);
    const b = f(JEU_B).slice(0, PREFIXE);
    assert.strictEqual(a, b,
      `${nom} : la partie variable est dans les ${PREFIXE} premiers caracteres. `
      + `Chaque nouvelle valeur creera un souvenir de plus au lieu de confirmer l'existant. `
      + `Deplacer le chiffre APRES le trentieme caractere.`);
  }
});

test('aucun chiffre dans les 30 premiers caracteres', () => {
  // Redondant avec le test precedent pour les valeurs numeriques, mais il attrape
  // aussi le cas ou deux jeux de test tomberaient par hasard sur la meme longueur.
  for (const [nom, f] of Object.entries(CRM_PATTERN_TEXTS)) {
    const prefixe = f(JEU_A).slice(0, PREFIXE);
    assert.ok(!/\d/.test(prefixe), `${nom} : « ${prefixe} » contient un chiffre`);
  }
});

test('les valeurs finissent bien dans la phrase', () => {
  // L'invariant du prefixe ne doit pas etre obtenu en jetant la valeur.
  assert.match(CRM_PATTERN_TEXTS.winRate(JEU_A), /67%/);
  assert.match(CRM_PATTERN_TEXTS.velocity(JEU_A), /42 jours/);
  assert.match(CRM_PATTERN_TEXTS.stagnation(JEU_A), /38 jours/);
  assert.match(CRM_PATTERN_TEXTS.companySize(JEU_A), /PME/);
  assert.match(CRM_PATTERN_TEXTS.jobTitle(JEU_A), /Directeur financier/);
  assert.match(CRM_PATTERN_TEXTS.touches(JEU_A), /4\.2/);
});

test('deux libelles ne partagent pas le meme prefixe', () => {
  // Deux faits distincts qui partageraient leurs 30 premiers caracteres se
  // fusionneraient dans replaceOrCreate : le second ecraserait le premier.
  const vus = new Map();
  for (const [nom, f] of Object.entries(CRM_PATTERN_TEXTS)) {
    const prefixe = f(JEU_A).slice(0, PREFIXE);
    assert.ok(!vus.has(prefixe), `${nom} et ${vus.get(prefixe)} partagent le prefixe « ${prefixe} »`);
    vus.set(prefixe, nom);
  }
});
