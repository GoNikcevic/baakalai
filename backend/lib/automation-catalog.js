/**
 * Catalogue des déclencheurs · Automatisation (migration 114).
 *
 * Un seul endroit décrit ce qu'un déclencheur est capable de fournir. C'est la
 * règle structurante de l'éditeur : le déclencheur DÉFINIT le contexte
 * d'exécution. « Le deal change de stage » fournit un deal, un contact, un
 * owner, un montant. « Un signal Recrutement apparaît » fournit une société et
 * un contact, mais pas forcément de deal. Sans cette table, on écrit un email
 * avec {montant_deal} puis on l'accroche à un déclencheur qui n'a pas de deal.
 *
 * Les libellés restent côté frontend (règle i18n) : ce module ne transporte
 * que des clés et des capacités.
 */

// Les 9 types produits par le moteur de veille (lib/agents/signal-agent.js,
// VALID_SIGNAL_TYPES). Tous appartiennent à la veille externe : la société
// concernée n'est pas forcément cliente.
const VEILLE_SIGNAL_TYPES = [
  'funding',
  'hiring',
  'news',
  'job_change',
  'leadership_change',
  'competitor',
  'product_launch',
  'expansion',
  'tech_adoption',
];

/**
 * Les signaux CRM (deal stagnant, client à risque, contact inactif) ne
 * transitent pas encore par la table `signals` : ils vivent dans les pages
 * Clients à risque et Deals à relancer. La famille est déclarée ici pour que
 * l'interface puisse dire où ils sont plutôt que de faire comme s'ils
 * n'existaient pas, mais aucun type ne la peuple au lot 1.
 */
const CRM_SIGNAL_TYPES = [];

const FAMILY_VEILLE = 'veille';
const FAMILY_CRM = 'crm';

function familyOfSignalType(signalType) {
  return CRM_SIGNAL_TYPES.includes(signalType) ? FAMILY_CRM : FAMILY_VEILLE;
}

/**
 * Ce qu'un déclencheur met à disposition des étapes.
 *
 * `deal: false` sur les signaux de veille n'est pas une limite temporaire :
 * un signal « Recrutement » pointe une société, et si un deal existe il n'est
 * pas celui du signal. L'éditeur barre {montant_deal} et grise l'étape
 * « changer le stage d'un deal » sur cette base.
 */
function contextOf(eventSource, eventKey) {
  if (eventSource === 'signal') {
    return {
      contact: true,
      company: true,
      signal: true,
      deal: false,
      owner: false,
    };
  }
  if (eventSource === 'crm_event') {
    const withDeal = ['deal_stage_changed', 'deal_created'].includes(eventKey);
    return {
      contact: true,
      company: true,
      signal: false,
      deal: withDeal,
      owner: withDeal,
    };
  }
  // email_event
  return { contact: true, company: true, signal: false, deal: false, owner: false };
}

/**
 * Les sources réellement branchées. Tout le reste est déclaré, visible et
 * grisé : mieux vaut montrer la cible et dire qu'elle n'est pas prête que
 * laisser croire qu'elle n'existe pas. Le grisage doit toujours porter sa
 * raison, jamais une phrase générique.
 */
const WIRED_EVENT_SOURCES = ['signal'];

function isWired(eventSource) {
  return WIRED_EVENT_SOURCES.includes(eventSource);
}

/** Catalogue des événements CRM et email, déclarés mais pas encore branchés. */
const CRM_EVENT_KEYS = ['deal_stage_changed', 'deal_created', 'contact_created'];
const EMAIL_EVENT_KEYS = ['reply_received', 'no_reply_days'];

module.exports = {
  VEILLE_SIGNAL_TYPES,
  CRM_SIGNAL_TYPES,
  CRM_EVENT_KEYS,
  EMAIL_EVENT_KEYS,
  FAMILY_VEILLE,
  FAMILY_CRM,
  familyOfSignalType,
  contextOf,
  isWired,
  WIRED_EVENT_SOURCES,
};
