/**
 * Demande d'échange avec un expert · formulaire public de la landing.
 *
 * POST /api/public/contact   { name, email, company, crm, lang } → { ok: true }
 *
 * Le formulaire vit à côté de l'agenda de réservation, il ne le remplace pas :
 * l'agenda capte ceux qui savent déjà quand ils sont disponibles, le
 * formulaire capte les autres. Les deux mènent au même échange.
 *
 * Aucune authentification : la ligne écrite ici est un prospect, pas un
 * utilisateur. Deux garde-fous tiennent la route ouverte, un rate-limit par
 * IP (middleware) et un champ piège (`website`) que seul un robot remplit.
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const logger = require('../lib/logger');
const { sendEmail } = require('../lib/email');
const { publicContactLimiter } = require('../middleware/rate-limit');

const router = express.Router();

/** Boîte qui reçoit les demandes. La valeur par défaut est volontairement la
 *  bonne adresse et non une boîte générique : sans variable d'environnement
 *  posée sur Railway, le formulaire doit quand même arriver à quelqu'un.
 *  Surchargeable pour que staging ne réveille personne. */
const NOTIFY_TO = process.env.CONTACT_NOTIFY_EMAIL || 'goran@baakal.ai';

const MAX = { name: 120, email: 200, company: 160, crm: 80 };

/** Validation volontairement permissive : une adresse professionnelle mal
 *  formée est une erreur de frappe, pas une attaque, et le rejet doit rester
 *  rare. On refuse ce qui ne peut pas être une adresse, rien de plus. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Caractères de contrôle : retirés avant la coupe, ils ne servent qu'à
 *  casser l'affichage de l'email de notification. */
const CONTROL_RE = /\p{Cc}/gu;

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_RE, ' ').trim().slice(0, max);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function hashIp(ip) {
  if (!ip) return null;
  const secret = process.env.ENCRYPTION_SECRET || '';
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 32);
}

router.post('/', publicContactLimiter, async (req, res) => {
  const body = req.body || {};

  // Champ piège : invisible pour un humain, rempli par les robots qui
  // remplissent tout. On répond 200 pour ne pas leur apprendre la règle.
  if (clean(body.website, 200)) {
    return res.json({ ok: true });
  }

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email).toLowerCase();
  const company = clean(body.company, MAX.company);
  const crm = clean(body.crm, MAX.crm);
  const lang = body.lang === 'en' ? 'en' : 'fr';

  if (!name || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  let id = null;
  try {
    const result = await db.query(
      `INSERT INTO expert_contact_requests (name, email, company, crm, lang, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, email, company || null, crm || null, lang, hashIp(req.ip)]
    );
    id = result.rows[0].id;
  } catch (err) {
    logger.error('public-contact', `Insert failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }

  // La demande est enregistrée : à partir d'ici, un échec d'envoi ne doit
  // plus faire échouer la requête. Le prospect a rempli sa part, la ligne
  // existe, et `notified_at` reste NULL pour signaler ce qu'il reste à faire.
  //
  // sendEmail ne lève jamais : il renvoie { success: false } quand la clé
  // Resend manque ou que l'API refuse. Tester `success` et non l'absence
  // d'exception, sinon `notified_at` se remplit sur des envois fantômes.
  try {
    const sent = await sendEmail({
      to: NOTIFY_TO,
      subject: `Demande d'échange : ${name}${company ? ` (${company})` : ''}`,
      html: `
        <div style="font-family:-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0A0A0A;">
          <p style="margin:0 0 16px;font-weight:600;">Nouvelle demande depuis la landing</p>
          <table cellpadding="0" cellspacing="0" style="font-size:14px;">
            <tr><td style="padding:3px 16px 3px 0;color:#7A7A78;">Nom</td><td>${escapeHtml(name)}</td></tr>
            <tr><td style="padding:3px 16px 3px 0;color:#7A7A78;">Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
            <tr><td style="padding:3px 16px 3px 0;color:#7A7A78;">Société</td><td>${escapeHtml(company || 'non renseignée')}</td></tr>
            <tr><td style="padding:3px 16px 3px 0;color:#7A7A78;">CRM</td><td>${escapeHtml(crm || 'non renseigné')}</td></tr>
            <tr><td style="padding:3px 16px 3px 0;color:#7A7A78;">Langue</td><td>${lang}</td></tr>
          </table>
        </div>`,
    });

    if (sent && sent.success) {
      await db.query('UPDATE expert_contact_requests SET notified_at = NOW() WHERE id = $1', [id]);
    } else {
      logger.warn('public-contact', `Demande #${id} enregistrée, notification non partie : ${sent && sent.reason}`);
    }
  } catch (err) {
    logger.error('public-contact', `Notification failed for #${id}: ${err.message}`);
  }

  res.json({ ok: true });
});

module.exports = router;
