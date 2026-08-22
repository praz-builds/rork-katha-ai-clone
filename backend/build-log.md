# Katha AI — Build Log

> Chronological record of all changes made across sessions.
> Every session that modifies code, schema, config, or infrastructure MUST append an entry here.

---

## 2026-08-15 — Project scaffolding

**Session:** Initial project setup (from Story For My Kid Claude Code session)

### Changes
- Created project at `/Users/mac16/Katha AI/`
- **CLAUDE.md** — project context, architecture, build instructions for Claude Code sessions
- **Supabase schema (migration 00001):** profiles, credit_ledger, stories, chapters, characters, comments, streaks, ad_rewards, referrals — 9 tables with indexes
- **RLS policies (migration 00002):** row-level security for all tables
- **Edge Functions scaffolded:**
  - `generate-story` — full orchestrator (auth, credit deduct, LLM fallback chain, refund on failure)
  - `continue-story` — next chapter generation (author-only)
  - `deduct-credit` — atomic credit deduction endpoint
  - `grant-credit` — AdMob SSV reward verification + 24hr cooldown
  - `library` — paginated curated story feed with genre filter + search
  - `feedback` — comments + one-time feedback credit reward per story
  - `adapty-webhook` — subscription/purchase event handler
- **Shared utilities:** `_shared/credits.ts` (append-only ledger), `_shared/llm.ts` (Sonnet → Haiku → gpt-4o-mini), `_shared/cors.ts`
- **Story generator system prompt v1.0** — `prompts/story-generator.md`
- **Blueprint reference** — copied from Story For My Kid project
- **Strategic decisions doc** — `references/strategic-decisions.md` (product identity, credit economy, growth loops, anti-gaming pipeline, content model, CTA strategy, discovery/feed model)
- **Schema migration 00003** — delta additions from strategic decisions (story_reads, story_followers, user_followers, bookmarks, story_likes, engagement counters, chapter publishing state, language/themes, pending credits, referral chain)
- **Git initialized** with initial commit

