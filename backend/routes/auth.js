const { Router } = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  requireAuth,
} = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/email');

const https = require('https');
const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN;

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: IS_PRODUCTION ? 'strict' : 'lax',
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

function setRefreshCookie(res, refreshToken) {
  res.cookie('bakal_refresh', refreshToken, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie('bakal_refresh', { path: '/api/auth' });
}

const router = Router();

// One-time auth code store (Google OAuth → code → token exchange)
const _oauthCodes = new Map();
// OAuth state store (CSRF protection for Google login)
const _oauthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _oauthCodes) {
    if (val.expiresAt < now) _oauthCodes.delete(key);
  }
  for (const [key, val] of _oauthStates) {
    if (val < now) _oauthStates.delete(key);
  }
}, 60000);

// HTTPS helpers — bypass Railway proxy cert issues
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST', port: 443,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, bearerToken) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname, method: 'GET', port: 443,
      headers: { Authorization: `Bearer ${bearerToken}` },
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Google OAuth
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = (process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:5173')) + '/api/auth/google/callback';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.use('/login', authLimiter);
router.use('/register', authLimiter);
router.use('/refresh', authLimiter);
router.use('/forgot-password', authLimiter);
router.use('/reset-password', authLimiter);
router.use('/resend-verification', authLimiter);

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
  return null;
}

async function issueTokens(user, { rememberMe = true } = {}) {
  const accessToken = signAccessToken(user);
  const refresh = generateRefreshToken(rememberMe ? undefined : 1); // 1 day if not remembered, 30 days default
  await db.refreshTokens.create(user.id, refresh.tokenHash, refresh.expiresAt);
  return { accessToken, refreshToken: refresh.token };
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name, company } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await db.users.getByEmail(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const isFirstUser = (await db.users.count()) === 0;

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.users.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
      company: company?.trim() || null,
      role: isFirstUser ? 'admin' : 'client',
    });

    if (isFirstUser) {
      try {
        await db.query('UPDATE campaigns SET user_id = $1 WHERE user_id IS NULL', [user.id]);
        await db.query('UPDATE chat_threads SET user_id = $1 WHERE user_id IS NULL', [user.id]);
      } catch { /* ignore */ }
    }

    // Send verification email (non-blocking)
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await db.query(
      'UPDATE users SET verification_token = $1, verification_expires = $2 WHERE id = $3',
      [verificationToken, verificationExpires, user.id]
    );
    sendVerificationEmail(email, verificationToken).catch(() => {});

    const { accessToken, refreshToken } = await issueTokens(user);

    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      token: accessToken,
      refreshToken, // kept for backward compat (Chrome extension)
      user: { id: user.id, email: user.email, name: user.name, role: user.role, onboarding_complete: false },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, rememberMe = true } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.users.getByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // OAuth-only users have no password
    if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google sign-in. Please log in with Google.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const { accessToken, refreshToken } = await issueTokens(
      { id: user.id, email: user.email, role: user.role },
      { rememberMe },
    );

    setRefreshCookie(res, refreshToken);
    res.json({
      token: accessToken,
      refreshToken, // kept for backward compat (Chrome extension)
      user: { id: user.id, email: user.email, name: user.name, company: user.company, role: user.role, onboarding_complete: !!user.onboarding_complete },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    // Read from httpOnly cookie first, fall back to body (backward compat)
    const refreshToken = req.cookies?.bakal_refresh || req.body?.refreshToken;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token is required' });

    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await db.refreshTokens.getByHash(tokenHash);
    if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });

    await db.refreshTokens.deleteByHash(tokenHash);

    if (new Date(stored.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = await db.users.getById(stored.user_id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const tokens = await issueTokens({ id: user.id, email: user.email, role: user.role });
    setRefreshCookie(res, tokens.refreshToken);
    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    // Invalidate ALL sessions for this user (not just the current token)
    await db.refreshTokens.deleteAllByUser(req.user.id);
    clearRefreshCookie(res);
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db.users.getById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Enrich with team info
    let teamRole = null;
    let teamName = null;
    try {
      const team = await db.teams.getByUser(req.user.id);
      if (team) {
        teamRole = team.role;
        teamName = team.name;
      }
    } catch { /* no team */ }

    res.json({ user: { ...user, onboarding_complete: !!user.onboarding_complete, teamRole, teamName } });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/verify-email
router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token manquant');

    const result = await db.query(
      'UPDATE users SET email_verified = true, verification_token = NULL, verification_expires = NULL WHERE verification_token = $1 AND verification_expires > NOW() RETURNING id',
      [token]
    );

    if (result.rows.length === 0) {
      return res.redirect(APP_URL + '/login?error=invalid_token');
    }

    res.redirect(APP_URL + '/login?verified=true');
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Always return success (don't reveal if email exists or verification state)
    const user = await db.users.getByEmail(email.toLowerCase().trim());
    if (user && !user.email_verified) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.query(
        'UPDATE users SET verification_token = $1, verification_expires = $2 WHERE id = $3',
        [verificationToken, verificationExpires, user.id]
      );
      sendVerificationEmail(user.email, verificationToken).catch(() => {});
    }

    res.json({ success: true, message: 'Si un compte non vérifié existe pour cette adresse, un nouveau lien a été envoyé.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Always return success (don't reveal if email exists)
    const user = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (user.rows.length > 0) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
      await db.query(
        'UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3',
        [resetToken, resetExpires, user.rows[0].id]
      );
      await sendPasswordResetEmail(email.toLowerCase().trim(), resetToken);
    }

    res.json({ success: true, message: 'Si cette adresse existe, un email a été envoyé.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const result = await db.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_expires > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Lien expiré ou invalide' });
    }

    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2',
      [hash, result.rows[0].id]
    );

    res.json({ success: true, message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) {
    next(err);
  }
});

