#!/usr/bin/env bash
# Freeze deploys : creates .deploy-freeze at repo root, commits and pushes
# it. The smoke-test CI workflow fails fast when this file exists, and
# (if "Wait for CI" is enabled in Railway) production stops auto-deploying
# until you run ./scripts/unfreeze-deploy.sh.
#
# Use this BEFORE a client demo, live onboarding, or any maintenance
# window where you can't afford a broken push hitting prod.
#
# Usage:
#   ./scripts/freeze-deploy.sh "Reason for freeze"
#   ./scripts/freeze-deploy.sh                      # prompts for reason

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .deploy-freeze ]; then
  echo "⚠ Deploys are already frozen. Current freeze:"
  echo "---"
  cat .deploy-freeze
  echo "---"
  echo ""
  echo "Run ./scripts/unfreeze-deploy.sh to unfreeze first."
  exit 1
fi

REASON="${1:-}"
if [ -z "$REASON" ]; then
  read -rp "Reason for freeze (e.g. 'BforCure onboarding live'): " REASON
fi
if [ -z "$REASON" ]; then
  echo "✗ Reason is required."
  exit 1
fi

WHO=$(git config user.name 2>/dev/null || whoami)
WHEN=$(date -u +"%Y-%m-%d %H:%M UTC")

cat > .deploy-freeze <<EOF
Deploy frozen by: $WHO
Frozen at:        $WHEN
Reason:           $REASON

The smoke-test CI workflow fails while this file exists.
To unfreeze: ./scripts/unfreeze-deploy.sh
EOF

git add .deploy-freeze
git commit -m "chore: freeze deploys, $REASON"
git push

echo ""
echo "🚨 DEPLOYS FROZEN"
echo "   Reason: $REASON"
echo "   CI will now fail on every push until you unfreeze."
echo "   Run: ./scripts/unfreeze-deploy.sh when safe to deploy again."