### Decisions locked
- App name: **Katha AI — Create Stories**
- Single currency (Credits), no dual coins/gems
- Author-only continuation (readers cannot extend stories)
- AI decides story length (no length picker)
- 3-credit welcome bonus (up from Blueprint's 2)
- Front-loaded creator earnings curve (1 credit/read for first 10, then tapering)
- Full anti-gaming pipeline required for reader earnings
- Genre is single-select; themes are LLM-generated free-form tags
- UI: English + Hindi. Generation: 15 languages

---

## 2026-08-17 — Rork app review + backend roadmap

**Session:** Full codebase review of Rork-built app (both iOS + Android) against all 12 prompts + fix-up prompt

### Changes
- **ROADMAP.md** — created phased backend execution plan (A through H)
- **CLAUDE.md** — updated architecture section (Rork is native Swift+Kotlin, not React Native), updated build phases, added Rork app status, added new edge functions to TODO list
- **MEMORY.md** — updated with Rork review findings, fix-up list, backend phases
- **build-log.md** — this entry

### Rork App Status
- **Repo:** `praz-builds/rork-katha-ai-clone` (GitHub, private)
- **Original repo** `praz-builds/rork-katha-ai` confirmed safe to delete (clone is strict superset with 16 additional files)
- **iOS:** 40+ screens in Swift/SwiftUI, Literata font bundled, all features in mock mode
- **Android:** Full parity — 40+ screens in Kotlin/Jetpack Compose, same feature set
- **All 12 prompts delivered:** Foundation, Auth, Create Wizard, Series/Continuation, Profiles, Engagement, Search/Bookmarks, Credits/Ads, Fix-up, Analytics, Parental/Language, Streaks/Notifications/Referrals/Offline/Audio

### Review Findings (critical gaps for fix-up prompt)
- Color tokens: nearly every hex deviates from spec (Rork generated own palette)
- Only 12 of 30 seed stories exist; no language field on Story model
- Home screen missing 6 of 8 sections (Continue Reading, For You, Writers You Follow, Rising, Katha's Picks, Welcome-back)
- Reader missing drop cap, progress bar, nav auto-hide
- StoryCard layout is vertical instead of spec's horizontal
- Library has 5 tabs instead of 4
- Author follower counts all wrong
- See MEMORY.md for full list

### Known Backend Bugs Confirmed
- `generate-story/index.ts:137` — double-deduct in response body
- `credits.ts` — race condition (read-then-write, not atomic)
- `llm.ts` — Haiku model ID outdated (Oct 2024 → should be Oct 2025)
- `generate-story` — hardcoded system prompt instead of loading from file

### TODO next session
- [ ] Phase A: Create Supabase project, fix critical bugs, deploy existing functions
- [ ] Phase B: Wire DALL-E 3 + edge-tts into generation pipeline
- [ ] User: Get API keys (Anthropic, OpenAI), create Supabase project

---

## 2026-08-17 — Phase A: Supabase setup + bug fixes + deploy

**Session:** Created Supabase project, fixed all 4 known bugs, deployed all edge functions

### Infrastructure
- **Supabase project created:** `iafeuxgoiknncgyjmugd` (region: ap-northeast-2 Seoul)
- **New key format:** publishable/secret (maps to anon/service_role)
- **Supabase CLI installed** via Homebrew (v2.114.0)
- **Project linked** and all migrations pushed
- **`.env.local` created** with project URL + keys (gitignored)
- **`config.toml` updated** with project ref, OAuth providers disabled (need real client IDs)

### Bug Fixes
1. **Double-deduct fix** (`generate-story/index.ts:137`): `newBalance - 1` → `newBalance` (was subtracting again after deductCredit already returned the post-deduction balance)
2. **Race condition fix** (`credits.ts`): replaced read-then-write pattern with atomic Postgres RPC functions (`deduct_credit`, `grant_credit`) using `FOR UPDATE` row locking
3. **System prompt fix** (`generate-story/index.ts`): hardcoded string → imported from `_shared/prompts.ts` (mirrors `prompts/story-generator.md`)
4. **Haiku model ID fix** (`llm.ts:45`): `claude-haiku-4-5-20241022` → `claude-haiku-4-5-20251001`

### Schema Changes
- **Migration 00004** (`00004_atomic_credit_rpcs.sql`): added `deduct_credit()` and `grant_credit()` Postgres functions with `SECURITY DEFINER` and `FOR UPDATE` locking
- **Migration 00001 fix**: `idx_ad_rewards_daily` — `claimed_at::date` → `date_trunc('day', claimed_at at time zone 'UTC')` (immutability fix)
- **Migration 00003 fix**: `idx_story_reads_dedup` — same `::date` → `date_trunc` fix

### New Files
- `supabase/functions/_shared/prompts.ts` — story generator system prompt as exportable constant
- `supabase/migrations/00004_atomic_credit_rpcs.sql` — atomic credit RPC functions

### Deployments
All 7 edge functions deployed and ACTIVE:
- `generate-story`, `continue-story`, `deduct-credit`, `grant-credit`, `library`, `feedback`, `adapty-webhook`

### TODO next session
- [ ] Set API key secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) once user has them
- [ ] Phase B: Wire DALL-E 3 cover images + edge-tts audio narration
- [ ] Create Supabase Storage buckets (covers, audio)
- [ ] Consider recreating project in Mumbai region for lower India latency

---

## 2026-08-22 — CodeRabbit credit and generation hardening

**Session:** Remediation of PR #3 critical merge-risk findings

### Changes

- Added migration `00005_secure_credit_operations.sql` with service-only RPC permissions, positive amount validation, text reference IDs, per-user serialization, and idempotency indexes.
- Added a nullable operation key for new idempotent mutations instead of imposing uniqueness on historical reference IDs that older continuation flows reused.
- Added atomic story completion so the story update and first chapter insert commit together.
- Changed initial and continuation generation to use deterministic credit references and refund persistence failures.
- Disabled the generic client-controlled deduction endpoint and unverified AdMob reward endpoint.
- Changed Adapty authentication to exact `Authorization` secret verification, fail-closed configuration, `customer_user_id` mapping, explicit product allowlisting, and transaction-level idempotency.
- Restricted feedback rewards to public stories not authored by the commenter, verified chapter ownership, and enforced the documented daily reward check.
- Added focused Adapty unit tests and executed all five migrations against an in-memory PostgreSQL runtime, including permission, replay, concurrency, feedback, and story-completion behavior checks.

### Deployment status

- Code changes and migration are pending PR review. They have not been deployed to the linked Supabase project.
- Adapty dashboard authorization and exact product IDs must match the server configuration before production webhook traffic is enabled.
