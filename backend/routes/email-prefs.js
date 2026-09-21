/**
 * Email Preferences · désinscription PUBLIQUE (sans login) depuis les emails.
 *
 * Monté sur /api/public/email-prefs AVANT le mur d'auth (server.js) : le lien
 * arrive dans une boîte mail, l'utilisateur ne doit pas avoir à se connecter
 * pour s'opposer (RGPD art. 21 · opposition « simple et effective »).
 *
 * GET  /unsubscribe?token=  → clic humain : coupe la catégorie, page de confirmation
 * POST /unsubscribe?token=  → one-click RFC 8058 (Gmail/Yahoo) : coupe, 200 vide
 *
 * Le token est un HMAC sans état (lib/email-prefs.js) : inforgeable, pas de
 * table à maintenir, idempotent · re-cliquer un vieux lien re-coupe juste la
 * même catégorie.
 */

const { Router } = require('express');
const { verifyUnsubscribeToken, setEmailPref } = require('../lib/email-prefs');

const router = Router();

const APP_URL = process.env.APP_URL || 'https://app.baakal.ai';

const LABELS_FR = {
  crm_digest: 'Digest CRM du lundi',
  weekly_report: 'Rapport hebdomadaire',
  tips: 'Conseils & découverte',
};

async function applyUnsubscribe(token) {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return null;
  await setEmailPref(parsed.userId, parsed.category, false);
  return parsed;
}

// POST · one-click RFC 8058 : les clients mail attendent un 200 sans contenu.
router.post('/unsubscribe', async (req, res) => {
  try {
    const parsed = await applyUnsubscribe(req.query.token);
    if (!parsed) return res.status(400).end();
    res.status(200).end();
  } catch {
    res.status(500).end();
  }
});

// GET · clic humain : confirmation minimaliste, lien vers les Paramètres.
router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = await applyUnsubscribe(req.query.token);
    if (!parsed) {
      return res.status(400).send(page('Lien invalide',
        'Ce lien de désinscription est invalide ou a été altéré.'));
    }
    const label = LABELS_FR[parsed.category] || parsed.category;
    res.send(page('Désinscription confirmée',
      `Vous ne recevrez plus les emails « ${label} ». Vous pouvez réactiver ou ajuster vos emails à tout moment dans vos paramètres.`));
  } catch {
    res.status(500).send(page('Erreur', 'Une erreur est survenue. Réessayez plus tard.'));
  }
});

function page(title, message) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}, baakalai</title></head>
<body style="font-family: -apple-system, sans-serif; background: #FAFAF9; margin: 0; padding: 60px 20px;">
  <div style="max-width: 420px; margin: 0 auto; background: white; border: 1px solid #e4e4e7; border-radius: 12px; padding: 32px; text-align: center;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #6E57FA; color: white; border-radius: 12px; font-weight: 700; font-size: 20px; margin-bottom: 20px;">b</div>
    <h1 style="font-size: 18px; margin: 0 0 10px;">${title}</h1>
    <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">${message}</p>
    <a href="${APP_URL}/settings" style="display: inline-block; background: #18181b; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">Gérer mes emails</a>
  </div>
</body></html>`;
}

module.exports = router;
