#!/bin/bash
# Apply a review batch end to end: edits -> verify -> publish what passes.
#   backend/originals/process-batch.sh <n>
# Stories with verdict "regenerate", failed edits or failed verification are
# listed and left private.
set -u
cd "$(dirname "$0")/../.."
n="$1"; dir=backend/originals
[ -f "$dir/edits-batch$n.jsonl" ] && deno run -A $dir/apply-edits.ts "edits-batch$n.jsonl" 2>&1 | grep -v Download
python3 - "$dir" "$n" <<'P' > /tmp/claude-batch-$n.txt
import json, sys
d, n = sys.argv[1], sys.argv[2]
for l in open(f"{d}/reviews-batch{n}.jsonl"):
    if l.strip():
        r = json.loads(l)
        print(r["slug"], r["verdict"], r.get("score"))
P
cat /tmp/claude-batch-$n.txt
ok=()
while read -r slug verdict score; do
  if [ "$verdict" = "regenerate" ]; then echo "REGENERATE $slug ($score)"; continue; fi
  if deno run -A $dir/verify.ts "$slug" 2>&1 | grep -v Download | tee /dev/stderr | grep -q ": PASS"; then ok+=("$slug"); fi
done < /tmp/claude-batch-$n.txt
if [ ${#ok[@]} -gt 0 ]; then
  printf "%s\n" "${ok[@]}" >> $dir/approved.txt
  deno run -A $dir/publish.ts "${ok[@]}" 2>&1 | grep -v Download
fi
