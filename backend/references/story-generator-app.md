# Story Generator App — Product & Architecture Blueprint

<!-- markdownlint-disable MD013 -->

> Historical baseline material for the original AI story generator plan.
> The active client is the Expo app in `../../expo/`; the Swift and Kotlin clients are preserved references.
> Current requirements in `../CLAUDE.md` and `../references/strategic-decisions.md` override this blueprint where they differ.
> Image and audio sections describe planned Phase B architecture; the current generation runtime returns text only.

---

## 1. Product Vision

A mobile-first AI story generator where users create personalized stories on demand. Stories are generated with cover art and optional audio narration. The app includes a curated free library for discovery and retention, with credits as the monetization currency.

This is a **separate product** from Story For My Kid (storyformykid.com). Different brand, different app, broader audience (not kids-only). The website continues independently.

### Competitive Reference: Okudu AI

| Metric | Okudu |
| -------- | ------- |
| Revenue | ~$30K/mo (Android alone) |
| Downloads | 84K total, ~200/day |
| Launched | Dec 2024 |
| Model | Free reads + credit-gated generation |
| Pricing | ~$7/mo or ~$68/yr (INR equivalent) |
| Credit cost | 2 credits ~ $2 USD |

Key Okudu patterns we're adopting:

- Everything free to read. Credits only for generation.
- 1 credit = 1 generation (short story or chapter).
- Free credits via ads, streaks, feedback, referrals, social posts.
- Subscription = bulk credits + premium perks.
- Ultra-light onboarding (1 question, no paywall upfront).
- Cover image generated with each story (bundled into credit cost).

---

## 2. Tech Stack & Ownership Split

### Two Workstreams

The app is built across two environments with clear boundaries:

```text
+-----------------------------------------------------------+
|                        RORK                                |
|  (Mobile app — UI, navigation, screens, native features)  |
|                                                            |
|  - All screens & components (React Native)                 |
|  - Bottom tab navigation                                   |
|  - Supabase Auth (Google/Apple sign-in)                    |
|  - Adapty SDK (subscriptions, credit packs, paywalls)      |
|  - AdMob SDK (rewarded video ads)                          |
|  - Push notifications (Expo/OneSignal)                     |
|  - Offline caching & local storage                         |
|  - Audio player UI                                         |
|  - Dark mode / reading themes                              |
+-----------------------------------------------------------+
          |                    |                    |
          | REST/RPC           | Webhooks           | SDK
          v                    v                    v
+------------------+  +----------------+  +----------------+
|   SUPABASE       |  |  VS CODE       |  |  ADAPTY        |
|   (Database +    |  |  AGENT         |  |  (Billing +    |
|    Auth +        |  |  (Backend      |  |   Credits)     |
|    Storage)      |  |   logic)       |  +----------------+
+------------------+  +----------------+
                      |
                      |  What VS Code agent builds:
                      |
                      |  - Supabase Edge Functions (Deno/TS)
                      |    - POST /generate-story (orchestrator)
                      |    - POST /continue-story (next chapter)
                      |    - POST /grant-credit (server-side ad verify)
                      |    - POST /deduct-credit (pre-generation check)
                      |    - GET  /library (curated story feed)
                      |    - POST /feedback (comments/ratings)
                      |    - Adapty webhook handler (subscription events)
                      |
                      |  - Story generation pipeline
                      |    - LLM call (Anthropic SDK — Sonnet/Haiku)
                      |    - Image generation (DALL-E / Flux)
                      |    - Audio narration (edge-tts)
                      |
                      |  - Database schema & migrations
                      |  - RLS policies
                      |  - Storage bucket config
                      |  - Credit ledger logic
                      |  - Streak/reward calculation
                      +--------------------------------------
```

### Clear Rule: Who Builds What

