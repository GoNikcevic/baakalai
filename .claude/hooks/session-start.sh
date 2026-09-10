#!/bin/bash
# SessionStart hook — deux rôles :
#
#   1. Installer les dépendances (remote uniquement) pour que tests et linters
#      tournent : les conteneurs démarrent sur un clone frais, sans node_modules.
#   2. Afficher l'état des conflits dès l'ouverture de la session, pour que le
#      sujet soit posé AVANT d'écrire du code plutôt qu'au moment du push.
#
# Tourne en synchrone : la session démarre une fois les deps prêtes, ce qui
# évite qu'un test parte avant l'installation.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# --- 1. Dépendances (remote uniquement ; en local chacun gère les siennes) ---

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  # npm install (pas ci) pour réutiliser le cache conteneur entre les runs :
  # l'étape est un no-op rapide quand node_modules est déjà là.
  echo "→ Installing backend dependencies"
  npm install --prefix "$ROOT/backend" --no-audit --no-fund

  echo "→ Installing frontend dependencies"
  npm install --prefix "$ROOT/frontend" --no-audit --no-fund

  echo "✓ Dependencies installed (backend + frontend)"
fi

# --- 2. État des conflits ---------------------------------------------------
#
# Jamais bloquant : un réseau coupé, un git ancien ou un dépôt en cours de
# bascule ne doivent pas empêcher la session de démarrer. D'où le `|| true`
# et le timeout — la sortie est indicative, pas un garde-fou.

echo ""
echo "── État des conflits ──"
timeout 90 node "$ROOT/scripts/check-conflicts.js" --report 2>&1 || true
cat <<'EOF'
RAPPEL (règle 6 de CLAUDE.md) : lancer `node scripts/check-conflicts.js` avant
tout `git push`. Si des conflits sont listés ci-dessus, les signaler à Goran
plutôt que de pousser sans rien dire.
EOF

# --- 3. Décisions produit en attente ----------------------------------------
#
# Goran a demandé qu'on lui rappelle les arbitrages ouverts à chaque session
# plutôt que de compter sur sa mémoire. La liste vit dans CLAUDE.md (source
# unique) ; on la relit ici pour qu'elle passe aussi par le terminal, pas
# seulement par le contexte du modèle. Section vidée = rien d'affiché.

PENDING="$(awk '/^### Décisions en attente/{f=1; next} f && /^## /{exit} f' "$ROOT/CLAUDE.md" 2>/dev/null || true)"
if printf '%s' "$PENDING" | grep -q '^- '; then
  echo ""
  echo "── Décisions en attente (CLAUDE.md § 6) ──"
  printf '%s\n' "$PENDING"
fi
