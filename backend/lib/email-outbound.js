/**
 * Outbound Email Service
 *
 * Sends 1-to-1 personal emails via user's own email account.
 * Supports: SMTP (any provider), Gmail OAuth, Microsoft OAuth.
 *
 * NOT for system emails (use lib/email.js + Resend for those).
 * This module handles nurture/retention emails that look personal.
 */

const nodemailer = require('nodemailer');
const { decrypt } = require('../config/crypto');
const db = require('../db');
const logger = require('./logger');
const contactOptout = require('./contact-optout');

// Cache transports per email account to avoid creating new connections each time
const _transportCache = new Map();

/**
 * Langue du compte, pour le pied de désinscription. Repli sur le français :
 * l'utilisateur type est francophone, et un pied dans la mauvaise langue vaut
 * mieux qu'un envoi qui échoue parce que le profil est absent.
 */
async function getUserLang(userId) {
  try {
    const { rows } = await db.query(`SELECT language FROM users WHERE id = $1`, [userId]);
    return rows[0] && rows[0].language === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

/**
 * Get or create a nodemailer transport for an email account.
 */
function getTransport(account) {
  const cached = _transportCache.get(account.id);
  if (cached && cached.expiresAt > Date.now()) return cached.transport;

  let transport;

  if (account.provider === 'gmail') {
    // Gmail via OAuth2
    transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: account.email_address,
        accessToken: account.decryptedAccessToken,
        refreshToken: account.decryptedRefreshToken,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    });
  } else if (account.provider === 'microsoft') {
    // Microsoft via OAuth2
    transport = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        type: 'OAuth2',
        user: account.email_address,
        accessToken: account.decryptedAccessToken,
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      },
    });
  } else {
    // Generic SMTP
    transport = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port || 587,
      secure: (account.smtp_port || 587) === 465,
      auth: {
        user: account.smtp_user || account.email_address,
        pass: account.decryptedSmtpPass,
      },
    });
  }

  _transportCache.set(account.id, {
    transport,
    expiresAt: Date.now() + 10 * 60 * 1000, // cache 10 min
  });

  return transport;
}

/**
 * Refresh OAuth token if expired. Updates DB and returns fresh token.
 */
