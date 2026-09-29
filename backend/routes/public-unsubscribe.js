/**
 * Désinscription d'un CONTACT (migration 120), publique et sans login.
 *
 * Montée sur /api/public/unsubscribe AVANT le mur d'auth : le lien arrive
 * dans la boîte d'un prospect qui n'a pas de compte baakalai et n'en aura
 * jamais. Exiger quoi que ce soit de lui viderait l'opposition de sa
 * substance, que l'article 21 du RGPD veut « simple et effective ».
 *
 *   POST /  → one-click RFC 8058, déclenché par Gmail ou Yahoo. 200 vide.
 *   GET  /  → clic humain, page de confirmation.
 *
 * À ne pas confondre avec /api/public/email-prefs, qui désinscrit un
 * UTILISATEUR des emails que baakalai lui envoie.
 *
 * Le jeton ne porte que le haché de l'adresse : voir lib/contact-optout.js.
 * Conséquence pratique, la page ne peut pas afficher « vous, untel@exemple.fr,
 * êtes désinscrit ». C'est voulu, et sans importance : la personne qui lit
 * connaît sa propre adresse.
 */

const { Router } = require('express');
const crypto = require('crypto');
const { verifyToken, recordOptOut } = require('../lib/contact-optout');
const logger = require('../lib/logger');

const router = Router();

/**
 * L'IP n'est conservée que hachée, et uniquement pour pouvoir dater une
 * contestation (« je ne me suis jamais désinscrit »). Salée par le secret
 * d'instance, elle ne permet pas de remonter à la personne.
 */
function hashIp(req) {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || '';
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
  if (!ip || !secret) return null;
  return crypto.createHmac('sha256', secret).update(ip).digest('base64url').slice(0, 32);
}

async function apply(req, source) {
  const parsed = verifyToken(req.query.token);
  if (!parsed) return null;
  await recordOptOut(parsed.userId, {
    emailHash: parsed.emailHash,
    source,
    // Tronqué : au-delà, c'est du bruit qui grossit la table sans rien
    // apprendre de plus sur l'origine du clic.
    userAgent: (req.get('user-agent') || '').slice(0, 300) || null,
    ipHash: hashIp(req),
  });
  return parsed;
}

// POST · one-click RFC 8058. Le client mail attend un 200 et n'affiche rien :
// toute page renvoyée ici serait perdue. Jamais de redirection non plus, les
// validateurs la comptent comme un échec.
router.post('/', async (req, res) => {
  try {
    const parsed = await apply(req, 'one_click');
    if (!parsed) return res.status(400).end();
    logger.info('unsubscribe', `Opt-out one-click enregistré pour ${parsed.userId}`);
    res.status(200).end();
  } catch (err) {
    logger.error('unsubscribe', `POST échoué : ${err.message}`);
    res.status(500).end();
  }
});

// GET · clic humain.
router.get('/', async (req, res) => {
  try {
    const parsed = await apply(req, 'link');
    if (!parsed) {
      return res.status(400).send(page(
        'Lien invalide',
        'Ce lien de désinscription est invalide ou a été altéré. Répondez simplement à l\'email en demandant à ne plus être contacté, votre interlocuteur recevra la demande.',
        false
      ));
    }
    logger.info('unsubscribe', `Opt-out par lien enregistré pour ${parsed.userId}`);
    res.send(page(
      'Vous êtes désinscrit',
      'Vous ne recevrez plus d\'emails de cet expéditeur. La demande prend effet immédiatement, aucun message en attente ne partira.',
      true
    ));
  } catch (err) {
    logger.error('unsubscribe', `GET échoué : ${err.message}`);
    res.status(500).send(page(
      'Erreur',
      'Une erreur est survenue et votre demande n\'a pas pu être enregistrée. Réessayez dans un instant.',
      false
    ));
  }
});

/**
 * Page autonome, sans dépendance externe.
 *
 * Elle n'est pas aux couleurs de baakalai et ne le nomme pas : le lecteur est
 * en relation avec l'expéditeur, pas avec nous, et découvrir un nom d'outil
 * inconnu sur une page de désinscription inquiète plus qu'il ne rassure. Le
 * ton reste neutre et la confirmation sans ambiguïté.
 */
function page(title, message, success) {
  const accent = success ? '#16A34A' : '#7A7A78';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
       padding:24px;background:#FAFAF9;color:#0A0A0A;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       -webkit-font-smoothing:antialiased}
  .card{max-width:440px;width:100%;background:#fff;border:1px solid #E4E4E0;
        border-radius:10px;padding:32px}
  .mark{width:34px;height:34px;border-radius:50%;background:${accent};
        display:flex;align-items:center;justify-content:center;margin-bottom:18px}
  .mark svg{display:block}
  h1{font-size:19px;font-weight:600;letter-spacing:-0.015em;margin-bottom:10px}
  p{font-size:14.5px;line-height:1.65;color:#525251}
  @media (prefers-color-scheme: dark){
    body{background:#0A0A0A;color:#FAFAF9}
    .card{background:#161619;border-color:#2A2A28}
    p{color:#A1A19F}
  }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff"
           stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        ${success ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M12 8v5M12 17h.01"/>'}
      </svg>
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

module.exports = router;
