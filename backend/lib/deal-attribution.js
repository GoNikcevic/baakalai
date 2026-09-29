/**
 * Ce qu'un rattachement deviné donne le droit de dire.
 *
 * Depuis l'arbitrage du 29/09, un deal Salesforce sans contact role est
 * rattaché à un contact plausible de son compte plutôt que laissé orphelin
 * (voir api/salesforce.js). C'est ce qui rend enfin visibles les clients, les
 * montants, les étapes et les relances d'une org qui ne remplit pas ses
 * OpportunityContactRoles · 308 deals sur 308 étaient invisibles chez un beta
 * testeur.
 *
 * Mais « porteur plausible » n'est pas « interlocuteur confirmé ». Écrire
 * « votre projet à 45 000 € » à quelqu'un qui n'en a peut-être jamais entendu
 * parler grille le contact, et le compte avec lui. La règle est donc :
 *
 *   le chiffre reste bon pour COMPTER · totaux, tuiles, classements, prévisions,
 *   score de churn, et tout ce qui s'affiche au user dans son propre produit ·
 *   un montant d'entreprise est un montant d'entreprise ;
 *
 *   le chiffre n'est pas bon pour AFFIRMER · rien de ce qui part vers le
 *   contact ne cite un montant que baakalai a deviné être le sien.
 *
 * Exclure purement et simplement ces contacts de l'envoi aurait coûté plus que
 * ça ne protège : ils sont déjà relançables aujourd'hui sur leur seule
 * inactivité (lib/reactivation-queue.js n'a besoin d'aucun deal pour ça), et
 * les retirer aurait vidé la file de réactivation du seul user que ce chantier
 * répare. C'est la citation du montant qui est risquée, pas le contact.
 *
 * Une fois le porteur confirmé à la main (attribution 'user'), le montant
 * redevient citable.
 */

/** Rattachements dont on peut affirmer le contenu au contact lui-même. */
const TRUSTED_ATTRIBUTIONS = ['crm_role', 'user'];

/**
 * Vrai quand le lien deal -> contact vient du CRM ou d'une confirmation.
 *
 * NULL compte comme fiable : ces lignes ont été rattachées avant la migration
 * 122, sur des orgs qui remplissaient leurs contact roles. Les traiter comme
 * douteuses ferait taire le montant chez tous les users existants pour une
 * question qui ne se posait pas encore.
 */
function isAttributionTrusted(opp) {
  const attribution = opp?.crm_deal_attribution ?? opp?.crmDealAttribution ?? null;
  return attribution === null || TRUSTED_ATTRIBUTIONS.includes(attribution);
}

/**
 * Le montant du deal, uniquement s'il a le droit d'être affirmé au contact.
 *
 * À utiliser partout où un montant entre dans un prompt d'agent ou dans un
 * email. Ailleurs — agrégats, tris, seuils — `deal_value` se lit directement.
 *
 * @returns {number|string|null} le montant tel quel, ou null s'il est deviné
 */
function assertableDealValue(opp) {
  if (!opp || !isAttributionTrusted(opp)) return null;
  const value = opp.deal_value ?? opp.dealValue ?? null;
  return value === '' ? null : value;
}

/**
 * Ce qui reste à confirmer, pour l'écran de relecture.
 *
 * Renvoie aussi un échantillon : un compteur seul ne se vérifie pas, alors que
 * trois noms de contacts avec leur société et leur montant permettent au user
 * de juger en un regard si la déduction tient.
 */
async function getInferredAttributions(userId, { sample = 5 } = {}) {
  const db = require('../db');
  const counted = await db.query(
    `SELECT count(*)::int AS total FROM opportunities
      WHERE user_id = $1 AND crm_deal_attribution = 'inferred'`,
    [userId]
  );
  const total = counted.rows[0]?.total || 0;
  if (total === 0) return { total: 0, sample: [] };

  // Les montants les plus gros d'abord : c'est là qu'une erreur de porteur
  // coûte le plus cher, donc là que le user veut regarder.
  const rows = await db.query(
    `SELECT id, name, title, company, deal_value, status
       FROM opportunities
      WHERE user_id = $1 AND crm_deal_attribution = 'inferred'
      ORDER BY deal_value DESC NULLS LAST, company
      LIMIT $2`,
    [userId, sample]
  );
  return { total, sample: rows.rows };
}

/**
 * Le user confirme que les porteurs devinés sont les bons interlocuteurs.
 *
 * En bloc, et pas ligne par ligne : la question n'est pas « ce contact-ci
 * est-il le bon » — le user n'en sait pas plus que baakalai sur une org de 300
 * deals — mais « est-ce que je fais confiance à la déduction ». Une réponse,
 * une fois.
 *
 * Passer en 'user' rend les montants citables dans les emails et met les
 * lignes hors de portée des resynchros (voir lib/deal-lifecycle-sync.js).
 */
async function confirmInferredAttributions(userId) {
  const db = require('../db');
  const result = await db.query(
    `UPDATE opportunities SET crm_deal_attribution = 'user', updated_at = now()
      WHERE user_id = $1 AND crm_deal_attribution = 'inferred'`,
    [userId]
  );
  return { confirmed: result.rowCount || 0 };
}

module.exports = {
  TRUSTED_ATTRIBUTIONS,
  isAttributionTrusted,
  assertableDealValue,
  getInferredAttributions,
  confirmInferredAttributions,
};
