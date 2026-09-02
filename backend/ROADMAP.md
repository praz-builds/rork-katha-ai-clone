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
- [ ] **Enforce the chapter word band server-side.** `500-1500` (standalone) and `600-900` (series chapter) are stated in the prompt and nothing checks them before persistence. While `gpt-5-mini` was serving, one chapter came back at 2026 words — 35% over the ceiling — and was stored and charged for. Over-length chapters distort reading-time estimates, TTS cost, and the reader UI. Either validate `word_count` in `requireUsableStoryOutput` and fall through to the next provider, or clamp at persistence. Not reproducing under `gpt-5.6-luna`, so this is latent rather than live.
- [ ] **Provision a dedicated fallback API key for story generation.** Two separate problems with the key situation today:
  1. **One key does two jobs.** A single `OPENAI_API_KEY` secret serves both DALL·E 3 cover generation (`_shared/image.ts`) and story text (`_shared/llm.ts`). A spend cap, rate limit, revocation, or key rotation on that one credential takes down covers *and* stories together.
  2. **No funded independent fallback.** Gemini (`429`) and OpenRouter (`402`) are both unavailable, so every position that can currently serve — `gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini` — authenticates with the same shared `OPENAI_API_KEY`. Story generation therefore has exactly one working credential behind it, and that credential is also what DALL·E covers use.

  Actions:
  - [ ] Decide the provider for the independent fallback. It must not be Claude/Anthropic — see the LLM Fallback Chain note in `AGENTS.md`. A second OpenAI project key is the least work; a genuinely different vendor (DeepSeek, Mistral, Together) buys real vendor-independence and is worth more here.
  - [ ] If it is another OpenAI key: add it as a new secret (e.g. `OPENAI_STORY_API_KEY`), read it in `_shared/llm.ts` ahead of `OPENAI_API_KEY`, and leave `_shared/image.ts` on the original so covers and stories stop sharing a blast radius.
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

### Cover Image Generation (code and storage done; `publish-story` not deployed)

Implementation exists in `_shared/image.ts` and `_shared/cover-prompts.ts`. Full reference: `COVER_IMAGES.md`.

- [x] `generateCoverImage()` in `_shared/image.ts` (gpt-image-1, 1024x1024 square PNG)
- [x] 18 genre-specific prompt configs in `_shared/cover-prompts.ts`
- [x] Dynamic prompt assembly: genre + title + themes + characters (scene/silhouette/portrait)
- [x] Retry logic: 3 attempts with progressive prompt simplification on moderation rejection
- [x] Upload to Supabase Storage bucket `covers/{story_id}/cover.png`
- [x] Centered composition required so center-crop works for all display sizes
- [x] Supabase Storage bucket `covers` created (public read, 5 MB limit, png/jpeg/webp) — verified against the storage API on 2026-08-30

### Audio Narration (English done, Spanish pending)

- [x] MiniMax Speech 02 HD on RunPod public endpoint (`minimax-speech-02-hd`)
- [x] `generate-audio` edge function with language-aware routing (EN to RunPod)
- [x] `audio-status` edge function: polls RunPod, uploads to Storage, updates chapters
- [x] 2 voices per language: Aria+Kai (EN), Elvira+Alvaro (ES)
- [x] Audio stored at `{story_id}/{chapter_id}/{voice_id}.mp3` in `audio` bucket
- [x] Input validation and ownership check on `generate-audio`
- [x] `_shared/edge-tts.ts` with voice mappings
- [ ] Wire edge-tts synthesis for Spanish (currently returns PENDING_IMPLEMENTATION)
- [ ] Compute and store `chapters.audio_duration`

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

**Goal:** Real money flows work. RevenueCat webhooks grant credits, AdMob SSV verifies ad watches.

### RevenueCat Webhook

Server-side handling is implemented. Dashboard configuration needed.

#### User Setup

