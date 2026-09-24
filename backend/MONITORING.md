# Katha service watch-list

<!-- markdownlint-disable MD013 -->

What has to be working for a person to use Katha, how bad it is when each piece stops, and how to tell. This is the list the 24/7 check will run against. It is not the check itself: nothing below runs on a schedule yet except the subscription-grant cron.

Written 2026-09-24, after "Where does it begin?" came up with no chips for the founder and `error_events` had no row to say why. The lesson: a service that fails into an empty state rather than an error does not show up on any list. A service can only be watched if its failures are written down somewhere.

## The functions

Checked against `backend/supabase/functions/` on 2026-09-24: 37 directories. Four are being deleted (`save-phrase`, `unsave-phrase`, `phrases`, `record-practice`) and are left out. The other 33 are all below. When you add a function, add its row here in the same PR.

| Tier | Service | Why it matters | Health signal |
|---|---|---|---|
| P0 | `shape-story` | The premise and the "Where does it begin?" opening chips | `error_events` `story_shape_failed` / `story_shape_empty` / `story_shape_rate_limited` / `story_shape_unhandled`; client `opening_directions_failed` / `opening_directions_all_dropped` (PostHog). Also how often it comes back empty |
| P0 | `generate-story`, `generate-story-stream`, `continue-story` | Every story and every chapter | `error_events` (`all_providers_failed`, `post_deduction_failed`, `streamed_chapter_outside_band`), p95 latency, provider fallbacks |
| P0 | `bootstrap-user`, `profile` | Every screen's first load, the You tab | Latency, 5xx, `guest_bootstrap_failed` |
| P0 | `generate-audio`, `audio-status` (RunPod MiniMax) | Narration | Job failures (`narration_*`, `audio_*`), queue time |
| P0 | `revenuecat-webhook`, `refresh-subscription-grants` (GH Actions cron, 03:00 UTC) | Money | Webhook 4xx/5xx, whether the cron run passed |
| P1 | `generate-character-image`, `regenerate-cover` | Portraits and covers | Failures, refusals when the free allowance runs out |
| P1 | `reimagine-chapter`, `edit-story` | Editing | `error_events` |
| P1 | `library`, `feed`, `publish-story`, `comments`, `like`, `bookmark`, `follow-story`, `follow-user`, `record-read`, `referral`, `credit-claims`, `feedback` | Library, Explore and the social features | 5xx, `feed_unhandled` |
| P2 | `send-push`, `register-push-token`, `voices`, `seed-voice-previews`, `reviewer-signin` | Supporting features | 5xx; `reviewer_pepper_missing` for the reviewer |
| P2 | `deduct-credit`, `grant-credit` | Retired. `deduct-credit` returns 403 to everyone on purpose; money moves through the operation RPCs | A 2xx from `deduct-credit` would be the incident |

## Upstream providers and storage

| What | Used by | State on 2026-09-24 | How to check by hand |
|---|---|---|---|
| **OpenRouter** (`OPENROUTER_API_KEY`) | Every text call (`_shared/llm.ts`), every image (`_shared/image.ts`) | **$3.29 left of $60 bought** (usage $56.71). About $31 was spent this month. The key in Supabase secrets is the same one as in `backend/.env`: their sha256 digests match. | `curl -s https://openrouter.ai/api/v1/credits -H "Authorization: Bearer $OPENROUTER_API_KEY"`. `total_credits - total_usage` is what is left. At $0 every generation fails with `all_providers_failed` and every shape with `story_shape_failed`. |
| **Gemini** (`GEMINI_API_KEY`) | Fallback in the text chain | Turned off with `LLM_DISABLED_PROVIDERS=gemini`. Quota ran out 2026-08-31. | `supabase secrets list` shows the flag is set. It is not a fallback until its share of the deadline is moved; see AGENTS.md *LLM Fallback Chain*. |
| **RunPod** `minimax-speech-02-hd` (`RUNPOD_API_KEY`) | `generate-audio`, `audio-status` | Set | Narrate one short chapter on the house account and check that `chapter_audio` gets a row with `duration_seconds`. |
| **Brave Search** (`BRAVE_SEARCH_API_KEY`, `GROUNDING_SEARCH_ENABLED`) | Grounding cards | **Not set.** Grounding search is off, so the classifier runs but no cards are fetched. | `supabase secrets list` |
| Storage bucket `covers` | Covers, portraits | Public read | Fetch any `stories.cover_image_url`, expect 200 |
| Storage bucket `audio` | Narration MP3s | Public read | Fetch any `chapter_audio` URL, expect 200 |
| Storage bucket `music` | Reader music (24 tracks) | Public read, no write policy | Fetch one track URL from `expo/src/lib/music*`, expect 200 |
| Storage bucket `avatars` | Profile photos (00060) | Public read | Fetch any `profiles.avatar_url`, expect 200 |
| **Sentry** (`SENTRY_DSN`, `sentryDsn`) | Push alerts | **Not set on either side.** `captureError` does nothing, so client failures reach PostHog only. | `supabase secrets list`, `expo/app.json` |

