const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
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
const orchestrator = require('./orchestrator');

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

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.error(`[${new Date().toISOString()}] Origin ${origin} not allowed by CORS. Allowed: ${allowedOrigins.join(', ')}`);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
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

// Protected routes (require JWT) with specific rate limiters
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/ai', requireAuth, aiLimiter, aiRouter);
app.use('/api/chat', requireAuth, chatLimiter, chatRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/stats', requireAuth, statsLimiter, statsRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/variables', requireAuth, variablesRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/crm', requireAuth, crmRouter);

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
  console.log(`\n🚀 Bakal backend running on http://0.0.0.0:${config.port}`);
  console.log(`   Health check: http://localhost:${config.port}/api/health`);
  console.log(`   Socket.io:    ws://localhost:${config.port}\n`);
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
    console.log(`\n🛑 ${signal} received — graceful shutdown starting...`);

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
        console.error('   DB close error:', err.message);
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
