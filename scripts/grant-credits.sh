#!/usr/bin/env bash
#
# Grant credits to a real user, in the real ledger.
#
# This exists because the honest alternative was worse. Create is gated on
# `credits >= 3` and a fresh guest is granted exactly 3, so the first story a
# tester writes leaves them at 0 and the second is refused -- with a real
# backend attached, `resolveInitialCredits` correctly shows that 0 rather than
# a comforting fake, because a number the server will not honour is an
# affordance that lies (Create looks enabled, then generation fails).
#
# So the fix is to make the balance actually be what the tester needs, not to
# draw a different number over it. This calls `grant_credit` with the service
# role, exactly as the welcome bonus does, and writes a real ledger row with a
# real operation key.
#
# It is a local operator tool and is never shipped or called from the app: it
# needs SUPABASE_SERVICE_ROLE_KEY, which exists only in backend/.env and in
# Supabase secrets.
#
# Usage:
#   scripts/grant-credits.sh                 # every user, 100 credits each
#   scripts/grant-credits.sh all 250
#   scripts/grant-credits.sh latest 250
#   scripts/grant-credits.sh <user-uuid> [amount]
#
# `all` is the default and the one to reach for. Every browser refresh that
# loses its session mints a new anonymous user, so a testing project
# accumulates dozens of them and "which of these is the tab I have open" is not
# a question worth answering.
#
# It grants to ANONYMOUS users only, and says how many real accounts it left
# alone. That distinction is the whole safety of this script: a guest identity
# is a throwaway artefact of local testing, while a signed-up account belongs
# to a person whose balance is theirs. This project turned out to hold 11 real
# accounts, so "grant to everyone" would have quietly handed out credits to
# strangers. Real accounts are only ever topped up by passing their uuid
# explicitly, one at a time, deliberately.
#
# `latest` grants to the most recently created user only; an explicit uuid
# grants to exactly that one, anonymous or not.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "backend/.env not found; cannot reach the service role." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

USER_ID="${1:-all}"
AMOUNT="${2:-100}"

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env" >&2
  exit 1
fi

USER_IDS=()

if [[ "$USER_ID" == "all" ]]; then
  # `mapfile` is bash 4; macOS ships bash 3.2. A read loop is portable.
  while IFS= read -r line; do
    [[ -n "$line" ]] && USER_IDS+=("$line")
  done < <(curl -sS "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=200" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    | python3 -c '
import sys, json
users = json.load(sys.stdin)["users"]
guests = [u for u in users if u.get("is_anonymous")]
named = len(users) - len(guests)
if named:
    sys.stderr.write(
        "Leaving %d real account(s) untouched; pass a uuid to top one up.\n"
        % named
    )
for u in guests:
    print(u["id"])
')
  if [[ ${#USER_IDS[@]} -eq 0 ]]; then
    echo "no anonymous users found; open the app once so a guest session exists" >&2
    exit 1
  fi
  echo "Granting to ${#USER_IDS[@]} guest sessions."
elif [[ "$USER_ID" == "latest" ]]; then
  USER_ID="$(curl -sS "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    | python3 -c 'import sys,json; u=json.load(sys.stdin)["users"]; print(u[0]["id"] if u else "")')"
  if [[ -z "$USER_ID" ]]; then
    echo "no auth users found; open the app once so a guest session exists" >&2
    exit 1
  fi
  echo "Most recent user: $USER_ID"
  USER_IDS=("$USER_ID")
else
  USER_IDS=("$USER_ID")
fi

# `grant_credit` is idempotent on `p_operation_key`: the same key twice is one
# grant, not two. A timestamped key per user is therefore what makes repeated
# runs add up rather than silently no-op after the first.
STAMP="$(date +%s)-$RANDOM"

for ID in "${USER_IDS[@]}"; do
  RESPONSE="$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/grant_credit" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"p_user_id\": \"$ID\",
      \"p_amount\": $AMOUNT,
      \"p_reason\": \"feedback\",
      \"p_reference_id\": \"local-testing\",
      \"p_operation_key\": \"local-test-$STAMP-$ID\"
    }")"

  if [[ "$RESPONSE" == *'not present in table \"profiles\"'* ]]; then
    # An auth user with no `profiles` row never finished `bootstrap-user`:
    # the session was created and then abandoned before the grant landed.
    # There is nothing to top up and nothing wrong -- the row appears the
    # next time that session boots the app.
    echo "  $ID -> skipped (never completed bootstrap)"
  elif [[ "$RESPONSE" == *'"message"'* ]]; then
    echo "  $ID -> FAILED: $RESPONSE" >&2
  else
    echo "  $ID -> balance $RESPONSE"
  fi
done
