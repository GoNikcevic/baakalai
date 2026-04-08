#!/usr/bin/env node
/**
 * Baakalai — Automated Release Notes generator
 *
 * Runs every Mon/Wed/Fri at 9am (Paris) via GitHub Actions.
 * Analyzes commits from the last N hours, asks Claude to synthesize
 * a hybrid release note (TL;DR + technical details), and posts it
 * to the Notion database '📦 Release Notes'.
 *
 * Requires env vars:
 *   ANTHROPIC_API_KEY    — Anthropic Messages API key
 *   NOTION_TOKEN         — Notion internal integration token (ntn_*)
 *   NOTION_DATABASE_ID   — ID of the target Notion database
 *   LOOKBACK_HOURS       — Optional, defaults to 48
 *
 * Zero dependencies — uses native fetch (Node 18+).
 */

const { execSync } = require('child_process');

// --- Config ---
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const LOOKBACK_HOURS = parseInt(process.env.LOOKBACK_HOURS || '48', 10);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

// --- Validation ---
function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
}
requireEnv('ANTHROPIC_API_KEY', ANTHROPIC_API_KEY);
requireEnv('NOTION_TOKEN', NOTION_TOKEN);
requireEnv('NOTION_DATABASE_ID', NOTION_DATABASE_ID);

console.log(`🔍 Analyzing commits from the last ${LOOKBACK_HOURS}h...`);

// --- Step 1: Fetch git log ---
const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
// Use § as a separator since it almost never appears in commit messages
const format = '%h§%an§%aI§%s§%b';

let gitLog;
try {
  gitLog = execSync(
    `git log --since="${sinceIso}" --no-merges --pretty=format:"${format}"`,
    { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
  );
} catch (err) {
  console.error('❌ git log failed:', err.message);
  process.exit(1);
}

const commits = gitLog
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [hash, author, date, subject, ...bodyParts] = line.split('§');
    return {
      hash: (hash || '').trim(),
      author: (author || '').trim(),
      date: (date || '').trim(),
      subject: (subject || '').trim(),
      body: bodyParts.join('§').trim(),
    };
  })
  .filter((c) => c.hash && c.subject);

if (commits.length === 0) {
  console.log(`ℹ️ No commits in the last ${LOOKBACK_HOURS}h. Skipping release note.`);
  process.exit(0);
}

console.log(`✅ Found ${commits.length} commits`);

// --- Step 2: Ask Claude to synthesize the release note ---
const commitsList = commits
  .map((c) => `- ${c.hash} ${c.subject}${c.body ? '\n  Body: ' + c.body.slice(0, 200).replace(/\n/g, ' ') : ''}`)
  .join('\n');

const todayDateFr = new Date().toLocaleDateString('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const sinceDateFr = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toLocaleDateString('fr-FR', {
  day: 'numeric',
  month: 'long',
});

const claudePrompt = `Tu rédiges une release note pour Baakalai, une plateforme SaaS de prospection B2B avec A/B testing IA et mémoire cross-campagne.

Analyse les commits ci-dessous et produis une release note HYBRIDE : un TL;DR user-friendly + des détails techniques structurés.

Commits des dernières ${LOOKBACK_HOURS}h (${sinceDateFr} → ${todayDateFr}) :
${commitsList}

Ta réponse DOIT être du JSON valide, UNIQUEMENT le JSON (pas de markdown fence, pas de préfixe) :

{
  "title": "Release YYYY-MM-DD — Titre court (max 60 chars)",
  "summary": "TL;DR en 2-3 phrases user-friendly décrivant l'impact global. Écrit comme si tu parlais à un utilisateur beta : pas de jargon technique, pas de noms de fichiers, juste ce qui change pour eux.",
  "categories": ["Features", "Fixes"],
  "sections": {
    "features": [
      "Nouvelle fonctionnalité X — explication en 1 ligne"
    ],
    "fixes": [
      "Correction de Y qui causait Z"
    ],
    "other": [
      "Refacto interne du module foo"
    ]
  }
}

RÈGLES STRICTES :
- title : commence par "Release" suivi de la date YYYY-MM-DD, max 60 caractères
- summary : 2-3 phrases max, ton chaleureux, orienté bénéfice utilisateur, en français
- categories : uniquement celles avec du contenu. Valeurs possibles : Features, Fixes, Refactor, Docs, DB, Branding, Infra
- sections.features : commits qui apportent de nouvelles fonctionnalités visibles (préfixe feat: ou équivalent)
- sections.fixes : bug fixes (préfixe fix:)
- sections.other : docs, refactor, chore, DB migrations, branding, infra (consolidés ensemble)
- Chaque bullet doit être compréhensible sans connaître le code : pas de nom de fichier, pas de hash git, pas de jargon dev
- Si plusieurs commits concernent le même sujet, FUSIONNE-les en une seule bullet
- Si tu ne trouves rien pour une section, mets un tableau vide []
- Réponds UNIQUEMENT avec le JSON, rien d'autre`;

