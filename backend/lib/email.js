const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Baakalai <noreply@baakal.ai>';
const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

async function sendEmail({ to, subject, html, headers }) {
  if (!RESEND_API_KEY) {
    logger.warn('email', `Email not sent (no RESEND_API_KEY): ${subject} → ${to}`);
    return { success: false, reason: 'no_api_key' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      // `headers` : en-têtes SMTP de l'email lui-même (ex. List-Unsubscribe,
      // cf. lib/email-prefs.js), pas ceux de l'appel API.
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, ...(headers ? { headers } : {}) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logger.error('email', `Failed to send email: ${res.status}`, { error: err });
      return { success: false, reason: err.message || res.status };
    }

    logger.info('email', `Email sent: ${subject} → ${to}`);
    return { success: true };
  } catch (err) {
    logger.error('email', `Email error: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

async function sendVerificationEmail(email, token) {
  const link = `${APP_URL}/api/auth/verify-email?token=${token}`;
  return sendEmail({
    to: email,
    subject: 'Vérifiez votre email, Baakalai',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: #18181b; color: white; border-radius: 12px; font-weight: 700; font-size: 22px;">b</div>
        </div>
        <h2 style="font-size: 20px; margin-bottom: 12px;">Vérifiez votre email</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
          Cliquez sur le bouton ci-dessous pour confirmer votre adresse email et activer votre compte Baakalai.
        </p>
        <a href="${link}" style="display: inline-block; background: #18181b; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Confirmer mon email
        </a>
        <p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">
          Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, ignorez cet email.
        </p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(email, token) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  return sendEmail({
    to: email,
    subject: 'Réinitialiser votre mot de passe, Baakalai',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: #18181b; color: white; border-radius: 12px; font-weight: 700; font-size: 22px;">b</div>
        </div>
        <h2 style="font-size: 20px; margin-bottom: 12px;">Réinitialiser votre mot de passe</h2>
        <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
          Vous avez demandé une réinitialisation de mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
        </p>
        <a href="${link}" style="display: inline-block; background: #18181b; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Réinitialiser mon mot de passe
        </a>
        <p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">
          Ce lien expire dans 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.
        </p>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
