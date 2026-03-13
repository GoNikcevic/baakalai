const path = require('path');
const express = require('express');
const cors = require('cors');
const { config, validateConfig } = require('./config');
const errorHandler = require('./middleware/error-handler');
const { requireAuth } = require('./middleware/auth');

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
const orchestrator = require('./orchestrator');

const app = express();

// CORS — restrict origins in production, allow localhost in dev
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'app')));
app.use('/landing', express.static(path.join(__dirname, '..', 'landing')));

// Health check (public)
app.get('/api/health', (_req, res) => {
  const configOk = validateConfig([
    'lemlist.apiKey',
    'notion.token',
    'claude.apiKey',
  ]);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      lemlist: !!config.lemlist.apiKey,
      notion: !!config.notion.token,
      claude: !!config.claude.apiKey,
    },
    configComplete: configOk,
  });
});

// Auth routes (public)
app.use('/api/auth', authRouter);

// Protected routes (require JWT)
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/variables', requireAuth, variablesRouter);
app.use('/api/export', requireAuth, exportRouter);

// Error handling
app.use(errorHandler);

app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n🚀 Bakal backend running on http://0.0.0.0:${config.port}`);
  console.log(`   Health check: http://localhost:${config.port}/api/health\n`);
  validateConfig([
    'lemlist.apiKey',
    'notion.token',
    'claude.apiKey',
  ]);

  // Clean up expired refresh tokens every hour
  const db = require('./db');
  setInterval(async () => {
    try { await db.refreshTokens.deleteExpired(); } catch { /* ignore */ }
  }, 60 * 60 * 1000);

  // Start orchestrator (cron jobs) if enabled
  orchestrator.start();
});
