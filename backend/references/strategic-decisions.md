# Katha AI — Strategic Decisions & Growth Loops

<!-- markdownlint-disable MD013 -->

> Companion document to the Story Generator App Blueprint.
> Captures product/strategy decisions locked in during the Rork build-planning session.
> **This document extends the Blueprint — it does not replace it.** Where this doc and the Blueprint conflict, this doc wins (it is newer and more specific).
>
> Purpose: give the VS Code backend agent the same context Rork has, so the app and the backend implement the same mental model of loops, credits, and safeguards.
>
> **⚠ SUPERSEDED IN PART.** Everything in this document about credit prices, plan
> prices, grants, earning amounts, subscription tiers, or carry-over is obsolete.
> `../../source-of-truth/CREDITS_AND_PRICING.md` at the repository root is the source of truth for all
> of it. The sections below that survive are the *mechanisms* — anti-gaming,
> growth loops, schema deltas, content model — not the numbers.

---

## 0. Executive summary (read this first)

1. **App is called Katha AI — Create Stories.** Separate product from Story For My Kid. Broader audience: adults 20-40, casual readers + aspiring writers. Kids get their own gated mode.
2. **One visible currency: Credits.** Users see one balance. Backend tracks provenance via the existing `reason` column on `credit_ledger` so we can separate paid, subsidized, and earned credits at analytics time.
3. **Every story starts as a Short Story.** Any story can grow into a Series when the author writes more chapters. **Only the author can continue their own story.** Readers follow stories or authors to get notified when new chapters drop.
4. **Categorization is one required Genre + LLM-generated free-form theme tags.** No mood tags, no hardcoded theme taxonomy.
5. **Creators earn credits when their published stories get read.** Front-loaded curve so the second story feels genuinely earned. Full anti-gaming pipeline required — this is the highest-abuse surface in the app.
6. **Bookmarks, search, follow-author, follow-story are all first-class.** These are retention primitives, not nice-to-haves.
7. **CTA phrasing is "Write yours"**, placed strategically across every reading surface, because story creation is the monetization event.
8. **UI in English + Hindi at launch. Story generation in 15 languages** (India-focused, Hindi in the language list, no other Indian languages in v1).

---

## 1. Product identity

| Attribute | Decision |
| --- | --- |
| Name | **Katha AI — Create Stories** |
| Positioning | AI-powered mobile-first story platform. Read curated + community stories free. Create your own with credits. |
| Primary audience | Adults 20-40, casual readers + aspiring writers. Not kids-first (kids-mode is a gated subset). |
| Emotional promise | *"Any story you can imagine, spun into a real one in under a minute — and worth reading twice."* |
| Aesthetic direction | Calm and premium. Warm amber/terracotta accent. Light-first with strong dark mode. Bookish (serif for story body, sans for UI). |
| Taste benchmark | Somewhere between Apple Books/Readwise and Wattpad — the polish of a reading app with the community energy of a serialized fiction platform. |
| Platforms | Cross-platform: iOS + Android + Web (Rork Pro). |

---

## 2. Business model philosophy

### Single-currency principle (critical)

The user sees **one balance**: **Credits**.

Every earning method deposits into the same balance. Every spending action deducts from the same balance. No coins, no gems, no separate creator wallet, no conversion sheets, no cooldown timers visible to the user.

**Why:** dual currencies confuse users, kill the intuitive "earn → spend" mental model, and require a conversion UI that adds friction to the exact moment we want to be zero-friction.

### Backend provenance tagging

The complete `credit_ledger.reason` contract is `'purchase' | 'subscription' | 'ad_reward' | 'streak' | 'feedback' | 'referral' | 'social' | 'generation' | 'welcome' | 'refund' | 'reader_earning'`. The baseline Blueprint and migration `00001` contain every value except `reader_earning`; migration `00003` adds only `reader_earning` for credits earned from reads on the user's own published stories.

At analytics time, slice like this:

