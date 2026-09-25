# Katha AI — Backend Roadmap

<!-- markdownlint-disable MD013 -->

> Phased execution plan for wiring the Expo app to real backend services.
> Each phase can be executed independently. Check off items as completed.
> Read `build-log.md` at session start to know current state.

---

## Phase A — Foundation (DONE)

**Goal:** Fix critical bugs, deploy existing functions, verify schema.

All bug fixes applied, migrations `00001`-`00015`, `00017`-`00023` and `00025` applied to the linked project. Migration `00016_device_tokens.sql` is absent from the repository and remains a pending Phase G task. **12 of 12 edge functions are deployed** — verified through production smoke suites on 2026-08-31 UTC.

### Remaining Verification

- [x] Set story-generation secrets: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, and existing `OPENAI_API_KEY`. Claude/Anthropic secret names are intentionally not read by the generation client.
- [ ] **Unblock the remaining fallback providers.** As of 2026-08-31 UTC `gpt-5.6-luna` serves production and the chain is healthy, but the two positions *ahead* of it are still blocked, so there is no funded provider-level redundancy in front of OpenAI. Each item below is an account action; none needs a code change or a deploy, because the chain already tries them in this order and simply falls through:
  - [ ] `GEMINI_API_KEY` returns `429 RESOURCE_EXHAUSTED`. Fix quota/billing on the Google AI project.
  - [ ] OpenRouter `google/gemini-2.5-flash` returns `402 Insufficient credits`. Add OpenRouter credits.
  - [x] OpenAI `gpt-5.6-luna` — **resolved 2026-08-31 UTC.** Access had to be granted on the *project* (`proj_XsPb…`), not only the org; the org grant alone left the 403 in place. Luna now serves all production generation, verified across romance/thriller/fantasy at 1085-1353 words. Note `/v1/models` listed Luna throughout the outage — that endpoint returns the catalogue, not the entitlement, so it cannot be used to probe access.
- [x] **Enforce the chapter word band server-side.** Done. `wordBandFor()` in `_shared/types.ts` is now the single source of truth for the band, read by both the prompt builder and `requireUsableStoryOutput()`. A generation outside `wordBandBounds()` (0.75x floor, 1.25x ceiling) falls through to the next provider like malformed JSON; drift inside the tolerance is logged. The count is taken from `chapter_body`, not the model's self-reported `word_count`. The 2,026-word `gpt-5-mini` chapter that motivated this is a regression test.
- [ ] **Provision a dedicated fallback API key for story generation.** Two separate problems with the key situation today:
  1. **One key does two jobs.** A single `OPENAI_API_KEY` secret serves both `gpt-image-1` cover generation (`_shared/image.ts`) and story text (`_shared/llm.ts`). A spend cap, rate limit, revocation, or key rotation on that one credential takes down covers *and* stories together.
  2. **No funded independent fallback.** Gemini (`429`) and OpenRouter (`402`) are both unavailable, so every position that can currently serve — `gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini` — authenticates with the same shared `OPENAI_API_KEY`. Story generation therefore has exactly one working credential behind it, and that credential is also what `gpt-image-1` covers use.

  Actions:
  - [x] **Code side is done.** `_shared/llm.ts` reads `OPENAI_STORY_API_KEY` ahead of `OPENAI_API_KEY`, and `_shared/image.ts` still reads `OPENAI_API_KEY`. Setting the secret is now the entire change, and leaving it unset preserves current behaviour.
  - [ ] **Set `OPENAI_STORY_API_KEY` in Supabase** to a second OpenAI key so covers and stories stop sharing one credential. This is an account action; no deploy follows it.
  - [ ] Decide whether the independent fallback should also be a different *vendor*. It must not be Claude/Anthropic — see the LLM Fallback Chain note in `AGENTS.md`. A second OpenAI key removes the shared-blast-radius problem but not the single-vendor one; DeepSeek, Mistral or Together would buy real vendor-independence.
  - [ ] If it is a new vendor: add a provider position in `runProviderChain` with its own timeout and `PHASE_END_SHARE` slice, and a `not_configured` path so a missing key falls through rather than erroring.
  - [ ] Either way, keep `openrouter/free` last. It routes to a random free model and has already served a code model for a prose rewrite in production.
- [ ] Add production Expo web origin to `ALLOWED_ORIGINS` before production browser traffic
- [x] Test user created and exercised via the smoke-test harness (`backend/scripts/smoke-series-generation.py`)
- [x] `generate-story` called end-to-end with credit deduction + story insert verified (`smoke-series-generation.py`: 58 assertions across 11 groups)
- [ ] Verify `library` endpoint returns data

<details>
<summary>Completed items</summary>

