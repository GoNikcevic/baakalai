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
    console.error(`[${new Date().toISOString()}] Origin ${origin} not allowed by CORS. Allowed: ${allowedOrigins.join(', ')}`);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // frontend needs inline styles
  crossOriginEmbedderPolicy: false, // allows loading external fonts/images
}));

// Limit request body size
app.use(express.json({ limit: '2mb' }));

// Global API rate limiter
app.use('/api/', apiLimiter);

// Inject Supabase config into frontend (before static serving)
app.get('/supabase-config.js', (_req, res) => {
  const { supabase } = config;
  res.setHeader('Content-Type', 'application/javascript');
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
  });
});

// Auth routes (public)
app.use('/api/auth', authRouter);

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
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/variables', requireAuth, variablesRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/crm', requireAuth, crmRouter);
app.use('/api/team-campaigns', requireAuth, require('./routes/team-campaigns'));
app.use('/api/analytics', requireAuth, analyticsRouter);
app.use('/api/notifications', requireAuth, require('./routes/notifications'));
app.use('/api/templates', requireAuth, require('./routes/templates'));
app.use('/api/nurture', requireAuth, require('./routes/nurture'));

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

  // Clean up completed jobs every 6 hours
  const jobCleanupInterval = setInterval(async () => {
    try { await db.jobQueue.cleanup(7); } catch { /* ignore */ }
  }, 6 * 60 * 60 * 1000);

  // Start orchestrator (cron jobs) if enabled
  orchestrator.start();

  // ── Graceful Shutdown ──
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown', `${signal} received — graceful shutdown starting...`);

    clearInterval(tokenCleanupInterval);
    clearInterval(jobCleanupInterval);

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
