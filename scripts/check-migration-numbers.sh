#!/usr/bin/env bash
#
# Fails when a migration number on this branch collides with one on main.
#
# WHY THIS EXISTS
# Migrations here are numbered by hand (00093_name.sql), and every branch cut
# from the same point picks the same next number. Two of them merge, and the
# second one is numbered over the first.
#
# The failure is silent, which is the whole problem. Supabase records applied
# migrations by version string in `supabase_migrations.schema_migrations`. Once
# 00093 is in that table, a *different* 00093 is considered already applied:
# `db push` skips it, reports success, and the schema change never happens.
# Nothing errors. It works on every developer's machine, where the migration
# ran before the collision existed, and it is simply missing in production --
# usually discovered much later, by the feature that depended on it breaking.
#
# This happened on 2026-09-20: #115 merged 00093_story_bible_rev.sql while a
# branch carrying 00093_music_bucket.sql was in flight. It was caught by hand.
#
# THE RULE
# Every migration added on this branch must be numbered strictly higher than
# every migration on main. Not merely "not a duplicate": reusing a gap below
# main's high-water mark (16, 24, 81 and 83 are unused) would apply out of
# order against databases that are already past it.
#
# Usage:
#   scripts/check-migration-numbers.sh [base-ref]     # default: origin/main
set -euo pipefail

BASE="${1:-origin/main}"
DIR="backend/supabase/migrations"

cd "$(dirname "$0")/.."

if [[ ! -d "$DIR" ]]; then
  echo "no migrations directory at $DIR" >&2
  exit 1
fi

# The number is the leading digits of the filename. `.sql` only: the `_test.ts`
# companions share the number by design.
numbers_in() {
  sed -n 's#.*/\([0-9][0-9]*\)_.*\.sql$#\1#p'
}

# --- 1. No two migrations on this branch share a number -----------------------
# Catches the collision before it ever reaches main, including two added in the
# same PR.
dupes="$(ls "$DIR"/*.sql | numbers_in | sort | uniq -d)"
if [[ -n "$dupes" ]]; then
  echo "Duplicate migration numbers on this branch:" >&2
  for n in $dupes; do
    echo "  $n:" >&2
    ls "$DIR"/${n}_*.sql | sed 's/^/    /' >&2
  done
  exit 1
fi

# --- 2. Every number is either main's own, or above everything main has ------
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "base ref '$BASE' not found; fetch it first (git fetch origin main)" >&2
  exit 1
fi

base_files="$(git ls-tree -r --name-only "$BASE" -- "$DIR" | grep '\.sql$' || true)"
if [[ -z "$base_files" ]]; then
  echo "no migrations found on $BASE -- refusing to guess" >&2
  exit 1
fi
base_max="$(echo "$base_files" | numbers_in | sort -u | tail -n1)"

# Read from the working tree, not from HEAD.
#
# An earlier version asked git which files the branch ADDED, which is the
# committed state -- so a renumbering done locally and not yet committed was
# judged against the old name and passed. The working tree is what a developer
# is about to commit and what CI has checked out, so it is the honest input for
# both. (Rule 1 above already reads it.)
status=0
for file in "$DIR"/*.sql; do
  n="$(echo "$file" | numbers_in)"
  if [[ -z "$n" ]]; then
    echo "::error file=$file::cannot read a migration number from this name" >&2
    echo "  Migrations must be named <number>_<name>.sql" >&2
    status=1
    continue
  fi

  same_number="$(echo "$base_files" | grep "/${n}_" || true)"

  if [[ -n "$same_number" ]]; then
    # The number exists on main. Fine only if it is the very same migration --
    # otherwise this branch has numbered a new migration over an applied one,
    # which is the silent failure this script exists to stop.
    if [[ "$(basename "$same_number")" == "$(basename "$file")" ]]; then
      continue
    fi
    echo "::error file=$file::migration $n already exists on $BASE as a different migration" >&2
    echo "COLLISION: $file" >&2
    echo "  $BASE has: $same_number" >&2
    echo "  Production's ledger already records $n as applied, so yours would be" >&2
    echo "  skipped silently and never run." >&2
    echo "  Fix: renumber to $(printf '%05d' $((10#$base_max + 1))) or higher, and rename its _test.ts to match." >&2
    status=1
    continue
  fi

  # A number main has never used. It must still outrank everything there:
  # reusing a gap below the high-water mark (16, 24, 81 and 83 are unused)
  # would apply out of order against databases already past it.
  #
  # String compare would call "00100" lower than "00093". Force base 10 so a
  # leading zero is not read as octal.
  if (( 10#$n <= 10#$base_max )); then
    echo "::error file=$file::migration $n is below the high-water mark on $BASE ($base_max)" >&2
    echo "OUT OF ORDER: $file" >&2
    echo "  $n is unused on $BASE, but databases are already past $base_max," >&2
    echo "  so this would apply out of order or not at all." >&2
    echo "  Fix: renumber to $(printf '%05d' $((10#$base_max + 1))) or higher, and rename its _test.ts to match." >&2
    status=1
  else
    echo "OK: $(basename "$file") is above $base_max"
  fi
done

exit "$status"