```sql
-- Paid credits (real revenue)
SUM(amount) FROM credit_ledger WHERE reason IN ('purchase', 'subscription') AND amount > 0

-- Subsidized credits (cost of acquisition/retention)
SUM(amount) FROM credit_ledger
  WHERE reason IN ('ad_reward','streak','feedback','referral','social','welcome','reader_earning')
  AND amount > 0

-- Spent credits (usage)
-SUM(amount) FROM credit_ledger WHERE reason = 'generation' AND amount < 0
```

Cost-per-active-user, LTV models, subsidy ratios, and unit-economics dashboards all fall out of these three queries.

### Cost per credit (unchanged from Blueprint)

Superseded — see `../../source-of-truth/CREDITS_AND_PRICING.md` §2. Measured cost is **$0.0423 per credit** blended ($0.031 text + $0.063 cover + $0.033 character set = $0.127 per 3-credit chapter), plus ~$0.22 per chapter of fresh audio narration. Any subsidized credit is a direct cost against future ARPU.

---

## 3. Content model

### 3.1 Short story is the default; series is emergent

- **Every new generation produces a single-chapter short story** (~800–1500 words). No length picker on the create screen.
- **The AI decides length** based on the topic and prompt — 500 words for a vignette, 1500 for something arc-worthy. Do not expose length as a user choice; it introduces analysis paralysis.
- **After the first chapter is generated, only the author sees "Continue this story ▸"** at the bottom of the reader. Costs 3 credits per additional chapter (text + cover + characters, separately purchasable). Each chapter gets its own cover art.
- **Optional advanced toggle inside the create wizard: "Plan this as a series"** with chapter count (3 / 5 / 10). When set, the LLM plans the arc and generates chapter 1 with foreshadowing hooks. User still pays per chapter as they generate them.
- Once a story has 2+ published chapters, it is a **Series** — surfaced with a series badge on cards and a chapter list in the reader.

### 3.2 Author-only continuation (load-bearing decision)

**Only the story's original author can write additional chapters.** This is a hard rule.

- Readers see chapters as they're published. They cannot generate or extend.
- Readers get "Follow this story ▸" and "Follow this author ▸" buttons instead of a continue CTA.
- When the author publishes a new chapter, every follower of that story gets a push notification: *"Chapter 2 of [Story Title] is here."*
- Every follower of the author gets a push when the author publishes any new story: *"[Author] just published a new story."*

This turns readers into a demand signal that pressures authors to keep writing (see §5).

### 3.3 Chapter draft-vs-published state

Backend schema addition: `chapters.is_published BOOLEAN DEFAULT false` and `chapters.published_at TIMESTAMPTZ`.

- Authors can generate a chapter and leave it unpublished (draft state, still costs a credit).
- Drafts appear in **Library → My stories** with a "Draft" badge, visible only to the author.
- Publishing is a one-tap action from the reader/editor.
- Reader-facing surfaces (Discover, Home, feed, author profile, following, notifications) only include published chapters.

### 3.4 Categorization

**Required at story creation:**

- **Genre** (single-select, required): Adventure, Fantasy, Sci-Fi, Mystery, Romance, Thriller, Horror, Slice of Life, Historical, Contemporary, LGBTQ+, Comedy, Drama, Poetry, Mythology, Spirituality, Motivational, Kids, **Erotica (18+, gated by parental controls)**.

**Auto-generated by LLM after generation, stored on the story record:**

- **Themes** — 3-6 free-form tags per story (e.g., "coming of age", "second chance", "revenge arc", "found family"). Not hardcoded. Power search, "more like this," and related recommendations.

