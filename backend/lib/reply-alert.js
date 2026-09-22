/**
 * Alerte « quelqu'un vous a répondu ».
 *
 * Une réponse arrêtait la séquence et, si l'autopilot était éteint, plus rien
 * ne se passait : aucune notification, aucun email. Le mode « arrête-toi à la
 * première réponse et rends-moi la main » ne valait donc que pour qui pensait
 * à aller regarder. C'est ce trou que ferme ce module, appelé sur CHAQUE
 * réponse détectée, autopilot allumé ou éteint.
 *
 * Deux chemins de détection existent et peuvent voir la même réponse dans la
 * même séquence de crons : le moteur natif (API Gmail) et l'analyse de
 * réponses (flux d'activité du CRM). D'où la fenêtre anti-doublon.
 */

const db = require('../db');
const logger = require('./logger');
const { createNotification } = require('./notify');

// Deux détections de la même réponse tombent dans le même passage de
// l'orchestrateur. Au-delà, une nouvelle notification est légitime : c'est une
// vraie deuxième réponse.
const DEDUP_WINDOW_HOURS = 6;

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://app.baakal.ai');

// Ce que l'utilisateur doit comprendre en lisant le titre, sans ouvrir.
const INTENT_LABELS = {
  meeting_request: { fr: 'demande un rendez-vous', en: 'is asking for a meeting' },
  interested: { fr: 'se dit intéressé', en: 'is interested' },
  question: { fr: 'pose une question', en: 'has a question' },
  not_now: { fr: 'demande à être recontacté plus tard', en: 'asks to be contacted later' },
  not_interested: { fr: "n'est pas intéressé", en: 'is not interested' },
  unsubscribe: { fr: 'demande à ne plus être contacté', en: 'asks to be removed' },
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function alreadyAlerted(userId, opportunityId) {
  const r = await db.query(
    `SELECT 1 FROM notifications
     WHERE user_id = $1 AND type = 'reply_received'
       AND metadata ->> 'opportunityId' = $2
       AND created_at > now() - ($3::int * INTERVAL '1 hour')
     LIMIT 1`,
    [userId, String(opportunityId), DEDUP_WINDOW_HOURS]
  );
  return r.rows.length > 0;
}

/**
 * Prévient l'utilisateur qu'un contact vient de répondre.
 * `handedOver` dit si baakalai s'arrête là (rien ne partira tout seul) ou s'il
 * poursuit la conversation : ce n'est pas le même message à lire.
 *
 * Best-effort : une alerte qui échoue ne doit jamais empêcher le traitement de
 * la réponse elle-même, d'où le try/catch général chez l'appelant.
 */
async function notifyReply(userId, {
  opportunityId, contactName, company, email, replyContent, intent, channel = 'email',
  population = 'prospection', handedOver = true,
}) {
  if (await alreadyAlerted(userId, opportunityId)) return { sent: false, reason: 'already_alerted' };

  const who = contactName || email || 'Un contact';
  const where = company ? ` (${company})` : '';
  const what = (INTENT_LABELS[intent] || {}).fr || 'a répondu';
  const title = `${who}${where} ${what}`;
  const excerpt = String(replyContent || '').trim().slice(0, 240);
  const body = handedOver
    ? `${excerpt}\n\nLa séquence est arrêtée, baakalai n'enverra rien de plus : la conversation est à vous.`
    : `${excerpt}\n\nbaakalai prépare une réponse, vous pouvez encore l'annuler avant qu'elle ne parte.`;

  await createNotification(userId, {
    type: 'reply_received',
    title,
    body,
    metadata: { opportunityId, email, intent, channel, population, handedOver },
  });

  // Email : nouvelle catégorie opt-out, jamais un transactionnel.
  try {
    const { isEmailEnabled, unsubscribeHeaders, emailFooter } = require('./email-prefs');
    if (!await isEmailEnabled(userId, 'reply_alert')) return { sent: true, email: false };

    const user = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    const to = user.rows[0]?.email;
    if (!to) return { sent: true, email: false };

    const link = `${APP_URL}/${population === 'crm' ? 'clients' : 'campaigns'}`;
    const { sendEmail } = require('./email');
    await sendEmail({
      to,
      subject: title,
      html: `
        <div style="max-width: 520px; margin: 0 auto; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #18181b;">
          <p style="font-size: 15px; font-weight: 600; margin: 0 0 4px;">${escapeHtml(title)}</p>
          <p style="font-size: 13px; color: #71717a; margin: 0 0 16px;">
            ${channel === 'linkedin' ? 'Réponse LinkedIn' : 'Réponse par email'}${handedOver ? ', la conversation est à vous' : ', baakalai prépare une réponse'}
          </p>
          <blockquote style="margin: 0 0 20px; padding: 12px 16px; background: #fafaf9; border-left: 3px solid #6E57FA; font-size: 14px; line-height: 1.6;">
            ${escapeHtml(excerpt)}
          </blockquote>
          <a href="${link}" style="display: inline-block; background: #6E57FA; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Ouvrir baakalai
          </a>
        </div>
        ${emailFooter(userId, 'reply_alert')}`,
      headers: unsubscribeHeaders(userId, 'reply_alert'),
    });
    return { sent: true, email: true };
  } catch (err) {
    // La notification in-app est déjà posée : l'email qui échoue ne doit pas
    // faire croire que rien n'a été signalé.
    logger.warn('reply-alert', `Email non envoyé à l'utilisateur ${userId}: ${err.message}`);
    return { sent: true, email: false };
  }
}

module.exports = { notifyReply, DEDUP_WINDOW_HOURS };