- [ ] Create RevenueCat project, configure products (canonical list: `CREDITS_AND_PRICING.md` §3):
  - `ai.katha.sub.reader.weekly` — $4.99, 5 credits
  - `ai.katha.sub.reader.monthly` — $8.99, 20 credits/mo
  - `ai.katha.sub.reader.yearly` — $29.99, 20 credits/mo, 3-day trial
  - `ai.katha.sub.reader.yearly.offer` — $19.99 first year, then $29.99 (one-time offer)
  - `ai.katha.sub.writer.weekly` — $6.99, 10 credits
  - `ai.katha.sub.writer.monthly` — $12.99, 50 credits/mo
  - `ai.katha.sub.writer.yearly` — $49.99, 50 credits/mo, 3-day trial
  - `ai.katha.credits.small` — $4.99, 10 credits
  - `ai.katha.credits.medium` — $14.99, 40 credits
  - `ai.katha.credits.large` — $29.99, 90 credits
- [ ] Trial grants are reduced: 15 credits (Writer) / 5 (Reader) during the 3-day trial; full grant on first successful charge
- [ ] Set webhook URL to `{SUPABASE_URL}/functions/v1/revenuecat-webhook`
- [ ] Set `REVENUECAT_WEBHOOK_SECRET` as a Supabase secret

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
- [x] Unhandled refund events persisted in `payment_event_backlog` (503 response)

</details>

### Rewarded-ad credit path — historical/deferred

Rewarded-ad credits were removed from the economy (`CREDITS_AND_PRICING.md` §5).
Do not add AdMob packages, config plugins, unit IDs, SSV endpoints, or QA work for
this deleted credit path. The former SSV checklist is retained only in git history.

### Expo App Integration

- [x] Add RevenueCat Purchases and RevenueCatUI under `../expo/`
- [ ] Use an Expo development build to verify RevenueCat purchases on both platforms

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
- [ ] **Dedup:** 1 crediting read per `(userId, storyId)` per day — *reader earnings deferred to v1.2; see `CREDITS_AND_PRICING.md` §5*
- [ ] Insert to `story_reads`, increment `stories.read_count` and `stories.unique_reader_count`

### Creator Earnings Curve

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
- [ ] **Lapse warning** — 3 days before subscription expiry, stating the exact balance at risk: "Your N credits expire when your plan ends on the Xth" (`CREDITS_AND_PRICING.md` §8)
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

### Referral Verification

- [ ] `POST /referral-verify` — validate referral claim
- [ ] Same-device check (device fingerprint)
- [ ] Self-referral prevention
- [ ] Rate limit: max 20 successful referrals per user per month
- [ ] On verified first-generation: grant 3 credits to referrer + 1 bonus to referred

### Remaining Cron Jobs

- [ ] Velocity anomaly check (hourly) — flag accounts with suspicious read patterns
- [ ] Pending credits -> confirmed (daily) — move credits past `pending_until` date
- [ ] Clawback flagged credits (on review)

### Final Integration Testing

- [ ] E2E: sign up -> generate story -> see cover + audio -> publish -> follower notified
- [ ] E2E: purchase credits via RevenueCat -> ledger updated -> generate story
- [ ] E2E: watch ad -> SSV verified -> credit granted -> 24hr cooldown enforced
- [ ] E2E: follow author -> author publishes -> FCM notification received
- [ ] E2E: read stories for 2 days -> streak credit awarded (milestones: day 2, 5, 7, then every 7)
- [ ] E2E: subscription lapses -> credit balance zeroed, library + unlocked audio + free reading all intact
- [ ] E2E: refer friend -> friend generates -> both get credits
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
- [x] Firebase Analytics + Google Ads attribution
- [x] i18n infrastructure: EN/ES/PT translations
- [x] EAS Build configuration
- [x] RevenueCat Purchases and RevenueCatUI integration
- [x] expo-notifications + push token
- [x] iOS ATT tracking transparency
- [x] OTA updates via expo-updates

</details>