| Component | Owner | Why |
| ----------- | ------- | ----- |
| Screens, navigation, UI components | **Rork** | It's a UI builder — this is what it does |
| Supabase Auth setup (Google/Apple providers) | **Rork** | Rork has Supabase integration |
| Adapty SDK init, paywall UI, purchase flow | **Rork** | Native SDK, must be in the app |
| AdMob rewarded video integration | **Rork** | Native SDK, must be in the app |
| Push notification setup | **Rork** | Native capability |
| Audio player component | **Rork** | UI component |
| Edge Functions (all backend logic) | **VS Code agent** | Server-side code, needs testing, version control |
| Story generation pipeline | **VS Code agent** | Complex orchestration, API keys, error handling |
| Database schema, migrations, RLS | **VS Code agent** | SQL, needs review and migration tracking |
| Credit ledger (grant/deduct/balance) | **VS Code agent** | Business-critical logic, must be server-side |
| Adapty webhook handler | **VS Code agent** | Server-side webhook processing |
| AdMob server-side reward verification | **VS Code agent** | Security-critical — never trust client for credits |

### Rule of Thumb
>
> If it touches money, credits, or API keys — **VS Code agent**.
> If it's a screen the user sees or taps — **Rork**.
> If it's both — Rork calls an Edge Function that VS Code agent built.

---

## 3. App Structure

### Bottom Navigation (5 tabs)

```text
Home  |  Discover  |  Create  |  Library  |  Settings
```

### Screen Map

```text
Onboarding (first launch only)
  └── "What brings you here?" (single question, 4-5 options)
  └── "Start exploring" → Home

Home
  ├── "Your stories" (generated stories, empty state CTA)
  ├── "Trending" (popular from library)
  └── "Continue reading" (in-progress stories)

Discover
  ├── Search bar + filter chips (genre, length, mood)
  ├── Genre sections (horizontal scroll cards)
  └── Story cards → Story Detail

Create (center tab, prominent)
  ├── Step 1: Genre picker (chips, multi-select)
  ├── Step 2: Topic (free text + "Get ideas" helper)
  ├── Step 3: Characters (name, description, traits)
  ├── Step 4: Length (Short / Standard / Long)
  ├── Step 5: Review → "Generate (1 credit)"
  └── Generation screen (loading animation → result)

Story Detail / Reader
  ├── Cover image (hero)
  ├── Story text (scrollable, not paginated — stories are short)
  ├── Audio player (play/pause, speed, sleep timer)
  ├── Chapter list (for multi-chapter stories)
  └── Actions: Save, Share, Comment, Rate

Library
  ├── Saved stories
  ├── Generated stories (history)
  ├── Reading history
  └── Downloads (offline)

Settings
  ├── Profile (avatar, username)
  ├── Premium (subscription paywall)
  ├── Credits (balance + "Get credits" screen)
  ├── Your journey (streak calendar)
  ├── Reading preferences (theme, font size)
  ├── Audiobook voice selection
  ├── Notifications
  ├── App theme (light/dark/auto)
  ├── Feedback / Rate app
  ├── FAQ, Privacy, Terms
  └── Sign out / Delete account
```

---

## 4. Monetization Architecture

### Credit System (managed by Adapty + Supabase)

**1 credit = 1 text generation** (story or chapter). Cover images and audio narration are planned pipeline additions, not current runtime output.

Adapty handles IAP/subscription billing. Supabase holds the credit ledger (source of truth).

```text
User purchases credits (Adapty)
    → Adapty webhook fires
    → Edge Function validates receipt
    → Supabase credits table updated
    → App polls balance or gets push update

User taps "Generate"
    → App calls /generate-story with a stable request_id
    → Edge Function authenticates and looks up that request_id
    → Existing request: reuses its operation without another deduction
    → New request: reserves the operation and deducts 1 credit atomically
    → Edge Function runs the generation pipeline
    → Returns story text
```

The current Expo client does not call `/continue-story`; that client flow is planned. When added, it must use the same authenticated, stable-`request_id`, replay-safe deduction contract.

### Pricing Tiers

