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
 * @returns {Promise<{subject, body} | null>} null si la génération a échoué.
 */
async function generateStepEmail({ consigne, prospect, previous, isFirst }) {
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
${instruction}${historyBlock(previous)}

Contraintes :
- Six lignes maximum, pas de header ni de footer
- Vouvoyer
- ${isFirst ? "C'est le premier message de ce parcours." : "C'est une relance : plus court que le précédent, une seule question."}
- L'objet ne doit pas ressembler à une newsletter
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

module.exports = { CONSIGNE_MARKER, isConsigneStep, generateStepEmail };
