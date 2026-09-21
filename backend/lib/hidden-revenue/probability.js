/**
 * P(récupération) · quelle chance a cette opportunité morte de redevenir du revenu.
 *
 * Fonction sœur de `computeDealProbability` (lib/forecast-engine.js) et elle
 * consomme le même contexte appris (`getLearnedContext`) : taux de conversion
 * réel du tenant et cycle de vente réel. La différence tient au sujet :
 * le forecast note un deal VIVANT, ici on note un deal ARRÊTÉ, ce qui appelle
 * d'autres facteurs (raison de perte, stade atteint avant l'arrêt) et surtout
 * un plafond beaucoup plus bas.
 *
 * Le plafond à 0,45 est structurel, pas prudentiel : on ne peut pas annoncer
 * qu'un deal mort a plus de chances de se conclure qu'un deal frais chez le
 * même client. Sans cette borne, un empilement de multiplicateurs favorables
 * produit des probabilités supérieures au taux de closing du tenant, et le
 * montant affiché devient indéfendable devant un prospect qui a son CRM ouvert.
 *
 * Tout est multiplicatif et borné, aucun appel LLM : même entrée = même sortie.
 */

const P_MIN = 0.02;
const P_MAX = 0.45;

/** Taux de conversion retenu quand le tenant n'a pas assez d'historique conclu. */
const DEFAULT_WIN_RATE = 0.30;

/** Cycle de vente retenu à défaut, aligné sur le forecast (lib/forecast-engine.js). */
const DEFAULT_CYCLE_DAYS = 90;

/** Enlève les accents et met en minuscules · les libellés d'étape et les
 *  raisons de perte sont du texte libre saisi dans 7 CRM différents. */
function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const LATE_STAGE = ['proposition', 'propal', 'proposal', 'devis', 'quote', 'negoc', 'negotiation', 'contrat', 'contract', 'closing', 'signature', 'offre', 'offer'];
const EARLY_STAGE = ['lead', 'prospect', 'nouveau', 'new', 'decouverte', 'discovery', 'qualification', 'qualif', 'premier contact', 'first contact', 'appel', 'call'];

/**
 * Où en était le deal quand il s'est arrêté · 'late' | 'early' | 'unknown'.
 * Un deal arrêté au stade « proposition envoyée » a déjà passé toutes les
 * étapes coûteuses : c'est le meilleur candidat du lot. Un deal arrêté en
 * découverte n'a jamais été qualifié.
 */
function stageBucket(stageLabel) {
  const s = normalize(stageLabel);
  if (!s) return 'unknown';
  if (LATE_STAGE.some(k => s.includes(k))) return 'late';
  if (EARLY_STAGE.some(k => s.includes(k))) return 'early';
  return 'unknown';
}

const LOST_REASON_RULES = [
  // L'ordre compte : une raison mentionnant un concurrent est d'abord une
  // perte au profit d'un tiers, même si elle parle aussi de prix.
  { key: 'competitor', multiplier: 0.50, keywords: ['concurrent', 'competitor', 'competition', 'autre solution', 'autre presta', 'other vendor', 'chez eux'] },
  { key: 'price', multiplier: 0.80, keywords: ['prix', 'price', 'trop cher', 'too expensive', 'tarif', 'cost', 'couteux'] },
  { key: 'postponed', multiplier: 1.40, keywords: ['budget', 'timing', 'report', 'plus tard', 'later', 'annee prochaine', 'next year', 'gel', 'freeze', 'pause', 'priorite', 'priority'] },
  { key: 'no_decision', multiplier: 1.20, keywords: ['pas de decision', 'no decision', 'sans suite', 'sans reponse', 'pas de reponse', 'no response', 'silence', 'ghost', 'abandon', 'no go', 'indecis'] },
];

/** Classe une raison de perte en texte libre. Retourne null si elle est vide
 *  ou si aucun motif connu ne ressort : on n'invente pas de multiplicateur. */
function lostReasonBucket(reason) {
  const r = normalize(reason);
  if (!r) return null;
  for (const rule of LOST_REASON_RULES) {
    if (rule.keywords.some(k => r.includes(k))) return rule;
  }
  return null;
}

/**
 * Probabilité de récupération d'un candidat.
 *
 * candidate : {
 *   daysQuiet          nombre de jours de silence, mesurés depuis snapshot_at
 *   stage              libellé d'étape CRM (texte libre)
 *   status             'lost' | autre
 *   lostReason         texte libre
 *   contactable        email présent et non bouncé
 *   unansweredCount    emails envoyés sans réponse (180 j)
 *   positiveReply      une réponse positive dans les 90 j
 *   icpFit             true | false | null quand on ne sait pas
 * }
 * ctx : { winRate, avgCycleDays } · le contexte appris du tenant.
 *
 * Retourne { probability, factors[] } où chaque facteur porte son
 * multiplicateur et sa justification, pour que l'écran puisse expliquer
 * le chiffre ligne à ligne.
 */
