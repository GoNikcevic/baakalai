#!/usr/bin/env node
/**
 * Seed the Supabase PostgreSQL database with demo data.
 * Reads and executes backend/db/seed-demo-data.sql against the configured DATABASE_URL.
 *
 * Usage:
 *   node scripts/seed-supabase.js          # Seed (skip if data exists)
 *   node scripts/seed-supabase.js --reset  # Clear all data then seed
 *   node scripts/seed-supabase.js --check  # Just check if data exists
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const RESET = process.argv.includes('--reset');
const CHECK_ONLY = process.argv.includes('--check');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes('[YOUR-PASSWORD]') || dbUrl.includes('YOUR-PASSWORD')) {
  console.error('\n  Error: DATABASE_URL is not configured properly in .env');
  console.error('  Set it to your Supabase connection string.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function main() {
  console.log('\n  Bakal — Supabase Seed\n  =====================\n');

  // Check existing data
  try {
    const res = await pool.query('SELECT COUNT(*) AS c FROM campaigns');
    const count = parseInt(res.rows[0].c, 10);

    if (CHECK_ONLY) {
      console.log(`  Database has ${count} campaign(s).`);
      await pool.end();
      process.exit(0);
    }

    if (count > 0 && !RESET) {
      console.log(`  Database already has ${count} campaign(s).`);
      console.log('  Use --reset to clear and re-seed.\n');
      await pool.end();
      process.exit(0);
    }
  } catch (err) {
    // Table might not exist — that's fine, SQL file should create it
    console.log('  Warning: Could not check existing data:', err.message);
  }

  if (RESET) {
    console.log('  Clearing existing data...');
    const clearSQL = `
      DELETE FROM chat_messages;
      DELETE FROM chat_threads;
      DELETE FROM versions;
      DELETE FROM diagnostics;
      DELETE FROM touchpoints;
      DELETE FROM campaigns;
      DELETE FROM memory_patterns;
      DELETE FROM opportunities;
      DELETE FROM reports;
      DELETE FROM chart_data;
      DELETE FROM user_profiles;
      DELETE FROM refresh_tokens;
      DELETE FROM documents;
      DELETE FROM project_files;
      DELETE FROM projects;
      DELETE FROM settings;
    `;
    try {
      await pool.query(clearSQL);
      console.log('  All tables cleared.\n');
    } catch (err) {
      console.warn('  Warning during clear:', err.message);
    }
  }

  // Read and execute SQL file
  const sqlPath = path.join(__dirname, '..', 'db', 'seed-demo-data.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`  Error: SQL file not found at ${sqlPath}`);
    await pool.end();
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('  Executing seed-demo-data.sql...');

  try {
    await pool.query(sql);
    console.log('  SQL executed successfully.\n');
  } catch (err) {
    console.error('  Error executing SQL:', err.message);
    if (err.detail) console.error('  Detail:', err.detail);
    await pool.end();
    process.exit(1);
  }

  // Verify
  try {
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM campaigns) AS campaigns,
        (SELECT COUNT(*) FROM touchpoints) AS touchpoints,
        (SELECT COUNT(*) FROM diagnostics) AS diagnostics,
        (SELECT COUNT(*) FROM versions) AS versions,
        (SELECT COUNT(*) FROM memory_patterns) AS patterns,
        (SELECT COUNT(*) FROM opportunities) AS opportunities,
        (SELECT COUNT(*) FROM reports) AS reports,
        (SELECT COUNT(*) FROM chart_data) AS chart_data
    `);
    const c = counts.rows[0];

    console.log('  ════════════════════════════════════');
    console.log('  Seed complete!');
    console.log(`  ${c.users} users`);
    console.log(`  ${c.campaigns} campaigns`);
    console.log(`  ${c.touchpoints} touchpoints`);
    console.log(`  ${c.diagnostics} diagnostics`);
    console.log(`  ${c.versions} versions`);
    console.log(`  ${c.patterns} memory patterns`);
    console.log(`  ${c.opportunities} opportunities`);
    console.log(`  ${c.reports} reports`);
    console.log(`  ${c.chart_data} chart data points`);
    console.log('  ════════════════════════════════════\n');
  } catch (err) {
    console.warn('  Could not verify counts:', err.message);
  }

  await pool.end();
}

main().catch(err => {
  console.error('  Fatal error:', err);
  process.exit(1);
});
