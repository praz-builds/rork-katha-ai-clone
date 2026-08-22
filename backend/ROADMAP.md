# Katha AI — Backend Roadmap

> Phased execution plan for wiring the Expo app to real backend services.
> Each phase can be executed independently. Check off items as completed.
> Read `build-log.md` at session start to know current state.

---

## Prerequisites (User Setup — before any phase)

- [x] Create Supabase project → `iafeuxgoiknncgyjmugd` (Seoul region)
- [ ] Get Anthropic API key → `supabase secrets set ANTHROPIC_API_KEY=xxx`
- [ ] Get OpenAI API key → `supabase secrets set OPENAI_API_KEY=xxx`
- [x] Fill project ID in `supabase/config.toml`

---

## Phase A — Foundation ✅ COMPLETE

**Goal:** Fix critical bugs, deploy existing functions, verify schema.

### Bug Fixes
- [x] `generate-story/index.ts:137` — changed `balance: newBalance - 1` to `balance: newBalance`
- [x] `_shared/credits.ts` — replaced with atomic Postgres RPC functions (`deduct_credit`, `grant_credit`) using `FOR UPDATE` locking (migration 00004)
- [x] `_shared/llm.ts` — updated Haiku model ID to `claude-haiku-4-5-20251001`
- [x] `generate-story/index.ts` — system prompt loaded from `_shared/prompts.ts`
- [x] Fixed `::date` immutability bugs in migration 00001 (`idx_ad_rewards_daily`) and 00003 (`idx_story_reads_dedup`) — replaced with `date_trunc('day', ... at time zone 'UTC')`
- [ ] `stories.genre` — verify column is `text` (single-select), not `text[]` (array)

### Deploy
- [x] Supabase CLI installed (v2.114.0 via Homebrew)
- [x] Project linked (`supabase link`)
- [x] All 4 migrations applied (`supabase db push` — 00001 through 00004)
- [x] All 7 edge functions deployed and ACTIVE
- [ ] Set secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (waiting on user)
- [ ] Verify `library` endpoint returns data
- [ ] Verify `deduct-credit` works with the fixed atomic logic
- [ ] Verify `generate-story` produces a story via LLM (text only, no images/audio yet)

### Verification (after API keys are set)
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

### Audio Narration (edge-tts)
- [ ] Add `generateAudioNarration(text, language)` function to `_shared/audio.ts`
- [ ] Default voice: `en-US-JennyNeural`, Rate: `-15%`
- [ ] Language-specific voices for Hindi, Spanish, Japanese, etc.
- [ ] Upload to Supabase Storage bucket `audio/`
- [ ] Compute duration: `file_size_bytes * 8 / 48000` seconds
- [ ] Return public URL + duration; store in `chapters.audio_url`, `chapters.audio_duration`

### Wire into generate-story + continue-story
- [ ] Call `generateCoverImage()` after LLM text generation
- [ ] Call `generateAudioNarration()` after LLM text generation
- [ ] Both calls can run in parallel (Promise.all)
- [ ] On image failure: use genre-based gradient fallback (still save story)
- [ ] On audio failure: save story without audio, mark `audio_status: 'failed'`
- [ ] Return `coverImageUrl` + `audioUrl` + `audioDuration` in response

### Storage Setup
- [ ] Create Supabase Storage bucket `covers` (public read)
- [ ] Create Supabase Storage bucket `audio` (public read)
- [ ] Set appropriate CORS + size limits

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
- [ ] Implement HMAC signature verification in `adapty-webhook/index.ts`
- [ ] Handle events: `subscription_started`, `subscription_renewed`, `subscription_cancelled`, `non_subscription_purchase`
- [ ] On subscription: update `profiles.subscription_tier` + `subscription_expires_at`
- [ ] On purchase: grant credits via `grantCredit()` with reason `purchase`
- [ ] On subscription renewal: grant monthly credits with reason `subscription`

### AdMob SSV (User setup first)
- [ ] User: Create AdMob account and get real app IDs and rewarded-ad unit IDs for the Expo app
- [ ] Implement SSV token verification in `grant-credit/index.ts`:
  - Fetch Google's public keys from `https://www.gstatic.com/admob/reward/verifier-keys.json`
  - Verify ECDSA signature on the SSV callback query params
  - Extract `user_id` and `reward_amount` from verified params
- [ ] Enforce 24hr cooldown per user (existing logic, just needs SSV gate)
- [ ] On verified: grant 1 credit with reason `ad_reward`
- [ ] On failure: return 403 (no credit granted)

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
- [ ] `GET /feed/for-you` — personalized:
  - Score: genre affinity (from read history) + followed author boost + theme overlap + time decay
  - Exclude: blocked users, drafts, own stories
  - Paginated (cursor-based)
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

## Post-Launch (Phase I — Growth)

Not in scope for initial launch, but documented for future:

- [ ] Premium voices (multiple voice options beyond JennyNeural)
- [ ] Hindi UI translation (localization files exist, values empty)
- [ ] Social verification (verified share-to-social for credits)
- [ ] Community features (story collections, reading lists)
- [ ] Full offline sync (not just downloads — bidirectional)
- [ ] PostHog analytics integration
- [ ] A/B test paywall variants via Adapty
- [ ] Moderation pipeline (flagged content review queue)
