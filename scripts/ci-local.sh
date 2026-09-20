#!/usr/bin/env bash
#
# Runs, locally, exactly what CI runs — so work can still be verified when CI
# cannot run at all.
#
# WHY THIS EXISTS
# On 2026-09-20 GitHub stopped starting jobs: "recent account payments have
# failed or your spending limit needs to be increased". Every job died in three
# seconds with no runner and no logs, on every branch, for every agent. Nothing
# was wrong with the code, and nothing could be proven right either.
#
# That is the dangerous state. Work does not get lost -- it is committed and
# pushed, and git does not care about billing -- but the temptation is to merge
# on "it looked fine locally", and what "fine" meant is different for each
# person. This script makes it one thing. Run it, and paste the summary into
# the PR so the next person knows exactly what was checked and what was not.
#
# It is not a replacement for CI. CI runs on a clean machine and cannot be
# skipped; this runs on yours and can. When CI is available, CI decides.
#
# Usage:
#   scripts/ci-local.sh                 # mirrors a PR run against origin/main
#   scripts/ci-local.sh --migrations    # force the migration suite (~8 min)
#   scripts/ci-local.sh --base <ref>    # compare against something else
set -uo pipefail

cd "$(dirname "$0")/.."

BASE="origin/main"
FORCE_MIGRATIONS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrations) FORCE_MIGRATIONS=1; shift ;;
    --base) BASE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

# Node is not on PATH in every shell on this machine, and a pnpm that cannot
# find node "succeeds" with exit 0 having done nothing -- which would make this
# script report a pass it never ran. Resolve it up front and fail loudly.
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin; do
    [[ -x "$candidate/node" ]] && export PATH="$candidate:$PATH" && break
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: no node on PATH. See AGENTS.md; nvm lives in ~/.nvm." >&2
  exit 1
fi

results=()
failed=0

run_step() {
  local label="$1"; shift
  printf '\n=== %s ===\n' "$label"
  if "$@"; then
    results+=("PASS  $label")
  else
    results+=("FAIL  $label")
    failed=1
  fi
}

skip_step() {
  results+=("SKIP  $1")
  printf '\n=== %s (skipped: %s) ===\n' "$1" "$2"
}

# --- The same question CI asks, answered the same way ------------------------
if [[ "$FORCE_MIGRATIONS" == "1" ]]; then
  sql_changed=1
elif git rev-parse --verify --quiet "$BASE" >/dev/null; then
  if git diff --name-only "$BASE...HEAD" | grep -q '^backend/supabase/migrations/.*\.sql$'; then
    sql_changed=1
  else
    sql_changed=0
  fi
else
  echo "WARNING: base ref '$BASE' not found; assuming migrations changed." >&2
  sql_changed=1
fi

# --- Expo -------------------------------------------------------------------
run_step "expo typecheck"  bash -c 'cd expo && pnpm typecheck'
run_step "expo lint"       bash -c 'cd expo && pnpm lint'
run_step "expo tests"      bash -c 'cd expo && pnpm test'

# --- Backend ----------------------------------------------------------------
run_step "migration numbers" scripts/check-migration-numbers.sh "$BASE"

if command -v deno >/dev/null 2>&1; then
  run_step "edge function typecheck" bash -c '
    set -uo pipefail
    shopt -s nullglob
    failed=0
    for f in backend/supabase/functions/*/index.ts; do
      deno check "$f" || failed=1
    done
    exit "$failed"'
  run_step "edge function tests" deno test --allow-env --allow-net --allow-read backend/supabase/functions/

  if [[ "$sql_changed" == "1" ]]; then
    run_step "migration tests" deno test --allow-env --allow-net --allow-read backend/supabase/migrations/
  else
    skip_step "migration tests" "no .sql changed vs $BASE — same rule as CI"
  fi
else
  skip_step "edge function typecheck" "deno not installed"
  skip_step "edge function tests" "deno not installed"
  skip_step "migration tests" "deno not installed"
  # A missing toolchain is not a pass. CI has deno; a local run without it has
  # checked strictly less, and saying so is the whole point of this script.
  failed=1
fi

# --- Summary, written to be pasted into a PR --------------------------------
printf '\n\n──────── LOCAL GATE — paste this into the PR ────────\n'
printf 'commit:  %s\n' "$(git rev-parse --short HEAD)"
printf 'base:    %s (%s)\n' "$BASE" "$(git rev-parse --short "$BASE" 2>/dev/null || echo unknown)"
printf 'when:    %s\n' "$(date -u '+%Y-%m-%d %H:%M UTC')"
printf 'host:    local machine, not CI\n\n'
for line in "${results[@]}"; do printf '  %s\n' "$line"; done
printf '\n'

if [[ "$failed" == "0" ]]; then
  printf 'RESULT: everything CI would have run, ran here, and passed.\n'
  printf '─────────────────────────────────────────────────────\n'
  exit 0
fi

printf 'RESULT: NOT clean. Do not merge on this.\n'
printf '─────────────────────────────────────────────────────\n'
exit 1
