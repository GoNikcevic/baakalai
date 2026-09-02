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

// Cache transports per email account to avoid creating new connections each time
const _transportCache = new Map();

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
 */
async function getDefaultAccount(userId) {
  const result = await db.query(
    `SELECT * FROM email_accounts WHERE user_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
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
async function sendPersonalEmail(userId, { to, toName, subject, body, replyTo }) {
  let account = await getDefaultAccount(userId);
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
    // No HTML — looks like a real personal email
    replyTo: replyTo || account.email_address,
  };

  try {
    const info = await transport.sendMail(mailOptions);
    logger.info('email-outbound', `Sent: ${subject} → ${to} via ${account.provider}`, { messageId: info.messageId });
    return { success: true, messageId: info.messageId };
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
      // plus, l'utilisateur doit reconnecter — c'est la même action corrective
      // que l'absence de compte, d'où le même code.
      return { success: false, code: 'no_email_account', error: err.message };
    }

    return { success: false, code: 'smtp_error', error: err.message };
  }
}

/**
 * Send a nurture email + log it + create Pipedrive activity.
 *
 * existingEmailId : id d'une ligne nurture_emails déjà en file (status
 * 'pending'). Dans ce cas on met à jour cette ligne au lieu d'en insérer une
 * nouvelle — sinon l'approbation créait un doublon et l'original restait
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
    // file — or la contrainte unique 067 (un seul pending par contact) libère
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
};
