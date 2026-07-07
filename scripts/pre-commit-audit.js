#!/usr/bin/env node
/**
 * Pre-commit hook — checks ONLY staged files for anti-patterns.
 * Fast: only scans files being committed, not the whole codebase.
 *
 * Install: ln -sf ../../scripts/pre-commit-audit.js .git/hooks/pre-commit
 * Or: add to package.json scripts + husky/simple-git-hooks
 *
 * Categories:
 * 1. Code safety (JSON.parse, fetch, alert)
 * 2. i18n (hardcoded French in frontend)
 * 3. CRM consistency (getUserKey for Salesforce, provider lists, ownership)
 * 4. Security (no ownership check on routes, missing auth)
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
  process.exit(0);
}

if (stagedFiles.length === 0) process.exit(0);

// ═══════════════════════════════════════════════════
// All patterns — each returns array of line numbers
// ═══════════════════════════════════════════════════

const PATTERNS = [

  // ─── 1. CODE SAFETY ─────────────────────────────

  {
    name: 'JSON.parse without try/catch',
    test(lines) {
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/JSON\.parse\s*\(/.test(lines[i])) continue;
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
        if (/Fetch\(/.test(lines[i])) continue;
        const ahead = lines.slice(i, i + 8).join('\n');
        if (!/\.ok\b/.test(ahead) && !/status/.test(ahead)) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
  {
    name: 'window.location.href in frontend (use navigate() instead)',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (/window\.location\.href\s*=/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },

  // ─── 2. i18n ────────────────────────────────────

  {
    name: 'Hardcoded French string without i18n (use en ? or t())',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/')) return [];
      if (filePath.includes('/i18n/') || filePath.includes('.test.')) return [];
      const issues = [];
      const frenchPatterns = [
        /['"`](?:Aucun|Erreur|Chargement|Enregistr|Sauvegard|Supprim|Connexion|Param[eè]tre|Configur|Campagne|Analyser|Cr[eé]er|Modifier|Confirmer|Bienvenue|Recherch|Importer|Exporter|Envoyer|Annuler|Valider|S[eé]lectionner|Ajouter|Fermer|Retour|Suivant|Pr[eé]c[eé]dent|Voir|Relancer|Supprimer|T[eé]l[eé]charger|Termin|Lancer|Analyser)[^'"`]*['"`]/,
      ];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (/\ben\s*\?/.test(line) || /\bt\s*\(/.test(line)) continue;
        for (const pattern of frenchPatterns) {
          if (pattern.test(line)) {
            issues.push(i + 1);
            break;
          }
        }
      }
      return issues;
    },
  },
  {
    name: 'Hardcoded French in backend API response (user-facing)',
    test(lines, filePath) {
      if (!filePath.includes('backend/')) return [];
      if (filePath.includes('.test.') || filePath.includes('node_modules')) return [];
      const issues = [];
      const frenchInResponse = /(?:res\.json|throw new Error|message:)\s*.*['"`](?:Aucun|Erreur|Connexion|non configur|Cr[eé]dits|insuffisant|Cl[eé] API|Limite|échoué|manquant|introuvable|nouveau|contact|import[eé]|envoy[eé]|corrig[eé]|analys|depuis|en cours|termin[eé])[^'"`]*['"`]/i;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (frenchInResponse.test(line)) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
  {
    name: 'Hardcoded fr-FR locale (should use user language)',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (/['"`]fr-FR['"`]/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },

  // ─── 3. CRM CONSISTENCY ─────────────────────────

  {
    name: 'getUserKey for CRM provider (use getUserCrmToken for Salesforce auto-refresh)',
    test(lines, filePath) {
      if (!filePath.includes('backend/')) return [];
      // Skip config/index.js where getUserKey is defined
      if (filePath.includes('config/index.js') || filePath.includes('crm-token.js')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Detect getUserKey used with CRM providers
        if (/getUserKey\s*\(.*(?:salesforce|hubspot|pipedrive|odoo|notion|airtable)/i.test(line)) {
          issues.push(i + 1);
        }
        // Also catch generic getUserKey in CRM provider detection loops
        if (/getUserKey\s*\(\s*\w+\s*,\s*p\s*\)/.test(line) || /getUserKey\s*\(\s*\w+\s*,\s*provider\s*\)/.test(line)) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
  {
    name: 'login.salesforce.com used for API calls (must use instance_url)',
    test(lines, filePath) {
      if (!filePath.includes('backend/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (/login\.salesforce\.com\/services\/data/.test(lines[i])) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
  {
    name: 'Incomplete CRM provider list (must include all 6: pipedrive, hubspot, salesforce, odoo, notion, airtable)',
    test(lines, filePath) {
      if (!filePath.includes('backend/')) return [];
      const issues = [];
      const ALL_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Detect provider arrays/lists: ['pipedrive', 'hubspot', ...]
        const arrayMatch = line.match(/\[\s*['"](?:pipedrive|hubspot|salesforce|odoo|notion|airtable)['"](?:\s*,\s*['"](?:\w+)['"])*\s*\]/);
        if (arrayMatch) {
          const found = ALL_PROVIDERS.filter(p => arrayMatch[0].includes(p));
          // Only flag if it looks like a CRM provider list (has at least 2 CRM providers) but is missing some
          if (found.length >= 2 && found.length < ALL_PROVIDERS.length) {
            const missing = ALL_PROVIDERS.filter(p => !found.includes(p));
            issues.push(i + 1);
          }
        }
      }
      return issues;
    },
  },
  {
    name: 'Hardcoded "pipedrive" fallback (should detect provider from user data)',
    test(lines, filePath) {
      if (!filePath.includes('backend/') && !filePath.includes('frontend/src/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Catch patterns like: || 'pipedrive', provider || 'pipedrive', default 'pipedrive'
        if (/\|\|\s*['"`]pipedrive['"`]/.test(line) || /=\s*['"`]pipedrive['"`]\s*[;,]/.test(line)) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },

  // ─── 4. SECURITY ────────────────────────────────

  {
    name: 'Route with req.params.id but no ownership check (potential data leak)',
    test(lines, filePath) {
      if (!filePath.includes('backend/routes/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Detect route handlers that use :id param
        if (/router\.(get|post|put|patch|delete)\s*\(\s*['"`][^'"`]*:id/.test(line)) {
          // Look ahead 15 lines for ownership check (user_id = req.user.id)
          const ahead = lines.slice(i, i + 15).join('\n');
          if (!/user_id|req\.user\.id|userId/.test(ahead) && !/requireAuth/.test(ahead)) {
            issues.push(i + 1);
          }
        }
      }
      return issues;
    },
  },
  {
    name: 'Double /api in request() call (request() already prepends /api)',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        if (/request\s*\(\s*['"`]\/api\//.test(lines[i])) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
  {
    name: 'res.ok checked on request() result (request() returns parsed JSON, not Response)',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Detect: const res = await request(...) then res.ok
        if (/await\s+request\s*\(/.test(line)) {
          const varMatch = line.match(/(const|let|var)\s+(\w+)\s*=\s*await\s+request/);
          if (varMatch) {
            const varName = varMatch[2];
            const ahead = lines.slice(i, i + 5).join('\n');
            if (new RegExp(`${varName}\\.ok\\b`).test(ahead)) {
              issues.push(i + 1);
            }
          }
        }
      }
      return issues;
    },
  },

  // ─── 5. SCOPE & VARIABLE SAFETY ─────────────────

  {
    name: 'Variable shadowing t() i18n function in .map(t => ...)',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/')) return [];
      const issues = [];
      // Check if file uses useT()
      const usesT = lines.some(l => /useT\s*\(\s*\)/.test(l));
      if (!usesT) return [];
      for (let i = 0; i < lines.length; i++) {
        if (/\.map\s*\(\s*t\s*=>/.test(lines[i]) || /\.map\s*\(\s*\(\s*t\s*[,)]/.test(lines[i])) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },

  // ─── 6. CURRENCY & LOCALE ───────────────────────

  {
    name: 'Hardcoded currency symbol ($ or EUR) — should be configurable',
    test(lines, filePath) {
      if (!filePath.includes('frontend/src/pages/CRM') && !filePath.includes('frontend/src/pages/Analytics')) return [];
      const issues = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Detect hardcoded $ in template literals or strings used for display
        if (/\$\{.*\}.*\$[^{]/.test(line) || /['"`]\$\s*\d/.test(line) || /[`'"].*€/.test(line)) {
          issues.push(i + 1);
        }
      }
      return issues;
    },
  },
];

// ═══════════════════════════════════════════════════
// Run all patterns on staged files
// ═══════════════════════════════════════════════════

let hasErrors = false;

for (const file of stagedFiles) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) continue;

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  for (const pat of PATTERNS) {
    const issueLines = pat.test(lines, file);
    if (issueLines.length > 0) {
      if (!hasErrors) {
        console.log('\n\u{1F6D1} Pre-commit audit found issues:\n');
        hasErrors = true;
      }
      for (const line of issueLines) {
        console.log(`  ${file}:${line} \u2014 ${pat.name}`);
        console.log(`    ${lines[line - 1]?.trim().slice(0, 100)}`);
      }
    }
  }
}

if (hasErrors) {
  console.log('\n  Fix these issues or commit with --no-verify to bypass.\n');
  process.exit(1);
}
