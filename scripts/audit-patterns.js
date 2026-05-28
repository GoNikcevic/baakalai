#!/usr/bin/env node
/**
 * Baakalai — Automated Pattern Audit
 *
 * Scans the codebase for known anti-patterns from ERRORS.md.
 * Run daily via cron, or manually: node scripts/audit-patterns.js
 *
 * Exit code 0 = clean, 1 = issues found
 * With --fix-errors-md flag: appends new findings to ERRORS.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ERRORS_MD = path.join(ROOT, 'ERRORS.md');
const updateErrorsMd = process.argv.includes('--fix-errors-md');

// Directories to scan (relative to ROOT)
const SCAN_DIRS = ['backend/routes', 'backend/lib', 'backend/api', 'frontend/src'];
const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

// ── Anti-patterns to detect ──

const PATTERNS = [
  {
    id: 'bare-json-parse',
    name: 'JSON.parse without try/catch',
    severity: 'HIGH',
    pattern: /JSON\.parse\s*\(/,
    exclude: /try\s*\{[^}]*JSON\.parse/,
    check(content, line, lines, lineIdx) {
      // Check if this JSON.parse is inside a try block (look back up to 5 lines)
      for (let i = Math.max(0, lineIdx - 5); i < lineIdx; i++) {
        if (/\btry\s*\{/.test(lines[i])) return false;
      }
      // Check same line
      if (/\btry\s*\{/.test(line)) return false;
      // Exclude test files
      return true;
    },
    lesson: 'All JSON.parse on external data must be in try/catch (ERRORS.md #2,#3)',
  },
  {
    id: 'alert-prompt',
    name: 'Native alert()/prompt() in frontend',
    severity: 'MEDIUM',
    pattern: /\b(alert|prompt)\s*\(/,
    check(content, line) {
      // Exclude comments and confirm() which is sometimes OK
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return false;
      return true;
    },
    lesson: 'Use showToast() or modal components instead (ERRORS.md #12)',
  },
  {
    id: 'empty-catch',
    name: 'Empty catch block (swallowed error)',
    severity: 'MEDIUM',
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*.*?\*\/\s*)?\}/,
    check(content, line) {
      // Allow /* ignore */ pattern only if it's intentional
      if (/\/\*\s*ignore\s*\*\//.test(line)) return false;
      if (/\/\*\s*skip\s*\*\//.test(line)) return false;
      return true;
    },
    lesson: 'Never silently swallow errors — log or show feedback (ERRORS.md #15)',
  },
  {
    id: 'fetch-no-ok-check',
    name: 'fetch() without res.ok check before .json()',
    severity: 'HIGH',
    pattern: /await\s+fetch\s*\(/,
    check(content, line, lines, lineIdx) {
      // Look ahead 5 lines for .ok check or error handling
      const ahead = lines.slice(lineIdx, lineIdx + 6).join('\n');
      if (/\.ok\b/.test(ahead) || /!res\w*\.ok/.test(ahead) || /status\s*[!=]==?\s*2/.test(ahead)) return false;
      // If it's wrapped in a helper function that handles errors, skip
      if (/hubspotFetch|voyagerFetch|pipedriveFetch|salesforceFetch/.test(line)) return false;
      return true;
    },
    lesson: 'Always check res.ok before parsing response (ERRORS.md #8)',
  },
  {
    id: 'hardcoded-provider-list',
    name: 'Hardcoded CRM provider list (may be incomplete)',
    severity: 'LOW',
    pattern: /\[['"]pipedrive['"].*['"]hubspot['"]/,
    check(content, line) {
      // Flag if list doesn't include all 7 providers
      const has = (p) => line.includes(`'${p}'`) || line.includes(`"${p}"`);
      if (has('pipedrive') && has('hubspot') && !has('notion')) return true;
      if (has('pipedrive') && has('hubspot') && !has('airtable')) return true;
      return false;
    },
    lesson: 'All provider lists must include all 7 CRM providers (ERRORS.md #6)',
  },
  {
    id: 'date-no-null-check',
    name: 'new Date() on potentially null value without guard',
    severity: 'MEDIUM',
    pattern: /new Date\(\s*\w+\.\w+\s*\)/,
    check(content, line, lines, lineIdx) {
      // Check if there's a null guard before
      const prev = lines.slice(Math.max(0, lineIdx - 2), lineIdx + 1).join('\n');
      if (/if\s*\(/.test(prev) || /\?\?/.test(line) || /\|\|/.test(line) || /\?\./.test(line)) return false;
      if (/isNaN/.test(prev)) return false;
      return true;
    },
    lesson: 'Always validate dates before arithmetic — NaN comparisons silently fail (ERRORS.md #5)',
  },
];

// ── Scanner ──

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of PATTERNS) {
      if (pat.pattern.test(line)) {
        if (!pat.check || pat.check(content, line, lines, i)) {
          findings.push({
            ...pat,
            file: path.relative(ROOT, filePath),
            line: i + 1,
            code: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  return findings;
}

function scanDirectory(dir) {
  const findings = [];
  const fullDir = path.join(ROOT, dir);
  if (!fs.existsSync(fullDir)) return findings;

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (EXTENSIONS.includes(path.extname(entry.name))) {
        findings.push(...scanFile(full));
      }
    }
  }

  walk(fullDir);
  return findings;
}

// ── Main ──

function main() {
  const allFindings = [];
  for (const dir of SCAN_DIRS) {
    allFindings.push(...scanDirectory(dir));
  }

  const date = new Date().toISOString().split('T')[0];

  if (allFindings.length === 0) {
    console.log(`✅ [${date}] Audit clean — no anti-patterns detected.`);
    process.exit(0);
  }

  // Group by severity
  const bySeverity = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const f of allFindings) {
    (bySeverity[f.severity] || bySeverity.MEDIUM).push(f);
  }

  console.log(`\n⚠️  [${date}] Found ${allFindings.length} potential issue(s):\n`);

  for (const [sev, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    console.log(`  ${sev} (${items.length}):`);
    for (const f of items) {
      console.log(`    ${f.file}:${f.line} — ${f.name}`);
      console.log(`      ${f.code}`);
      console.log(`      → ${f.lesson}`);
    }
    console.log('');
  }

  // Update ERRORS.md if flag set
  if (updateErrorsMd && fs.existsSync(ERRORS_MD)) {
    const existing = fs.readFileSync(ERRORS_MD, 'utf8');

    // Check if today's audit already exists
    if (existing.includes(`### Automated Audit — ${date}`)) {
      console.log('ℹ️  ERRORS.md already has today\'s audit.');
    } else {
      const section = [
        '',
        `### Automated Audit — ${date}`,
        '',
        `Found ${allFindings.length} potential issue(s):`,
        '',
        '| Severity | File | Line | Pattern | Code |',
        '|----------|------|------|---------|------|',
        ...allFindings.map(f =>
          `| ${f.severity} | \`${f.file}\` | ${f.line} | ${f.name} | \`${f.code.replace(/\|/g, '\\|').slice(0, 80)}\` |`
        ),
        '',
      ].join('\n');

      fs.writeFileSync(ERRORS_MD, existing + section);
      console.log(`📝 Updated ERRORS.md with ${allFindings.length} finding(s).`);
    }
  }

  process.exit(1);
}

main();