Backend addition: `stories.themes TEXT[]` (already effectively covered by `genre TEXT[]` in Blueprint but themes are a distinct dimension — add as a new column, don't overload genre).

---

## 4. Complete credit economy — master table

> **SUPERSEDED. See `../../source-of-truth/CREDITS_AND_PRICING.md` (repository root).**
>
> The earning table, spending table, pricing tiers and free-vs-premium behavior
> that used to live here are obsolete in every particular. See
> `../../source-of-truth/CREDITS_AND_PRICING.md` §§1, 3, and 5 for every current number, price, grant,
> SKU, and earning rule. The enduring mechanisms are free reading, one credit per
> AI action, non-rolling subscription grants, and whole-balance lapse at
> subscription end; library and unlocked audio remain available.
>
> The **creator-earning curve** described in §5.1 and the **anti-gaming pipeline**
> in §6 are deferred to v1.2, not deleted — they are well designed and will be
> needed if reader earnings return. Read them as a future spec, not current
> behavior.


## 5. Growth loops

### 5.1 Reader-earned credits loop (creator payout)

```text
User publishes a story
    → Story appears in Discover / feed / author profile
        → Real readers read it
            → Each read (subject to anti-gaming, §6) grants credits to the author
                → Author uses earned credits to write more stories
                    → More stories on the platform
                        → More reading material for readers
                            → More reads → more earnings → more stories
```

This is the **content flywheel**. It only works if credits earned feel meaningful (front-loaded curve) and can't be gamed (§6).

### 5.2 Follow graph loops

**Two follow types, both required:**

- **Follow an author** — every new story they publish appears in your feed + push notification.
- **Follow a story** — get notified specifically when that story gets a new chapter.

**Reader-side loop:** Following a story creates a real reason to reopen the app when the notification fires. Serialized fiction platforms consistently see new-chapter push as the highest-CTR notification category (~15-25% CTR vs 3-5% for generic engagement pings).

**Author-side loop:** When an author sees "142 people are following this story," writing chapter 2 becomes emotionally compelling. This is *free retention on the supply side*.

**Milestone push notifications for authors** (backend cron, sent max once per day per author):

- Follower milestones: 10, 50, 100, 500, 1,000, then every 1,000
- Read milestones per story: 10, 100, 500, 1,000, 10,000
- Credit-earning milestones: 10 earned, 50, 100

Copy examples: *"100 people are waiting for chapter 2"* / *"Your story just crossed 500 reads. Keep going."*

### 5.3 Referral loop

Deep-link based. New user installs from a referral link → account is tagged with `referred_by` → when they generate their first story, the **referrer gets 10 credits and the invited user gets 5**. Caps: 3 payouts/month and 10 lifetime for the referrer; invited account must be ≥24h old at payout. Deferred to v1.1.

**Anti-abuse:** referral pays out only after first *generation*, not first install. This prevents install-farm abuse.

### 5.4 Streak loop

**Retuned, not removed.** Daily reading activity increments a streak counter; milestones pay **1 credit at day 2, day 5, day 7, then every 7 days** (`../../source-of-truth/CREDITS_AND_PRICING.md` §5). **Superseded 2026-09-16 (pricing doc decision 49): the ladder is five rungs that rise, at days 2, 5, 10, 15 and 21, it terminates rather than repeating weekly, and it is data — `streak_ladder()`, migration 00089 — rather than a schedule written in two documents. The mechanism below is unchanged; the days and the amounts are not.** Streak breaks reset to zero and rewards restart at day 2. Dates are computed server-side and each milestone is keyed `streak:{user_id}:{milestone_day}` so replays are structural no-ops. The streak-warning push at 20:00 local time stays.

### 5.5 Ad loop (the paying-conversion funnel)

**Removed from the economy.** Rewarded ads lose money as a credit source at any plausible eCPM (`../../source-of-truth/CREDITS_AND_PRICING.md` §5). Retained here only as a record of the integration requirements, should non-rewarded ads ever ship. Historically: a verified rewarded ad granted 1 credit per rolling 24 hours. This cannot be activated until AdMob sends signed SSV callbacks directly to the server and the backend provides user-bound claim nonces, global transaction replay protection, and atomic cooldown/grant enforcement. Client reward callbacks never grant credits.

As covered in the Blueprint, this loop **loses money per ad-funded generation** but is intended to build a daily-open habit that drives paid conversion (target: 3-8% of free users).

---

## 6. Anti-gaming pipeline (creator-earning safeguards)

The reader-earning surface is the highest-abuse target in the app. Every read that counts toward creator earnings **must** pass this pipeline. Backend implements this in the `POST /record-read` edge function.

### 6.1 Self-read guard

- Reader `user_id` == story `author_id` → do not record, do not grant credit.
- Do not even count for the "unique reads" tally on author analytics — self-reads should be zero-signal.

### 6.2 Minimum read time (word-count-scaled)

- Compute required minimum: `min_read_seconds = min(max(chapter.word_count / 4, 45), 180)`.
  - 400-word chapter -> 100s minimum
  - 1500-word chapter -> 180s minimum (capped)
  - Any chapter under 180 words -> 45s minimum (floor; short pieces still need to be actually read)
- Reader must be on the story page continuously for at least `min_read_seconds` before the read is counted for creator earnings.
- App reports foreground time via `POST /record-read` when the reader leaves the page or the app backgrounds.

### 6.3 New account throttle

- If reader account age < 24 hours: read counts for 0 credits toward creator (but still counts toward the story's "reads" display and reader's own history).
- If reader account age 24-72 hours: add one integer half-credit unit to the future reader-earning accumulator. Older eligible reads add two units. The serialized `record-read` transaction grants `floor(units / 2)` whole integer credits and retains `units % 2`; fractional values are never inserted into `credit_ledger.amount` or passed to credit RPCs.
- Kills sockpuppet farms at trivial engineering cost.

### 6.4 Read velocity anomaly detection

- Nightly cron computes read velocity per story: `reads_last_2_hours / reads_prior_24h_avg`.
- If ratio > 10x AND engagement signals (comments, likes, shares) haven't scaled proportionally → **pause credit accrual on that story pending manual review**. Reads still count for display; earnings freeze until reviewed.
- Real virality carries engagement. Farms don't fake engagement well.

### 6.5 Session diversity cap

- One device (device_id + ip_hash) can generate at most **5 crediting reads per author per 24 hours**. Additional reads still count for the story's read counter but don't grant author credits.
- Prevents "I'll read 40 of your stories to farm you credits" ring behavior.

### 6.6 Per-story daily earning cap

- No single story can earn its author more than **10 credits/day**, regardless of read volume.
- Protects against sudden viral windows creating uncontrolled subsidy costs.

### 6.7 Optional internal cooldown (recommended)

- Reader-earned credits enter a **48-hour pending state** internally (invisible to user — balance updates immediately).
- If the source story is flagged (§6.4) or the account is flagged during the window, the credits are clawed back before they're spent.
- If the user spends credits during the pending window, spend from the oldest cleared balance first (FIFO).
- Alternative: skip the pending state, accept a small fraud tail, lean on real-time §6.4 detection. **Recommendation: implement the pending state.** The user never sees it, and it protects margin.

### 6.8 Reads dedup

- One (user_id, story_id) pair contributes at most **1 crediting read per 24 hours**.
- Same user re-reading the story tomorrow counts as a fresh crediting read.
- Same user re-reading 3 times in an hour counts as 1.

---

## 7. Discovery & feed model

Discover tab structure:

```text
[ Search bar with debounced autocomplete ]
[ Filter chips: For You | Trending | Rising | New ]
[ Horizontal genre strip: All | Adventure | Fantasy | Sci-Fi | ... ]
[ Story cards (vertical list, engagement counters visible on each card) ]
```

- **For You** — personalized feed driven by user's read history, follows, and genre preferences.
- **Trending** — top stories by weighted engagement score in last 7 days.
- **Rising** — high engagement velocity in last 24-48 hours (before they hit Trending — surfaces new hits early).
- **New** — most recently published, filterable by genre.

**Engagement score for ranking:** `((0.4 x likes) + (0.3 x comments) + (0.2 x shares) + (0.1 x save_rate)) x time_decay`. Time decay is a standard exponential over 7 days.

**Search:** full-text against title, author username, LLM-generated themes, and genre. Supabase `pg_trgm` + `tsvector` is fine for v1. Recent searches saved locally on device. Empty search state shows trending queries.

---

## 8. CTA strategy

Primary CTA phrasing: **"Write yours"** (short, present-tense, action-forward, works in every context).

Strategic placement across the app:

| Location | CTA style |
| --- | --- |
| Center bottom tab | `+` icon in accented pill, always visible |
| Home | FAB appears after user scrolls past hero fold |
| End of every story reader | Inline card: *"Loved this? Spin your own story"* — pre-fills the same genre |
| Empty state on Library | *"Nothing saved yet — try writing your first story"* |
| Empty state on Home | *"Your library's waiting. Write your first story."* |
| Post-comment (occasionally) | *"You clearly have taste — write one yourself?"* |
| Author profile of someone you're viewing | *"Follow their style — write in their genre"* |
| After a streak milestone | *"Streak milestone reached. You earned 1 credit."* |

**Rule:** the CTA lives on **every reading surface**. Reading is the intake; writing is the monetization event.

---

## 9. Reader UX decisions

- **Reader is scrollable continuous scroll within a chapter** (blueprint-aligned). Not paginated.
- **Between chapters, discrete units** — chapter list accessed via pull-up sheet.
- **Progress bar** at the top of the reader shows scroll progress through the current chapter.
- **Sign-in wall — Okudu-style mid-read.** After ~1 page of preview reading, unauthenticated user hits a soft wall: *"Sign in to keep reading — it's free"* with Google/Apple/Email options and a skip that lets them browse but not read more of that story. Full reading requires sign-in.
- **Audio player** — inline in the reader with play/pause, playback speed, sleep timer, background playback.
- **Reading themes** — light, dark, sepia. Font size slider. Serif body text default (Charter or Lora); optional sans-serif toggle.

---

## 10. Kids mode & parental controls

> **Superseded.** None of this section shipped. The product has a per-draft
> Create switch labelled **All-ages** (`audienceMode: "kids"` internally), no
> Settings entry, no PIN and no parental controls, and the Play listing
> targets 18+ only. `source-of-truth/STORY_GENERATION_FLOW.md` §3 is the
> record.

- **Kids mode is off by default.**
- Enabled from Settings → Parental Controls → PIN-gated.
- When on: hides Erotica genre entirely, hides content with adult LLM-generated themes (violence, substance, sexual), locks the create wizard's genre picker to a safe subset, disables comments (or restricts to moderated), and disables social share.
- PIN required to disable.

---

## 11. Languages (v1 scope)

**UI localization (v1):**

- English
- Hindi

**Story-generation languages (v1) — top 15:**
English, Hindi, Spanish, French, German, Portuguese, Italian, Japanese, Korean, Mandarin, Arabic, Russian, Indonesian, Turkish, Bengali.

**Not in v1:** Tamil, Telugu, Marathi, Gujarati, and other Indian regional languages beyond Hindi + Bengali. Add based on install geography data 3-6 months post-launch.

Language selection is per-story on the create wizard (`stories.language TEXT NOT NULL DEFAULT 'en'`). Reader displays a language chip on the story card.

---

## 12. Backend schema additions (delta from Blueprint)

Add to the Blueprint schema:

```sql
-- Complete contract after migrations 00001 and 00003:
-- 'purchase', 'subscription', 'ad_reward', 'streak', 'feedback',
-- 'referral', 'social', 'generation', 'welcome', 'refund', 'reader_earning'
-- Migration 00003 adds only 'reader_earning' to the 00001 baseline.

-- Chapters: draft vs published
alter table chapters add column is_published boolean default false;
alter table chapters add column published_at timestamptz;
create index idx_chapters_published on chapters(story_id, is_published, chapter_number);

-- Stories: language + themes
alter table stories add column language text not null default 'en';
alter table stories add column themes text[] default '{}';
alter table stories add column planned_chapter_count integer; -- null = not planned as series
create index idx_stories_themes on stories using gin(themes);
create index idx_stories_language on stories(language, is_public);

-- Read tracking
create table story_reads (
    id uuid primary key default gen_random_uuid(),
    story_id uuid references stories(id) on delete cascade,
    chapter_id uuid references chapters(id) on delete cascade,
    user_id uuid references profiles(id),
    device_id text,
    ip_hash text,
    duration_seconds integer,
    is_own_story boolean default false,
    counts_for_earnings boolean default true,
    read_at timestamptz default now()
);
create index idx_story_reads_story on story_reads(story_id, read_at desc);
create index idx_story_reads_user on story_reads(user_id, read_at desc);
-- The serialized record-read transaction rejects an earning read when an
-- eligible row exists for this user/story in the preceding rolling 24 hours.
create index idx_story_reads_user_story_recent
    on story_reads(user_id, story_id, read_at desc)
    where counts_for_earnings = true;

-- Follow-a-story
create table story_followers (
    story_id uuid references stories(id) on delete cascade,
    user_id uuid references profiles(id) on delete cascade,
    followed_at timestamptz default now(),
    primary key (story_id, user_id)
);
create index idx_story_followers_user on story_followers(user_id, followed_at desc);

-- Follow-an-author
create table user_followers (
    author_id uuid references profiles(id) on delete cascade,
    follower_id uuid references profiles(id) on delete cascade,
    followed_at timestamptz default now(),
    primary key (author_id, follower_id),
    check (author_id != follower_id)
);
create index idx_user_followers_follower on user_followers(follower_id, followed_at desc);

-- Bookmarks
create table bookmarks (
    user_id uuid references profiles(id) on delete cascade,
    story_id uuid references stories(id) on delete cascade,
    bookmarked_at timestamptz default now(),
    primary key (user_id, story_id)
);
create index idx_bookmarks_user on bookmarks(user_id, bookmarked_at desc);

-- Likes (for feed ranking + engagement counters)
create table story_likes (
    user_id uuid references profiles(id) on delete cascade,
    story_id uuid references stories(id) on delete cascade,
    liked_at timestamptz default now(),
    primary key (user_id, story_id)
);
create index idx_story_likes_story on story_likes(story_id);

-- Engagement counter cache (denormalized, updated by triggers or async job)
alter table stories add column read_count integer default 0;
alter table stories add column unique_reader_count integer default 0;
alter table stories add column like_count integer default 0;
alter table stories add column comment_count integer default 0;
alter table stories add column share_count integer default 0;
alter table stories add column follower_count integer default 0;
alter table stories add column credits_earned integer default 0;

-- Pending credit state (for optional fraud-review buffer)
alter table credit_ledger add column pending_until timestamptz;
alter table credit_ledger add column clawed_back_at timestamptz;

-- Referral chain
alter table profiles add column referred_by uuid references profiles(id);
alter table profiles add column first_generation_at timestamptz;

-- Age throttle / anti-gaming
alter table profiles add column account_created_at timestamptz default now();
```

---

## 13. Backend edge functions to add (delta from Blueprint)

| Function | Purpose |
| --- | --- |
| `POST /record-read` | Full anti-gaming pipeline. Records read, decides if it earns author credits, updates engagement counters. |
| `POST /publish-chapter` | Marks chapter as published, fires follower notifications. |
| `POST /follow-story`, `POST /unfollow-story` | Story-follow toggles. |
| `POST /follow-user`, `POST /unfollow-user` | Author-follow toggles. |
| `POST /bookmark`, `POST /unbookmark` | Bookmark toggles. |
| `POST /like`, `POST /unlike` | Like toggles. |
| `GET /feed/for-you` | Personalized feed based on follows + read history. |
| `GET /feed/trending`, `GET /feed/rising`, `GET /feed/new` | Feed variants with engagement-score ranking. |
| `GET /search?q=` | Full-text search across titles, themes, usernames, genres. |
| `GET /author/:username` | Profile view: their stories, comments, follower/following counts. |
| `GET /story/:id/analytics` | Author-only per-story analytics. |
| **Cron: `nightly_velocity_check`** | Velocity anomaly detection, pauses accrual on flagged stories. |
| **Cron: `pending_credits_clear`** | Clears pending credit_ledger rows past their `pending_until`. |
| **Cron: `milestone_notifications`** | Sends milestone pushes to authors. |
| **Cron: `streak_warning`** | 20:00 local-time streak-break warning push. |

---

## 14. Milestone triggers & push notifications

| Trigger | Recipient | Copy example |
| --- | --- | --- |
| Someone you follow publishes a story | Follower | *"[Author] just published '[Story Title]'"* |
| A story you follow gets a new chapter | Story follower | *"Chapter [N] of '[Story Title]' is here"* |
| Your story crosses 10, 100, 500, 1000, 10000 reads | Author | *"Your story just crossed [N] reads. Keep going."* |
| Your story crosses 10, 50, 100, 500, 1000 followers | Author | *"[N] people are waiting for chapter [next]"* |
| You've earned 10, 50, 100 credits from reads | Author | *"Your readers just funded your next [N] stories"* |
| Streak break warning at 20:00 local | User with active streak, no activity today | *"Your [N]-day streak is at risk. One story keeps it alive."* |
| Streak milestone hit (2, 5, 7, then every 7 days — superseded, see §5.4) | User | *"[N]-day streak. Here's a credit on us."* |
| First generation completed | User (in-app moment, not push) | *"Your first story is ready. Welcome to Katha."* |

All push notifications respect per-category opt-out in Settings → Notifications.

---

## 15. Open items pending confirmation

Things this doc leaves unresolved — flag for future decision:

1. **Welcome bonus amount — settled.** It is 3 credits after the paywall and one-time-offer decline path; see `../../source-of-truth/CREDITS_AND_PRICING.md` §5.
2. **Optional internal cooldown on reader-earned credits** — recommended but optional. Backend team decides based on fraud detection load.
3. **Social post verification workflow** — manual moderation queue in v1 or automated? Recommend manual for v1 (low volume expected), automate once volume justifies.
4. **Regeneration on user-initiated retry** — not offered in v1. Consider adding as premium-only feature post-launch.
5. **Community-published stories in Discover from day 1** — this doc assumes yes (needed for the reader-earning loop to work). If we want a stricter curation phase for the first N days post-launch, gate community publishing behind a "verified creator" flag.
6. **Real payout program (Wattpad Paid Stories-style)** — out of scope for v1. Consider once reader-earning loop is proven and top creators are hitting sustained volume.

---

## Appendix A: What did NOT change from the Blueprint

For clarity — the following remain as specified in the Blueprint:

- Tech stack split (Rork for UI, VS Code agent for backend).
- Supabase Auth (Google + Apple).
- RevenueCat for billing. **Rewarded-ad credits are historical/deferred and must
  not be implemented**; see `../../source-of-truth/CREDITS_AND_PRICING.md` §5.
- Pricing tiers — **superseded, see `../../source-of-truth/CREDITS_AND_PRICING.md` §3.**
- Cost-per-generation — **superseded, see `../../source-of-truth/CREDITS_AND_PRICING.md` §2** ($0.127 per chapter).
- 5-tab bottom nav structure.
- Append-only credit ledger pattern.
- RevenueCat webhook verification. AdMob SSV material is historical only and
  cannot authorize a credit path.
- Phase 1-5 build order (though this doc reshuffles some sub-priorities).

Anything not explicitly overridden here defers to the Blueprint.

---

*End of document. Feed this to the VS Code backend agent alongside the Blueprint.*