| Offering | Price | Credits | Notes |
| ---------- | ------- | --------- | ------- |
| Starter Pack | $2.99 | 3 credits | One-time IAP, impulse buy |
| Value Pack | $7.99 | 10 credits | One-time IAP |
| Power Pack | $14.99 | 25 credits | One-time IAP |
| Monthly Sub | $6.99/mo | 20 credits/mo + ad-free + premium voices | Recurring |
| Yearly Sub | $49.99/yr | 25 credits/mo + ad-free + premium voices | Recurring, best value |

Subscription credits carry over up to 2x monthly amount (e.g., 20/mo sub → max 40 banked).

### Free Credit Earning Methods

| Method | Reward | Cooldown | Purpose |
| -------- | -------- | ---------- | --------- |
| **Watch ad** (rewarded video, planned and disabled) | 1 credit | 1 per rolling 24 hours | Daily engagement |
| **Reading streak** | 1 credit | Every 3 consecutive days | Retention |
| **Leave feedback** (comment on a story) | 1 credit | 1 per story | Community + content |
| **Referral** (friend installs + generates) | 3 credits | Per unique referral | Acquisition |
| **Social post** (TikTok/Instagram mention) | 1 credit | Per verified post | Organic marketing |

---

## 5. Rewarded Ads — Integration Plan

> **Current status:** Disabled. Client callbacks cannot grant credits. Activation requires verified AdMob SSV, replay protection, and atomic cooldown/grant handling to be deployed.

### How It Works

```text
User taps "Watch ad for 1 credit" on the Credits screen
    → Authenticated app asks the server for a one-time claim nonce
    → Server binds the opaque nonce to that authenticated user
    → App requests a rewarded ad from AdMob SDK
    → App passes only the opaque nonce as AdMob custom_data
    → AdMob serves a 15-30 second full-screen video
    → User MUST watch to completion (no skip)
    → AdMob sends its signed SSV callback directly to the server
    → Server verifies the signature and resolves the user from the bound nonce
    → Server atomically records globally unique transaction_id, enforces the
      rolling 24-hour cooldown, and grants 1 credit
    → If signature, nonce, transaction, or cooldown is invalid: rejects
```

### Technical Setup

**In Rork (app side):**

- Library: `react-native-google-mobile-ads`
- Create AdMob account at admob.google.com
- Register iOS + Android app IDs
- Create "Rewarded" ad unit (one per platform)
- Preload ad on Credits screen mount
- Show ad on button tap
- Treat the local reward callback as UI feedback only; it never proves credit eligibility
- Request the server-issued claim nonce before presenting the ad

**In VS Code agent (backend side):**

- Dedicated public endpoint receives AdMob's signed SSV callback directly
- Verify the callback signature with Google's published verification keys
- Resolve the user from a one-time server-generated claim nonce in `custom_data`; never trust callback or app-supplied `user_id`
- Persist AdMob `transaction_id` with global uniqueness to reject replay
- Consume the nonce, enforce the rolling 24-hour cooldown, and grant the credit atomically
- Keep `POST /grant-credit` disabled until this complete flow is deployed

**CRITICAL: Never trust the client.** Always verify server-side. People WILL try to fake the reward callback.

### Ad Revenue Economics (Why It's Not About Ad Money)

| Market | eCPM (per 1000 views) | Revenue per view |
| -------- | ---------------------- | ------------------ |
| US/UK/AU | $10-30 | $0.01-0.03 |
| India/SEA | $2-8 | $0.002-0.008 |
| Global avg | $8-15 | $0.008-0.015 |

**Cost per generation:** $0.03-0.14 (LLM $0.02-0.10 + image $0.01-0.04)

**Per ad-funded generation, you LOSE $0.02-0.11.**

### Why Do It Anyway?

Ads are NOT the profit center. They are a **conversion funnel**:

```text
Free user watches ad → gets 1 credit → generates a story → loves it
    → comes back tomorrow for another ad credit → daily habit forms
        → 1 credit/day isn't enough ("I want 3 stories tonight")
            → buys credit pack or subscribes
                → NOW you're profitable
```

**The real math:**

