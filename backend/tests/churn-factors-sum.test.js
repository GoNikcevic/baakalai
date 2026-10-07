/**
 * La decomposition du score doit FAIRE LA SOMME du score.
 *
 * ── Ce qui s'affichait ──────────────────────────────────────────────────────
 *
 * Un contact de staging montrait « Churn : 0/100 » et, juste en dessous, un
 * seul facteur : « 2 champ(s) manquant(s)  +10 ». Zero d'un cote, dix de
 * l'autre, sous les yeux de l'utilisateur.
 *
 * La cause : l'abattement « client actif » de -15 n'etait inscrit dans les
 * facteurs QUE s'il laissait le score au-dessus de zero (`if (score > 0)`).
 * Donc il disparaissait de l'explication exactement quand il etait
 * determinant · celui qui ramene le score a zero.
 *
 * ── Pourquoi c'est plus grave que ca n'en a l'air ───────────────────────────
 *
 * Le produit vend un score EXPLIQUE : la fiche compte et la page Clients a
 * risque affichent la decomposition pour qu'on puisse juger le chiffre. Une
 * addition visiblement fausse ne discredite pas ce facteur-la, elle discredite
 * tous les chiffres de la page.
 */

const test = require('node:test');
const assert = require('node:assert');
const { scoreOpportunity } = require('../lib/churn-scoring');

const JOUR = 86400000;
const ilYA = (n) => new Date(Date.now() - n * JOUR).toISOString();

/** La somme des poids doit valoir le score, une fois le plancher applique. */
function sommeDesFacteurs(resultat) {
  return resultat.factors.reduce((s, f) => s + f.weight, 0);
}

test('un client actif ramene a zero garde son abattement dans les facteurs', () => {
  // Le cas exact de staging : un client gagne, actif, dont le seul malus est
  // un profil incomplet. 10 - 15 tombe sous zero, donc le score vaut 0.
  const r = scoreOpportunity({
    status: 'won',
    last_activity_at: ilYA(7),
    name: 'Mehdi Mercier',
    email: 'mehdi@exemple.fr',
  }, {});

  assert.strictEqual(r.score, 0, 'le plancher a zero s applique');
  const abattement = r.factors.find(f => f.signal === 'status_won_offset');
  assert.ok(abattement, 'l abattement doit figurer dans les facteurs, meme quand il ramene a zero');
  assert.ok(abattement.weight < 0, 'et porter un poids negatif');
});

test('l abattement porte sa valeur REELLE, pas sa valeur nominale', () => {
  // Un contact a 10 ne beneficie pas de -15 : il beneficie de -10, le plancher
  // absorbe le reste. Annoncer -15 serait une seconde arithmetique fausse.
  const r = scoreOpportunity({
    status: 'won',
    last_activity_at: ilYA(7),
    name: 'Mehdi Mercier',
    email: 'mehdi@exemple.fr',
  }, {});

  const abattement = r.factors.find(f => f.signal === 'status_won_offset');
  assert.strictEqual(sommeDesFacteurs(r), r.score,
    `la somme des facteurs (${sommeDesFacteurs(r)}) doit valoir le score (${r.score})`);
  assert.ok(abattement.weight > -15, 'l abattement est rogne par le plancher');
});

test('un client actif qui reste au-dessus de zero garde l abattement entier', () => {
  // Ici le malus est plus lourd que l'abattement : il s'applique en entier, et
  // la somme doit toujours tomber juste.
  // 70 jours d'inactivite (+18) et une affaire ouverte immobile depuis 80
  // jours (+25) font 43 ; l'abattement de -15 laisse 28, donc largement
  // positif. 70 jours et non 95 : au-dela de 90 un client gagne declenche
  // `client_silent` (+20) AU LIEU de l'abattement, et le test ne mesurerait
  // plus ce qu'il croit mesurer.
  const r = scoreOpportunity({
    status: 'won',
    last_activity_at: ilYA(70),
    name: 'Alice',
    email: 'alice@exemple.fr',
    company: 'Acme',
    title: 'Directrice',
    phone: '0600000000',
  }, {
    deals: [{ status: 'open', created_at: ilYA(80), updatedAt: ilYA(80) }],
  });

  assert.ok(r.score > 0, 'le score reste positif');
  const abattement = r.factors.find(f => f.signal === 'status_won_offset');
  if (abattement) assert.strictEqual(abattement.weight, -15, 'abattement entier');
  assert.strictEqual(sommeDesFacteurs(r), r.score);
});

test('la somme tombe juste sur un contact sans aucun facteur', () => {
  const r = scoreOpportunity({ status: 'open', name: 'Vide' }, {});
  assert.strictEqual(sommeDesFacteurs(r), r.score);
});
