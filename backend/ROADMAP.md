# Katha AI — Backend Roadmap

<!-- markdownlint-disable MD013 -->

> Phased execution plan for wiring the Expo app to real backend services.
> Each phase can be executed independently. Check off items as completed.
> Read `build-log.md` at session start to know current state.

---

## Prerequisites (User Setup — before any phase)

- [x] Create Supabase project → `iafeuxgoiknncgyjmugd` (Seoul region)
- [ ] Get Anthropic API key → `supabase secrets set ANTHROPIC_API_KEY=xxx`
- [x] Get OpenAI API key → `supabase secrets set OPENAI_API_KEY=xxx`
- [x] Fill project ID in `supabase/config.toml`

---

## Phase A — Foundation Baseline Deployed

**Goal:** Fix critical bugs, deploy existing functions, verify schema.

### Bug Fixes

- [x] `generate-story/index.ts:137` — changed `balance: newBalance - 1` to `balance: newBalance`
- [x] `_shared/credits.ts` — replaced with atomic Postgres RPC functions (`deduct_credit`, `grant_credit`) using `FOR UPDATE` locking (migration 00004)
- [x] `_shared/llm.ts` — updated Haiku model ID to `claude-haiku-4-5-20251001`
- [x] `generate-story/index.ts` — system prompt loaded from `_shared/prompts.ts`
- [x] Fixed `::date` immutability bugs in migration 00001 (`idx_ad_rewards_daily`) and 00003 (`idx_story_reads_dedup`) — replaced with `date_trunc('day', ... at time zone 'UTC')`

### Deploy

- [x] Supabase CLI installed (v2.114.0 via Homebrew)
- [x] Project linked (`supabase link`)
- [x] All 4 migrations applied (`supabase db push` — 00001 through 00004)
- [x] All 7 edge functions deployed and ACTIVE
- [x] Hardened migrations applied (`supabase db push` — 00005 through 00007)
- [x] Hardened Edge Functions deployed and ACTIVE

### Pending Verification and Configuration

- [ ] Resolve the `stories.genre` contract: the deployed baseline is `text[]`, while the locked product decision is single-select
- [ ] Set secret: `ANTHROPIC_API_KEY` (waiting on user)
- [x] Set secret: `OPENAI_API_KEY`
- [x] Set local browser CORS secret: `ALLOWED_ORIGINS=http://localhost:8090`
- [ ] Add exact production Expo web origin to `ALLOWED_ORIGINS` before production browser traffic
- [ ] Verify `library` endpoint returns data
- [ ] Confirm disabled `deduct-credit` returns 403 and trusted generation deducts through service-only RPCs
- [ ] Verify `generate-story` produces a story via LLM (text only, no images/audio yet)
- [ ] Create a test user via Supabase Auth dashboard
- [ ] Manually call `generate-story` with curl and verify credit deduction + story insert
- [ ] Confirm `credit_ledger` has correct `balance_after` values

---

## Phase B — Complete Generation Pipeline

**Goal:** Every generated story gets a cover image + audio narration.

### Cover Image Generation (DALL-E 3)

- [ ] Add `generateCoverImage(title, genre, themes, language)` function to `_shared/image.ts`
- [ ] Prompt template: "3D CGI animated film style" (NEVER "Pixar" — hard block)
- [ ] Retry logic: up to 3 attempts, simplify scene description on moderation rejection
- [ ] Strip "AI", "generated", "artificial intelligence" from image metadata
- [ ] Upload generated image to Supabase Storage bucket `covers/`
- [ ] Return public URL; store in `stories.cover_image_url`

### Audio Narration (DONE -- 2026-08-25)

- [x] RunPod serverless endpoint `katha-tts` deployed with VibeVoice 1.5B (ADA_24 GPU, scale-to-zero)
- [x] `generate-audio` edge function with language-aware routing (EN to RunPod, ES to edge-tts)
- [x] `audio-status` edge function: polls RunPod, uploads to Storage, updates chapters
- [x] 2 voices per language: Aria+Kai (EN), Elvira+Alvaro (ES)
- [x] Audio stored at `{story_id}/{chapter_id}/{voice_id}.mp3` in `audio` bucket
- [x] Input validation and ownership check on generate-audio
- [x] `_shared/edge-tts.ts` with voice mappings (synthesis pending implementation)
- [ ] Wire edge-tts synthesis for Spanish (currently returns PENDING_IMPLEMENTATION)
- [ ] Compute and store `chapters.audio_duration`

