#!/bin/bash
# Wait for the 00:22 Codex cover run to finish, then publish every approved
# story that was only waiting on its cover. Safe to rerun: publish.ts is idempotent.
cd "$(dirname "$0")/../.."
dir=backend/originals
target=$(date -j -f "%Y-%m-%d %H:%M" "2026-09-19 00:25" +%s)
while [ "$(date +%s)" -lt "$target" ]; do sleep 60; done
while pgrep -f "codex exec --skip-git" >/dev/null || pgrep -f "covers/run.sh" >/dev/null; do sleep 60; done
ls $dir/covers/*.png | wc -l
deno run -A $dir/publish.ts $(sort -u $dir/approved.txt) 2>&1 | grep -v Download
