const { Router } = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  requireAuth,
} = require('../middleware/auth');

const router = Router();

// Rate limiting: 10 attempts per 15 minutes per IP on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

router.use('/login', authLimiter);
router.use('/register', authLimiter);
router.use('/refresh', authLimiter);

/**
 * Validate password strength.
 * - Min 8 characters
 * - At least 1 uppercase, 1 lowercase, 1 digit
 */
function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one digit';
  }
  return null;
}

/**
 * Issue access + refresh tokens and return a standard auth response.
 */
function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refresh = generateRefreshToken();
  db.refreshTokens.create(user.id, refresh.tokenHash, refresh.expiresAt);
  return { accessToken, refreshToken: refresh.token };
}

// POST /api/auth/register — Create a new account
router.post('/register', async (req, res) => {
  const { email, password, name, company } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  // Check if email already exists
  const existing = db.users.getByEmail(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // First user becomes admin
  const isFirstUser = db.users.count() === 0;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.users.create({
    email: email.toLowerCase().trim(),
    passwordHash,
    name: name.trim(),
    company: company?.trim() || null,
    role: isFirstUser ? 'admin' : 'client',
  });

  // Assign existing unowned campaigns to the first user
  if (isFirstUser) {
    try {
      db.getDb().prepare('UPDATE campaigns SET user_id = ? WHERE user_id IS NULL').run(user.id);
      db.getDb().prepare('UPDATE chat_threads SET user_id = ? WHERE user_id IS NULL').run(user.id);
    } catch { /* columns may not exist yet */ }
  }

  const { accessToken, refreshToken } = issueTokens(user);

  res.status(201).json({
    token: accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

// POST /api/auth/login — Sign in
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.users.getByEmail(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { accessToken, refreshToken } = issueTokens({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  res.json({
    token: accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, company: user.company, role: user.role },
  });
});

// POST /api/auth/refresh — Exchange refresh token for new access + refresh tokens
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const stored = db.refreshTokens.getByHash(tokenHash);

  if (!stored) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Revoke the used token (rotation)
  db.refreshTokens.deleteByHash(tokenHash);

  // Check expiration
  if (new Date(stored.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const user = db.users.getById(stored.user_id);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Issue new pair
  const tokens = issueTokens({ id: user.id, email: user.email, role: user.role });

  res.json({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

// POST /api/auth/logout — Revoke refresh token
router.post('/logout', (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    db.refreshTokens.deleteByHash(tokenHash);
  }

  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — Get current user info (requires auth)
router.get('/me', requireAuth, (req, res) => {
  const user = db.users.getById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

module.exports = router;