### Wire into publish flow

- [ ] Call `generateCoverImage()` on publish (via Inngest async step)
- [x] Call `generate-audio` on publish (via Inngest async step -- endpoint ready)
- [ ] On image failure: use genre-based gradient fallback (still save story)
- [ ] On audio failure: save story without audio, mark `audio_status: 'failed'`

### Storage Setup

- [ ] Create Supabase Storage bucket `covers` (public read)
- [x] Created Supabase Storage bucket `audio` (public read, service role upload)
- [ ] Set appropriate CORS + size limits
- [ ] Configure Supabase Storage bucket CORS for production media access
- [ ] Configure Edge Function CORS via the `ALLOWED_ORIGINS` Supabase secret with the exact production web origin; local `http://localhost:8090` is already configured

---

## Phase C — Monetization Wiring

**Goal:** Real money flows work. Adapty webhooks grant credits, AdMob SSV verifies ad watches.

### Adapty Webhook (User setup first)

- [ ] User: Create Adapty account, configure products:
  - `ai.katha.subscription.monthly` — $6.99/mo, 20 credits
  - `ai.katha.subscription.yearly` — $49.99/yr, 25 credits/mo
  - `ai.katha.credits.starter` — $2.99, 3 credits
  - `ai.katha.credits.value` — $7.99, 10 credits
  - `ai.katha.credits.power` — $14.99, 25 credits
- [ ] User: Set webhook URL to `{SUPABASE_URL}/functions/v1/adapty-webhook`
- [ ] User: Get `ADAPTY_WEBHOOK_SECRET`, set as Supabase secret

#### Implemented Server Handling

- [x] Verify the exact configured `Authorization` value and fail closed when the secret is absent
- [x] Allowlist fully qualified product IDs and validate `customer_user_id`
- [x] Handle purchase, subscription start/renewal, and trial conversion credit events
- [x] Grant purchase/subscription credits through service-only serialized RPCs
- [x] Deduplicate provider transactions across users and event types
- [x] Persist unhandled refund events in `payment_event_backlog` and return 503

#### Production Blockers

- [ ] Verify dashboard authorization and exact product IDs against production configuration
- [ ] Sync subscription tier and expiry into profiles
- [ ] Implement monthly allocation scheduling for the annual plan before enabling that SKU
- [ ] Implement refund clawbacks and backlog reconciliation

### AdMob SSV (User setup first)

- [ ] Keep rewarded-ad credit grants disabled until every item in this section is complete
- [ ] User: Create AdMob account and get real app IDs and rewarded-ad unit IDs for the Expo app
- [ ] Generate a one-time claim nonce on the server and bind it to the authenticated user before showing the ad
- [ ] Configure AdMob `custom_data` with the opaque claim nonce; never send or trust an app-supplied `user_id` or SSV token as proof
- [ ] Add a dedicated public AdMob SSV callback endpoint that receives Google's signed callback directly:
  - Fetch Google's public keys from `https://www.gstatic.com/admob/reward/verifier-keys.json`
  - Verify ECDSA signature on the SSV callback query params
  - Resolve the authenticated user only from the verified, server-issued claim nonce
- [ ] Persist AdMob `transaction_id` with a global uniqueness constraint for replay protection
- [ ] Enforce the rolling 24-hour cooldown and credit grant in one database transaction
- [ ] On verified: grant 1 credit with reason `ad_reward`
- [ ] On invalid signature, unknown/used nonce, replay, or cooldown: reject without granting credit

### Expo App Integration

- [ ] Add Expo-compatible Adapty and AdMob packages under `../expo/`
- [ ] Configure their Expo config plugins in `../expo/app.json`, including the iOS and Android app IDs
- [ ] Wire Adapty public SDK keys and AdMob rewarded-ad unit IDs into the Expo runtime configuration
- [ ] Use an Expo development build to verify purchases and rewarded ads on both platforms
- [ ] Keep generated iOS `Info.plist` and Android `AndroidManifest.xml` changes reproducible through Expo config plugins

---

## Phase D — Social Graph & Engagement

**Goal:** Follow, bookmark, like toggles work server-side. Publishing fires notifications.

