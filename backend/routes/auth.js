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

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
  return null;
}

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refresh = generateRefreshToken();
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

    const passwordHash = await bcrypt.hash(password, 10);
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

    const { accessToken, refreshToken } = await issueTokens(user);

    res.status(201).json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.users.getByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const { accessToken, refreshToken } = await issueTokens({
      id: user.id, email: user.email, role: user.role,
    });

    res.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, company: user.company, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
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
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
