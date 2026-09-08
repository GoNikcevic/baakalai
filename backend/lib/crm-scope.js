/**
 * CRM Scope — frontière unique entre les deux populations de `opportunities`.
 *
 * La table `opportunities` mélange deux populations que le produit présente
 * comme deux univers séparés :
 *
 * - les contacts issus du CRM (synchro Pipedrive/HubSpot/Salesforce/Odoo,
 *   import manuel, extension) → `campaign_id IS NULL`. Ce sont EUX que les
 *   logiques d'Activation doivent viser : réactivation de deals, upsell,
 *   churn, relance client, renouvellement.
 *
 * - les prospects froids importés par une campagne de prospection
 *   (Apollo/Lemlist via routes/campaigns.js) → `campaign_id IS NOT NULL`.
 *   Ils n'ont jamais parlé à l'utilisateur. Leur seul canal légitime est la
 *   séquence de la campagne qui les a fait entrer.
 *
 * Sans cette frontière, un prospect froid inactif depuis 14 jours devenait
 * éligible aux triggers `deal_stagnant` / `inactive_contact` et à la chaîne
 * `deal_reactivation` : il recevait un email de relance écrit pour un deal
 * CRM en cours (« je reviens vers vous suite à nos échanges ») alors
 * qu'aucun échange n'a jamais eu lieu.
 *
 * `campaign_id` est fiable comme discriminant : il est posé à la création du
 * prospect et aucun code ne le réécrit ensuite.
 */

/** Fragment SQL à ajouter aux WHERE qui sélectionnent des contacts CRM.
 *  Préfixer par l'alias de table utilisé par la requête appelante. */
const CRM_CONTACT_SQL = 'campaign_id IS NULL';

/** Équivalent JS, pour les filtrages en mémoire (listByUser & co). */
function isCrmContact(opp) {
  return !opp?.campaign_id;
}

/** Ne conserve que les contacts CRM d'une liste d'opportunités. */
function onlyCrmContacts(opps) {
  return (opps || []).filter(isCrmContact);
}

module.exports = { CRM_CONTACT_SQL, isCrmContact, onlyCrmContacts };
