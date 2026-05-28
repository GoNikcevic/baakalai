#!/usr/bin/env node
/**
 * Pre-commit hook — checks ONLY staged files for anti-patterns.
 * Fast: only scans files being committed, not the whole codebase.
 *
 * Install: ln -sf ../../scripts/pre-commit-audit.js .git/hooks/pre-commit
 * Or: add to package.json scripts + husky/simple-git-hooks
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

// Get staged files
let stagedFiles;
try {
  stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
    .split('\n')
    .filter(f => f && EXTENSIONS.includes(path.extname(f)))
    .filter(f => !f.includes('node_modules'));
} catch {
  process.exit(0); // Not in a git repo or no staged files
}

if (stagedFiles.length === 0) process.exit(0);

// Critical patterns only (fast check, don't block on low-severity)
const CRITICAL_PATTERNS = [
  {
    name: 'JSON.parse without try/catch',
    test(lines) {
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/JSON\.parse\s*\(/.test(lines[i])) continue;
        // Look back for try
        let inTry = false;
        for (let j = Math.max(0, i - 5); j <= i; j++) {
          if (/\btry\s*\{/.test(lines[j])) { inTry = true; break; }
        }
        if (!inTry) issues.push(i + 1);
      }
      return issues;
    },
  },
  {
    name: 'alert() or prompt() in frontend code',
    test(lines, filePath) {
      if (!filePath.includes('frontend/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (/\b(alert|prompt)\s*\(/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
  {
    name: 'fetch() without res.ok check',
    test(lines) {
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/await\s+fetch\s*\(/.test(lines[i])) continue;
        // Skip if it's inside a wrapper function
        if (/Fetch\(/.test(lines[i])) continue;
        const ahead = lines.slice(i, i + 8).join('\n');
        if (!/\.ok\b/.test(ahead) && !/status/.test(ahead)) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
];

let hasErrors = false;

for (const file of stagedFiles) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) continue;

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  for (const pat of CRITICAL_PATTERNS) {
    const issueLines = pat.test(lines, file);
    if (issueLines.length > 0) {
      if (!hasErrors) {
        console.log('\n🛑 Pre-commit audit found issues:\n');
        hasErrors = true;
      }
      for (const line of issueLines) {
        console.log(`  ${file}:${line} — ${pat.name}`);
        console.log(`    ${lines[line - 1]?.trim().slice(0, 100)}`);
      }
    }
  }
}

if (hasErrors) {
  console.log('\n  Fix these issues or commit with --no-verify to bypass.\n');
  process.exit(1);
}
