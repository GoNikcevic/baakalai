#!/usr/bin/env node
/**
 * Check pré-push — détecte les conflits AVANT de pousser.
 *
 * Deux risques distincts, deux vérifications :
 *
 *   1. DÉSYNCHRO  — quelqu'un (William, une session Claude, un autre poste) a
 *      poussé sur la même branche pendant qu'on travaillait. Le push sera
 *      refusé par GitHub. Bloquant : rien à faire d'autre que récupérer.
 *
 *   2. CONFLIT AVEC MAIN — la branche a divergé de `main` au point que la
 *      fusion staging → main ne passera plus toute seule. Non bloquant (une
 *      branche staging a le droit de diverger), mais signalé fort : c'est le
 *      conflit qu'on découvre trop tard, au moment de livrer en production.
 *
 * Usage :
 *   node scripts/check-conflicts.js            # rapport complet
 *   node scripts/check-conflicts.js --strict   # bloque aussi sur le cas 2
 *   node scripts/check-conflicts.js --no-fetch # sans accès réseau
 *   node scripts/check-conflicts.js --report   # lecture seule (démarrage de session)
 *
 * Branché sur le hook pre-push (voir .githooks/pre-push).
 * Contournement ponctuel : git push --no-verify
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const NO_FETCH = process.argv.includes('--no-fetch');
const REPORT = process.argv.includes('--report'); // lecture seule : informe, ne bloque jamais

// Branche de référence pour la production. Surchargeable : BASE_BRANCH=xxx
const BASE = process.env.BASE_BRANCH || 'main';

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m',
};

function sh(cmd, quiet = true) {
  return execSync(cmd, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: quiet ? ['pipe', 'pipe', 'ignore'] : 'inherit',
  }).trim();
}

function trySh(cmd) {
  try { return sh(cmd); } catch { return null; }
}

function head(label) {
  console.log(`\n${C.bold}${label}${C.reset}`);
}

// --- Contexte -------------------------------------------------------------

const branch = trySh('git rev-parse --abbrev-ref HEAD');
if (!branch || branch === 'HEAD') {
  console.log(`${C.yellow}⚠  HEAD détaché — vérification ignorée.${C.reset}`);
  process.exit(0);
}

console.log(`${C.bold}${REPORT ? 'État du dépôt' : 'Check pré-push'}${C.reset} ${C.dim}— branche ${branch}${C.reset}`);

// --- Récupération de l'état distant --------------------------------------

if (!NO_FETCH) {
  const fetched = trySh(`git fetch origin ${branch} ${BASE} 2>&1`) !== null
    || trySh('git fetch origin 2>&1') !== null;
  if (!fetched) {
    console.log(`${C.yellow}⚠  Impossible de contacter GitHub — vérification sur les données locales, potentiellement périmées.${C.reset}`);
  }
}

const remoteBranch = trySh(`git rev-parse --verify --quiet origin/${branch}`) ? `origin/${branch}` : null;
const remoteBase = trySh(`git rev-parse --verify --quiet origin/${BASE}`) ? `origin/${BASE}` : null;

let blocking = false;
let warning = false;

// --- 1. Désynchronisation avec la branche distante ------------------------

head('1. Désynchronisation');

if (!remoteBranch) {
  console.log(`   ${C.dim}Branche pas encore sur GitHub — premier push, rien à vérifier.${C.reset}`);
} else {
  const behind = Number(trySh(`git rev-list --count HEAD..${remoteBranch}`) || 0);
  const ahead = Number(trySh(`git rev-list --count ${remoteBranch}..HEAD`) || 0);

  if (behind === 0) {
    console.log(`   ${C.green}✓${C.reset} À jour avec ${remoteBranch} (${ahead} commit(s) à pousser).`);
  } else {
    if (!REPORT) blocking = true;
    console.log(`   ${C.red}✗ ${behind} commit(s) sur ${remoteBranch} qu'on n'a pas en local.${C.reset}`);
    console.log(`   ${C.dim}${REPORT
      ? `Branche en retard. Récupérer avant de commencer : git pull --no-rebase origin ${branch}`
      : "Quelqu'un a poussé pendant qu'on travaillait. Le push sera refusé."}${C.reset}\n`);

    const incoming = (trySh(`git log --format="%h  %an  %s" HEAD..${remoteBranch}`) || '')
      .split('\n').filter(Boolean).map(l => `     ${l}`).join('\n');
    if (incoming) console.log(`   Commits entrants :\n${incoming}\n`);

    // Les fichiers touchés des deux côtés = les vrais points de friction.
    const theirs = new Set((trySh(`git diff --name-only HEAD...${remoteBranch}`) || '').split('\n').filter(Boolean));
    const ours = (trySh(`git diff --name-only ${remoteBranch}...HEAD`) || '').split('\n').filter(Boolean);
    const overlap = ours.filter(f => theirs.has(f));

    if (overlap.length) {
      console.log(`   ${C.red}Fichiers modifiés des deux côtés (${overlap.length}) :${C.reset}`);
      overlap.forEach(f => console.log(`     • ${f}`));
    } else {
      console.log(`   ${C.dim}Aucun fichier en commun — un simple "git pull" devrait suffire.${C.reset}`);
    }
  }
}

// --- 2. Conflit de fusion avec la branche de production -------------------

head(`2. Fusion vers ${BASE}`);

if (!remoteBase) {
  console.log(`   ${C.dim}origin/${BASE} introuvable — vérification ignorée.${C.reset}`);
} else if (branch === BASE) {
  console.log(`   ${C.dim}On est déjà sur ${BASE} — sans objet.${C.reset}`);
} else {
  const conflicts = mergeConflicts('HEAD', remoteBase);

  if (conflicts === null) {
    console.log(`   ${C.yellow}⚠  Test de fusion impossible (git trop ancien ?) — vérification ignorée.${C.reset}`);
  } else if (conflicts.length === 0) {
    const diverged = Number(trySh(`git rev-list --count ${remoteBase}..HEAD`) || 0);
    console.log(`   ${C.green}✓${C.reset} La fusion vers ${BASE} passera toute seule (${diverged} commit(s) d'écart).`);
  } else {
    warning = true;
    if (STRICT) blocking = true;
    console.log(`   ${C.yellow}⚠  ${conflicts.length} fichier(s) en conflit avec ${remoteBase} :${C.reset}\n`);
    conflicts.forEach(({ file, kind }) => {
      console.log(`     • ${file}`);
      console.log(`       ${C.dim}${kind}${C.reset}`);
    });
    console.log(`\n   ${C.dim}Non bloquant pour ce push, mais la fusion vers ${BASE} demandera un arbitrage manuel.${C.reset}`);
  }
}

// --- Verdict --------------------------------------------------------------

console.log('');
if (blocking) {
  console.log(`${C.red}${C.bold}✗ Push interrompu.${C.reset}`);
  console.log(`${C.dim}  Récupérer d'abord :  git pull --no-rebase origin ${branch}${C.reset}`);
  console.log(`${C.dim}  Forcer malgré tout : git push --no-verify${C.reset}\n`);
  process.exit(1);
}
if (warning) {
  console.log(REPORT
    ? `${C.yellow}${C.bold}⚠ Des conflits attendent à la fusion vers ${BASE}.${C.reset}\n`
    : `${C.yellow}${C.bold}✓ Push autorisé — mais des conflits attendent à la fusion vers ${BASE}.${C.reset}\n`);
} else {
  console.log(`${C.green}${C.bold}✓ Aucun conflit détecté.${C.reset}\n`);
}
process.exit(0);

// --- Détection de conflits ------------------------------------------------

/**
 * Fusion à blanc de deux commits, sans toucher au répertoire de travail.
 * Retourne [{ file, kind }], [] si tout passe, ou null si indéterminable.
 */
