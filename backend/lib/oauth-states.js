/**
 * States OAuth CRM éphémères, partagés entre le flow produit
 * (routes/crm.js — connexion d'un compte, state porteur d'un userId) et le
 * diagnostic public (routes/public-diagnostic.js — lecture unique sans
 * compte, state marqué `diagnostic: true`). Les deux flows partagent le même
 * callback enregistré chez les fournisseurs : /api/crm/:provider/callback.
 *
 * En mémoire volontairement : un state vit 10 minutes, ne pas survivre à un
 * redéploiement est acceptable (l'utilisateur reclique).
 */

const states = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of states) {
    if (val.expiresAt < now) states.delete(key);
  }
}, 300000).unref();

module.exports = states;