async function callClaude() {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      messages: [{ role: 'user', content: claudePrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function parseClaudeResponse(raw) {
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {}

  // Fallback: extract JSON from code fence
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  // Fallback: extract first {...} block
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces) {
    try {
      return JSON.parse(braces[0]);
    } catch {}
  }

  throw new Error('Could not parse Claude response as JSON:\n' + raw.slice(0, 500));
}

// --- Step 3: Build Notion blocks and post ---

function paragraphBlock(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }] },
  };
}

function headingBlock(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function bulletBlock(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }] },
  };
}

function commitBullet(c) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        {
          type: 'text',
          text: { content: c.hash + ' ' },
          annotations: { code: true },
        },
        {
          type: 'text',
          text: { content: c.subject.slice(0, 200) },
        },
      ],
    },
  };
}

async function postToNotion(releaseNote) {
  const today = new Date().toISOString().split('T')[0];
  const sinceDate = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
  const sinceYmd = sinceDate.toISOString().split('T')[0];
  const period = `${sinceYmd} → ${today}`;
  const latestCommit = commits[0]?.hash || 'unknown';

  // Build page body (children blocks)
  const children = [];

  // TL;DR section
  children.push(headingBlock('💡 TL;DR'));
  children.push(paragraphBlock(releaseNote.summary || 'Pas de résumé disponible.'));

  // Features
  if (Array.isArray(releaseNote.sections?.features) && releaseNote.sections.features.length > 0) {
    children.push(headingBlock('✨ Nouvelles fonctionnalités'));
    for (const item of releaseNote.sections.features) {
      children.push(bulletBlock(item));
    }
  }

  // Fixes
  if (Array.isArray(releaseNote.sections?.fixes) && releaseNote.sections.fixes.length > 0) {
    children.push(headingBlock('🔧 Corrections'));
    for (const item of releaseNote.sections.fixes) {
      children.push(bulletBlock(item));
    }
  }

  // Other
  if (Array.isArray(releaseNote.sections?.other) && releaseNote.sections.other.length > 0) {
    children.push(headingBlock('🔄 Autres changements'));
    for (const item of releaseNote.sections.other) {
      children.push(bulletBlock(item));
    }
  }

  // Technical commit list (audit trail)
  children.push(headingBlock('📜 Commits (audit technique)'));
  for (const c of commits) {
    children.push(commitBullet(c));
  }

  // Notion max children per page creation = 100. Truncate if needed.
  const truncatedChildren = children.slice(0, 100);

  // Build properties (must match the database schema)
  const properties = {
    'Titre': {
      title: [{ text: { content: (releaseNote.title || `Release ${today}`).slice(0, 200) } }],
    },
    'Date': {
      date: { start: today },
    },
    'Version': {
      rich_text: [{ text: { content: latestCommit } }],
    },
    'Période': {
      rich_text: [{ text: { content: period } }],
    },
    'Résumé': {
      rich_text: [{ text: { content: (releaseNote.summary || '').slice(0, 2000) } }],
    },
    'Commits': {
      number: commits.length,
    },
    'Statut': {
      status: { name: 'Not started' },
    },
  };

  // Categories multi_select (only if at least one)
  const validCategories = ['Features', 'Fixes', 'Refactor', 'Docs', 'DB', 'Branding', 'Infra'];
  if (Array.isArray(releaseNote.categories) && releaseNote.categories.length > 0) {
    const filtered = releaseNote.categories.filter((c) => validCategories.includes(c));
    if (filtered.length > 0) {
      properties['Catégories'] = { multi_select: filtered.map((name) => ({ name })) };
    }
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties,
      children: truncatedChildren,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.url || `https://www.notion.so/${data.id?.replace(/-/g, '')}`;
}

// --- Main ---
(async () => {
  try {
    console.log('🤖 Calling Claude to synthesize release note...');
    const claudeRaw = await callClaude();
    console.log('📝 Parsing Claude response...');
    const releaseNote = parseClaudeResponse(claudeRaw);
    console.log(`   → Title: ${releaseNote.title}`);
    console.log(`   → Categories: ${(releaseNote.categories || []).join(', ') || '(none)'}`);
    console.log(`   → Features: ${(releaseNote.sections?.features || []).length}`);
    console.log(`   → Fixes: ${(releaseNote.sections?.fixes || []).length}`);
    console.log(`   → Other: ${(releaseNote.sections?.other || []).length}`);

    console.log('📤 Posting to Notion database...');
    const url = await postToNotion(releaseNote);
    console.log(`✅ Release note published: ${url}`);
  } catch (err) {
    console.error('❌ Failed to publish release note:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
