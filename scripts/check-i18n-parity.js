#!/usr/bin/env node
/**
 * Parité i18n : `fr.json` et `en.json` doivent porter exactement les mêmes clés.
 *
 * La règle 1 du CLAUDE.md impose d'ajouter chaque clé dans les DEUX fichiers au
 * même commit. Rien ne le vérifiait : une clé oubliée côté `en.json` ne se voit
 * qu'en basculant l'app en anglais, et `t()` retombe alors sur la clé brute
 * affichée telle quelle à l'écran (« campaign.step.subject » au milieu d'une
 * page). Le défaut passe la revue, le build et les tests.
 *
 * Trois défauts détectés, tous bloquants :
 *
 *   1. CLÉ MANQUANTE   : présente d'un côté, absente de l'autre.
 *   2. TYPE DIVERGENT  : objet d'un côté, chaîne de l'autre. La branche entière
 *      devient inatteignable dans une langue, sans clé « manquante » visible.
 *   3. VALEUR VIDE     : la clé existe mais ne rend rien, ce qui est pire qu'une
 *      clé absente (pas de repli, juste un trou dans l'interface).
 *
 * Usage :
 *   node scripts/check-i18n-parity.js           # rapport complet
 *   node scripts/check-i18n-parity.js --quiet   # silencieux si tout va bien
 *
 * Branché sur le hook pre-commit (voir .githooks/pre-commit).
 * Contournement ponctuel : git commit --no-verify
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

const LOCALES = {
  fr: path.join(repoRoot, 'frontend/src/i18n/fr.json'),
  en: path.join(repoRoot, 'frontend/src/i18n/en.json'),
};

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m',
};

// Combien de clés on détaille avant de résumer. Au-delà, la liste complète
// noie le message dans un terminal de hook.
const MAX_LISTED = 15;

/** Aplatit un objet de traductions en « a.b.c » -> valeur. */
function flatten(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, full, out);
    } else {
      out.set(full, value);
    }
  }
  return out;
}

/** Chemins de tous les noeuds intermédiaires, pour repérer objet contre chaîne. */
function branches(node, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.add(full);
      branches(value, full, out);
    }
  }
  return out;
}

function load(locale, file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`${C.red}${C.bold}✗ ${locale}.json illisible${C.reset} : ${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Un JSON cassé fait échouer le build de toute façon, autant le dire ici,
    // avec le nom du fichier.
    console.error(`${C.red}${C.bold}✗ ${locale}.json n'est pas un JSON valide${C.reset} : ${err.message}`);
    process.exit(1);
  }
}

function report(title, keys) {
  if (keys.length === 0) return;
  console.error(`\n  ${C.red}${title}${C.reset} ${C.dim}(${keys.length})${C.reset}`);
  for (const key of keys.slice(0, MAX_LISTED)) console.error(`    ${key}`);
  if (keys.length > MAX_LISTED) {
    console.error(`    ${C.dim}... et ${keys.length - MAX_LISTED} autre(s)${C.reset}`);
  }
}

const fr = load('fr', LOCALES.fr);
const en = load('en', LOCALES.en);

const flatFr = flatten(fr);
const flatEn = flatten(en);

const missingInEn = [...flatFr.keys()].filter((k) => !flatEn.has(k)).sort();
const missingInFr = [...flatEn.keys()].filter((k) => !flatFr.has(k)).sort();

// Objet d'un côté, feuille de l'autre : la clé n'apparaît ni comme manquante
// ni comme présente au même endroit, elle change juste de nature.
const branchFr = branches(fr);
const branchEn = branches(en);
const typeMismatch = [
  ...[...branchFr].filter((k) => flatEn.has(k)).map((k) => `${k} ${C.dim}(objet en fr, texte en en)${C.reset}`),
  ...[...branchEn].filter((k) => flatFr.has(k)).map((k) => `${k} ${C.dim}(texte en fr, objet en en)${C.reset}`),
].sort();

const isEmpty = (v) => typeof v === 'string' && v.trim() === '';
const empty = [
  ...[...flatFr].filter(([, v]) => isEmpty(v)).map(([k]) => `fr : ${k}`),
  ...[...flatEn].filter(([, v]) => isEmpty(v)).map(([k]) => `en : ${k}`),
].sort();

const failures = missingInEn.length + missingInFr.length + typeMismatch.length + empty.length;

if (failures === 0) {
  if (!QUIET) {
    console.log(`${C.green}✓${C.reset} Parité i18n : ${flatFr.size} clés, identiques en fr et en en.`);
  }
  process.exit(0);
}

console.error(`${C.bold}Parité i18n${C.reset}`);
report('Manquantes dans en.json', missingInEn);
report('Manquantes dans fr.json', missingInFr);
report('Type divergent', typeMismatch);
report('Valeur vide', empty);

console.error(`\n${C.red}${C.bold}✗ ${failures} défaut(s) de parité.${C.reset}`);
console.error(`${C.dim}  Règle 1 du CLAUDE.md : toute clé va dans fr.json ET en.json au même commit.${C.reset}`);
console.error(`${C.dim}  Contournement ponctuel : git commit --no-verify${C.reset}`);
process.exit(1);