// ─── Google OAuth ───

router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured' });

  const state = crypto.randomBytes(32).toString('hex');
  _oauthStates.set(state, Date.now() + 5 * 60 * 1000); // 5 min expiry

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect(APP_URL + '/?error=google_failed');

  // CSRF protection: validate state parameter
  const stateExpiry = _oauthStates.get(state);
  if (!state || !stateExpiry || stateExpiry < Date.now()) {
    _oauthStates.delete(state);
    return res.redirect(APP_URL + '/?error=invalid_state');
  }
  _oauthStates.delete(state);

  try {
    // Exchange code for tokens (use https module to handle Railway's cert chain)
    const tokens = await httpsPost('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString());

    // Get user info
    const googleUser = await httpsGet(`https://www.googleapis.com/oauth2/v2/userinfo`, tokens.access_token);

    // Find or create user (normalize email to prevent duplicates)
    const normalizedEmail = googleUser.email.toLowerCase().trim();
    let dbUser = await db.users.getByEmail(normalizedEmail);

    if (!dbUser) {
      // Create new user (no password needed for OAuth)
      dbUser = await db.users.create({
        email: normalizedEmail,
        passwordHash: null,
        name: googleUser.name || normalizedEmail.split('@')[0],
        company: null,
        role: 'client',
      });
      // Mark as verified immediately + clear password for OAuth-only user
      await db.query('UPDATE users SET email_verified = true, password_hash = NULL WHERE id = $1', [dbUser.id]);
    } else {
      // Existing user — mark as verified if not already
      if (!dbUser.email_verified) {
        await db.query('UPDATE users SET email_verified = true WHERE id = $1', [dbUser.id]);
      }
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = await issueTokens({
      id: dbUser.id, email: dbUser.email, role: dbUser.role,
    });

    // Store tokens with a one-time code (not in URL)
    const authCode = crypto.randomBytes(32).toString('hex');
    _oauthCodes.set(authCode, {
      accessToken, refreshToken,
      user: { id: dbUser.id, name: dbUser.name, email: dbUser.email, role: dbUser.role, onboarding_complete: !!dbUser.onboarding_complete },
      expiresAt: Date.now() + 60000, // 1 minute
    });

    // Redirect with code only (tokens exchanged via POST)
    res.redirect(`${APP_URL}/?auth=google&code=${authCode}`);

  } catch (err) {
    console.error('[google-auth] Error:', err.message);
    res.redirect(APP_URL + '/?error=google_failed');
  }
});

// DELETE /api/auth/account — Delete user account and all associated data (GDPR/CCPA right to erasure)
router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    const user = await db.users.getById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Require password confirmation for password-based accounts
    if (user.password_hash) {
      if (!password) return res.status(400).json({ error: 'Password confirmation required to delete account' });
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(403).json({ error: 'Invalid password' });
    }

    // Check if user is a team admin — must transfer or disband first
    try {
      const team = await db.teams.getByUser(userId);
      if (team && team.role === 'admin') {
        const membersResult = await db.query(
          'SELECT COUNT(*) as cnt FROM team_members WHERE team_id = $1 AND user_id != $2',
          [team.team_id, userId]
        );
        if (parseInt(membersResult.rows[0].cnt) > 0) {
          return res.status(409).json({
            error: 'You are a team admin with other members. Transfer admin role or remove members before deleting your account.',
          });
        }
      }
    } catch { /* no team — ok */ }

    // Cascade delete all user data (order matters for FK constraints)
    // Most tables have ON DELETE CASCADE from users(id), but we explicitly clean up
    // tables that may not have direct FK or need special handling
    await db.query('DELETE FROM nurture_emails WHERE trigger_id IN (SELECT id FROM nurture_triggers WHERE user_id = $1)', [userId]);
    await db.query('DELETE FROM nurture_triggers WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM email_accounts WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM prospect_activities WHERE campaign_id IN (SELECT id FROM campaigns WHERE user_id = $1)', [userId]);
    await db.query('DELETE FROM opportunity_product_lines WHERE opportunity_id IN (SELECT id FROM opportunities WHERE user_id = $1)', [userId]);
    await db.query('DELETE FROM crm_field_mappings WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM crm_cleaning_reports WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM team_campaigns WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)', [userId]);
    await db.query('DELETE FROM product_lines WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = $1 AND role = $2)', [userId, 'admin']);
    await db.query('DELETE FROM team_members WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM user_integrations WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);

    // Final: delete user (cascades to campaigns, projects, threads, documents, reports, etc.)
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    console.log(`[account-deletion] User ${userId} account deleted (GDPR/CCPA erasure)`);
    res.json({ success: true, message: 'Account and all associated data have been permanently deleted.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/onboarding-complete — Mark onboarding as done
router.post('/onboarding-complete', requireAuth, async (req, res, next) => {
  try {
    await db.query('UPDATE users SET onboarding_complete = true WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/onboarding-reset — Allow user to re-run onboarding wizard
router.post('/onboarding-reset', requireAuth, async (req, res, next) => {
  try {
    await db.query('UPDATE users SET onboarding_complete = false WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/exchange-code — Exchange one-time auth code for tokens
router.post('/exchange-code', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const data = _oauthCodes.get(code);
  if (!data || data.expiresAt < Date.now()) {
    _oauthCodes.delete(code);
    return res.status(401).json({ error: 'Invalid or expired code' });
  }
  _oauthCodes.delete(code);

  res.json({
    token: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
  });
});

module.exports = router;
