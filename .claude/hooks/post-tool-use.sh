#!/bin/bash
# PostToolUse hook — validates files right after Claude edits them.
#
#  - backend/**/*.js (non side-effectful)  → runtime require() smoke check
#                                            (catches the 2026-04-09 crash class)
#  - frontend/src/i18n/{fr,en}.json        → key parity check (CLAUDE.md rule)
#
# Reads the hook payload from stdin, extracts the edited file path. On a
# problem it exits 2 with an explanation on stderr so Claude sees and fixes it.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$ROOT" ] && exit 0

PAYLOAD="$(cat)"
FILE="$(printf '%s' "$PAYLOAD" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    try { const j=JSON.parse(s); process.stdout.write((j.tool_input&&(j.tool_input.file_path||j.tool_input.notebook_path))||''); }
    catch { process.stdout.write(''); }
  });
")"

[ -z "$FILE" ] && exit 0

# Normalize to a path relative to repo root
REL="${FILE#"$ROOT"/}"

# ── i18n parity ────────────────────────────────────────────────────
case "$REL" in
  frontend/src/i18n/fr.json|frontend/src/i18n/en.json)
    if ! node "$ROOT/scripts/check-i18n-parity.js" >&2; then
      exit 2
    fi
    exit 0
    ;;
esac

# ── backend runtime require() ──────────────────────────────────────
case "$REL" in
  backend/*.js)
    # Skip side-effectful modules (start servers / open DB on require)
    case "$REL" in
      backend/server.js|backend/routes/*|backend/orchestrator/*|*/tests/*|*.test.js)
        exit 0 ;;
    esac
    SUB="${REL#backend/}"
    ERR="$(cd "$ROOT/backend" && \
      NODE_ENV=test CLAUDE_API_KEY=dummy ANTHROPIC_API_KEY=dummy LEMLIST_API_KEY=dummy \
      NOTION_API_KEY=dummy JWT_SECRET=dummy-secret-at-least-32-characters-long \
      DATABASE_URL=postgres://d:d@localhost:5432/d SUPABASE_URL=https://d.supabase.co \
      SUPABASE_SERVICE_ROLE_KEY=dummy \
      node -e "require('./$SUB')" 2>&1)"
    if [ $? -ne 0 ]; then
      echo "🛑 backend module failed to load: $REL" >&2
      echo "$ERR" >&2
      echo "Fix the require()-time crash before continuing." >&2
      exit 2
    fi
    exit 0
    ;;
esac

exit 0