- [x] Supabase project created: `iafeuxgoiknncgyjmugd` (Seoul ap-northeast-2)
- [x] OpenAI API key set in Supabase secrets
- [x] Project ID filled in `supabase/config.toml`
- [x] Supabase CLI installed (v2.114.0), project linked
- [x] Migrations 00001-00008 applied
- [x] Migration 00009 applied (production series state and hook metadata)
- [x] Migration 00010 applied (series state hardening: named CHECK constraints added NOT VALID, backfill repair, hook_type validation, series_state retention)
- [x] Migration 00011 applied (validates the 00010 CHECK constraints in a separate transaction)
- [x] Migration 00012 applied (restores table GRANTs for anon/authenticated/service_role)
- [x] Migration 00013 applied (drops the premature handle_new_user trigger from 00012)
- [x] Migration 00014 applied (re-applies the 00008 taxonomy columns, which were recorded as applied but never ran)
- [x] Migration 00015 applied (narrows the authenticated UPDATE grant on `stories` to title/topic/cover_image_url/is_public; a table-level grant cannot be narrowed by a column REVOKE)
- [x] Migration 00017 applied (adds `profiles.preferred_genres` for feed personalization)
- [x] Migration 00018 applied (persistent `error_events` telemetry and `error_event_summary`)
- [x] Migration 00019 applied (service-role grants for error telemetry over REST)
- [x] Migration 00020 applied (non-mutating user reference for append-only error telemetry)
- [x] Migration 00021 applied (one summary row per error fingerprint)
- [x] Migration 00022 applied (separate validation for the `error_events.user_id` foreign key)
- [x] Migration 00023 applied (detaches `error_events.user_id` from `profiles` so telemetry cannot block profile deletion)
- [x] Migration 00025 applied (erasure path for the detached identifier: `AFTER DELETE` trigger on `profiles`, on-demand `erase_user_error_telemetry(uuid)`, and `prune_error_event_user_ids(interval)` retention backstop — all service-role only, event rows always preserved)
- [ ] Profile creation on signup — build with the signup flow; `credit_ledger.user_id` references `profiles(id)`, so a profile row must exist before credits can be granted
- [x] **All 12 edge functions deployed** from `main` and the Gemini/OpenRouter generation branch on 2026-08-31 UTC. Verified with production smoke suites: `adapty-webhook`, `audio-status`, `continue-story`, `deduct-credit`, `edit-story`, `feed`, `feedback`, `generate-audio`, `generate-story`, `grant-credit`, `library`, `publish-story`. Five of these had never been deployed at all, which is how the `feed` and `publish-story` defects went unseen.
  - `edit-story` and `publish-story` are called by `expo/src/lib/api.ts`; both verified working end to end by `backend/scripts/smoke-app-surface.py`.
  - `publish-story` also needs the `covers` storage bucket, which **does exist** (created 2026-08-25: public read, 5 MB limit, png/jpeg/webp).
- [x] `generate-story` and `continue-story` redeployed for series state hardening (2026-08-29)
- [x] `generate-story` double-deduct fix
- [x] `_shared/credits.ts` replaced with atomic RPCs (`deduct_credit`, `grant_credit`) using `FOR UPDATE` locking
- [x] `_shared/llm.ts` story chain uses Gemini 3.1 Pro Preview -> OpenRouter Free Router -> `gpt-4o-mini`, with typed provider failures and strict schema output for story JSON
- [x] System prompt loaded from `_shared/prompts.ts`
- [x] `::date` immutability bugs fixed in migrations 00001 and 00003
- [x] Local CORS configured: `ALLOWED_ORIGINS=http://localhost:8090`

</details>

---

## Phase B — Complete Generation Pipeline (IN PROGRESS)

**Goal:** Every generated story gets a cover image + audio narration.

### Cover Image Generation (shipped and deployed; `publish-story` live since 2026-09)

Implementation exists in `_shared/image.ts` and `_shared/cover-prompts.ts`. Full reference: `COVER_IMAGES.md`.

- [x] `generateCoverImage()` in `_shared/image.ts` — **`google/gemini-2.5-flash-image` via OpenRouter, 1024x1536 portrait**. The `gpt-image-1` / 1024x1024 written here was true in August and was superseded twice: the OpenAI credential was revoked 2026-09-08, and the square output was replaced by the 2:3 book-cover format. `COVER_IMAGES.md` is canonical, including the 2026-09-19 rule that HOUSE covers are drawn with the Codex CLI while a reader's own story keeps this provider
- [x] 18 genre-specific prompt configs in `_shared/cover-prompts.ts`
- [x] Dynamic prompt assembly: genre + title + themes + characters (scene/silhouette/portrait)
- [x] Retry logic: 3 attempts with progressive prompt simplification on moderation rejection
- [x] Upload to Supabase Storage bucket `covers/{story_id}/cover.png`
- [x] Centered composition required so center-crop works for all display sizes
- [x] Supabase Storage bucket `covers` created (public read, 5 MB limit, png/jpeg/webp) — verified against the storage API on 2026-08-30

### Audio Narration (English done and deployed; Spanish pending)

