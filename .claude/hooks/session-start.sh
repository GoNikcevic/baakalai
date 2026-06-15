#!/bin/bash
# SessionStart hook — installs backend + frontend dependencies so tests and
# linters work in Claude Code on the web sessions (containers start with a
# fresh clone and no node_modules).
#
# Runs synchronously: the session starts only once deps are installed, which
# avoids race conditions where Claude runs a test/lint before they're ready.
set -euo pipefail

# Only run in the remote (web) environment. Locally, devs manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# npm install (not ci) so the post-hook container cache is reused across runs
# and the step is a fast no-op when node_modules is already present.
echo "→ Installing backend dependencies"
npm install --prefix "$ROOT/backend" --no-audit --no-fund

echo "→ Installing frontend dependencies"
npm install --prefix "$ROOT/frontend" --no-audit --no-fund

echo "✓ Dependencies installed (backend + frontend)"
