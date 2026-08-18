#!/usr/bin/env node
/**
 * PostToolUse hook: checks edited files for ALL bug classes from the audit.
 * Returns additionalContext to tell Claude to fix them immediately.
 *
 * Covers: i18n, CRM consistency, security, scope, code safety.
 */
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  try {
    const o = JSON.parse(data);
    const f = o.tool_input?.file_path || o.tool_response?.filePath || '';
    if (!f || f.includes('node_modules') || f.includes('.test.')) process.exit(0);

    const fs = require('fs');
    if (!fs.existsSync(f)) process.exit(0);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const hits = [];
    const isFrontend = f.includes('frontend/src/');
    const isBackend = f.includes('backend/');
    const isRoute = f.includes('backend/routes/');
    const isJsx = f.endsWith('.jsx');
    const isI18nFile = f.includes('/i18n/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

      // ─── 1. HARDCODED FRENCH (frontend) ───
      if (isFrontend && isJsx && !isI18nFile) {
        if (!/\ben\s*\?/.test(line) && !/\bt\s*\(/.test(line)) {
          if (/['"`](?:Aucun|Erreur|Chargement|Enregistr|Sauvegard|Supprim|Connexion|Param[eè]tre|Configur|Campagne|Analyser|Cr[eé]er|Modifier|Confirmer|Bienvenue|Recherch|Importer|Exporter|Envoyer|Annuler|Valider|S[eé]lectionner|Ajouter|Fermer|Retour|Suivant|Pr[eé]c[eé]dent|Voir|Relancer|Supprimer|T[eé]l[eé]charger|Termin|Lancer)/.test(line)) {
            hits.push(`  L${i+1} [i18n-FR-frontend]: ${line.trim().slice(0, 90)}`);
          }
        }
      }

      // ─── 2. HARDCODED FRENCH (backend API responses) ───
      if (isBackend && !isI18nFile) {
        if (/(?:res\.json|throw new Error|message:)\s*.*['"`](?:Aucun|Erreur|Connexion|non configur|Cr[eé]dits|insuffisant|Cl[eé] API|Limite|[eé]chou[eé]|manquant|introuvable|nouveau|contact|import[eé]|envoy[eé]|corrig[eé]|analys|depuis|en cours|termin[eé])/i.test(line)) {
          hits.push(`  L${i+1} [i18n-FR-backend]: ${line.trim().slice(0, 90)}`);
        }
      }

      // ─── 3. getUserKey for CRM providers (must use getUserCrmToken) ───
      if (isBackend && !f.includes('config/index.js') && !f.includes('crm-token.js')) {
        if (/getUserKey\s*\(.*(?:salesforce|hubspot|pipedrive|odoo|notion|airtable)/i.test(line)) {
          hits.push(`  L${i+1} [CRM-auth]: getUserKey for CRM provider — use getUserCrmToken instead`);
        }
        if (/getUserKey\s*\(\s*\w+\s*,\s*(?:p|provider)\s*\)/.test(line)) {
          hits.push(`  L${i+1} [CRM-auth]: getUserKey with provider var — use getUserCrmToken instead`);
        }
      }

      // ─── 4. login.salesforce.com for API calls ───
      if (isBackend && /login\.salesforce\.com\/services\/data/.test(line)) {
        hits.push(`  L${i+1} [CRM-salesforce]: login.salesforce.com for API calls — must use instance_url`);
      }

      // ─── 5. Hardcoded pipedrive fallback ───
      if (/\|\|\s*['"`]pipedrive['"`]/.test(line)) {
        hits.push(`  L${i+1} [CRM-fallback]: hardcoded pipedrive fallback — detect provider from user data`);
      }

      // ─── 6. Double /api in request() ───
      if (isFrontend && /request\s*\(\s*['"`]\/api\//.test(line)) {
        hits.push(`  L${i+1} [security]: double /api — request() already prepends /api`);
      }

      // ─── 7. res.ok on request() result ───
      if (isFrontend && /await\s+request\s*\(/.test(line)) {
        const varMatch = line.match(/(const|let|var)\s+(\w+)\s*=\s*await\s+request/);
        if (varMatch) {
          const ahead = lines.slice(i, i + 5).join('\n');
          if (new RegExp(`${varMatch[2]}\\.ok\\b`).test(ahead)) {
            hits.push(`  L${i+1} [security]: res.ok on request() result — request() returns parsed JSON, not Response`);
          }
        }
      }

      // ─── 8. window.location.href in frontend ───
      if (isFrontend && /window\.location\.href\s*=/.test(line)) {
        hits.push(`  L${i+1} [ux]: window.location.href — use navigate() for SPA routing`);
      }

      // ─── 9. Variable shadowing t() ───
      if (isFrontend && isJsx) {
        if (/\.map\s*\(\s*t\s*=>/.test(line) || /\.map\s*\(\s*\(\s*t\s*[,)]/.test(line)) {
          const usesT = lines.some(l => /useT\s*\(\s*\)/.test(l));
          if (usesT) {
            hits.push(`  L${i+1} [scope]: .map(t =>) shadows t() i18n function — rename the variable`);
          }
        }
      }

      // ─── 10. Hardcoded fr-FR locale ───
      if (isFrontend && /['"`]fr-FR['"`]/.test(line)) {
        hits.push(`  L${i+1} [i18n]: hardcoded fr-FR locale — use user language setting`);
      }

      // ─── 11. Incomplete CRM provider list ───
      if (isBackend) {
        const arrayMatch = line.match(/\[\s*['"](?:pipedrive|hubspot|salesforce|odoo|notion|airtable)['"](?:\s*,\s*['"](?:\w+)['"])*\s*\]/);
        if (arrayMatch) {
          const ALL = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'];
          const found = ALL.filter(p => arrayMatch[0].includes(p));
          if (found.length >= 2 && found.length < ALL.length) {
            const missing = ALL.filter(p => !found.includes(p));
            hits.push(`  L${i+1} [CRM-providers]: incomplete provider list — missing: ${missing.join(', ')}`);
          }
        }
      }

      // ─── 12. Route with :id but no ownership check ───
      if (isRoute && /router\.(get|post|put|patch|delete)\s*\(\s*['"`][^'"`]*:id/.test(line)) {
        const ahead = lines.slice(i, i + 15).join('\n');
        if (!/user_id|req\.user\.id|userId/.test(ahead)) {
          hits.push(`  L${i+1} [security]: route with :id param but no ownership check in next 15 lines`);
        }
      }
    }

    if (hits.length > 0) {
      const i18nHits = hits.filter(h => h.includes('[i18n'));
      const otherHits = hits.filter(h => !h.includes('[i18n'));
      const instructions = [
        `AUDIT WARNING: ${f} has ${hits.length} issue(s). You MUST fix ALL of them NOW before proceeding.`,
        '',
      ];
      if (i18nHits.length > 0) {
        instructions.push(
          'FOR EACH [i18n] issue: translate the French string to English and wrap with: en ? "English text" : "French text"',
          'If the file has no `en` variable, add: const { lang } = useI18n(); const en = lang === \'en\'; (frontend) or check userLang (backend)',
          '',
        );
      }
      if (otherHits.length > 0) {
        instructions.push(
          'FOR EACH other issue: follow the fix instruction in brackets.',
          '',
        );
      }
      instructions.push(...hits);
      const msg = instructions.join('\n');

      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: msg,
        },
      }));
    }
  } catch {
    // Don't block on hook errors
  }
});