- [x] MiniMax Speech 02 HD on RunPod public endpoint (`minimax-speech-02-hd`)
- [x] `generate-audio` edge function with language-aware routing (EN to RunPod)
- [x] `audio-status` edge function: polls RunPod, uploads to Storage, updates chapters
- [x] 2 voices per language: Aria+Kai (EN), Elvira+Alvaro (ES)
- [x] Audio stored at `{story_id}/{chapter_id}/{voice_id}.mp3` in `audio` bucket
- [x] Input validation and ownership check on `generate-audio`
- [x] `_shared/edge-tts.ts` with voice mappings
- [ ] Wire edge-tts synthesis for Spanish (currently returns PENDING_IMPLEMENTATION)
- [x] Compute and store the narration's duration — `chapter_audio.duration_seconds`, derived from the MP3's own frames because the provider returns none. First populated 2026-09-19 (PR #113)
- [x] **A full-length chapter can be narrated at all.** MiniMax refuses >10,000 characters and the median live chapter is 9,112 with a p90 of 13,382, so 133 of 354 published chapters could never be narrated. `_shared/narration-chunks.ts` splits at paragraph then sentence boundaries and `_shared/narration-mp3.ts` stitches the parts under one correct `Info` header, so the file reports its true length and stays seekable
- [ ] Drop the bitrate from 128 kbps. ~1,124 bytes per character is a music bitrate for speech and ~10 MB of a reader's cellular data per chapter. If the RunPod endpoint forwards `audio_setting.bitrate`, this is a `voices` row change with no deploy

### Wire into Publish Flow

`publish-story` edge function exists but async media pipeline not yet wired.

- [ ] Wire `generateCoverImage()` on publish (via Inngest async step)
- [ ] Wire `generate-audio` on publish (via Inngest async step)
- [ ] On image failure: use genre-based gradient fallback (still save story)
- [ ] On audio failure: save story without audio, mark `audio_status: 'failed'`
- [ ] Set up Inngest for async media pipeline

### Storage & CORS

- [x] Created Supabase Storage bucket `audio` (public read, service role upload)
- [x] Supabase Storage bucket `covers` created (public read, service role upload) — verified 2026-08-30
- [ ] Set a size limit on the `audio` bucket (`covers` is capped at 5 MB; `audio` has no limit)
- [ ] Configure Supabase Storage bucket CORS for production media access

---

## Phase C — Monetization Wiring

**Goal:** Real money flows work. RevenueCat webhooks grant credits, deduct chargebacks, and lapse balances on expiry. Rewarded ads and AdMob SSV are removed from the economy — see Phase C2.

### RevenueCat Webhook

Server-side handling is implemented. Dashboard configuration needed.

#### User Setup

- [ ] Create RevenueCat project, configure products (canonical list, prices and grants: `../source-of-truth/CREDITS_AND_PRICING.md` §3 *Store SKUs* — the SKU names are repeated here so the console matches the code map in `_shared/revenuecat.ts`; the prices are not):
  - `ai.katha.sub.weekly`, `ai.katha.sub.monthly`, `ai.katha.sub.yearly` (yearly carries the 3-day trial)
  - `ai.katha.credits.2`, `ai.katha.credits.10`, `ai.katha.credits.50`, `ai.katha.credits.200`, `ai.katha.credits.1000`
  - One entitlement: `katha`
  - *(Updated 2026-09-16. The `reader.*` / `writer.*` families and the `small` / `medium` / `large` packs listed here before, and the 5 / 30 / 100 / 300 packs after them, never reached a store.)*
- [ ] Trial grant is reduced during the 3-day trial; the full grant lands on the first successful charge (amount in the pricing doc §3)
- [ ] Set webhook URL to `{SUPABASE_URL}/functions/v1/revenuecat-webhook`
- [x] Set `REVENUECAT_WEBHOOK_SECRET` as a Supabase secret
- [x] Set `SUBSCRIPTION_GRANT_CRON_SECRET` as a Supabase secret

#### Blocked on the store listing going live

None of the following can be done before the app has a live App Store Connect /
Google Play listing, because RevenueCat products are *mappings* to store products
and the platform SDK keys are only issued once the store apps are linked. Everything
here is dashboard work, not code — the client and webhook are complete and deployed.

- [ ] **Create the 8 store products** in App Store Connect and Google Play Console,
      matching the SKU list above exactly. First-time IAPs are reviewed alongside the
      first app build, so budget for that review cycle. Country pricing is set in the
      console at the same time (USD base, auto-convert, India by hand — pricing doc
      decision 54); no client code converts a price.
- [ ] **Issue the production RevenueCat SDK keys** (`appl_…` for iOS, `goog_…` for
      Android) and paste them into `REVENUECAT_IOS_RELEASE_PUBLIC_KEY` /
      `REVENUECAT_ANDROID_RELEASE_PUBLIC_KEY` in `expo/src/lib/revenuecat.ts`.
      Until then a release build has no billing at all — `activate()` logs an error
      and returns. The Test Store key (`test_…`) simulates purchases and is
      development-only; it can never process a real transaction.
- [ ] **Create the RevenueCat entitlement** `katha` and the offerings the paywall
      reads. *(Was `katha_reader` / `katha_writer` with a `katha_ai_pro` alias until
      the single-plan grid; the code map moved to `katha` on 2026-09-16.)*
- [ ] **Wire the paywall to live RevenueCat package data** — price, renewal terms,
      trial eligibility and offer copy must come from the SDK, not from the
      hardcoded `PAYWALL_PRODUCTS` constant. Cannot be validated until the products
      exist. (Raised in CodeRabbit review of PR #44 and deferred here.)
- [ ] **Schedule `refresh-subscription-grants`** (monthly) with the
      `SUBSCRIPTION_GRANT_CRON_SECRET` in the Authorization header. Annual
      subscribers receive their allowance monthly, and the store emits only one
      `RENEWAL` per year, so without this scheduler annual plans grant once and
      then stop.
- [ ] **Confirm with App Review that voiding purchased pack credits on subscription
      lapse is permitted** (`../source-of-truth/CREDITS_AND_PRICING.md` §12 item 5). Packs are
      consumable IAPs. If it is not permitted, carve packs out of the lapse rule so
      only granted and earned credits expire.
- [ ] **Ship a development build** — RevenueCat uses native modules, so Expo Go
      cannot validate purchases, restores, Paywalls or Customer Center.
      `expo-dev-client` is installed; the commands are in `expo/README.md`.

#### Production Blockers

- [ ] Verify dashboard authorization and exact product IDs against production configuration
- [ ] Sync subscription tier and expiry into profiles
- [x] Implement monthly allocation scheduling for the annual plan before enabling that SKU
- [x] Implement refund clawbacks and backlog reconciliation

<details>
<summary>Completed server handling</summary>

- [x] Exact `Authorization` secret verification, fail-closed when absent
- [x] Fully qualified product ID allowlisting and `customer_user_id` validation
- [x] Purchase, subscription start/renewal, and trial conversion credit events
- [x] Service-only serialized RPCs for credit grants
- [x] Transaction-level deduplication across users and event types
- [x] Unhandled refund events persisted in `payment_event_backlog` (**422** for backlog-eligible validation failures; 503 is reserved for an unconfigured webhook secret)

</details>

### Rewarded-ad credit path — historical/deferred

Rewarded-ad credits were removed from the economy (`../source-of-truth/CREDITS_AND_PRICING.md` §5).
Do not add AdMob packages, config plugins, unit IDs, SSV endpoints, or QA work for
this deleted credit path. The former SSV checklist is retained only in git history.

### Expo App Integration

- [x] Add RevenueCat Purchases and RevenueCatUI under `../expo/`
- [ ] Use an Expo development build to verify RevenueCat purchases on both platforms

---

## Phase C2 — Ads (POST-MVP, not a launch dependency)

**Decision (2026-09-03):** no ads of any kind ship in the MVP. Reading stays free,
unlimited and **uninterrupted** — principle 1 and the §7 "Never block reading" rule in
`../source-of-truth/CREDITS_AND_PRICING.md` stand unchanged.

An earlier draft proposed a house-styled full-screen break between chapters on the free
tier, so that "read without interruptions" could be sold as a paid benefit. **That is
dropped.** It earned nothing (house-styled, no ad network), so it was friction with no
revenue attached, and `../source-of-truth/CREDITS_AND_PRICING.md` §7 already cites the finding that users who
convert to remove friction churn faster than users who convert for positive value.

### The rule that must hold until this phase ships

- [ ] **Do not list "ad-free", "no ads", or "no interruptions" as a paid benefit** on any
      paywall, onboarding screen, or store listing while the free tier has no ads. A
      benefit that removes nothing is a false benefit and a misleading-subscription risk
      at App Review. The Reader plan sells audio, offline and credits until ads exist.

### When this phase does ship

- [ ] Decide the format: third-party ad network (earns revenue, adds an SDK dependency and
      a privacy/ATT surface) vs house-styled house promos (earns nothing — only justifiable
      if the goal is cross-promotion, not monetization).
- [ ] If a third-party network: ATT prompt, consent/GDPR handling, and a privacy-manifest
      update. `expo-tracking-transparency` is already a dependency.
- [ ] Only once ads are live on the free tier, add "read without interruptions" to the
      paid benefit lists and amend principle 1 and the §7 Never list in
      `../source-of-truth/CREDITS_AND_PRICING.md` **in the same commit**, so the canonical doc never
      contradicts itself.
- [ ] Rewarded-ad *credits* stay removed. **The margin argument for this is stale and
      must be re-run before the decision is cited again.** It compared ~$0.006-0.012 of
      rewarded-video revenue per view against $0.0423 of credit cost; the corrected basis
      is $0.0092-$0.0274 (`../source-of-truth/CREDITS_AND_PRICING.md` §2), which at the
      favourable end is no longer clearly a loss. The removal still stands on the grounds
      in `../source-of-truth/CREDITS_AND_PRICING.md` §12 item 7 - no ads of any kind in the
      MVP - but it should not be defended on unit economics until they are recomputed.

---

## Phase D — Social Graph & Engagement

**Goal:** Follow, bookmark, like toggles work server-side. Publishing fires notifications.

### Toggle Endpoints (8 endpoints, 4 pairs)

Each is a simple POST with auth + upsert/delete + count update:

- [ ] `POST /follow-story` / `POST /unfollow-story` — `story_followers` + `stories.follower_count`
- [ ] `POST /follow-user` / `POST /unfollow-user` — `user_followers` + `profiles.follower_count`
- [ ] `POST /bookmark` / `POST /unbookmark` — `bookmarks`
- [ ] `POST /like` / `POST /unlike` — `story_likes` + `stories.like_count`

### Publish Chapter

- [ ] `POST /publish-chapter` — update `chapters.is_published = true`, `published_at = now()`
- [ ] Increment `stories.chapter_count` (avoid double-count)
- [ ] Fire FCM notification to all story followers (requires Phase G; stub until then)

---

## Phase E — Anti-Gaming Pipeline

**Goal:** Creator earnings are fraud-resistant.

### record-read Endpoint

- [ ] `POST /record-read` — receives: `storyId`, `chapterId`, `duration`, `deviceId`, `sessionId`
- [ ] **Self-read guard:** if `userId === story.authorId`, `counts_for_earnings = false`
- [ ] **Min read time:** if `duration < 30s`, reject
- [ ] **Account age throttle:** if account < 48 hours old, `counts_for_earnings = false`
- [ ] **Velocity anomaly detection:** if user has > 50 reads in the last hour, flag for review
- [ ] **Session diversity cap:** max 10 crediting reads from same `deviceId` per day
- [ ] **Per-story daily cap:** max 10 credits earned per story per day
- [ ] **Dedup:** 1 crediting read per `(userId, storyId)` per day — *reader earnings **blocked**, not merely deferred: `reader_earning` is retired under the current economy and may not be reintroduced without amending `../source-of-truth/CREDITS_AND_PRICING.md` first; see `../source-of-truth/CREDITS_AND_PRICING.md` §5*
- [ ] Insert to `story_reads`, increment `stories.read_count` and `stories.unique_reader_count`

### Creator Earnings Curve

> ⛔ **BLOCKED, not scheduled.** `reader_earning` is retired under the current
> economy (`../source-of-truth/CREDITS_AND_PRICING.md` §5). Everything in this
> section — the curve, pending credits, the confirmation cron, and any grant
> carrying reason `reader_earning` — may not be implemented until that file is
> amended to reinstate it. The tables below are retained as the design that
> would be revived, not as work to pick up.

| Reads | Credits per read | Cumulative credits |
|-------|-----------------|-------------------|
| 1-10 | 1 per read | 10 |
| 11-50 | 1 per 5 reads | 18 |
| 51-100 | 1 per 5 reads | 28 |
| 101-500 | 1 per 10 reads | 68 |
| 501-1000 | 1 per 10 reads | 118 |
| 1001+ | 1 per 25 reads | 118+ |

- [ ] Implement as Postgres function or edge function
- [ ] Credits go to `pending_until` (24hr buffer) before confirmation
- [ ] Grant to author's `credit_ledger` with reason `reader_earning` after pending period

### Cron: Confirm Pending Credits

- [ ] Daily cron: move `pending_until < now()` credits from pending to confirmed
- [ ] Velocity anomaly check: flag accounts, claw back if needed

---

## Phase F — Discovery & Feed

**Goal:** Real personalized feeds, search, author profiles, story analytics.

### Feed Endpoints

- [x] `GET /feed` — personalized feed (deployed):
  - New users: curated stories by like count, backfill with public stories
  - Returning users: scored feed (genre affinity +3, followed author +5, trending +2, recency +1, engagement +1)
  - Includes `continue_reading` array, paginated (offset-based)
- [ ] `GET /feed/trending` — weighted engagement (0.4x likes + 0.3x comments + 0.2x shares + 0.1x bookmarks/reads), 30-day window, 7-day half-life decay
- [ ] `GET /feed/rising` — engagement velocity (last 24h / avg prior 7d), min 100 lifetime reads
- [ ] `GET /feed/new` — chronological, last 14 days

### Search

- [ ] `GET /search?q=query` — full-text search
- [x] `pg_trgm` extension enabled, GIN trigram index on `stories.title` (migration 00007)
- [ ] Add `tsvector` indexes on `stories.themes`, `profiles.display_name`
- [ ] Return grouped results: stories, writers, themes, genres
- [ ] Rank by relevance score + engagement boost

### Author Profile

- [ ] `GET /author/:username` — public profile data
- [ ] Return: profile info, published stories (paginated), follower/following counts

### Story Analytics

- [ ] `GET /story/:id/analytics` — author-only
- [ ] Return: daily reads (90-day rolling), chapter breakdown, milestones, credits earned
- [ ] Verify `userId === story.authorId` before returning

---

## Phase G — Push Notifications

**Goal:** Real-time notifications via FCM for both platforms.

### User Setup

- [ ] Create Firebase project
- [ ] Create a Firebase service account for FCM HTTP v1 authentication
- [ ] Set `FIREBASE_SERVICE_ACCOUNT_KEY` as Supabase secret
- [ ] iOS: upload APNs key to Firebase
- [ ] Expo: configure `google-services.json` and `GoogleService-Info.plist` through `../expo/app.json`

### Database

- [ ] Create migration `00016_device_tokens.sql`:

  ```sql
  CREATE TABLE device_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at timestamptz DEFAULT now(),
    UNIQUE(user_id, token)
  );
  ```

- [ ] Enable RLS: authenticated owner-only `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies using `auth.uid() = user_id`

### Endpoints

- [ ] `POST /register-device` — upsert `device_tokens` with FCM token + platform
- [ ] `DELETE /register-device` — remove token (on sign-out)

### FCM Integration

- [ ] Add `_shared/notifications.ts`:
  - `sendPush(userId, title, body, data)` — look up device tokens, send via FCM
  - `sendPushToMany(userIds[], title, body, data)` — batch send
- [ ] Use Firebase Admin SDK (Deno-compatible) or raw FCM HTTP v1 API

### Notification Triggers

- [ ] `publish-chapter` -> notify story followers: "Chapter N is here"
- [ ] `generate-story` (on publish) -> notify author followers: "[Author] published a new story"
- [ ] `feedback` (comment) -> notify story author: "[User] commented on your story"
- [ ] `record-read` (milestone) -> notify author: "'[Story]' hit N reads"
- [ ] `record-read` (credit earned) -> notify author: "+N credits from '[Story]'"

### Cron Jobs

- [ ] **Streak warning** — daily at 8 PM per user's timezone: "Your N-day streak needs saving"
- [ ] **Lapse warning** — 3 days before subscription expiry, stating the exact balance at risk: "Your N credits expire when your plan ends on the Xth" (`../source-of-truth/CREDITS_AND_PRICING.md` §8)
- [ ] **Weekly digest** — Sunday morning: "Katha's picks for [date]"
- [ ] **Streak freeze reset** — 1st of each month: reset `freezesAvailable = 2` for Premium users

---

## Phase H — Seed Library & Final Polish

**Goal:** App has real curated content on launch. All loose ends tied.

### Seed Library

- [ ] Write 30 curated stories across all genres (real prose, 500-1500 words each)
- [ ] Distribution: 22 English, 5 Spanish, 3 Portuguese
- [ ] Engagement tiers: 5 viral (10k-80k reads), 10 solid (500-2k), 15 new (10-200)
- [ ] 3-5 stories as multi-chapter series (2-3 chapters each)
- [ ] Genre-based gradient covers for each
- [ ] Generate audio narration for all 30 stories
- [ ] Insert via seed script or migration

### Referral and feedback credits — shipped 2026-09-16, migration 00089

The design that stood here (`referral-verify`, a device fingerprint, 20 a month,
3 + 1 credits) is superseded by the pricing doc's decisions 51 and 52. What
shipped:

- [x] `referral` edge function (`code`, `claim`) over `claim_referral_code` and `settle_referrals`; code-based, no deep link yet
- [x] Payout only when the invitee has generated once **and** is ≥ 24 h old; caps, amounts and the 7-day claim window are in `../source-of-truth/CREDITS_AND_PRICING.md` §5 *Referral*
- [x] Self-referral is a check constraint and a second claim is blocked by `unique (referred_id)`; tester accounts refused. **No device fingerprint** — the pricing doc's §9 "not building" list forbids it
- [x] `credit-claims` edge function (`list`, `claim`) over `claim_comment_credit`: 1 credit per claimed comment after a qualifying read, capped per story / day / month; `create_feedback` no longer grants
- [ ] v1.1: deferred deep link `katha.ai/i/{code}` resolving the referrer on first launch, with the code field kept as the recovery path (pricing doc §5)

### Remaining Cron Jobs

- [ ] Velocity anomaly check (hourly) — flag accounts with suspicious read patterns
- [ ] Pending credits -> confirmed (daily) — move credits past `pending_until` date
- [ ] Clawback flagged credits (on review)

### Final Integration Testing

- [ ] E2E: sign up -> generate story -> see cover + audio -> publish -> follower notified
- [ ] E2E: purchase credits via RevenueCat -> ledger updated -> generate story
- ~~E2E: watch ad -> SSV verified -> credit granted -> 24hr cooldown enforced~~ — removed with rewarded-ad credits (Phase C2)
- [ ] E2E: follow author -> author publishes -> FCM notification received
- [ ] E2E: read stories for 2 days -> streak credit awarded at the day-2 rung; the five rungs are `streak_ladder()` (pricing doc §5), and a `streak_milestones` row is written per rung
- [ ] E2E: subscription lapses -> credit balance zeroed, library + unlocked audio + free reading all intact
- [ ] E2E: enter invite code -> friend generates -> nothing until 24 h -> both get credits on the next profile fetch
- [ ] E2E: read a story ≥ 120 s -> comment ≥ 40 chars -> Claim in Credits -> 1 credit; comment now uneditable; second claim on the same story refused
- [ ] E2E: search stories -> find by title, theme, author, genre
- [ ] E2E: kids mode ON -> mature content hidden everywhere

---

## PostHog Analytics Plan

> PostHog owns understanding and experimentation. RevenueCat owns money and subscriptions.

### Phase 1: Event Instrumentation

Wire `trackEvent()` calls into every screen.

**Onboarding funnel:**
- [ ] `onboarding_started`, `onboarding_purpose_selected`, `onboarding_name_entered`
- [ ] `onboarding_genres_selected`, `onboarding_refine_answered`, `onboarding_moment_answered`
- [ ] `onboarding_notification_shown`, `onboarding_notification_allowed`
- [ ] `paywall_shown`, `paywall_plan_changed`, `paywall_subscribe_tapped`
- [ ] `paywall_dismissed`, `onboarding_completed`

**Create studio funnel:**
- [ ] `create_started`, `create_genre_selected`, `create_seed_entered`, `create_character_added`
- [ ] `create_generate_tapped`, `create_generation_completed`, `create_generation_failed`
- [ ] `editor_paragraph_selected`, `editor_action_used`, `editor_undo_tapped`
- [ ] `editor_publish_tapped`, `editor_publish_confirmed`, `editor_draft_discarded`

**Reading and engagement:**
- [ ] `story_opened`, `story_read_completed`, `story_liked`, `story_bookmarked`
- [ ] `story_shared`, `audio_play_tapped`, `author_followed`

**Navigation:**
- [ ] `tab_switched`, `profile_opened`, `search_performed`

### Phase 2: Dashboards (PostHog UI, no code)

| Dashboard | Key metrics |
|-----------|------------|
| Onboarding Health | Funnel conversion per step, drop-off by purpose, time to complete |
| Creation Pipeline | Funnel from `create_started` to `editor_publish_confirmed`, failure rate, edits per story |
| Engagement & Retention | DAU/WAU/MAU, D1/D7/D30 retention cohorts |
| Revenue | `paywall_subscribe_tapped` conversion by variant, trial-to-paid, revenue per user |

### Phase 3: Feature Flags & A/B Tests

| Experiment | Flag | Variants | Goal |
|---|---|---|---|
| Paywall entry timing | `paywall-entry-test` | after step 8 vs after step 14 | `paywall_subscribe_tapped` rate |
| Welcome credits | `welcome-credits` | 3, 5, 10 | 7-day retention |
| Home CTA copy | `home-primary-cta` | "Create a story" vs "Start writing" | `create_started` |
| Onboarding length | `onboarding-steps` | full (14) vs short (8) | completion rate |
| Audio gating | `audio-free-tier` | gated vs free | premium conversion |

Remote config via JSON payloads (no RevenueCat overlap):
- [ ] Welcome credit count, max characters, feature gates, home layout

Price testing goes through RevenueCat (it owns store products and localized pricing).

### Phase 4: Surveys

- [ ] Post-first-read NPS (trigger: first `story_read_completed`)
- [ ] Post-first-create feedback (trigger: first `editor_publish_confirmed`)
- [ ] Churn prevention survey (trigger: 7 days inactive)
- [ ] Setup: wrap app in `PostHogSurveyProvider`

### PostHog vs RevenueCat Boundaries

| Concern | Owner |
|---|---|
| Onboarding analytics | PostHog |
| Paywall layout A/B test | RevenueCat Paywalls |
| Paywall strategy (when/where to show) | PostHog experiment |
| Price testing | RevenueCat |
| App remote config | PostHog feature flags |
| Subscription state | RevenueCat (`isPremium` source of truth) |
| User surveys | PostHog |
| Revenue dashboards | Both (RevenueCat for exact revenue, PostHog for revenue x behavior) |

---

## Play Store go-live — one-week push (2026-09-24 → 2026-10-01)

**Goal:** by Thursday 2026-10-01 the Android build is in a Play closed test with every
pre-push item done, so nothing is left except Google's clock. Production access itself
cannot land inside the week: the 12-tester × 14-day closed test runs from the day the
first AAB reaches testers, so **uploading on day 1 or 2 is the whole schedule** — a
test started 2026-09-25 clears 2026-10-09 at the earliest.

Pre-push means "before the first AAB is uploaded"; the binary bakes in the OTA channel,
the runtime version, the Sentry plugin config, any Firebase file, the Android
permission list and the native audio mode, so those cannot be fixed by an update.
Post-push is everything an `expo-updates` release or a console change can carry.

Sources: the founder's launch sheet (2026-09-24, rows P0-MVP and P1 below; its row 28
onwards was cut off in the screenshot and still needs adding) and two read-only audits
the same day — native Android/iOS coverage, and Play policy readiness. The sheet's
wording is kept in the Item column so the two can be ticked together.

### P0 — MVP (must be done before the first AAB, unless marked)

| Item | When | Done | Notes |
|---|---|---|---|
| EAS project + first AAB build | Pre-push, **day 1** | [~] | **Done in code (#138):** `version` is `1.0.0`; a local `./gradlew bundleRelease` compiles (see build-log 2026-09-25). **Founder:** `cd expo && npx eas-cli login && npx eas-cli init` (writes `extra.eas.projectId`; nothing else to edit), then `npx eas-cli build -p android --profile production`. The production profile sets `SENTRY_DISABLE_AUTO_UPLOAD=true` so a missing Sentry token cannot fail the first build; remove it once the Sentry project and `SENTRY_AUTH_TOKEN` exist, or JS stack traces stay unsymbolicated. versionCode auto-increments (`appVersionSource: remote`) |
| OTA updates config | Pre-push, day 1 | [~] | **Done in code (#138):** `channel` on all three profiles (`production` / `preview` / `development`); `runtimeVersion` `{ policy: appVersion }`; `expo/app.config.ts` turns the `UPDATE_PROJECT_ID` placeholder into `https://u.expo.dev/<projectId>` once `eas init` has written the id. **Founder:** only `eas init` above. Check `npx expo config --type public` shows the real URL before the first build |
| Crash reporting (Sentry DSN + wrap) | Pre-push, day 1 | [~] | **Done in code (#138):** `app.config.ts` reads `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` and `APP_ENV` from the build environment; no values invented. **Founder:** create the Sentry project, then `eas env:create` for `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` and the secret `SENTRY_AUTH_TOKEN` (production environment). The production profile sets `SENTRY_DISABLE_AUTO_UPLOAD=true`, so the build works without the token; remove that line once it is set, or stack traces stay unsymbolicated. Backend `SENTRY_DSN` Supabase secret too |
| Firebase / google-services.json | Pre-push, day 1 | [x] | **Removed (#138):** both packages, `src/lib/firebase-analytics.ts` (it had no callers) and every doc reference. Was: | `@react-native-firebase/app` + `/analytics` are dependencies but not in `plugins` and there is no `google-services.json`. **Recommendation: remove both packages.** They also pull in the `AD_ID` permission, which contradicts the Data Safety answer "no device identifiers", and a linked-but-unconfigured RNFB can fail at native init where JS `try/catch` cannot reach. Re-add with the file when push (P1) needs FCM |
| Background audio (audit finding, not on the sheet) | Pre-push, day 1 | [~] | **Done in code (#138):** `configureAudioSession()` (`expo/src/lib/audio-session.ts`) at start-up, `UIBackgroundModes: ["audio"]`. **Left:** the day-7 lock-screen check on a real phone. Was: | No `Audio.setAudioModeAsync` anywhere and no `UIBackgroundModes: ["audio"]`: narration and genre music stop when the phone locks or the user switches app, and iOS silent mode mutes them. Invisible on the :8090 web preview. Set `staysActiveInBackground`, `playsInSilentModeIOS`, `shouldDuckAndroid` at app start |
| Unjustified Android permissions (audit finding) | Pre-push, day 1 | [x] | **Done (#138)**, confirmed on a locally built release AAB's merged manifest (build-log 2026-09-25); `CAMERA` blocked too. Android no longer asks for photo permission before the picker. Was: | The merged manifest carries `RECORD_AUDIO` (expo-av), `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE`, and `AD_ID` (Firebase). None is used. Add `android.blockedPermissions` in `app.json`; confirm against the first build's merged manifest, since the local `expo/android` folder is generated and untracked |
| Decent looking website (katha.thetractionlabs.com) | Pre-push | [~] | **Drafted, founder to merge.** A product landing page (hero, how it works, features, pricing in words, the Originals covers) is up for review on `thetractionlabs-site` branch `katha-legal-v2`, with the legal rewrite below. Merging to that repo's `main` deploys it. The Play listing links it as the developer website |
| Privacy Policy + Terms (Katha's own) | Pre-push | [~] | **Drafted, founder to merge** (`thetractionlabs-site` branch `katha-legal-v2`, same PR as the site). Rewritten for the real stack: 18+, email is required past onboarding, photos to OpenRouter / Gemini (the reference photo is not stored), the OpenRouter training tier, Brave grounding, PostHog EU, Sentry, RevenueCat, published work surviving deletion anonymised. Open: legal entity, governing law, contact address — see the PR |
| Play Console listing | Pre-push, day 2 | [~] | **Drafted, founder to paste** — all in `store/android/` (see its README). Listing copy EN / PT-BR / ES-419 within limits (`check-listing.mjs`), 512 icon and 1024×500 feature graphic per language rendered from HTML, Data Safety answers with code citations (`data-safety.md` — **three decisions first**: OpenRouter training tier makes story text "shared" until turned off, PostHog GeoIP, partial deletion), IARC answers + target audience 18+ + ads none + App access paste text (`content-rating.md`; top up the reviewer account's credits, it earns none). **Still open: the 4–8 phone screenshots** — `screenshot-plan.md` lists the eight to capture after the final UI round |
| 12 testers for 14 days | Pre-push, **start day 2** | [ ] | Google's gate for new personal developer accounts. The two `tester_accounts` rows do not count. Line the twelve up now so the opt-in link goes out the hour the AAB is live |
| Generative AI content reporting | Pre-push | [~] | Shipped 2026-09-16: report sheet from the story page and the reader's ⋮ menu, `content_reports` reasons extended in 00089. The queue view exists since 2026-09-25 (`content_reports_open`, migration 00097, **needs `supabase db push`**); the query and the resolve step are in `backend/MONITORING.md` § *The report queue*. **Open: the founder must name the owner** who works the queue; until then Play's UGC policy (action, not just intake) is not met |
| Block author (audit finding) | Pre-push | [x] | 2026-09-25. Block was already on the story and reader ⋮ sheets; it is now on every comment's ⋮ menu too, confirmed in-sheet, guests asked to sign in (as Report does). A block hides that writer's stories and comments at once, app-wide (`lib/blocks.ts`: Home, Explore, Starred, their profile, open threads), and server-side in `comments`, `feed`, search, `library` (new) and `profile`'s public read (new). Undo: Profile › Blocked accounts, or Unblock on the blocked writer's page. **Needs `library` and `profile` deployed** |
| "Kids mode" wording (audit finding) | Pre-push | [~] | 2026-09-25: the Create switch reads **All-ages** (label and accessibility name), `genres.kids` is All-ages / Todas las edades / Todas as idades, and the "Parental controls / Kids mode and PIN gate" strings are deleted in all three locales. Internal `kids` values unchanged. `audience-copy.test.ts` fails on any visible "Kids" or "PIN". **Open:** the Play listing copy, which is not in this repo, must say All-ages too |
| Generation provider (paid primary) | Pre-push | [ ] | Gemini is quota-blocked (`429`) and the OpenRouter free router is last in the chain. A reviewer whose first story fails is a "broken functionality" rejection. Account action, no code |
| Edge function deploy audit | Pre-push, re-run day 6 | [~] | Last verified 2026-09-21 (production current with main, 37 / 37). Re-run after this week's merges and before the build that goes to review — merged is not deployed |
| Ambient Music while story reading | Pre-push | [~] | Shipped: 24 genre tracks from the `music` bucket, mute-only in the reader. **Profile control built (2026-09-25):** a "Background music" switch on You, writing the same `katha.reader.music-muted.v1` preference as the reader's mute, so each shows what the other set. The background-audio row above covers playback with the phone locked in code (#138); confirm on a device |
| Send OTP from otp@katha, 6-digit code instead of Supabase's 8 | Pre-push | [~] | **Client done** (`codex/onboarding-and-create-polish`): one `OTP_LENGTH = 6` in `expo/src/lib/otp.ts` behind every code path (onboarding code step, Sign in, the reviewer's code); a pasted "123 456" / "123456⏎" verifies on its own, an 8-digit paste is refused with a line saying so, copy says "6-digit code" in EN/ES/PT. **Still the founder's:** the Supabase dashboard OTP length = 6 and the custom SMTP sender. The client refuses 8-digit codes, so flip the setting before this client reaches anyone |
| Refined intro animation | Pre-push | [x] | `codex/onboarding-and-create-polish`: motion on the UI thread (Reanimated 4; no per-frame React render), swipe between slides, 44pt dot targets, copy crossfade, reduced motion honoured. Desktop trap fixed: a phone-width column (`controls.introMaxWidth`) that scrolls when the window is short |
| "More options" moments: cap long text, end with "…" | Pre-push | [x] | `codex/onboarding-and-create-polish`: chips show at most 40 characters, cut at a word, ending "…" (`expo/src/lib/moment-display.ts`); the full moment (up to 300) is still stored and sent. The chip is the only place a moment is echoed back |
| Loading screen consistency | — | [x] | Resolved on the sheet |
| Recheck progress bar during onboarding (bug) | — | [x] | Resolved on the sheet |
| Streak icon and credits always on top, beside profile | — | [x] | Resolved on the sheet |

### P1 — can follow by OTA or a console change

| Item | When | Done | Notes |
|---|---|---|---|
| Seed story library (30 stories) | Post-push, **start now** | [ ] | Thirty stories take longer to write than the review takes; the store does not need them, the first users do |
| In-app feedback form | Post-push, via OTA | [~] | Built 2026-09-25: "Send feedback" on You opens a sheet posting to the new `app-feedback` function and `app_feedback` table (00098). **Not** the old `feedback` function, which posts story comments. 5 per hour / 20 per day per user; retries replay rather than duplicate; rows are erased with the account. Ticks when 00098 and the function are deployed and the client ships. Still needs an owner who reads the table |
| RevenueCat production key | Post-push, but **before production** | [~] | **Code done (PR #142)**: the key is read from the EAS env var `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (no source edit; OTA-deliverable), Android `sub:baseplan` ids are accepted by client and webhook, the paywall carries the Subscriptions-policy copy (price/period, renews automatically, cancel in Google Play, Restore, Manage, Terms, Privacy — EN/PT/ES), and a shipped build with no key disables purchase and says why. **Founder steps remain**: follow [`PLAY_BILLING_SETUP.md`](PLAY_BILLING_SETUP.md) — 8 products, service account (up to 36h to activate), RevenueCat app/entitlement `katha`/offerings `default` + `credit_packs`, RTDN, webhook, the `goog_` key into EAS. Deploy `revenuecat-webhook` and `refresh-subscription-grants` first |
| Push notifications | Post-launch | [ ] | Phase G. Client permission flow and Android channels exist; FCM is not wired. Needs Firebase back (see the Firebase row) |
| Sentry DSN / PostHog tweaks (OTA) | Post-push, via OTA | [ ] | Rotate the DSN after the first public build so the value in the reviewed binary is not the one that stays live |
| "Add Language" button at the bottom of language selection in More options, stored in Supabase | Post-push | [ ] | Needs a column or table for requested languages |
| Feed inspired by Dungeon AI: once a user creates stories, "Your stories" comes first on Home | Post-push | [x] | Already true in code: `buildFeedRows` in `HomeScreen.tsx` puts `yours` first whenever the reader owns a story with a chapter, and `home-feed-rows.test.ts` pins it ("leads with 'Your stories'"). Checked 2026-09-25; nothing to build |
| Ship Dark Mode | Post-push | [ ] | Theme is light by decision today; a dark theme is a token pass plus the `prefers-color-scheme` equivalent on native |
| Add character in the Reimagine flow between chapters … | — | [ ] | Sheet row 28, cut off in the screenshot — complete the description and the rows after it |

### Day plan

| Day | Date | Work |
|---|---|---|
| 1 | Thu 09-24 – Fri 09-25 | One build-config PR: EAS init, OTA, Sentry, remove Firebase, blocked permissions, background audio, version 1.0.0. First AAB |
| 2 | Fri 09-25 | Play Console app, internal track upload, closed test open, invite the twelve. Fund the paid provider |
| 3–4 | Sat 09-26 – Sun 09-27 | Block author, Kids→All-ages, "More options" truncation, OTP sender + 6 digits, intro animation. Store assets (feature graphic, screenshots, PT/ES copy) |
| 5 | Mon 09-28 | Data Safety, content rating, target audience. Katha's own Privacy + Terms; website pass |
| 6 | Tue 09-29 | Deploy what merged; edge deploy audit; new closed-test build |
| 7 | Wed 09-30 – Thu 10-01 | Walk the flow on a real Android device (background audio, lock screen, report, block, OTP; the intro must not scroll on a phone, since its page is `minHeight: window.height` and a non-edge-to-edge Android window can differ from the root view by the status bar; swipe the intro on the slowest phone). Report-queue owner named. RevenueCat products created so the key lands before production |

---


## Post-Launch (Phase I — Growth)

Not in scope for initial launch:

- [ ] Premium voices (multiple voice options per language)
- [ ] A/B test paywall variants via RevenueCat Paywalls
- [ ] Moderation pipeline (flagged content review queue)
- [ ] Social verification (verified share-to-social for credits)
- [ ] Community features (story collections, reading lists)
- [ ] Full offline sync (bidirectional, not just downloads)

<details>
<summary>Already shipped (pre-launch)</summary>

- [x] PostHog analytics integration (SDK installed, live keys wired)
- [x] Sentry crash reporting (SDK installed)
- [ ] ~~Firebase Analytics + Google Ads attribution~~ — removed 2026-09-25, never configured
- [x] i18n infrastructure: EN/ES/PT translations
- [x] EAS Build configuration
- [x] RevenueCat Purchases and RevenueCatUI integration
- [x] expo-notifications + push token
- [x] iOS ATT tracking transparency
- [x] OTA updates via expo-updates

</details>
