/**
 * Audit Log Middleware
 *
 * Logs security-sensitive actions to the audit_log table.
 * Used for GDPR/CCPA compliance and security monitoring.
 *
 * Tracked actions:
 * - auth.login, auth.register, auth.logout, auth.delete_account, auth.reset_password
 * - data.export
 * - settings.update_key
 * - crm.import, crm.sync
 * - team.join, team.role_change, team.remove_member, team.regenerate_invite
 * - admin.cross_tenant_access, admin.pattern_share, admin.run_orchestrator
 *
 * Two ways in:
 * - AUDITED_ROUTES, for routes identified by their path alone
 * - logAudit(), called directly by a handler that needs context the path does
 *   not carry (which member, which role before and after)
 */

const db = require('../db');

// Les clés sont comparées à `${req.baseUrl}${req.path}`, donc au chemin complet.
// `prefix: true` étend la clé aux sous-chemins (`/import` couvre
// `/import/hubspot`) : sans lui, une route paramétrée n'est JAMAIS journalisée,
// et l'entrée reste morte sans que rien ne le signale. Trois l'étaient depuis
// leur écriture (`teams/join/:code`, `crm/import/:provider`, et `crm/sync` qui
// n'a même jamais existé sous ce nom). Ne pas mettre `prefix` sur une clé dont
// les sous-chemins sont d'autres actions : `settings/keys` reste exact, sinon
// `keys/test` serait journalisé comme une écriture de clé.
const AUDITED_ROUTES = {
  'POST /api/auth/login':          { action: 'auth.login',           resource: 'user' },
  'POST /api/auth/register':       { action: 'auth.register',        resource: 'user' },
  'POST /api/auth/logout':         { action: 'auth.logout',          resource: 'user' },
  'DELETE /api/auth/account':      { action: 'auth.delete_account',  resource: 'user' },
  'POST /api/auth/reset-password': { action: 'auth.reset_password',  resource: 'user' },
  'GET /api/export/account':       { action: 'data.export',          resource: 'user' },
  'POST /api/settings/keys':       { action: 'settings.update_key',  resource: 'integration' },
  'POST /api/crm/import':          { action: 'crm.import',           resource: 'contacts', prefix: true },
  'POST /api/crm/sync-to':         { action: 'crm.sync',             resource: 'crm',      prefix: true },
  'POST /api/crm/sync-opportunity':{ action: 'crm.sync',             resource: 'crm' },
  'POST /api/teams/join':          { action: 'team.join',            resource: 'team',     prefix: true },
  'POST /api/stats/run-orchestrator': { action: 'admin.run_orchestrator', resource: 'orchestrator' },
};

function matchAuditedRoute(routeKey) {
  const exact = AUDITED_ROUTES[routeKey];
  if (exact) return exact;

  for (const [key, config] of Object.entries(AUDITED_ROUTES)) {
    if (config.prefix && routeKey.startsWith(`${key}/`)) return config;
  }
  return null;
}

async function logAudit(userId, action, resourceType, resourceId, details, req) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        action,
        resourceType,
        resourceId || null,
        JSON.stringify(details || {}),
        req?.ip || req?.connection?.remoteAddress || null,
        (req?.headers?.['user-agent'] || '').slice(0, 256),
      ]
    );
  } catch {
    // Never fail the request because of audit logging
  }
}

/**
 * Contrôle de propriété avec contournement admin journalisé.
 * Retourne true si l'appelant a le droit de toucher la ressource.
 *
 * `req.user.role === 'admin'` (users.role, attribué au premier compte inscrit)
 * traverse les tenants : le lookup se fait par id, sans périmètre d'équipe.
 * C'est un accès de niveau support, il ne doit pas être silencieux. Chaque fois
 * que c'est CE rôle qui débloque l'accès, et non la propriété, on écrit
 * `admin.cross_tenant_access`.
 *
 * `allowUnowned` reproduit les deux formes du contrôle qui existaient en
 * ligne : certaines routes tolèrent une ressource sans propriétaire (lignes
 * legacy, `user_id` NULL), d'autres la refusent.
 */
function allowOwnerOrAdmin(req, ownerId, resourceType, resourceId, { allowUnowned = false } = {}) {
  if (allowUnowned && !ownerId) return true;
  if (ownerId && ownerId === req.user?.id) return true;
  if (req.user?.role !== 'admin') return false;

  logAudit(
    req.user.id,
    'admin.cross_tenant_access',
    resourceType,
    resourceId || null,
    { owner_user_id: ownerId || null, route: `${req.method} ${req.baseUrl}${req.path}` },
    req
  );
  return true;
}

function auditMiddleware(req, res, next) {
  const routeKey = `${req.method} ${req.baseUrl}${req.path}`.replace(/\/$/, '');
  const config = matchAuditedRoute(routeKey);

  if (!config) return next();

  // Capture response to log after completion
  const originalEnd = res.end;
  res.end = function (...args) {
    originalEnd.apply(this, args);

    // Only log successful actions (2xx/3xx)
    if (res.statusCode < 400) {
      const userId = req.user?.id || null;
      const details = {};

      // Add context without sensitive data
      if (config.action === 'auth.login') {
        details.email = req.body?.email ? req.body.email.replace(/(.{2}).*(@.*)/, '$1***$2') : undefined;
      }
      if (config.action === 'settings.update_key') {
        details.providers = Object.keys(req.body || {}).filter(k => k !== 'password');
      }
      if (config.action === 'crm.import' || config.action === 'crm.sync') {
        details.route = routeKey;
      }

      logAudit(userId, config.action, config.resource, userId, details, req);
    }
  };

  next();
}

module.exports = { auditMiddleware, logAudit, allowOwnerOrAdmin };
