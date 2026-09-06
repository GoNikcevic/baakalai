const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEFAULT_SECRET = 'bakal-jwt-secret-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
const ACCESS_TOKEN_EXPIRES = '15m';
const REFRESH_TOKEN_DAYS = 30;

// Enforce strong secret in production, warn in dev
if (JWT_SECRET === DEFAULT_SECRET) {
  if (IS_PRODUCTION) {
    console.error('❌ JWT_SECRET is required in production. Set a strong secret in .env.');
    process.exit(1);
  }
  console.warn('⚠️  JWT_SECRET is using the default value. Set a strong secret in .env for production.');
}

/**
 * Sign a short-lived access token (15 min).
 */
function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES },
  );
}

/**
 * Generate a random refresh token + its SHA-256 hash for storage.
 * Returns { token, tokenHash, expiresAt }
 */
function generateRefreshToken(days) {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const d = days || REFRESH_TOKEN_DAYS;
  const expiresAt = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
  return { token, tokenHash, expiresAt };
}

/**
 * Hash a refresh token for lookup.
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Express middleware: requires a valid JWT in Authorization header.
 * Sets req.user = { id, email, role }.
 */
function requireAuth(req, res, next) {
  // Les callbacks OAuth CRM sont des redirections navigateur — pas de JWT.
  // L'identité vient du paramètre state, vérifié dans le handler.
  if (/^\/api\/crm\/(salesforce|hubspot|pipedrive)\/callback(\?|$)/.test(req.originalUrl)) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Express middleware: requires an authenticated admin.
 * Use after requireAuth for actions that curate shared, cross-tenant resources
 * (e.g. publishing a memory pattern to the global pool).
 */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

/**
 * Optional auth: attaches req.user if token present, but doesn't block.
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch { /* ignore invalid token */ }
  }
  next();
}

module.exports = {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  optionalAuth,
};