| Segment | Monthly value |
| --------- | --------------- |
| Free user (ad only) | -$0.60 to -$3.30 loss (subsidized) |
| Paying user (sub) | +$3.00 to +$8.50 profit |
| Typical free→paid conversion | 3-8% |
| Breakeven requires | ~$5-15 ARPU across all users |

At 1000 DAU with 5% conversion:

- 950 free users cost: ~$60-100/month
- 50 paying users earn: ~$150-425/month
- Net: **profitable at modest scale**

The ad credit exists to create **daily habit → conversion pressure → subscription**.

---

## 6. Database Schema (Supabase)

VS Code agent builds and manages all migrations.

```sql
-- Core tables

create table profiles (
    id uuid primary key references auth.users(id),
    username text unique,
    avatar_url text,
    onboarding_purpose text, -- authoring, casual, kids, language, other
    created_at timestamptz default now()
);

create table credit_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id),
    amount integer not null, -- positive = credit, negative = debit
    reason text not null, -- 'purchase', 'subscription', 'ad_reward', 'streak', 'feedback', 'referral', 'social', 'generation'
    reference_id text, -- Adapty transaction ID, story ID, etc.
    balance_after integer not null, -- running balance
    created_at timestamptz default now()
);

create table stories (
    id uuid primary key default gen_random_uuid(),
    author_id uuid references profiles(id),
    title text not null,
    genre text[] not null,
    topic text,
    cover_image_url text,
    is_public boolean default false, -- visible in Discover
    is_curated boolean default false, -- part of seed library
    length_type text check (length_type in ('mini', 'short', 'standard', 'long')),
    word_count integer,
    status text default 'draft' check (status in ('draft', 'generating', 'complete', 'failed')),
    created_at timestamptz default now()
);

create table chapters (
    id uuid primary key default gen_random_uuid(),
    story_id uuid references stories(id) on delete cascade,
    chapter_number integer not null,
    title text,
    content text not null,
    word_count integer,
    audio_url text,
    created_at timestamptz default now(),
    unique(story_id, chapter_number)
);

create table characters (
    id uuid primary key default gen_random_uuid(),
    story_id uuid references stories(id) on delete cascade,
    name text not null,
    description text,
    background text,
    appearance text,
    is_hero boolean default false
);

create table comments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id),
    story_id uuid references stories(id) on delete cascade,
    chapter_id uuid references chapters(id),
    content text not null,
    created_at timestamptz default now()
);

create table streaks (
    user_id uuid primary key references profiles(id),
    current_streak integer default 0,
    longest_streak integer default 0,
    last_activity_date date,
    next_credit_at integer default 3, -- days until next credit
    updated_at timestamptz default now()
);

create table ad_rewards (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id),
    claimed_at timestamptz default now(),
    verification_token text
);

-- The verified reward transaction locks the user, rejects any successful
-- claim within the preceding 24 hours, then inserts the claim atomically.
create index idx_ad_rewards_user_claimed
    on ad_rewards(user_id, claimed_at desc);

create table referrals (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid references profiles(id),
    referred_id uuid references profiles(id),
    credited boolean default false,
    created_at timestamptz default now()
);

-- Indexes
create index idx_credit_ledger_user on credit_ledger(user_id, created_at desc);
create index idx_stories_author on stories(author_id, created_at desc);
create index idx_stories_public on stories(is_public, created_at desc) where is_public = true;
create index idx_chapters_story on chapters(story_id, chapter_number);
create index idx_comments_story on comments(story_id, created_at desc);
```

---

## 7. Generation Pipeline (Edge Function)

VS Code agent builds this as a Supabase Edge Function.

