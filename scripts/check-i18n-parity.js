#!/usr/bin/env node
/**
 * i18n parity check — ensures fr.json and en.json have exactly the same set
 * of (nested) keys. Enforces the CLAUDE.md rule: every user-facing string
 * must have a key in BOTH fr.json AND en.json.
 *
 * Exit 0 = in sync, exit 1 = keys missing on one side.
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'frontend', 'src', 'i18n');
const frPath = path.join(dir, 'fr.json');
const enPath = path.join(dir, 'en.json');

function load(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`🛑 Cannot parse ${path.relative(process.cwd(), p)}: ${err.message}`);
    process.exit(1);
  }
}

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

const fr = flatten(load(frPath));
const en = flatten(load(enPath));

const missingInEn = [...fr].filter(k => !en.has(k));
const missingInFr = [...en].filter(k => !fr.has(k));

if (missingInEn.length === 0 && missingInFr.length === 0) {
  console.log(`✓ i18n in sync (${fr.size} keys)`);
  process.exit(0);
}

console.error('🛑 i18n keys out of sync between fr.json and en.json:\n');
if (missingInEn.length) {
  console.error(`  Missing in en.json (${missingInEn.length}):`);
  missingInEn.forEach(k => console.error(`    - ${k}`));
}
if (missingInFr.length) {
  console.error(`  Missing in fr.json (${missingInFr.length}):`);
  missingInFr.forEach(k => console.error(`    - ${k}`));
}
console.error('\n  Add the missing key(s) to BOTH files (CLAUDE.md rule).');
process.exit(1);