function recoveryProbability(candidate = {}, ctx = {}) {
  const factors = [];
  const winRate = ctx.winRate != null && ctx.winRate > 0 ? ctx.winRate : DEFAULT_WIN_RATE;
  let p = winRate;

  factors.push({
    signal: 'base_win_rate',
    multiplier: 1,
    detail: ctx.winRate != null
      ? `Taux de conversion réel du CRM : ${Math.round(winRate * 100)} %`
      : `Taux de conversion par défaut : ${Math.round(winRate * 100)} % (historique conclu insuffisant)`,
  });

  const apply = (signal, multiplier, detail) => {
    p *= multiplier;
    factors.push({ signal, multiplier, detail });
  };

  // 1. Ancienneté du silence, rapportée au cycle de vente du tenant.
  // Un silence de 60 jours n'a pas le même sens sur un cycle de 3 semaines et
  // sur un cycle de 9 mois : c'est le rapport qui compte, pas le nombre de jours.
  const cycle = Math.max(14, ctx.avgCycleDays || DEFAULT_CYCLE_DAYS);
  const cycleRatio = Math.max(0, Number(candidate.daysQuiet) || 0) / cycle;
  const quietDays = Math.round(Number(candidate.daysQuiet) || 0);
  if (cycleRatio >= 4) apply('quiet_4_cycles', 0.25, `${quietDays} j de silence, plus de 4 cycles de vente`);
  else if (cycleRatio >= 2) apply('quiet_2_cycles', 0.45, `${quietDays} j de silence, plus de 2 cycles de vente`);
  else if (cycleRatio >= 1) apply('quiet_1_cycle', 0.70, `${quietDays} j de silence, plus d'un cycle de vente`);

  // 2. Stade atteint avant l'arrêt.
  const bucket = stageBucket(candidate.stage);
  if (bucket === 'late') apply('stage_late', 1.30, `Arrêté au stade « ${candidate.stage} », après la proposition`);
  else if (bucket === 'early') apply('stage_early', 0.60, `Arrêté au stade « ${candidate.stage} », avant qualification`);

  // 3. Raison de perte · le facteur le plus discriminant quand il est renseigné.
  // Un budget reporté est une vente différée ; un concurrent signé est une
  // vente perdue. Les traiter pareil est la principale façon de gonfler
  // artificiellement le montant affiché.
  if (candidate.status === 'lost') {
    const reason = lostReasonBucket(candidate.lostReason);
    if (reason) apply(`lost_${reason.key}`, reason.multiplier, `Raison de perte : ${candidate.lostReason}`);
  }

  // 4. Engagement observé.
  if (candidate.positiveReply) {
    apply('positive_reply', 1.30, 'Réponse positive dans les 90 derniers jours');
  } else if ((candidate.unansweredCount || 0) >= 3) {
    apply('unanswered', 0.60, `${candidate.unansweredCount} relances sans réponse`);
  }

  // 5. Contactabilité · une opportunité injoignable n'est pas actionnable.
  // Elle n'est pas écartée pour autant : le compte reste réel, c'est le
  // contact qu'il faut retrouver, d'où une décote forte plutôt qu'un zéro.
  if (candidate.contactable === false) {
    apply('uncontactable', 0.35, 'Aucune adresse valide pour ce contact');
  }

  // 6. Fit ICP.
  if (candidate.icpFit === true) apply('icp_fit', 1.15, 'Secteur aligné avec la cible du profil');
  else if (candidate.icpFit === false) apply('icp_off', 0.85, 'Secteur hors de la cible du profil');

  const bounded = Math.min(P_MAX, Math.max(P_MIN, p));
  if (bounded !== p) {
    factors.push({
      signal: bounded === P_MAX ? 'capped_max' : 'capped_min',
      multiplier: 1,
      detail: bounded === P_MAX
        ? `Plafonnée à ${Math.round(P_MAX * 100)} % : un deal arrêté ne peut pas mieux convertir qu'un deal frais`
        : `Plancher à ${Math.round(P_MIN * 100)} %`,
    });
  }

  return { probability: Math.round(bounded * 1000) / 1000, factors };
}

module.exports = {
  recoveryProbability,
  stageBucket,
  lostReasonBucket,
  normalize,
  P_MIN,
  P_MAX,
  DEFAULT_WIN_RATE,
  DEFAULT_CYCLE_DAYS,
};
