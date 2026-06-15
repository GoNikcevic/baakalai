#!/usr/bin/env bash
# One-time setup: point git at the versioned hooks in .githooks/.
# Run once per clone (git config is per-clone, not committed).
#
#   bash scripts/install-hooks.sh
#
set -e
ROOT="$(git rev-parse --show-toplevel)"
chmod +x "$ROOT"/.githooks/* "$ROOT"/scripts/pre-commit-audit.js "$ROOT"/scripts/pre-push-smoke.js 2>/dev/null || true
git config core.hooksPath .githooks
echo "✓ core.hooksPath set to .githooks"
echo "  pre-commit: scripts/pre-commit-audit.js (anti-pattern scan on staged files)"
echo "  pre-push:   scripts/pre-push-smoke.js   (runtime require() of changed backend modules)"
echo "  Bypass any hook with --no-verify."
