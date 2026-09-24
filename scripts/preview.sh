#!/usr/bin/env bash
#
# Opens the preview at http://localhost:8090 on the code that is actually on main.
#
# WHY THIS EXISTS
# There are ~30 worktrees in this repo, one per agent lane. A preview started in
# any of them serves that lane's branch, and goes stale the moment anything else
# merges -- silently, because the page keeps working. On 2026-09-20 the preview
# had been running for ten hours against a branch that was missing PR #121, so
# Reimagine was being reviewed in a design that no longer existed on main.
#
# The rule this enforces: THE PREVIEW ONLY EVER SHOWS MAIN. If a change is not
# merged, it is not in the preview. To see a branch before it merges, review the
# PR -- do not repoint this script.
#
# It refuses to start rather than show something it cannot vouch for. That is
# true in --offline too: skipping the fetch skips the network, never the checks.
#
# Usage:
#   scripts/preview.sh            # fetch, sync to origin/main, serve
#   scripts/preview.sh --offline  # no fetch; still refuses unless HEAD is
#                                 # clean and equal to the known origin/main
set -euo pipefail

WORKTREE="${KATHA_PREVIEW_WORKTREE:-$HOME/Katha-AI-preview}"
PORT="${KATHA_PREVIEW_PORT:-8090}"
FETCH=1
case "${1:-}" in
  "") ;;
  --offline) FETCH=0 ;;
  *) echo "unknown argument: $1" >&2; exit 64 ;;
esac

if [[ ! -d "$WORKTREE/expo" ]]; then
  echo "FATAL: no preview worktree at $WORKTREE" >&2
  echo "  Create it once with:" >&2
  echo "    git worktree add -b local-preview \"$WORKTREE\" origin/main" >&2
  echo "    (cd \"$WORKTREE/expo\" && pnpm install)" >&2
  echo "    cp <any working worktree>/expo/.env \"$WORKTREE/expo/.env\"   # not in git" >&2
  exit 1
fi

# Node is not on PATH in every shell on this machine, and a pnpm that cannot
# find node "succeeds" with exit 0 having done nothing. Resolve it or fail loud.
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin; do
    [[ -x "$candidate/node" ]] && export PATH="$candidate:$PATH" && break
  done
fi
command -v node >/dev/null 2>&1 || { echo "FATAL: no node on PATH; nvm lives in ~/.nvm" >&2; exit 1; }

cd "$WORKTREE"

# Two agents running this at once would otherwise interleave: one resets the
# worktree while the other is installing, or kills the server the other just
# started, leaving the port serving a commit nobody printed. Hold a lock for
# the prepare phase; `mkdir` is atomic even over NFS.
LOCK="$WORKTREE/.preview-lock"
for _ in $(seq 1 60); do
  mkdir "$LOCK" 2>/dev/null && break
  sleep 1
done
if [[ ! -d "$LOCK" ]]; then
  echo "FATAL: could not acquire $LOCK after 60s." >&2
  echo "  Another preview.sh may be mid-sync. If none is running, remove it." >&2
  exit 1
fi
# shellcheck disable=SC2064
trap "rmdir '$LOCK' 2>/dev/null || true" EXIT

# Uncommitted work here means someone edited the preview worktree by mistake.
# Resetting over it would destroy it, so stop and let a human decide. Checked
# on every path, including --offline.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "FATAL: $WORKTREE has uncommitted changes." >&2
  echo "  This worktree is a read-only mirror of main. Edit in a lane worktree." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

if [[ "$FETCH" == "1" ]]; then
  echo "Syncing preview to origin/main..."
  git fetch origin main --quiet
fi

git checkout --quiet local-preview 2>/dev/null || git checkout --quiet -b local-preview origin/main

before="$(git rev-parse HEAD)"
git reset --hard --quiet origin/main
head="$(git rev-parse HEAD)"

# --offline skips the fetch, not the guarantee. If the local origin/main ref is
# all we have, we can still refuse to serve anything that is not it -- what we
# cannot promise is that the ref is current, so say so rather than imply it.
if [[ "$FETCH" == "0" ]]; then
  echo "OFFLINE: not fetched. Serving the last known origin/main ($(git rev-parse --short HEAD))."
  echo "         It may be behind the real main. Re-run without --offline to be sure."
fi

# A lockfile change between main and whatever was last installed leaves the
# preview running against stale dependencies, which looks like a code bug.
if [[ "$before" != "$head" ]] && ! git diff --quiet "$before" "$head" -- expo/pnpm-lock.yaml; then
  echo "Lockfile changed since the last sync -- reinstalling dependencies..."
  (cd expo && pnpm install --frozen-lockfile)
fi

# If a preview is already serving this exact commit out of this worktree, leave
# it alone: killing and rebooting it would cost a Metro warm-up for no change.
# Check every pid on the port, not just the first. Expo holds it with more than
# one process and the one `lsof` lists first reports a cwd of "/", so testing
# only that pid never matches and the preview is needlessly rebooted each run.
holders="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [[ -n "$holders" ]]; then
  ours=0
  for p in $holders; do
    if [[ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)" == "$WORKTREE/expo" ]]; then
      ours=1
      break
    fi
  done
  if [[ "$ours" == "1" && "$before" == "$head" ]]; then
    echo "Already serving $(git rev-parse --short HEAD) on http://localhost:$PORT -- leaving it up."
    exit 0
  fi
  echo "Stopping whatever holds :$PORT (pids $(echo "$holders" | tr '\n' ' '))..."
  kill $(lsof -ti tcp:"$PORT") 2>/dev/null || true
  for _ in $(seq 1 10); do
    lsof -ti tcp:"$PORT" >/dev/null 2>&1 || break
    sleep 0.5
  done
  lsof -ti tcp:"$PORT" >/dev/null 2>&1 && kill -9 $(lsof -ti tcp:"$PORT") 2>/dev/null || true
fi

echo
echo "────────────────────────────────────────────────"
echo " PREVIEW — main only"
echo " commit:  $(git rev-parse --short HEAD)  $(git log -1 --format=%s)"
echo " url:     http://localhost:$PORT"
echo " note:    review at a phone-sized viewport (390 x 844); the"
echo "          product is designed for it. A desktop window works too."
echo "────────────────────────────────────────────────"
echo

# Release the lock before handing the process over to Expo: `exec` replaces this
# shell, so the EXIT trap would never run and the lock would leak.
rmdir "$LOCK" 2>/dev/null || true
trap - EXIT

cd expo
exec pnpm expo start --web --port "$PORT"
