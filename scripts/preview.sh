#!/usr/bin/env bash
#
# Opens the preview at http://localhost:8090 on the code that is actually on main.
#
# WHY THIS EXISTS
# There are ~31 worktrees in this repo, one per agent lane. A preview started in
# any of them shows that lane's branch, and goes stale the moment anything else
# merges -- silently, because the page keeps working. On 2026-09-20 the preview
# had been running for ten hours against a branch that was missing PR #121, so
# Reimagine was being reviewed in a design that no longer existed on main.
#
# The rule this enforces: THE PREVIEW ONLY EVER SHOWS MAIN. If a change is not
# merged, it is not in the preview. To see a branch before it merges, review the
# PR -- do not repoint this script.
#
# It refuses to start rather than show something it cannot vouch for: a dirty
# tree, or a local-preview branch that has drifted from origin/main, is a hard
# stop.
#
# Usage:
#   scripts/preview.sh            # sync to origin/main and serve
#   scripts/preview.sh --no-sync  # serve what is already checked out
set -euo pipefail

WORKTREE="${KATHA_PREVIEW_WORKTREE:-$HOME/Katha-AI-preview}"
PORT="${KATHA_PREVIEW_PORT:-8090}"
SYNC=1
[[ "${1:-}" == "--no-sync" ]] && SYNC=0

if [[ ! -d "$WORKTREE/expo" ]]; then
  echo "FATAL: no preview worktree at $WORKTREE" >&2
  echo "  Create it once with:" >&2
  echo "    git worktree add -b local-preview \"$WORKTREE\" origin/main" >&2
  echo "    cd \"$WORKTREE/expo\" && pnpm install && cp <a working>/expo/.env expo/.env" >&2
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

if [[ "$SYNC" == "1" ]]; then
  # Uncommitted work here means someone edited the preview worktree by mistake.
  # Resetting over it would destroy it, so stop and let a human decide.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "FATAL: $WORKTREE has uncommitted changes." >&2
    echo "  This worktree is a read-only mirror of main. Edit in a lane worktree." >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi

  echo "Syncing preview to origin/main..."
  git fetch origin main --quiet
  git checkout --quiet local-preview 2>/dev/null || git checkout --quiet -b local-preview origin/main
  git reset --hard --quiet origin/main
fi

head="$(git rev-parse --short HEAD)"
subject="$(git log -1 --format=%s)"

# A lockfile change between main and whatever was last installed leaves the
# preview running against stale dependencies, which looks like a code bug.
if ! git diff --quiet HEAD@{1} HEAD -- expo/pnpm-lock.yaml 2>/dev/null; then
  echo "Lockfile changed since the last sync -- reinstalling dependencies..."
  (cd expo && pnpm install --frozen-lockfile)
fi

# Free the port. An old server from another worktree is exactly the failure
# this script exists to prevent, and it would otherwise silently win.
if existing="$(lsof -ti tcp:"$PORT" 2>/dev/null)" && [[ -n "$existing" ]]; then
  echo "Stopping whatever holds :$PORT (pid $existing)..."
  kill $existing 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    lsof -ti tcp:"$PORT" >/dev/null 2>&1 || break
    sleep 0.5
  done
  lsof -ti tcp:"$PORT" >/dev/null 2>&1 && kill -9 $(lsof -ti tcp:"$PORT") 2>/dev/null || true
fi

echo
echo "────────────────────────────────────────────────"
echo " PREVIEW — main only"
echo " commit:  $head  $subject"
echo " url:     http://localhost:8090"
echo " note:    use a phone-sized viewport; the desktop-width"
echo "          intro carousel traps the flow."
echo "────────────────────────────────────────────────"
echo

cd expo
exec pnpm expo start --web --port "$PORT"
