/**
 * Hidden Revenue Score · l'agrégation, en fonctions pures et testables.
 *
 * Trois chiffres, trois rôles distincts, et c'est ce qui les empêche de se
 * répéter :
 *
 *   HRS         taille de la réserve, rapportée au volume d'affaires du client.
 *   Montant     ce qu'on peut raisonnablement en sortir (réserve × probabilité).
 *   Confiance   fiabilité de l'estimation, et rien d'autre.
 *
 * Le HRS se calcule sur la valeur QUALIFIÉE, pas sur la valeur attendue. Deux
 * raisons : la phrase reste lisible (« 24 % de votre base de revenu dort »), et
 * le score ne bouge pas quand on retouche le modèle de probabilité. Sans ça,
 * score et montant diraient deux fois la même chose.
 *
 * La qualité de données ne pèse PAS dans le HRS. Elle monte quand le CRM est
 * bien tenu, là où les quatre dimensions montent quand il est mal exploité :
 * une composante à contresens dans une somme pondérée rend le total
 * inexplicable. Elle est l'unique entrée de la confiance, où elle a sa place.
 */

const SCORE_VERSION = 'hrs-v1';

/**
 * Poids des dimensions. Si une dimension n'est pas évaluée (non implémentée,
 * ou aucune donnée pour la calculer), son poids est retiré et les autres sont
 * renormalisées : un score partiel reste sur 100 et reste comparable, au lieu
 * d'être mécaniquement écrasé par les composantes manquantes.
 */
const DIMENSION_WEIGHTS = {
  dormant_pipeline: 0.35,
  customer_expansion: 0.25,
  customer_reactivation: 0.25,
  lead_reactivation: 0.15,
};

/**
 * Paliers d'intensité · part de la base de revenu (pipeline ouvert + gagné sur
 * 12 mois) que représente la réserve d'une dimension.
 *
 * Des paliers ancrés plutôt qu'une courbe : chaque borne a un sens métier
 * qu'on peut défendre ligne à ligne devant un prospect. 12 % de la base de
 * revenu qui dort, c'est la moitié du score ; au delà de 40 %, la réserve est
 * telle que la précision n'apporte plus rien à la décision.
 */
const INTENSITY_ANCHORS = [
  [0.00, 0],
  [0.05, 25],
  [0.12, 50],
  [0.25, 75],
  [0.40, 100],
];

/** Sous-score 0 à 100 d'une dimension, par interpolation linéaire entre paliers. */
function subScore(intensity) {
  const x = Number(intensity);
  if (!Number.isFinite(x) || x <= 0) return 0;
  const last = INTENSITY_ANCHORS[INTENSITY_ANCHORS.length - 1];
  if (x >= last[0]) return 100;
  for (let i = 1; i < INTENSITY_ANCHORS.length; i++) {
    const [x0, y0] = INTENSITY_ANCHORS[i - 1];
    const [x1, y1] = INTENSITY_ANCHORS[i];
    if (x <= x1) return Math.round(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  return 100;
}

/**
 * HRS à partir des sous-scores des dimensions évaluées.
 * `subScores` : { dormant_pipeline: 73, customer_reactivation: 66, ... }
 * Retourne { hrs, weights } où `weights` expose la renormalisation appliquée.
 */
function aggregateScore(subScores = {}) {
  const evaluated = Object.keys(subScores).filter(
    d => DIMENSION_WEIGHTS[d] != null && Number.isFinite(Number(subScores[d]))
  );
  if (evaluated.length === 0) return { hrs: 0, weights: {} };

  const totalWeight = evaluated.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d], 0);
  const weights = {};
  let hrs = 0;
  for (const d of evaluated) {
    const w = DIMENSION_WEIGHTS[d] / totalWeight;
    weights[d] = Math.round(w * 1000) / 1000;
    hrs += w * Number(subScores[d]);
  }
  return { hrs: Math.round(Math.min(100, Math.max(0, hrs))), weights };
}

/**
 * Composition de la confiance. Chaque entrée est une couverture entre 0 et 1.
 * Ce sont toutes des mesures de ce que la base CONTIENT, jamais de ce qu'elle vaut.
 */