async function refreshTokenIfNeeded(account) {
  if (!account.token_expiry || !account.refresh_token) return account;

  const expiresAt = new Date(account.token_expiry).getTime();
  // Refresh 5 minutes before expiry
  if (expiresAt > Date.now() + 300000) return account;

  const { encrypt, decrypt: dec } = require('../config/crypto');
  const refreshToken = dec(account.refresh_token);

  let tokenUrl, params;

  if (account.provider === 'gmail') {
    tokenUrl = 'https://oauth2.googleapis.com/token';
    params = {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    };
  } else if (account.provider === 'microsoft') {
    tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    params = {
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://outlook.office365.com/SMTP.Send offline_access',
    };
  } else {
    return account;
  }

  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });

      if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
      const tokens = await res.json();

      const newExpiry = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

      await db.query(
        `UPDATE email_accounts SET access_token = $1, token_expiry = $2, status = 'active', updated_at = now() WHERE id = $3`,
        [encrypt(tokens.access_token), newExpiry, account.id]
      );

      // Clear transport cache so new token is used
      _transportCache.delete(account.id);

      logger.info('email-outbound', `Refreshed ${account.provider} token for ${account.email_address}`);
      return { ...account, access_token: encrypt(tokens.access_token), token_expiry: newExpiry };
    } catch (err) {
      lastErr = err;
      logger.warn('email-outbound', `Token refresh attempt ${attempt}/${MAX_RETRIES} failed for ${account.email_address}: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // exponential backoff
      }
    }
  }

  logger.error('email-outbound', `Token refresh failed after ${MAX_RETRIES} attempts for ${account.email_address}: ${lastErr.message}`);
  await db.query(
    `UPDATE email_accounts SET status = 'expired', updated_at = now() WHERE id = $1`,
    [account.id]
  );
  throw new Error(`OAuth token expired for ${account.email_address}. Please reconnect.`);
}

/**
 * Decrypt sensitive fields of an email account row.
 */
function decryptAccount(account) {
  const decrypted = { ...account };
  try {
    if (account.access_token) decrypted.decryptedAccessToken = decrypt(account.access_token);
    if (account.refresh_token) decrypted.decryptedRefreshToken = decrypt(account.refresh_token);
    if (account.smtp_pass) decrypted.decryptedSmtpPass = decrypt(account.smtp_pass);
  } catch (err) {
    logger.error('email-outbound', `Failed to decrypt account ${account.id}: ${err.message}`);
  }
  return decrypted;
}

/**
 * Get the default email account for a user.
 * `is_default` est un vrai drapeau depuis la migration 112 (un seul vrai par
 * utilisateur) ; le tri par ancienneté reste le filet pour un compte qui n'en
 * aurait aucun, par exemple si la boîte par défaut a expiré.
 */
async function getDefaultAccount(userId) {
  const result = await db.query(
    `SELECT * FROM email_accounts WHERE user_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Boîte d'envoi à utiliser : celle demandée si elle est utilisable, la boîte
 * par défaut sinon.
 *
 * Le repli est volontaire : une campagne lancée depuis une boîte supprimée ou
 * expirée doit continuer à partir plutôt que de s'arrêter en silence. Le
 * changement d'expéditeur est journalisé, il n'est jamais muet.
 */
async function resolveAccount(userId, accountId) {
  if (accountId) {
    const asked = await db.query(
      `SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [accountId, userId]
    );
    if (asked.rows[0]) return asked.rows[0];
    logger.warn('email-outbound', `Boîte ${accountId} indisponible pour ${userId}, repli sur la boîte par défaut`);
  }
  return getDefaultAccount(userId);
}

/** Boîtes actives d'un utilisateur, la boîte par défaut en tête. */
async function listActiveAccounts(userId) {
  const result = await db.query(
    `SELECT * FROM email_accounts WHERE user_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at ASC`,
    [userId]
  );
  return result.rows;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Ajoute la signature du compte au mailOptions (texte + version HTML + image
 * inline CID). No-op si le compte n'a pas de signature · l'email reste texte
 * seul, comportement historique.
 */
function applySignature(mailOptions, account, body) {
  const sigText = (account.signature_text || '').trim();
  const sigImage = account.signature_image || null;
  if (!sigText && !sigImage) return;

  // Séparateur "-- " : convention de signature reconnue par les clients mail.
  mailOptions.text = body + '\n\n-- \n' + (sigText || '');

  const imageMatch = sigImage ? sigImage.match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  const parts = [];
  if (sigText) parts.push(escapeHtml(sigText).replace(/\n/g, '<br>'));
  if (imageMatch) parts.push('<img src="cid:baakal-signature" alt="" style="max-width:220px;height:auto;display:block;margin-top:8px;">');

  mailOptions.html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;">` +
    `${escapeHtml(body).replace(/\n/g, '<br>')}<br><br>` +
    `<span style="color:#666;">-- </span><br>${parts.join('<br>')}</div>`;

  if (imageMatch) {
    mailOptions.attachments = [
      ...(mailOptions.attachments || []),
      {
        cid: 'baakal-signature',
        filename: `signature.${imageMatch[1].split('/')[1].replace('jpeg', 'jpg')}`,
        content: Buffer.from(imageMatch[2], 'base64'),
        contentType: imageMatch[1],
      },
    ];
  }
}

/**
 * Send a personal email via user's own email account.
 *
 * `code` accompagne chaque échec : les appelants (route /approve, TodayCard)
 * en ont besoin pour distinguer « rien à configurer » d'une vraie panne SMTP
 * et proposer l'action corrective. Le message texte reste destiné aux logs.
 *
 * @param {string} userId
 * @param {{ to, toName, subject, body, replyTo }} options
 * @returns {{ success, messageId, error, code }}
 */
async function sendPersonalEmail(userId, { to, toName, subject, body, replyTo, accountId }) {
  // Règle produit : aucun contenu généré ne part avec un tiret cadratin
  // (marqueur IA). Appliqué ici, au transport, pour couvrir tous les
  // appelants ; la signature du compte (texte de l'utilisateur) est ajoutée
  // après et n'est jamais réécrite.
  const { humanize } = require('./human-style');
  subject = humanize(subject);
  body = humanize(body);

  // Opposition du destinataire (migration 120). Vérifiée ICI et non chez les
  // appelants, pour la même raison que humanize() juste au-dessus : un
  // appelant qui oublierait la règle ne doit pas pouvoir la contourner.
  // Échec explicite plutôt que silencieux, pour que l'appelant puisse marquer
  // la ligne et ne pas la reprogrammer indéfiniment.
  if (await contactOptout.isOptedOut(userId, to)) {
    logger.info('email-outbound', `Bloqué : ${to} s'est désinscrit des emails de ${userId}`);
    return {
      success: false,
      code: 'recipient_unsubscribed',
      error: 'Recipient opted out of your emails.',
    };
  }

  // `accountId` : expéditeur choisi pour cette campagne (migration 112). Sans
  // lui, la boîte par défaut · c'est le cas de toutes les relances CRM.
  let account = await resolveAccount(userId, accountId);
  if (!account) {
    return {
      success: false,
      code: 'no_email_account',
      error: 'No email account configured. Connect Gmail or SMTP in Settings.',
    };
  }

  // Refresh OAuth token if needed
  if (account.provider === 'gmail' || account.provider === 'microsoft') {
    try {
      account = await refreshTokenIfNeeded(account);
    } catch (err) {
      return { success: false, code: 'token_refresh_failed', error: err.message };
    }
  }

  const decrypted = decryptAccount(account);
  const transport = getTransport(decrypted);

  const mailOptions = {
    from: account.email_address,
    to: toName ? `${toName} <${to}>` : to,
    subject,
    text: body,
    // Sans signature : texte seul · looks like a real personal email.
    replyTo: replyTo || account.email_address,
  };

  // Signature du compte (migration 102) : dès qu'elle existe, on passe en
  // multipart texte+HTML · le format des vrais emails composés dans Gmail,
  // donc toujours « personnel ». L'image part en pièce inline CID (comme les
  // signatures Outlook) : pas d'hébergement externe, pas d'URL de tracking.
  applySignature(mailOptions, account, body);

  // Désinscription. APRÈS la signature, qui réécrit `text` et `html` à partir
  // du corps brut et effacerait un pied ajouté avant elle.
  //
  // La langue vient du compte de l'utilisateur, faute de mieux : on ne connaît
  // pas celle du contact, et l'utilisateur écrit dans la langue de son marché.
  const lang = await getUserLang(userId);
  // `|| ''` et non une concaténation directe : un corps vide donnerait la
  // chaîne « undefined » suivie du pied, envoyée telle quelle au destinataire.
  mailOptions.text = (mailOptions.text || '') + contactOptout.footerText(userId, to, lang);
  // `html` n'existe que si le compte a une signature. Sans elle, l'email reste
  // texte seul, ce qui est justement ce qui le fait passer pour un vrai
  // message personnel : on ne va pas le convertir en HTML pour un pied.
  if (mailOptions.html) {
    mailOptions.html += contactOptout.footerHtml(userId, to, lang);
  }
  // En-têtes RFC 8058. Exigés par Gmail et Yahoo au-dessus de leurs seuils de
  // volume, et ils comptent comme moyen d'opposition à part entière : un
  // destinataire peut se désinscrire depuis son client mail sans ouvrir.
  mailOptions.headers = {
    ...(mailOptions.headers || {}),
    ...contactOptout.unsubscribeHeaders(userId, to),
  };

  try {
    const info = await transport.sendMail(mailOptions);
    logger.info('email-outbound', `Sent: ${subject} → ${to} via ${account.email_address}`, { messageId: info.messageId });
    // `accountId` remonte à l'appelant : c'est lui qui trace la boîte dans
    // campaign_sends, d'où se calcule le plafond journalier par boîte.
    return { success: true, messageId: info.messageId, accountId: account.id };
  } catch (err) {
    logger.error('email-outbound', `Failed: ${subject} → ${to}: ${err.message}`);

    // Mark account as expired if auth fails
    if (err.responseCode === 535 || err.code === 'EAUTH') {
      await db.query(
        `UPDATE email_accounts SET status = 'expired', updated_at = now() WHERE id = $1`,
        [account.id]
      );
      _transportCache.delete(account.id);
      // Le compte vient de passer 'expired' : getDefaultAccount ne le renverra
      // plus, l'utilisateur doit reconnecter · c'est la même action corrective
      // que l'absence de compte, d'où le même code.
      return { success: false, code: 'no_email_account', error: err.message };
    }

    // Rejet DÉFINITIF du destinataire (5xx « user unknown ») ≠ erreur transitoire :
    // l'adresse n'existe plus · la personne a probablement quitté la société.
    // Code distinct pour que l'appelant tamponne le contact (data quality + churn).
    const permanentCodes = [550, 551, 553];
    const bounceText = /user unknown|no such user|does not exist|recipient .*(rejected|not found)|mailbox (unavailable|not found|does not exist)|address rejected|invalid recipient/i;
    if (permanentCodes.includes(err.responseCode)
      || (err.responseCode >= 500 && bounceText.test(err.message || ''))) {
      return { success: false, code: 'recipient_bounced', error: err.message };
    }

    return { success: false, code: 'smtp_error', error: err.message };
  }
}

/**
 * Send a nurture email + log it + create Pipedrive activity.
 *
 * existingEmailId : id d'une ligne nurture_emails déjà en file (status
 * 'pending'). Dans ce cas on met à jour cette ligne au lieu d'en insérer une
 * nouvelle · sinon l'approbation créait un doublon et l'original restait
 * bloqué en 'pending' pour toujours.
 */
async function sendNurtureEmail(userId, {
  triggerId, opportunityId, to, toName, subject, body, crmProvider = 'pipedrive', teamCampaignId, patternIds, existingEmailId,
}) {
  // 1. Create the email record as pending (or reuse the queued one)
  let nurture;
  if (existingEmailId) {
    const existing = await db.query(
      `SELECT * FROM nurture_emails WHERE id = $1 AND user_id = $2`,
      [existingEmailId, userId]
    );
    nurture = existing.rows[0];
    if (!nurture) throw new Error(`nurture_emails row ${existingEmailId} not found`);
  } else {
    const emailRecord = await db.query(`
      INSERT INTO nurture_emails (user_id, trigger_id, opportunity_id, to_email, to_name, subject, body, status, team_campaign_id, pattern_ids)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
      RETURNING *
    `, [userId, triggerId || null, opportunityId || null, to, toName || null, subject, body, teamCampaignId || null, patternIds || []]);
    nurture = emailRecord.rows[0];
  }

  // 2. Send the email
  const result = await sendPersonalEmail(userId, { to, toName, subject, body });

  // 3. Update status
  if (result.success) {
    await db.query(
      `UPDATE nurture_emails SET status = 'sent', sent_at = now() WHERE id = $1`,
      [nurture.id]
    );

    // L'envoi passe : si l'adresse était marquée bouncée, elle re-marche.
    if (opportunityId) {
      await db.query(
        `UPDATE opportunities SET email_bounced_at = NULL, email_bounce_reason = NULL
         WHERE id = $1 AND email_bounced_at IS NOT NULL`,
        [opportunityId]
      ).catch(() => {});
    }

    // 4. Log in Pipedrive as activity/note
    if (crmProvider === 'pipedrive') {
      try {
        const { getUserKey } = require('../config');
        const pipedrive = require('../api/pipedrive');
        const pdToken = await getUserKey(userId, 'pipedrive');
        if (pdToken && opportunityId) {
          const opp = await db.opportunities.get(opportunityId);
          if (opp?.crm_contact_id) {
            await pipedrive.createNote(pdToken, {
              personId: parseInt(opp.crm_contact_id, 10),
              content: `<b>Email envoyé via Baakalai</b><br><b>Objet:</b> ${subject}<br><br>${body.replace(/\n/g, '<br>')}`,
            });
          }
        }
      } catch (err) {
        logger.warn('email-outbound', `Pipedrive note failed: ${err.message}`);
      }
    }
  } else if (result.code === 'no_email_account') {
    // Aucune boîte mail connectée : rien ne cloche avec CET email, c'est le
    // compte qui n'est pas configuré. Le passer en 'failed' le sortirait de la
    // file · or la contrainte unique 067 (un seul pending par contact) libère
    // alors le contact, et le cron du lendemain regénère un brouillon tout
    // aussi inenvoyable, à nouveau facturé en tokens. On laisse donc la ligne
    // en 'pending' : on enregistre juste la raison, la file est préservée et
    // les emails partiront tels quels dès la boîte connectée.
    await db.query(
      `UPDATE nurture_emails SET error = $1 WHERE id = $2`,
      [result.error, nurture.id]
    );
  } else {
    await db.query(
      `UPDATE nurture_emails SET status = 'failed', error = $1 WHERE id = $2`,
      [result.error, nurture.id]
    );

    // Le contact s'est désinscrit (migration 120). Marquer la séquence comme
    // arrêtée, sinon le cron du lendemain regénère un brouillon pour le même
    // contact : des tokens brûlés pour un email qui sera rebloqué au
    // transport, tous les jours, indéfiniment. C'est aussi ce qui fait
    // remonter le motif dans l'interface.
    if (result.code === 'recipient_unsubscribed' && opportunityId) {
      await db.query(
        `UPDATE opportunities
         SET sequence_stopped_at = now(), sequence_stop_reason = 'unsubscribed'
         WHERE id = $1`,
        [opportunityId]
      ).catch((err) => logger.warn('email-outbound', `Marquage désinscription échoué : ${err.message}`));
    }

    // Bounce définitif : tamponner le contact · lu par le scan data quality
    // (issue email_bounced) et par le scoring churn (contact probablement parti).
    if (result.code === 'recipient_bounced') {
      if (opportunityId) {
        await db.query(
          `UPDATE opportunities SET email_bounced_at = now(), email_bounce_reason = $1 WHERE id = $2`,
          [(result.error || '').slice(0, 500), opportunityId]
        ).catch(() => {});
      }

      // Pénalité mémoire : un bounce n'est PAS un échec du copy (le contenu
      // n'a jamais été lu), mais laisser l'envoi compter comme neutre-positif
      // fausserait la boucle · les patterns de cet email seraient crédités
      // d'un « envoi » vers une adresse morte. On décrémente donc d'un cran,
      // plancher à 0. Best-effort : la pénalité ne doit jamais faire échouer
      // le traitement du bounce lui-même.
      const bouncedPatternIds = nurture.pattern_ids || [];
      if (bouncedPatternIds.length > 0) {
        await db.query(
          `UPDATE memory_patterns
           SET confirmations = GREATEST(COALESCE(confirmations, 1) - 1, 0)
           WHERE id = ANY($1)`,
          [bouncedPatternIds]
        ).catch((err) => logger.warn('email-outbound', `Pattern bounce penalty failed: ${err.message}`));
      }
    }
  }

  return { ...result, emailId: nurture.id };
}

/**
 * Test an email account by sending a test email to the user.
 */
async function testEmailAccount(account) {
  const decrypted = decryptAccount(account);
  const transport = getTransport(decrypted);
  try {
    await transport.verify();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendPersonalEmail,
  sendNurtureEmail,
  testEmailAccount,
  getDefaultAccount,
  resolveAccount,
  listActiveAccounts,
  // Consommés par le moteur natif de prospection (lecture Gmail API pour la
  // détection de réponses · même token OAuth que l'envoi, scope mail.google.com).
  refreshTokenIfNeeded,
  decryptAccount,
};