### Toggle Endpoints (6 pairs)

Each is a simple POST with auth + upsert/delete + count update:

- [ ] `POST /follow-story` — insert to `story_followers`, increment `stories.follower_count`
- [ ] `POST /unfollow-story` — delete from `story_followers`, decrement count
- [ ] `POST /follow-user` — insert to `user_followers`, increment `profiles.follower_count`
- [ ] `POST /unfollow-user` — delete from `user_followers`, decrement count
- [ ] `POST /bookmark` — insert to `bookmarks`
- [ ] `POST /unbookmark` — delete from `bookmarks`
- [ ] `POST /like` — insert to `story_likes`, increment `stories.like_count`
- [ ] `POST /unlike` — delete from `story_likes`, decrement count

### Publish Chapter

- [ ] `POST /publish-chapter` — update `chapters.is_published = true`, `published_at = now()`
- [ ] Increment `stories.chapter_count` (avoid double-count)
- [ ] Fire FCM notification to all story followers (requires Phase G; stub with TODO until then)

---

## Phase E — Anti-Gaming Pipeline

**Goal:** Creator earnings are fraud-resistant. This is the most complex endpoint.

### record-read Endpoint

- [ ] `POST /record-read` — receives: `storyId`, `chapterId`, `duration` (seconds), `deviceId`, `sessionId`
- [ ] **Self-read guard:** if `userId === story.authorId`, mark `counts_for_earnings = false`
- [ ] **Min read time:** if `duration < 30`, reject (too fast to have read)
- [ ] **Account age throttle:** if `profiles.account_created_at` < 48 hours ago, `counts_for_earnings = false`
- [ ] **Velocity anomaly detection:** if user has > 50 reads in the last hour, flag for review
- [ ] **Session diversity cap:** max 10 crediting reads from same `deviceId` per day
- [ ] **Per-story daily cap:** max 10 credits earned per story per day
- [ ] **Dedup:** 1 crediting read per `(userId, storyId)` per day
- [ ] Insert to `story_reads` with all fields populated
- [ ] Increment `stories.read_count` and `stories.unique_reader_count` (if first read from this user)

### Creator Earnings Curve

- [ ] Implement the front-loaded curve as a Postgres function or in the edge function:
  - Reads 1-10: 1 credit per read
  - Reads 11-50: 1 credit per 5 reads
  - Reads 51-100: 1 credit per 5 reads
  - Reads 101-500: 1 credit per 10 reads
  - Reads 501-1000: 1 credit per 10 reads
  - Reads 1001+: 1 credit per 25 reads
- [ ] Credits go to `pending_until` (24hr buffer) before confirmation
- [ ] Grant to author's `credit_ledger` with reason `reader_earning` after pending period

### Cron: Confirm Pending Credits

- [ ] Daily cron: move `pending_until < now()` credits from pending to confirmed
- [ ] Cron: velocity anomaly check (flag accounts, claw back if needed)

---

## Phase F — Discovery & Feed

**Goal:** Real personalized feeds, search, author profiles, story analytics.

### Feed Endpoints