const CONFIDENCE_WEIGHTS = [
  { key: 'amountCoverage', weight: 25, label: 'Montants renseignés' },
  { key: 'activityCoverage', weight: 20, label: "Dates d'activité réelles" },
  { key: 'contactability', weight: 15, label: 'Contacts joignables' },
  { key: 'historyDepth', weight: 15, label: "Profondeur d'historique" },
  { key: 'volume', weight: 10, label: 'Volume statistique' },
  { key: 'statusCoherence', weight: 10, label: 'Cohérence des statuts' },
  { key: 'lostReasonCoverage', weight: 5, label: 'Raisons de perte renseignées' },
];

/**
 * Confiance 0 à 100 + le détail de ce qui l'a fait monter ou descendre.
 * Une couverture absente compte pour 0 : ne pas savoir, c'est ne pas savoir.
 */
function confidenceScore(coverage = {}) {
  const factors = [];
  let score = 0;
  for (const { key, weight, label } of CONFIDENCE_WEIGHTS) {
    const raw = Number(coverage[key]);
    const value = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    const points = value * weight;
    score += points;
    factors.push({
      key,
      label,
      weight,
      coverage: Math.round(value * 100) / 100,
      points: Math.round(points * 10) / 10,
    });
  }
  return { confidence: Math.round(Math.min(100, Math.max(0, score))), factors };
}

/**
 * Fourchette affichée. La confiance ne s'affiche pas À CÔTÉ du montant, elle le
 * TRANSFORME : à 86 % elle est serrée et dit « on sait », à 45 % elle est large
 * et dit « votre base est trop trouée pour être précise », ce qui est le vrai
 * diagnostic dans ce cas là. Le même écran sert les deux sans jamais mentir.
 *
 * Largeur maximale 60 % : au delà, la fourchette ne veut plus rien dire et il
 * vaut mieux ne rien annoncer du tout (cf. `isQuantifiable`).
 */
const MAX_SPREAD = 0.6;

function expectedRange(expectedValue, confidence) {
  const value = Math.max(0, Number(expectedValue) || 0);
  const c = Math.min(1, Math.max(0, (Number(confidence) || 0) / 100));
  const spread = MAX_SPREAD * (1 - c);
  return {
    low: Math.round(value * (1 - spread)),
    high: Math.round(value * (1 + spread)),
    spread: Math.round(spread * 1000) / 1000,
  };
}

/**
 * En dessous de 35 de confiance, on n'annonce pas de montant : on annonce le
 * trou de données. Un CRM pauvre donne peu de candidats donc un score bas, or
 * c'est le cas type de notre ICP. Le troisième état évite qu'un écran affiche
 * « peu de revenu dormant » à quelqu'un dont la base est simplement vide.
 */
const QUANTIFIABLE_CONFIDENCE = 35;

function isQuantifiable(confidence) {
  return (Number(confidence) || 0) >= QUANTIFIABLE_CONFIDENCE;
}

/**
 * Bandes de lecture du HRS. Un score élevé veut dire « beaucoup à récupérer »,
 * jamais « vous travaillez mal » : les clés sont neutres et le libellé est
 * construit côté front (i18n).
 */
function scoreBand(hrs) {
  const s = Number(hrs) || 0;
  if (s <= 20) return 'low';
  if (s <= 40) return 'moderate';
  if (s <= 60) return 'significant';
  if (s <= 80) return 'high';
  return 'very_high';
}

function confidenceBand(confidence) {
  const c = Number(confidence) || 0;
  if (c < 50) return 'low';
  if (c < 75) return 'medium';
  if (c < 90) return 'high';
  return 'very_high';
}

module.exports = {
  SCORE_VERSION,
  DIMENSION_WEIGHTS,
  INTENSITY_ANCHORS,
  CONFIDENCE_WEIGHTS,
  MAX_SPREAD,
  QUANTIFIABLE_CONFIDENCE,
  subScore,
  aggregateScore,
  confidenceScore,
  expectedRange,
  isQuantifiable,
  scoreBand,
  confidenceBand,
};