function mergeConflicts(ours, theirs) {
  // git >= 2.38 : merge-tree fait la fusion en mémoire.
  const r = spawnSync('git', ['merge-tree', '--write-tree', ours, theirs], {
    cwd: repoRoot, encoding: 'utf8',
  });

  if (r.error || r.status === null) return null;
  if (r.status === 0) return [];               // fusion propre
  if (r.status !== 1) return null;             // 2+ = erreur (option inconnue, etc.)

  const out = r.stdout || '';
  const files = new Map();

  for (const line of out.split('\n')) {
    let m;
    if ((m = line.match(/^CONFLICT \(content\): Merge conflict in (.+)$/))) {
      files.set(m[1], 'Les deux branches ont modifié les mêmes lignes.');
    } else if ((m = line.match(/^CONFLICT \(add\/add\): Merge conflict in (.+)$/))) {
      files.set(m[1], 'Fichier créé séparément des deux côtés — travail fait deux fois.');
    } else if ((m = line.match(/^CONFLICT \(modify\/delete\): (.+?) deleted in (.+?) and modified in (.+?)\./))) {
      files.set(m[1], `Supprimé dans ${m[2]}, modifié dans ${m[3]} — il faut trancher.`);
    } else if ((m = line.match(/^CONFLICT \((?:rename[^)]*|[^)]+)\): (?:.*?in )?(\S+)/))) {
      files.set(m[1], line.replace(/^CONFLICT \([^)]+\): /, ''));
    }
  }

  return [...files].map(([file, kind]) => ({ file, kind }));
}
