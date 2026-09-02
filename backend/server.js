const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { config, validateConfig } = require('./config');
const errorHandler = require('./middleware/error-handler');
const { requireAuth } = require('./middleware/auth');
const { apiLimiter, aiLimiter, chatLimiter, statsLimiter } = require('./middleware/rate-limit');
const socketServer = require('./socket');

const authRouter = require('./routes/auth');
const campaignsRouter = require('./routes/campaigns');
const dashboardRouter = require('./routes/dashboard');
const aiRouter = require('./routes/ai');
const chatRouter = require('./routes/chat');
const settingsRouter = require('./routes/settings');
const documentsRouter = require('./routes/documents');
const profileRouter = require('./routes/profile');
const statsRouter = require('./routes/stats');
const projectsRouter = require('./routes/projects');
const variablesRouter = require('./routes/variables');
const exportRouter = require('./routes/export');
const crmRouter = require('./routes/crm');
const analyticsRouter = require('./routes/analytics');
const orchestrator = require('./orchestrator');
const logger = require('./lib/logger');

const app = express();

// Trust proxy (Railway, Render, etc.)
app.set('trust proxy', 1);

// CORS — restrict origins in production, allow localhost in dev
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];

// Auto-allow Railway public domain so the served frontend can reach the API
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  const railwayOrigin = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (!allowedOrigins.includes(railwayOrigin)) {
    allowedOrigins.push(railwayOrigin);
  }
}

// Always allow app.baakal.ai and baakal.ai
for (const d of ['https://app.baakal.ai', 'https://baakal.ai']) {
  if (!allowedOrigins.includes(d)) allowedOrigins.push(d);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow specific Chrome extension IDs (set ALLOWED_EXTENSION_IDS env var, comma-separated)
    if (origin?.startsWith('chrome-extension://') && process.env.ALLOWED_EXTENSION_IDS) {
      const allowed = process.env.ALLOWED_EXTENSION_IDS.split(',').map(id => id.trim());
      if (allowed.some(id => origin.includes(id))) return callback(null, true);
    }
    console.error(`[${new Date().toISOString()}] Origin ${origin} not allowed by CORS. Allowed: ${allowedOrigins.join(', ')}`);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "wss:", "https:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // allows loading external fonts/images
}));

// Webhook Stripe — corps BRUT exigé pour vérifier la signature, donc monté
// avant express.json (public, validé par STRIPE_WEBHOOK_SECRET).
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), require('./routes/billing').stripeWebhook);

// Limit request body size
app.use(express.json({ limit: '2mb' }));

// Cookie parser (for httpOnly refresh token cookie)
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Global API rate limiter
app.use('/api/', apiLimiter);

// Inject Supabase config into frontend (before static serving)
app.get('/supabase-config.js', (_req, res) => {
  const { supabase } = config;
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`// Auto-injected Supabase configuration
window.BAKAL_SUPABASE_URL = ${JSON.stringify(supabase.url)};
window.BAKAL_SUPABASE_ANON_KEY = ${JSON.stringify(supabase.anonKey)};
`);
});

// Serve frontend static files (React build)
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
app.use('/landing', express.static(path.join(__dirname, '..', 'landing')));

// Health check (public) — includes DB pool stats
app.get('/api/health', async (_req, res) => {
  const db = require('./db');
  const dbHealth = await db.healthCheck();
  const configOk = validateConfig([
    'lemlist.apiKey',
    'notion.token',
    'claude.apiKey',
  ]);
  // État des crons (dernier run par job + retard éventuel). Informative
  // seulement : ne dégrade pas le status, sinon Railway redémarrerait le
  // service en boucle pour une panne que le restart ne répare pas.
  const crons = await require('./lib/cron-watchdog').healthSummary(db);
  res.json({
    status: dbHealth.ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      lemlist: !!config.lemlist.apiKey,
      notion: !!config.notion.token,
      claude: !!config.claude.apiKey,
    },
    database: dbHealth,
    sockets: socketServer.getConnectedUserCount(),
    configComplete: configOk,
    ...(crons ? { crons } : {}),
  });
});

// Audit logging middleware (before routes, logs security-sensitive actions)
const { auditMiddleware } = require('./middleware/audit-log');
app.use('/api', auditMiddleware);

// Auth routes (public)
app.use('/api/auth', authRouter);

// Webhooks (public — validated via shared secret, not JWT)
app.use('/api/webhooks', require('./routes/webhooks'));

// Diagnostic CRM public (lead magnet, sans compte — rate-limité par IP dans la route)
app.use('/api/public/diagnostic', require('./routes/public-diagnostic'));