- [x] `GET /feed` — personalized (deployed in PR #8):
  - New users: curated stories by like count, backfill with public stories
  - Returning users: scored feed (genre affinity +3, followed author +5, trending +2, recency +1, engagement +1)
  - Includes `continue_reading` array
  - Paginated (offset-based)
- [ ] `GET /feed/for-you` — enhanced personalized (future iteration):
- [ ] `GET /feed/trending` — weighted engagement:
  - Score: `0.4×likes + 0.3×comments + 0.2×shares + 0.1×(bookmarks/reads)`
  - 30-day window, 7-day half-life time decay
- [ ] `GET /feed/rising` — engagement velocity:
  - Score: `engagement_last_24h / avg_daily_engagement_prior_7d`
  - Filter: only stories with > 100 lifetime reads
- [ ] `GET /feed/new` — chronological:
  - Last 14 days, sorted by `created_at` DESC

### Search

- [ ] `GET /search?q=query` — full-text search
- [ ] Enable `pg_trgm` and `tsvector` extensions
- [ ] Create GIN indexes on `stories.title`, `stories.themes`, `profiles.display_name`
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
- [ ] Expo: configure Android `google-services.json` and iOS `GoogleService-Info.plist` through `../expo/app.json`

### Database

- [ ] Create migration `00006_device_tokens.sql` (`00005_secure_credit_operations.sql` reserves migration number 00005):

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

- [ ] Enable RLS with authenticated owner-only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policies using `auth.uid() = user_id`; the full policy set allows authenticated upserts to read and update their conflict target without exposing another user's tokens

### Endpoints

- [ ] `POST /register-device` — upsert `device_tokens` with FCM token + platform
- [ ] `DELETE /register-device` — remove token (on sign-out)

### FCM Integration

- [ ] Add `_shared/notifications.ts` utility:
  - `sendPush(userId, title, body, data)` — looks up user's device tokens, sends via FCM
  - `sendPushToMany(userIds[], title, body, data)` — batch send
- [ ] Use Firebase Admin SDK (Deno-compatible) or raw FCM HTTP v1 API

### Notification Triggers

Wire into existing endpoints:

- [ ] `publish-chapter` → notify story followers: "Chapter N is here 📖"
- [ ] `generate-story` (on publish) → notify author followers: "[Author] published a new story ✨"
- [ ] `feedback` (comment) → notify story author: "[User] commented on your story"
- [ ] `record-read` (milestone) → notify author: "'[Story]' hit N reads 🎉"
- [ ] `record-read` (credit earned) → notify author: "+N credits from '[Story]'"

### Cron Jobs

- [ ] **Streak warning** — daily at 8 PM per user's timezone: "Your N-day streak needs saving"
- [ ] **Weekly digest** — Sunday morning: "Katha's picks for [date]"
- [ ] **Streak freeze reset** — 1st of each month: reset `freezesAvailable = 2` for Premium users

---

## Phase H — Seed Library & Final Polish

**Goal:** App has real curated content on launch. All loose ends tied.

### Seed Library

- [ ] Write 30 curated stories across all genres (real prose, 500-1500 words each)
- [ ] Distribution: 22 English, 5 Hindi, 2 Spanish, 1 Japanese
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
- [ ] Pending credits → confirmed (daily) — move credits past pending_until date
- [ ] Clawback flagged credits (on review)

### Final Integration Testing

- [ ] E2E: sign up → generate story → see cover + audio → publish → follower notified
- [ ] E2E: purchase credits via Adapty → ledger updated → generate story
- [ ] E2E: watch ad → SSV verified → credit granted → 24hr cooldown enforced
- [ ] E2E: follow author → author publishes → FCM notification received
- [ ] E2E: read stories for 3 days → streak credit awarded
- [ ] E2E: refer friend → friend generates → both get credits
- [ ] E2E: search stories → find by title, theme, author, genre
- [ ] E2E: kids mode ON → mature content hidden everywhere

---

## PostHog Analytics Plan

> PostHog owns understanding and experimentation. Adapty owns money and subscriptions.
> PostHog decides the journey; Adapty decides the paywall. Both measure together.

### Phase 1: Event Instrumentation

Wire `trackEvent()` calls into every screen. No dashboard setup needed yet.

**Onboarding funnel:**
- [ ] `onboarding_started`, `onboarding_purpose_selected` (purpose), `onboarding_name_entered`
- [ ] `onboarding_genres_selected` (genres, count), `onboarding_refine_answered`, `onboarding_moment_answered`
- [ ] `onboarding_notification_shown`, `onboarding_notification_allowed` (granted)
- [ ] `paywall_shown` (placement, plan), `paywall_plan_changed`, `paywall_subscribe_tapped` (plan, trial)
- [ ] `paywall_dismissed`, `onboarding_completed` (purpose, subscribed)

**Create studio funnel:**
- [ ] `create_started`, `create_genre_selected`, `create_seed_entered`, `create_character_added`
- [ ] `create_generate_tapped`, `create_generation_completed` (duration_ms, word_count), `create_generation_failed`
- [ ] `editor_paragraph_selected`, `editor_action_used` (action), `editor_undo_tapped`
- [ ] `editor_publish_tapped`, `editor_publish_confirmed`, `editor_draft_discarded`

**Reading and engagement:**
- [ ] `story_opened` (story_id, genre, source), `story_read_completed` (duration_seconds)
- [ ] `story_liked`, `story_bookmarked`, `story_shared`, `audio_play_tapped`, `author_followed`

**Navigation:**
- [ ] `tab_switched` (tab), `profile_opened`, `search_performed` (query, results_count)

### Phase 2: Dashboards (PostHog UI, no code)

Create these in the PostHog dashboard after events are flowing.

**Dashboard 1 -- Onboarding Health:**
- Funnel: `onboarding_started` -> `onboarding_purpose_selected` -> `onboarding_genres_selected` -> `onboarding_notification_allowed` -> `paywall_shown` -> `onboarding_completed`
- Conversion per step, drop-off by purpose, time to complete

**Dashboard 2 -- Creation Pipeline:**
- Funnel: `create_started` -> `create_generate_tapped` -> `create_generation_completed` -> `editor_action_used` -> `editor_publish_confirmed`
- AI edit action breakdown, generation failure rate, edits per story

**Dashboard 3 -- Engagement and Retention:**
- DAU/WAU/MAU, `story_opened` and `editor_publish_confirmed` per user, D1/D7/D30 retention cohorts

**Dashboard 4 -- Revenue:**
- `paywall_subscribe_tapped` conversion by variant, trial to paid conversion, revenue per user
- Track `subscription_started` (from Adapty webhook event forwarded to PostHog) for accurate revenue

### Phase 3: Feature Flags and A/B Tests

| Experiment | Flag | Variants | Goal |
|---|---|---|---|
| Paywall entry timing | `paywall-entry-test` | after step 8 vs after step 14 | `paywall_subscribe_tapped` rate |
| Welcome credits | `welcome-credits` | 3, 5, 10 | 7-day retention |
| Home CTA copy | `home-primary-cta` | "Create a story" vs "Start writing" | create_started |
| Onboarding length | `onboarding-steps` | full (14) vs short (8) | completion rate |
| Audio gating | `audio-free-tier` | gated vs free | premium conversion |

Remote config via JSON payloads (no Adapty overlap):
- [ ] Welcome credit count, max characters, feature gates, home layout

Price testing goes through Adapty (it owns store products and localized pricing). PostHog flags control app behavior and non-purchase experiments only.

> All file paths below are relative to `expo/`.

### Phase 4: Surveys

- [ ] Post-first-read NPS (trigger: first `story_read_completed`)
- [ ] Post-first-create feedback (trigger: first `editor_publish_confirmed`)
- [ ] Churn prevention survey (trigger: 7 days inactive)
- [ ] Setup: wrap app in `PostHogSurveyProvider`

### PostHog vs Adapty Boundaries

| Concern | Owner |
|---|---|
| Onboarding analytics | PostHog only (Adapty has no visibility) |
| Paywall layout A/B test | Adapty Flow Builder (owns receipts) |
| Paywall strategy A/B test (when/where to show) | PostHog experiment |
| Price testing | Adapty (only it can serve localized prices) |
| App remote config | PostHog feature flags (JSON payloads) |
| Subscription state | Adapty (`isPremium` is source of truth) |
| User surveys | PostHog only |
| Revenue dashboards | Both (Adapty for exact revenue, PostHog for revenue x behavior) |

---

## Post-Launch (Phase I -- Growth)

Not in scope for initial launch, but documented for future:

- [ ] Premium voices (multiple voice options beyond JennyNeural)
- [ ] Hindi UI translation (localization files exist, values empty)
- [ ] Social verification (verified share-to-social for credits)
- [ ] Community features (story collections, reading lists)
- [ ] Full offline sync (not just downloads -- bidirectional)
- [x] PostHog analytics integration (SDK installed, live keys wired)
- [x] Sentry crash reporting (SDK installed, `src/lib/analytics.ts`)
- [x] Firebase Analytics + Google Ads attribution (`src/lib/firebase-analytics.ts`)
- [x] i18n infrastructure: EN/ES/PT translations (`src/i18n/`)
- [x] EAS Build configuration (`eas.json`)
- [x] Adapty SDK v4 with live keys (`src/lib/adapty.ts`)
- [x] expo-notifications + push token (`src/lib/notifications.ts`)
- [x] iOS ATT tracking transparency (`src/lib/tracking-transparency.ts`)
- [x] OTA updates via expo-updates
- [ ] A/B test paywall variants via Adapty Flow Builder
- [ ] Moderation pipeline (flagged content review queue)