```text
POST /generate-story
    ├── Auth check (JWT from Supabase Auth)
    ├── Credit check (balance >= 1)
    ├── Deduct 1 credit (atomic, write to ledger)
    ├── Create story record (status: 'generating')
    │
    ├── [Parallel]
    │   ├── LLM call (Anthropic SDK)
    │   │   ├── Primary: claude-sonnet-4-6 (timeout: 60s)
    │   │   ├── Fallback: claude-haiku-4-5 (timeout: 30s)
    │   │   └── Fallback: gpt-4o-mini (timeout: 30s)
    │   │
    │   └── Cover image (after story title is known)
    │       ├── Primary: DALL-E 3 or Flux
    │       └── Upload to Supabase Storage
    │
    ├── Audio narration (edge-tts, after story text is ready)
    │   └── Upload to Supabase Storage
    │
    ├── Update story record (status: 'complete')
    └── Return { story, chapters, cover_url, audio_url }
```

**Fallback:** If generation fails after credit deduction, refund the credit automatically and return error.

---

## 8. Build Order (Phased Rollout)

### Phase 1 — Read-Only App (Week 1-2)

**Goal:** App in stores with free library. No generation yet.

| Task | Owner |
| ------ | ------- |
| App shell, bottom nav, screen stubs | Rork |
| Supabase project setup, schema migration | VS Code |
| Seed library (curated stories) loaded into DB | VS Code |
| Home screen (trending, library feed) | Rork |
| Discover screen (browse, search, filter) | Rork |
| Story detail / reader screen | Rork |
| Audio player component | Rork |
| Supabase Auth (Google + Apple sign-in) | Rork + VS Code (provider config) |
| Sign-in wall (gate reading after preview) | Rork |
| Library screen (saved, history) | Rork |
| Settings screen (profile, preferences) | Rork |
| Edge Function: GET /library (paginated feed) | VS Code |

### Phase 2 — Generation + Credits (Week 3-4)

**Goal:** Users can generate stories with credits.

| Task | Owner |
| ------ | ------- |
| Create flow (4-step wizard UI) | Rork |
| Edge Function: POST /generate-story | VS Code |
| Edge Function: credit deduct/check/balance | VS Code |
| Credit balance display in app | Rork |
| Credits screen UI (balance + earning methods) | Rork |
| Generation loading/result screen | Rork |
| Give every new user 2 free credits (welcome bonus) | VS Code |
| "Continue story" (generate next chapter) | VS Code |

### Phase 3 — Monetization (Week 5-6)

**Goal:** Revenue flows.

| Task | Owner |
| ------ | ------- |
| Adapty SDK integration | Rork |
| Subscription paywall screen | Rork |
| Credit pack purchase flow | Rork |
| Adapty webhook handler (Edge Function) | VS Code |
| AdMob rewarded video integration | Rork |
| Edge Function: POST /grant-credit (SSV verify) | VS Code |
| 24hr ad cooldown logic | VS Code |
| Premium badge / ad-free flag | Rork + VS Code |

### Phase 4 — Engagement Loops (Week 7-8)

**Goal:** Retention and organic growth.

| Task | Owner |
| ------ | ------- |
| Streak system (UI calendar + logic) | Rork + VS Code |
| Push notifications (daily reminder, streak warning) | Rork |
| Comments/feedback on stories | Rork + VS Code |
| Feedback credit reward | VS Code |
| Referral system (deep links + credit grant) | Rork + VS Code |
| Social share (TikTok/Instagram verification) | VS Code |
| App Store rating prompt (after 3rd generation) | Rork |

### Phase 5 — Growth & Polish (Week 9+)

**Goal:** Optimize conversion and expand.

| Task | Owner |
| ------ | ------- |
| Onboarding A/B testing | Rork + analytics |
| Paywall A/B testing (pricing, copy) | Adapty remote config |
| Premium audiobook voices (Google Cloud TTS) | VS Code |
| Offline mode (download stories) | Rork |
| Community features (publish your story publicly) | Rork + VS Code |
| Multiple character profiles | Rork + VS Code |
| Language support (multi-language generation) | VS Code |
| Reading level adaptation | VS Code |

---

## 9. Key Architectural Decisions

### Why Supabase Edge Functions (not Cloudflare Workers)?

- Supabase is already the DB — edge functions have direct DB access with zero latency
- Auth JWT verification is built-in
- Storage access is native
- One platform for auth + DB + storage + functions = simpler ops
- If edge function cold starts become a problem, move generation to a dedicated worker

