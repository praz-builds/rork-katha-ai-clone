# Katha AI — Backend Roadmap

<!-- markdownlint-disable MD013 -->

> Phased execution plan for wiring the Expo app to real backend services.
> Each phase can be executed independently. Check off items as completed.
> Read `build-log.md` at session start to know current state.

---

## Phase A — Foundation (DONE)

**Goal:** Fix critical bugs, deploy existing functions, verify schema.

All bug fixes applied, 10 migrations (00001-00010) applied to the linked project, 10 edge functions deployed and ACTIVE.

### Remaining Verification

- [ ] Set secret: `ANTHROPIC_API_KEY` (waiting on user)
- [ ] Add production Expo web origin to `ALLOWED_ORIGINS` before production browser traffic
- [ ] Create a test user via Supabase Auth dashboard
- [ ] Manually call `generate-story` with curl and verify credit deduction + story insert
- [ ] Verify `library` endpoint returns data

<details>
<summary>Completed items</summary>

- [x] Supabase project created: `iafeuxgoiknncgyjmugd` (Seoul ap-northeast-2)
- [x] OpenAI API key set in Supabase secrets
- [x] Project ID filled in `supabase/config.toml`
- [x] Supabase CLI installed (v2.114.0), project linked
- [x] Migrations 00001-00008 applied
- [x] Migration 00009 applied (production series state and hook metadata)
- [x] Migration 00010 applied (series state hardening: named CHECK constraints, backfill repair, hook_type validation, series_state retention)
- [x] 10 edge functions deployed and ACTIVE
- [x] `generate-story` and `continue-story` redeployed for series state hardening (2026-08-29)
- [x] `generate-story` double-deduct fix
- [x] `_shared/credits.ts` replaced with atomic RPCs (`deduct_credit`, `grant_credit`) using `FOR UPDATE` locking
- [x] `_shared/llm.ts` Haiku model ID updated to `claude-haiku-4-5-20251001`
- [x] System prompt loaded from `_shared/prompts.ts`
- [x] `::date` immutability bugs fixed in migrations 00001 and 00003
- [x] Local CORS configured: `ALLOWED_ORIGINS=http://localhost:8090`

</details>

---

## Phase B — Complete Generation Pipeline (IN PROGRESS)

**Goal:** Every generated story gets a cover image + audio narration.

### Cover Image Generation (code done, storage pending)

Implementation exists in `_shared/image.ts` and `_shared/cover-prompts.ts`. Full reference: `COVER_IMAGES.md`.

- [x] `generateCoverImage()` in `_shared/image.ts` (gpt-image-1, 1024x1024 square PNG)
- [x] 18 genre-specific prompt configs in `_shared/cover-prompts.ts`
- [x] Dynamic prompt assembly: genre + title + themes + characters (scene/silhouette/portrait)
- [x] Retry logic: 3 attempts with progressive prompt simplification on moderation rejection
- [x] Upload to Supabase Storage bucket `covers/{story_id}/cover.png`
- [x] Centered composition required so center-crop works for all display sizes
- [ ] **Create Supabase Storage bucket `covers`** (public read, service role upload)

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
- [ ] Create Supabase Storage bucket `covers` (public read, service role upload)
- [ ] Set appropriate size limits on both buckets
- [ ] Configure Supabase Storage bucket CORS for production media access

---

## Phase C — Monetization Wiring

**Goal:** Real money flows work. Adapty webhooks grant credits, AdMob SSV verifies ad watches.

### Adapty Webhook

Server-side handling is implemented. Dashboard configuration needed.

#### User Setup

- [ ] Create Adapty account, configure products:
  - `ai.katha.subscription.monthly` — $6.99/mo, 20 credits
  - `ai.katha.subscription.yearly` — $49.99/yr, 25 credits/mo
  - `ai.katha.credits.starter` — $2.99, 3 credits
  - `ai.katha.credits.value` — $7.99, 10 credits
  - `ai.katha.credits.power` — $14.99, 25 credits
- [ ] Set webhook URL to `{SUPABASE_URL}/functions/v1/adapty-webhook`
- [x] `ADAPTY_WEBHOOK_SECRET` set as Supabase secret

#### Production Blockers