// OAuth email callbacks (public — user returns from Google/Microsoft redirect, no auth needed)
const { gmailCallback, microsoftCallback } = require('./routes/nurture');
app.get('/api/nurture/email-accounts/callback/gmail', gmailCallback);
app.get('/api/nurture/email-accounts/callback/microsoft', microsoftCallback);

// Team context — inject req.team + req.teamRole on every authenticated request
const { teamContext } = require('./middleware/team-context');
app.use('/api', requireAuth, teamContext);

// Team routes
app.use('/api/teams', requireAuth, require('./routes/teams'));

// Protected routes (require JWT) with specific rate limiters
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/ai', requireAuth, aiLimiter, aiRouter);
app.use('/api/chat', requireAuth, chatLimiter, chatRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/billing', requireAuth, require('./routes/billing'));
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/variables', requireAuth, variablesRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/crm', requireAuth, crmRouter);
app.use('/api/churn', requireAuth, require('./routes/churn'));
app.use('/api/reactivation', requireAuth, require('./routes/reactivation'));
app.use('/api/data-quality', requireAuth, require('./routes/data-quality'));
app.use('/api/team-campaigns', requireAuth, require('./routes/team-campaigns'));
app.use('/api/strategic', requireAuth, require('./routes/strategic'));
app.use('/api/signals', requireAuth, require('./routes/signals'));
app.use('/api/informz', requireAuth, require('./routes/informz'));
app.use('/api/analytics', requireAuth, analyticsRouter);
app.use('/api/analytics/membership', requireAuth, require('./routes/analytics-membership'));
app.use('/api/notifications', requireAuth, require('./routes/notifications'));
app.use('/api/templates', requireAuth, require('./routes/templates'));
app.use('/api/nurture', requireAuth, require('./routes/nurture'));
app.use('/api/priorities', requireAuth, require('./routes/priorities'));
app.use('/api/ext', requireAuth, require('./routes/extension'));
app.use('/api/events', requireAuth, require('./routes/events'));

// SPA catch-all — serve React index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/landing/')) return next();
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(503).json({ error: 'Frontend not built yet. Run: cd frontend && npm run build' });
    }
  });
});

// Error handling
app.use(errorHandler);

// Create HTTP server and attach Socket.io
const server = http.createServer(app);
// Catch unhandled promise rejections (prevents silent cron/agent failures)
process.on('unhandledRejection', (err) => {
  logger.error('process', `Unhandled rejection: ${err?.message || err}`);
});

socketServer.init(server, allowedOrigins);

server.listen(config.port, '0.0.0.0', () => {
  logger.info('startup', `Bakal backend running on http://0.0.0.0:${config.port}`);
  logger.info('startup', `Health check: http://localhost:${config.port}/api/health`);
  logger.info('startup', `Socket.io: ws://localhost:${config.port}`);
  validateConfig([
    'lemlist.apiKey',
    'notion.token',
    'claude.apiKey',
  ]);

  // Clean up expired refresh tokens every hour
  const db = require('./db');
  const tokenCleanupInterval = setInterval(async () => {
    try { await db.refreshTokens.deleteExpired(); } catch { /* ignore */ }
  }, 60 * 60 * 1000);

  // Data retention cleanup — runs daily at startup + every 24h
  const { runRetentionCleanup } = require('./lib/retention-cleanup');
  runRetentionCleanup().catch(() => {});
  const retentionInterval = setInterval(async () => {
    try { await runRetentionCleanup(); } catch { /* ignore */ }
  }, 24 * 60 * 60 * 1000);

  // Start orchestrator (cron jobs) if enabled
  orchestrator.start();

  // Dead-man's switch des crons — démarre TOUJOURS, sans condition sur
  // ORCHESTRATOR_ENABLED : c'est précisément quand ce flag casse (cf. les
  // trois mois d'extinction silencieuse d'avril-juillet 2026) que le
  // processus web doit donner l'alerte.
  require('./lib/cron-watchdog').startWatchdog(db);

  // ── Graceful Shutdown ──
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown', `${signal} received — graceful shutdown starting...`);

    clearInterval(tokenCleanupInterval);
    clearInterval(retentionInterval);

    // Stop accepting new connections
    server.close(async () => {
      console.log('   HTTP server closed');

      // Close socket connections
      socketServer.close();
      console.log('   Socket.io closed');

      // Close database pool
      try {
        await db.closeDb();
        console.log('   Database pool closed');
      } catch (err) {
        logger.error('shutdown', 'DB close error', { error: err.message });
      }

      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('⚠️  Forced exit after 30s timeout');
      process.exit(1);
    }, 30000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
