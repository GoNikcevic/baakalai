#!/usr/bin/env node
/**
 * Bakal — Connection health check script
 * Tests end-to-end connectivity to PostgreSQL (Supabase), Claude API, and Lemlist.
 *
 * Usage: node scripts/check-connection.js
 */

require('dotenv').config();

const CHECKS = [];
function ok(name, detail) { CHECKS.push({ name, status: 'ok', detail }); }
function fail(name, detail) { CHECKS.push({ name, status: 'FAIL', detail }); }
function skip(name, detail) { CHECKS.push({ name, status: 'skip', detail }); }

async function checkPostgres() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('[YOUR-PASSWORD]') || url.includes('YOUR-PASSWORD')) {
    return skip('PostgreSQL', 'DATABASE_URL not configured');
  }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  try {
    const res = await pool.query('SELECT current_database() AS db, current_user AS usr, now() AS ts');
    const row = res.rows[0];
    ok('PostgreSQL', `db=${row.db} user=${row.usr} time=${row.ts}`);

    // Check if tables exist
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableNames = tables.rows.map(r => r.table_name);
    const required = ['users', 'campaigns', 'touchpoints', 'diagnostics', 'versions', 'memory_patterns'];
    const missing = required.filter(t => !tableNames.includes(t));
    if (missing.length > 0) {
      fail('Schema', `Missing tables: ${missing.join(', ')}`);
    } else {
      ok('Schema', `${tableNames.length} tables found, all required tables present`);
    }

    // Check data
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM campaigns) AS campaigns,
        (SELECT COUNT(*) FROM touchpoints) AS touchpoints
    `);
    const c = counts.rows[0];
    ok('Data', `users=${c.users} campaigns=${c.campaigns} touchpoints=${c.touchpoints}`);

    await pool.end();
  } catch (err) {
    fail('PostgreSQL', err.message);
  }
}

async function checkClaude() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'your_anthropic_api_key_here') {
    return skip('Claude API', 'ANTHROPIC_API_KEY not configured');
  }
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just "ok".' }],
    });
    ok('Claude API', `model=${process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'} tokens=${res.usage?.input_tokens}+${res.usage?.output_tokens}`);
  } catch (err) {
    fail('Claude API', err.message?.substring(0, 120));
  }
}

async function checkLemlist() {
  const key = process.env.LEMLIST_API_KEY;
  if (!key || key === 'your_lemlist_api_key_here') {
    return skip('Lemlist API', 'LEMLIST_API_KEY not configured');
  }
  try {
    const auth = Buffer.from(`:${key}`).toString('base64');
    const res = await fetch('https://api.lemlist.com/api/campaigns', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.ok) {
      const data = await res.json();
      ok('Lemlist API', `${Array.isArray(data) ? data.length : '?'} campaigns found`);
    } else {
      fail('Lemlist API', `HTTP ${res.status}`);
    }
  } catch (err) {
    fail('Lemlist API', err.message);
  }
}

async function checkNotion() {
  const token = process.env.NOTION_TOKEN;
  if (!token || token === 'your_notion_integration_token_here') {
    return skip('Notion API', 'NOTION_TOKEN not configured');
  }
  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (res.ok) {
      const data = await res.json();
      ok('Notion API', `bot=${data.name || data.bot?.owner?.type || 'connected'}`);
    } else {
      fail('Notion API', `HTTP ${res.status}`);
    }
  } catch (err) {
    fail('Notion API', err.message);
  }
}

(async () => {
  console.log('\n  Bakal — Connection Health Check\n  ================================\n');

  await checkPostgres();
  await checkClaude();
  await checkLemlist();
  await checkNotion();

  const maxName = Math.max(...CHECKS.map(c => c.name.length));
  for (const c of CHECKS) {
    const icon = c.status === 'ok' ? '\x1b[32m✓\x1b[0m' : c.status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m-\x1b[0m';
    console.log(`  ${icon} ${c.name.padEnd(maxName + 2)}${c.detail}`);
  }

  const failures = CHECKS.filter(c => c.status === 'FAIL');
  console.log(`\n  ${CHECKS.length} checks, ${failures.length} failures\n`);
  process.exit(failures.length > 0 ? 1 : 0);
})();