### Why Adapty (not RevenueCat)?

- Adapty has native **credit/coin system** support (promotional offers, grant credits server-side)
- Paywall A/B testing built-in (critical for conversion optimization)
- Webhook-first architecture plays well with Edge Functions
- Comparable pricing to RevenueCat

### Why AdMob (not Unity Ads)?

- Largest ad network = best fill rate from day 1
- Rewarded video eCPM is competitive
- Server-side verification (SSV) is robust
- Can add mediation (Unity, AppLovin, Meta) later for better eCPM

### Credit Ledger Pattern

- **Append-only ledger** — never update, only insert new rows
- Every credit change is a row: amount (+1 or -1), reason, reference, balance_after
- Balance = last row's balance_after (indexed query)
- Full audit trail for disputes, debugging, analytics
- Atomic deduction: `INSERT INTO credit_ledger ... WHERE balance_after >= 0`

---

## 10. Metrics to Track (PostHog / Adapty)

### North Star

- **Weekly active generators** (users who generated at least 1 story)

### Funnel

1. Install → Onboarding complete (target: 85%+)
2. Onboarding → First read (target: 60%+)
3. First read → Sign-in (target: 40%+)
4. Sign-in → First generation (target: 30%+)
5. First generation → Second generation (target: 50%+)
6. Active free user → Paid conversion (target: 5-8%)

### Engagement

- DAU/MAU ratio (target: 25%+)
- Average stories generated per user per week
- Reading streak length distribution
- Ad credit claim rate (% of DAU who watch daily ad)
- Credit balance at time of purchase (understand urgency trigger)

### Revenue

- ARPU (all users) — target: $1-3/mo
- ARPPU (paying users) — target: $7-12/mo
- LTV:CAC ratio — target: 3:1+
- Trial → paid conversion (if using trial)
- Subscription churn (target: <10%/mo)

---

## 11. What We Reuse from Story For My Kid

| Asset | How It's Reused |
| ------- | ---------------- |
| Anthropic SDK integration patterns | Same LLM calling code, adapted for edge functions |
| Story generation prompt engineering | Base prompts refined from 51 published stories |
| edge-tts narration pipeline | Same voice, same SSML chunking logic |
| Supabase operational knowledge | Same platform, new project |
| Content taxonomy (genres, age bands) | Starting genre list |
| 51 curated stories | Seed library content (re-formatted for new schema) |
| Image generation learnings | Moderation workarounds, style prompt patterns |
| Stripe webhook patterns | Adapty webhook handler follows same async patterns |

---

## Appendix: Okudu Feature Reference

Captured from app walkthrough (Aug 2026):

- **Onboarding:** 1 question ("What brings you to Okudu?"), 5 options, single tap
- **Home:** Your stories + Trending feed
- **Create:** 4 steps (genre → topic → characters → review), paginated dots
- **Character creation:** Name, Description, Background, Appearance (detailed)
- **Discover:** Search + filters (language, proficiency, genre, age, writing status), genre sections
- **Reader:** Paginated (Page X of Y), chapter list via pull-up sheet, reader tip tooltip
- **Auth gate:** Mid-read sign-in wall ("Sign in to continue reading for free"), Google/Apple/Facebook/Email, skip option
- **Comments:** Per-chapter, with Reply/Report, multi-language community
- **Settings:** Premium, Credits, Journey, Language & reading level, Parental controls, Audiobook voices, Notifications, Theme, social links, Feedback
- **Premium paywall:** Reader/Creator toggle, 30 credits/mo, premium voices, ad-free, unlimited editing. Yearly (discounted) + Monthly pricing. "Unused credits carry over, up to 2x"
- **Credits screen:** Balance display, 5 earning methods (Streak, Ad, Feedback, Invite, Social post), cooldown timers
- **Content types:** Mini, Short, Novelette, Novel — multi-chapter support
- **Community:** User-generated stories visible in Discover, by-author attribution
