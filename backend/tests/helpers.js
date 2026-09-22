/**
 * Test helpers · sets up an isolated Express app with a fresh SQLite DB.
 *
 * Usage:
 *   const { setup, teardown, request, registerAndLogin } = require('./helpers');
 *   before(setup);
 *   after(teardown);
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

// Unique temp DB per test run
const TEST_DB_PATH = path.join(__dirname, `..`, `data`, `test-${process.pid}.db`);

// Set env BEFORE requiring any app code
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.ENCRYPTION_SECRET = 'test-encryption-secret-32chars!!';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-fake-key';
process.env.DATABASE_PATH = TEST_DB_PATH;

let server;
let baseUrl;

function clearBackendCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/backend/') && !key.includes('node_modules') && !key.includes('/tests/')) {
      delete require.cache[key];
    }
  }
}

function cleanDb() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = TEST_DB_PATH + ext;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

async function setup() {
  // Close previous DB if any
  try {
    const oldDb = require('../db');
    if (typeof oldDb.closeDb === 'function') oldDb.closeDb();
  } catch { /* module not loaded yet */ }

  // Clear module cache so DB gets re-initialized
  clearBackendCache();

  // Clean any previous test DB
  cleanDb();

  // Now require the app
  const express = require('express');
  const cors = require('cors');
  const errorHandler = require('../middleware/error-handler');
  const { requireAuth } = require('../middleware/auth');

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Mount routes
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/campaigns', requireAuth, require('../routes/campaigns'));
  app.use('/api/projects', requireAuth, require('../routes/projects'));
  app.use('/api/profile', requireAuth, require('../routes/profile'));
  app.use('/api/ai', requireAuth, require('../routes/ai'));
  // Monté pour que l'export RGPD soit testable : ses requêtes listent leurs
  // colonnes une par une, et une colonne disparue y passe inaperçue jusqu'au
  // 500 en production. C'est arrivé avec `phone` sur opportunities.
  app.use('/api/export', requireAuth, require('../routes/export'));
  app.use(errorHandler);

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function teardown() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  // Close DB connection
  try {
    const dbMod = require('../db');
    if (typeof dbMod.closeDb === 'function') dbMod.closeDb();
  } catch { /* ignore */ }

  clearBackendCache();
  cleanDb();
}

/**
 * Minimal HTTP request helper (no external deps).
 */
function request(method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Register a test user and return { token, refreshToken, user } */
async function registerAndLogin(overrides = {}) {
  const email = overrides.email || `test-${Date.now()}@bakal.test`;
  const res = await request('POST', '/api/auth/register', {
    body: {
      email,
      password: overrides.password || 'TestPass1',
      name: overrides.name || 'Test User',
      company: overrides.company || 'TestCo',
    },
  });
  return { token: res.body.token, refreshToken: res.body.refreshToken, user: res.body.user, status: res.status };
}

module.exports = { setup, teardown, request, registerAndLogin };
