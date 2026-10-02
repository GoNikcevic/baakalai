/**
 * Rédiger l'email d'une étape de workflow, au moment de l'envoi.
 *
 * Une étape de workflow ne stocke pas un email, elle stocke une CONSIGNE :
 * « féliciter pour le recrutement et proposer un échange de 15 minutes ».
 * Cette consigne est écrite une fois et vaut pour tous les contacts que le
 * déclencheur fera entrer, ce qui est la seule façon d'automatiser sans
 * rédiger un email par personne.
 *
 * L'email lui-même est donc écrit ICI, à l'envoi, et c'est un gain de qualité
 * et non une concession : à ce moment-là on connaît le contact, son deal, et
 * ce qui lui a déjà été envoyé dans ce parcours. Au moment où l'utilisateur
 * construisait son workflow, on ne savait rien de tout ça.
 *
 * RÈGLE ABSOLUE : si la génération échoue, on n'envoie RIEN. Envoyer la
 * consigne telle quelle mettrait une note de service sous les yeux d'un
 * client. Une étape non partie se rattrape, un email absurde non.
 */

const claude = require('../api/claude');
const logger = require('./logger');

/** Marqueur porté par `touchpoints.sub_type` : ce corps est une consigne. */
const CONSIGNE_MARKER = 'consigne';

function isConsigneStep(tp) {
  return tp && tp.type === 'email' && tp.sub_type === CONSIGNE_MARKER;
}

/**
 * Ce qui a déjà été envoyé à ce contact dans ce parcours, pour que l'étape 2
 * ne redise pas l'étape 1. C'est la raison d'être de la génération tardive.
 */
function historyBlock(previous) {
  if (!previous || previous.length === 0) return '';
  const lines = previous
    .filter(p => String(p.body || '').trim())
    .slice(-3)
    .map((p, i) => `  ${i + 1}. ${String(p.body).replace(/\s+/g, ' ').slice(0, 200)}`);
  if (lines.length === 0) return '';
  return `\n\nCe que les messages précédents de ce parcours disaient déjà. Ne pas le redire, enchaîner dessus :\n${lines.join('\n')}`;
}

/**
 * Ce que le RÔLE du destinataire change dans le message.
 *
 * Lot 6, migration 125 : « un envoi multi-threadé qui ne distingue pas le
 * décideur de l'utilisateur final envoie le même message aux deux, ce qui est
 * la meilleure façon de perdre les deux ». Le décideur veut l'enjeu, pas le
 * mode d'emploi ; l'opérationnel vit le problème au quotidien et n'a pas la
 * main sur le budget. Leur écrire la même chose se voit.
 *
 * Vocabulaire fixé par la migration 125. Un rôle inconnu ne reçoit AUCUNE
 * consigne d'angle plutôt qu'une consigne moyenne : inventer un angle pour
 * quelqu'un dont on ignore la fonction est pire que de ne pas en avoir.
 */
const ANGLE_PAR_ROLE = {
  decision_maker: "Ce destinataire décide. Parler de l'enjeu et du résultat, pas du fonctionnement. Une seule décision à prendre.",
  influencer: "Ce destinataire conseille sans décider. Lui donner de quoi défendre le sujet en interne.",
  operational: "Ce destinataire vit le problème au quotidien mais n'a pas la main sur le budget. Parler du concret, ne rien demander qui engage de l'argent.",
};

/**
 * Ce que les COLLÈGUES du destinataire ont déjà reçu.
 *
 * C'est la contrainte la plus importante de l'envoi multi-threadé, et la moins
 * évidente : deux personnes d'une même société qui reçoivent la même accroche
 * se le disent, et le procédé devient visible. On passe donc les objets déjà
 * envoyés, sans les corps · il s'agit d'éviter la redite, pas de recopier.
 */
function colleaguesBlock(siblings) {
  if (!siblings || siblings.length === 0) return '';
  const lignes = siblings
    .filter(s => String(s.subject || '').trim())
    .slice(0, 3)
    .map(s => `  - ${s.collegue || 'un collègue'}${s.titre ? ` (${s.titre})` : ''} a reçu un message intitulé « ${String(s.subject).slice(0, 120)} »`);
  if (lignes.length === 0) return '';
  return `\n\nDes collègues de cette même société ont déjà été contactés :\n${lignes.join('\n')}\nÉcrire quelque chose de cohérent avec ça mais de différent : ni la même accroche, ni le même objet. Ne jamais mentionner qu'un collègue a été contacté.`;
}

/**
 * @param {object} p
 * @param {string} [p.role] rôle du destinataire dans son compte (migration 125)
 * @param {Array} [p.siblings] ce que ses collègues ont déjà reçu
 * @returns {Promise<{subject, body} | null>} null si la génération a échoué.
 */
async function generateStepEmail({ consigne, prospect, previous, isFirst, role = null, siblings = [] }) {
  const instruction = String(consigne || '').trim();
  if (!instruction) return null;

  const who = [
    prospect.name ? `Destinataire : ${prospect.name}` : null,
    prospect.title ? `Poste : ${prospect.title}` : null,
    prospect.company ? `Société : ${prospect.company}` : null,
    prospect.crm_stage ? `Étape du deal : ${prospect.crm_stage}` : null,
    prospect.deal_value ? `Montant du deal : ${prospect.deal_value}` : null,
  ].filter(Boolean).join('\n- ');

  const prompt = `Tu es un commercial B2B qui écrit à un contact de son CRM. Écris un email personnel, pas un email marketing.

Contexte :
- ${who}

Ce que cet email doit faire :
${instruction}${historyBlock(previous)}${colleaguesBlock(siblings)}

Contraintes :
- Six lignes maximum, pas de header ni de footer
- Vouvoyer
- ${isFirst ? "C'est le premier message de ce parcours." : "C'est une relance : plus court que le précédent, une seule question."}
- L'objet ne doit pas ressembler à une newsletter
${ANGLE_PAR_ROLE[role] ? `- ${ANGLE_PAR_ROLE[role]}` : ''}
${require('./human-style').HUMAN_STYLE_RULES_FR}

Retourne uniquement un JSON : { "subject": "...", "body": "..." }`;

  try {
    const result = await claude.callClaude(
      'Tu écris des emails de suivi client. Retourne uniquement du JSON valide.',
      prompt,
      600,
      'workflow_step_email'
    );

    let parsed = result.parsed;
    if (!parsed) {
      const m = (result.content || result.raw || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
    }
    if (!parsed?.subject || !parsed?.body) return null;

    const { humanizeFields } = require('./human-style');
    return humanizeFields({ subject: parsed.subject, body: parsed.body }, ['subject', 'body']);
  } catch (err) {
    logger.warn('workflow-step-email', `Generation echouee : ${err.message}`);
    return null;
  }
}

module.exports = { CONSIGNE_MARKER, isConsigneStep, generateStepEmail, ANGLE_PAR_ROLE, colleaguesBlock };