## What is already checked, and what is not

- **`backend/scripts/smoke-app-surface.py`** checks, against production: that `feed`, `audio-status`, `edit-story`, `publish-story`, `generate-audio`, `bootstrap-user`, `profile` and `shape-story` are deployed and refuse anonymous callers; `bootstrap-user`, `profile` (`me`, `ledger`) and `shape-story` (the payload DirectionStep sends, which must return opening beats) for a new account; then `generate-story`, `library`, `feed`, `edit-story`, `publish-story` (cover included) and `audio-status`. It creates its own account and cleans it up. It is run by hand; nothing schedules it.
- **`backend/scripts/smoke-generation-matrix.py`** and **`smoke-series-generation.py`** check generation across genres and a multi-chapter series. They are expensive and run by hand.
- **`.github/workflows/subscription-grants.yml`** is the only scheduled job. It calls `refresh-subscription-grants` daily at 03:00 UTC. If a run fails, the Actions tab shows it and nothing else does.
- **Not checked by anything:** `revenuecat-webhook`, `generate-character-image`, `regenerate-cover`, `reimagine-chapter`, `continue-story`, the social functions, the OpenRouter balance, and the buckets.

## How to check each P0 by hand

First mint a session for the house account (`originals@kathaai.test`). With the service role, call `/auth/v1/admin/generate_link` (`type: magiclink`), then `/auth/v1/verify` with the `hashed_token`, and use the `access_token` you get back as the Bearer token. Read `error_events` through the Management API query endpoint with `read_only: true`.

- **`shape-story`**: POST `{"idea": "<a real premise>", "variant": "create", "genre": "mystery", "planned_chapter_count": 3}`. Expect 200 and `shape.beats` with 3 items in 6–10s. A `{shape: null}` always comes with a `reason`, and since 2026-09-24 every null writes a row. Then `select error_code, count(*) from error_events where error_code like 'story_shape%' and occurred_at > now() - interval '1 day' group by 1`. **Check `story_shape_rate_limits` too.** If a writer reports an empty screen and has no row there, the request never got past authentication. The problem is then on the client, and PostHog's `opening_directions_failed` has the reason.
- **`generate-story`, `generate-story-stream`, `continue-story`**: run `smoke-app-surface.py`, which covers `generate-story`. For the streamed paths, generate one story on the house account in the app. Then `select error_code, count(*) from error_events where bucket in ('generation.story','llm.provider') and occurred_at > now() - interval '1 day' group by 1`. If `all_providers_failed` shows up, check the OpenRouter balance first.
- **`bootstrap-user`, `profile`**: POST `{}` to `bootstrap-user` and `{"action": "me"}` to `profile` with the house JWT. Both should return 200 in under 3s. `smoke-app-surface.py` [1b] prints how long each took.
- **`generate-audio`, `audio-status`**: narrate one chapter on the house account, then poll `audio-status?job_id=…` until it says ready. Check that `chapter_audio.duration_seconds` is filled in. Look at `error_events` rows with `bucket = 'generation.audio'`.
- **`revenuecat-webhook`**: the RevenueCat dashboard's webhook delivery log (non-2xx responses) and `error_events` rows with `bucket = 'payments'`. **`refresh-subscription-grants`**: the latest *subscription grants* run in GitHub Actions, then `credit_ledger` rows with a `subscription:` reference for the current month.

## Deploy check

Merged is not deployed; see AGENTS.md *Production state*. For any function on this list, `GET /v1/projects/iafeuxgoiknncgyjmugd/functions/<slug>/body` from the Management API and look for a symbol the change added. For example, `shape-story` after this change should contain `story_shape_rate_limited`.
