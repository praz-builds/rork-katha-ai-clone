#!/usr/bin/env bash
# Compare every deployed Edge Function against the working tree, file by file.
#
# Merged is not deployed. Supabase functions ship when somebody runs
# `supabase functions deploy`, so before any release the only trustworthy
# question is whether the live bundles match the commit you are shipping.
#
# `ACTIVE` in `supabase functions list` only means a deployment exists, and the
# Management API's /body endpoint returns an ESZIP2.3 archive whose sources are
# compressed -- `strings` on it finds nothing but specifiers and remote URLs.
# So this downloads each function's real source with the CLI instead, into a
# throwaway directory, and `cmp`s every file against this checkout.
#
# Usage:  scripts/audit-function-drift.sh [project-ref]
# Exit:   0 = no drift, 1 = drift or a download failure.

set -uo pipefail

REF="${1:-iafeuxgoiknncgyjmugd}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCS="$REPO_ROOT/backend/supabase/functions"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/katha-drift-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

[ -d "$FUNCS" ] || { echo "no functions directory at $FUNCS" >&2; exit 1; }

slugs=$(ls "$FUNCS" | grep -v '^_')
echo "auditing $(echo "$slugs" | wc -l | tr -d ' ') functions against $(git -C "$REPO_ROOT" rev-parse --short HEAD)"

failed_download=()
for slug in $slugs; do
  mkdir -p "$WORK/$slug/supabase"
  cp "$REPO_ROOT/backend/supabase/config.toml" "$WORK/$slug/supabase/" 2>/dev/null
  if ! (cd "$WORK/$slug" && supabase functions download "$slug" --project-ref "$REF" >/dev/null 2>&1); then
    failed_download+=("$slug")
  fi
done

total=0 same=0 drift=0 missing=0
drifted=()
for slug in $slugs; do
  live="$WORK/$slug/supabase/functions"
  [ -d "$live" ] || continue
  this=0
  while IFS= read -r f; do
    rel="${f#"$live"/}"
    mine="$FUNCS/$rel"
    total=$((total + 1))
    if [ ! -f "$mine" ]; then
      echo "  DEPLOYED-BUT-ABSENT-HERE  $slug :: $rel"
      missing=$((missing + 1)); this=1
    elif cmp -s "$f" "$mine"; then
      same=$((same + 1))
    else
      echo "  DRIFT  $slug :: $rel"
      drift=$((drift + 1)); this=1
    fi
  done < <(find "$live" -type f \( -name '*.ts' -o -name '*.js' -o -name '*.json' \) | sort)
  [ "$this" -eq 1 ] && drifted+=("$slug")
done

echo "---"
echo "files compared: $total   identical: $same   drifted: $drift   deployed-but-absent-here: $missing"

if [ ${#failed_download[@]} -gt 0 ]; then
  echo "download FAILED (audited nothing for these): ${failed_download[*]}"
fi
if [ ${#drifted[@]} -gt 0 ]; then
  echo "deploy these: ${drifted[*]}"
  echo "remember the importer closure: a changed _shared file means every function that imports it,"
  echo "not just the ones whose own folder changed. Migration first, then functions."
  exit 1
fi
[ ${#failed_download[@]} -gt 0 ] && exit 1
echo "no drift: production matches this checkout"
