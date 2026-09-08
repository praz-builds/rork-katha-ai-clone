#!/usr/bin/env bash
#
# The smoke pass: everything that must hold before main is trusted.
#
# CI already runs each suite. This exists so a person can run the same set in
# one command before merging or after pulling, and because it adds the one
# check CI could not have: a real Metro bundle.
#
# The bundle matters more than it looks. `tsc` resolves imports through
# TypeScript's own resolver, and Metro does not: a path that typechecks can
# still fail to bundle, and the symptom is a blank screen with nothing useful
# in the log. That happened in this repo when `node_modules` was a symlink --
# typecheck and every unit test passed while the app would not start.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

step() { printf "\n\033[1m==> %s\033[0m\n" "$1"; }

step "Client: typecheck"
(cd expo && pnpm typecheck)

step "Client: lint"
(cd expo && pnpm lint)

step "Client: unit and smoke tests"
(cd expo && pnpm exec jest --ci)

step "Backend: typecheck every edge function"
for f in backend/supabase/functions/*/index.ts; do
  deno check "$f"
done

step "Backend: edge function tests"
deno test --allow-env --allow-net --allow-read backend/supabase/functions/

step "Backend: migration tests (PGlite, slow on purpose)"
deno test --allow-env --allow-net --allow-read backend/supabase/migrations/

# Last, because it is the slowest and the most likely to fail for a reason the
# suites above cannot see.
step "Client: web bundle actually builds"
BUNDLE_OUT="$(mktemp -d)"
trap 'rm -rf "$BUNDLE_OUT"' EXIT
(cd expo && pnpm exec expo export --platform web --output-dir "$BUNDLE_OUT" >/dev/null)
test -s "$BUNDLE_OUT/index.html" || {
  echo "bundle produced no index.html" >&2
  exit 1
}

printf "\n\033[1;32mSmoke pass complete.\033[0m\n"
