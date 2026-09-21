#!/usr/bin/env bash
# Unfreeze deploys : removes .deploy-freeze, commits and pushes.
# Pair with ./scripts/freeze-deploy.sh.
#
# Usage:
#   ./scripts/unfreeze-deploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .deploy-freeze ]; then
  echo "✓ Deploys are not frozen. Nothing to do."
  exit 0
fi

echo "Current freeze:"
echo "---"
cat .deploy-freeze
echo "---"
echo ""

git rm .deploy-freeze
git commit -m "chore: unfreeze deploys"
git push

echo ""
echo "✅ DEPLOYS UNFROZEN"
echo "   CI will pass again and Railway will auto-deploy on the next push."
