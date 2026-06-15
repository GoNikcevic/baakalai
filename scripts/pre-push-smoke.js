#!/usr/bin/env node
/**
 * Pre-push smoke test — local mirror of .github/workflows/smoke-test.yml.
 *
 * Catches the "parse-OK but crashes at require() time" bug class that took
 * down production on 2026-04-09 (unescaped backticks in CHAT_SYSTEM_RULES).
 * `node --check` only validates parse-time syntax; actually require()-ing the
 * module surfaces top-level crashes here instead of on Railway.
 *
 * Scans backend/**.js files changed between the upstream branch and HEAD,
 * skipping the side-effectful ones (server.js, routes/*, orchestrator/*)
 * exactly like the CI does.
 *
 * Bypass with: git push --no-verify
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function sh(cmd, quiet = false) {
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf8', stdio: quiet ? ['pipe', 'pipe', 'ignore'] : 'pipe' }).trim();
}

// Determine the diff base: upstream tracking branch if it exists, else origin/main.
let base;
try {
  base = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}', true);
} catch {
  base = 'origin/main';
}

let changed;
try {
  changed = sh(`git diff --name-only ${base}...HEAD -- 'backend/**/*.js'`)
    .split('\n')
    .map(f => f.trim())
    .filter(Boolean)
    .filter(f => !f.includes('node_modules/'))
    .filter(f => !f.includes('/tests/'))
    .filter(f => !f.endsWith('.test.js'))
    .filter(f => fs.existsSync(path.join(repoRoot, f)));
} catch {
  // No upstream / new branch — fall back to last commit only.
  changed = sh("git diff --name-only HEAD~1 -- 'backend/**/*.js'")
    .split('\n')
    .map(f => f.trim())
    .filter(Boolean)
    .filter(f => fs.existsSync(path.join(repoRoot, f)));
}

if (changed.length === 0) {
  process.exit(0);
}

// Dummy env so modules reading process.env at load time don't crash.
const env = {
  ...process.env,
  NODE_ENV: 'test',
  CLAUDE_API_KEY: 'smoke-test-dummy',
  ANTHROPIC_API_KEY: 'smoke-test-dummy',
  LEMLIST_API_KEY: 'smoke-test-dummy',
  NOTION_API_KEY: 'smoke-test-dummy',
  JWT_SECRET: 'smoke-test-dummy-secret-at-least-32-characters-long',
  DATABASE_URL: 'postgres://dummy:dummy@localhost:5432/dummy',
  SUPABASE_URL: 'https://dummy.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'smoke-test-dummy',
};

const backendDir = path.join(repoRoot, 'backend');
let failed = 0;

for (const file of changed) {
  const rel = file.replace(/^backend\//, '');
  // Side-effectful at load (start servers / open DB connections) — skip.
  if (rel === 'server.js' || rel.startsWith('routes/') || rel.startsWith('orchestrator/')) {
    console.log(`⊘ skip (side-effectful at load): ${rel}`);
    continue;
  }
  process.stdout.write(`→ require('./${rel}') ... `);
  try {
    execSync(`node -e "require('./${rel}')"`, { cwd: backendDir, env, stdio: 'pipe' });
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    process.stderr.write((err.stderr || err.stdout || err.message).toString() + '\n');
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n🛑 ${failed} backend module(s) failed the runtime load test. Push aborted.`);
  console.error('   Fix the crash, or bypass with: git push --no-verify\n');
  process.exit(1);
}
console.log('✓ All changed backend modules load cleanly');