- [ ] Verify dashboard authorization and exact product IDs against production configuration
- [ ] Sync subscription tier and expiry into profiles
- [ ] Implement monthly allocation scheduling for the annual plan before enabling that SKU
- [ ] Implement refund clawbacks and backlog reconciliation

<details>
<summary>Completed server handling</summary>

- [x] Exact `Authorization` secret verification, fail-closed when absent
- [x] Fully qualified product ID allowlisting and `customer_user_id` validation
- [x] Purchase, subscription start/renewal, and trial conversion credit events
- [x] Service-only serialized RPCs for credit grants
- [x] Transaction-level deduplication across users and event types
- [x] Unhandled refund events persisted in `payment_event_backlog` (503 response)

</details>

### AdMob SSV

Rewarded-ad credits remain disabled until every item below is complete.

- [ ] User: Create AdMob account and get real app IDs and rewarded-ad unit IDs
- [ ] Generate a one-time claim nonce on the server, bind to authenticated user before showing the ad
- [ ] Configure AdMob `custom_data` with the opaque claim nonce; never trust app-supplied `user_id`
- [ ] Add dedicated public AdMob SSV callback endpoint:
  - Fetch Google's public keys from `https://www.gstatic.com/admob/reward/verifier-keys.json`
  - Verify ECDSA signature on the SSV callback query params
  - Resolve user only from the verified, server-issued claim nonce
- [ ] Persist AdMob `transaction_id` with a global uniqueness constraint for replay protection
- [ ] Enforce rolling 24-hour cooldown and credit grant in one database transaction
- [ ] On verified: grant 1 credit with reason `ad_reward`
- [ ] On invalid signature, unknown/used nonce, replay, or cooldown: reject without granting

### Expo App Integration

- [x] Add Expo-compatible Adapty package under `../expo/` (SDK v4, live keys in `src/lib/adapty.ts`)
- [ ] Add AdMob package under `../expo/`
- [ ] Configure Expo config plugins in `../expo/app.json` (iOS and Android app IDs)
- [ ] Wire AdMob rewarded-ad unit IDs into Expo runtime config
- [ ] Use an Expo development build to verify purchases and rewarded ads on both platforms

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
- [ ] **Dedup:** 1 crediting read per `(userId, storyId)` per day
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

- [ ] Create migration `00011_device_tokens.sql`:

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
- [ ] E2E: purchase credits via Adapty -> ledger updated -> generate story
- [ ] E2E: watch ad -> SSV verified -> credit granted -> 24hr cooldown enforced
- [ ] E2E: follow author -> author publishes -> FCM notification received
- [ ] E2E: read stories for 3 days -> streak credit awarded
- [ ] E2E: refer friend -> friend generates -> both get credits
- [ ] E2E: search stories -> find by title, theme, author, genre
- [ ] E2E: kids mode ON -> mature content hidden everywhere

---

## PostHog Analytics Plan

> PostHog owns understanding and experimentation. Adapty owns money and subscriptions.

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

Remote config via JSON payloads (no Adapty overlap):
- [ ] Welcome credit count, max characters, feature gates, home layout

Price testing goes through Adapty (it owns store products and localized pricing).

### Phase 4: Surveys

- [ ] Post-first-read NPS (trigger: first `story_read_completed`)
- [ ] Post-first-create feedback (trigger: first `editor_publish_confirmed`)
- [ ] Churn prevention survey (trigger: 7 days inactive)
- [ ] Setup: wrap app in `PostHogSurveyProvider`

### PostHog vs Adapty Boundaries

| Concern | Owner |
|---|---|
| Onboarding analytics | PostHog |
| Paywall layout A/B test | Adapty Flow Builder |
| Paywall strategy (when/where to show) | PostHog experiment |
| Price testing | Adapty |
| App remote config | PostHog feature flags |
| Subscription state | Adapty (`isPremium` source of truth) |
| User surveys | PostHog |
| Revenue dashboards | Both (Adapty for exact revenue, PostHog for revenue x behavior) |

---

## Post-Launch (Phase I — Growth)

Not in scope for initial launch:

- [ ] Premium voices (multiple voice options per language)
- [ ] A/B test paywall variants via Adapty Flow Builder
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
- [x] Adapty SDK v4 with live keys
- [x] expo-notifications + push token
- [x] iOS ATT tracking transparency
- [x] OTA updates via expo-updates

</details>
