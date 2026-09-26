function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${err.message}`);
  if (process.env.NODE_ENV !== 'production' && err.stack) console.error(err.stack);

  // Un 401/403 renvoyé par un CRM connecté (session Salesforce/Pipedrive/HubSpot
  // invalide, permissions insuffisantes) est un problème CÔTÉ CRM, pas une
  // session Baakalai expirée · le laisser passer tel quel ferait déconnecter
  // l'utilisateur de Baakalai (api-client.js traite tout 401 comme "session
  // expirée" et vide le token). On le remonte en 502, jamais en 401/403.
  const status = err.isCrmUpstreamError ? 502 : (err.status || 500);
  // In production, hide internal error details from client
  const message = (status >= 500 && process.env.NODE_ENV === 'production')
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({
    error: message,
    code: err.code || undefined,
  });
}

module.exports = errorHandler;
