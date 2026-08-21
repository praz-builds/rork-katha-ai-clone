# CLAUDE.md — Katha AI Backend

> **Current repository context (2026-08-22):** This backend now lives at `backend/` inside the canonical `praz-builds/rork-katha-ai-clone` monorepo. The approved active client is `../expo/`; the Swift and Kotlin clients are preserved references. Historical Rork-specific notes below explain prior decisions but do not override the root `../CLAUDE.md` or the current Expo product contract.

## Product Context

**Katha AI — Create Stories.** AI-powered mobile-first story platform. Users read curated + community stories for free. Creating stories costs credits. Includes cover art and audio narration per story.

**This is a separate product from Story For My Kid (storyformykid.com).** Different brand, different app, broader audience (adults 20-40, casual readers + aspiring writers). The website continues independently.

Competitive reference: Okudu AI (~$30K/mo revenue, 84K downloads, launched Dec 2024).

## Key Product Decisions

These are locked in via `references/strategic-decisions.md` (the authoritative doc — overrides the Blueprint where they conflict):

- **Single currency: Credits.** No coins, no gems, no dual wallets. Backend tracks provenance via `credit_ledger.reason`.
- **Every story starts as a short story.** AI decides length (500-1500 words). No length picker. Stories become Series when author adds chapters.
- **Author-only continuation.** Only the original author can write new chapters. Readers follow stories/authors for notifications.
- **Genre is single-select; themes are LLM-generated** (3-6 free-form tags per story).
- **3-credit welcome bonus** (generates → continue → continue arc).
- **Creator earnings:** readers' reads earn the author credits (front-loaded curve, full anti-gaming pipeline).
- **UI: English + Hindi. Generation: 15 languages.**
- Kids mode is off by default, PIN-gated in parental controls.

## Architecture

### Monorepo Workspaces

1. **Expo app** (`../expo/`) — approved cross-platform product client and primary UI workspace.
2. **Backend** (`./`) — Supabase Edge Functions, database schema, generation pipeline, credit ledger, and webhook handlers.
3. **Native references** (`../ios-katha-ai-create-stories/`, `../android-katha-ai/`) — preserved Rork implementations for platform-specific reference.

**Rule:** Money, credits, API keys, and trusted generation logic stay in the backend. User-facing UI stays in Expo. When a feature spans both, update the contract and both workspaces in the same pull request.

### Stack

- **Database + Auth + Storage:** Supabase (new project, separate from storyformykid.com)
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Story generation:** Anthropic SDK (Sonnet 4.6 primary, Haiku 4.5 fallback, gpt-4o-mini last resort)
- **Image generation:** DALL-E 3 or Flux (cover art per story)
- **Audio narration:** edge-tts (en-US-JennyNeural, Rate: -15%)
- **Billing:** Adapty (subscriptions + credit packs + paywall A/B testing)
- **Ads:** AdMob (rewarded video for free credits, server-side verification)
- **Push notifications:** FCM (Firebase Cloud Messaging) for both iOS and Android
- **Analytics:** PostHog
- **Mobile app:** Native Swift (iOS) + Kotlin (Android), built via Rork

### Rork App Status (as of 2026-08-17)

**COMPLETE in mock mode.** All 12 prompts + fix-up prompt delivered. Both iOS and Android at full parity (40+ screens). App runs entirely on local state — no real backend calls yet.

**Repo:** `praz-builds/rork-katha-ai-clone` (GitHub, private)

**Fix-up prompt needed** for color tokens, seed data gaps, Home screen sections, Reader drop cap, and other deviations documented in build-log.md (2026-08-17 entry).

### Key Patterns from Story For My Kid (reusable knowledge)

- **LLM fallback chain:** Sonnet 4.6 (60s timeout) -> Haiku 4.5 (30s) -> gpt-4o-mini (30s). Always refund credit on total failure.
- **Never use `claude --print` CLI for generation** — adds 70-100s overhead. Use Anthropic SDK directly.
- **edge-tts narration:** Voice en-US-JennyNeural, Rate -15%. Output is MPEG 2 Layer III at 48kbps CBR. Duration formula: `file_size_bytes * 8 / 48000` seconds.
- **Image generation:** "Pixar-inspired" is a HARD BLOCK in OpenAI moderation. Use "3D CGI animated film style". Build retry logic (up to 3 attempts) with simplified scene language on moderation rejection.
- **Never include "AI", "generated", "artificial intelligence"** in public-facing image metadata.

## Database

Schema is in `supabase/migrations/` (3 migrations). Key tables:

**Core (migration 00001):**
- `profiles` — user identity, linked to Supabase Auth
- `credit_ledger` — append-only ledger (every credit change is a row)
- `stories` — generated + curated stories
- `chapters` — story content (supports multi-chapter, draft/published state)
- `characters` — per-story character definitions
- `comments` — user feedback per story/chapter
- `streaks` — reading streak tracking
- `ad_rewards` — daily ad credit claims (1 per 24hr)
- `referrals` — referral tracking

**Social + Creator Economy (migration 00003):**
- `story_reads` — read tracking with anti-gaming fields (device_id, ip_hash, duration, counts_for_earnings)
- `story_followers` — follow a story for chapter notifications
- `user_followers` — follow an author for new story notifications
- `bookmarks` — saved stories
- `story_likes` — engagement signal for feed ranking

**Not yet created (needed for Phase G):**
- `device_tokens` — FCM/APNs token storage for push notifications

**Credit ledger pattern:** Never update rows — only insert. Balance = last row's `balance_after`. Atomic deduction via `INSERT ... WHERE balance_after >= 0`.

**Credit reasons:** `purchase`, `subscription`, `ad_reward`, `streak`, `feedback`, `referral`, `social`, `generation`, `welcome`, `refund`, `reader_earning`

## Edge Functions

All in `supabase/functions/`. Each is a Deno/TypeScript handler:

### Implemented (scaffolded)
| Function | Method | Purpose | Status |
|----------|--------|---------|--------|
| `generate-story` | POST | Orchestrator: auth -> credit check -> deduct -> LLM -> image -> audio -> return | 70% (LLM works, image/audio stubbed) |
| `continue-story` | POST | Generate next chapter (author-only) | 70% (same gap) |
| `deduct-credit` | POST | Atomic credit deduction | Done |
| `grant-credit` | POST | AdMob SSV reward verification + 24hr cooldown | Scaffolded (no SSV verify) |
| `library` | GET | Paginated curated story feed with genre filter + search | Done |
| `feedback` | POST | Comments + one-time feedback credit reward | Done |
| `adapty-webhook` | POST | Subscription/purchase event handler | Scaffolded (no HMAC verify) |

### TODO
| Function | Purpose | Phase |
|----------|---------|-------|
| `record-read` | Anti-gaming pipeline (self-read guard, min read time, account age throttle, velocity detection, dedup) | E |
| `publish-chapter` | Mark chapter published, fire follower notifications via FCM | D |
| `follow-story` / `unfollow-story` | Story follow toggles | D |
| `follow-user` / `unfollow-user` | Author follow toggles | D |
| `bookmark` / `unbookmark` | Bookmark toggles | D |
| `like` / `unlike` | Like toggles | D |
| `feed/for-you` | Personalized feed | F |
| `feed/trending`, `feed/rising`, `feed/new` | Feed variants | F |
| `search` | Full-text search (pg_trgm + tsvector) | F |
| `author/:username` | Public author profile | F |
| `story/:id/analytics` | Author-only per-story analytics | F |
| `register-device` | Store FCM token for push notifications | G |
| `send-notification` | Internal: send push via FCM | G |
| `referral-verify` | Referral fraud checks (device fingerprint, rate limit) | H |

Shared utilities in `supabase/functions/_shared/`.

### Known Bugs (fix in Phase A)
- `generate-story/index.ts:137` — `balance: newBalance - 1` double-deducts in response
- `credits.ts` — read-then-write race condition (needs Postgres FOR UPDATE)
- `generate-story` — hardcoded system prompt (should load `prompts/story-generator.md`)
- `llm.ts` — Haiku model ID outdated (`claude-haiku-4-5-20241022` → `claude-haiku-4-5-20251001`)

## Monetization

### Credits
- 1 credit = 1 generation (story or chapter, includes cover image + audio)
- Credit packs: $2.99/3, $7.99/10, $14.99/25
- Monthly sub: $6.99/mo (20 credits + ad-free + premium voices)
- Yearly sub: $49.99/yr (25 credits/mo + ad-free + premium voices)
- Subscription credits carry over up to 2x monthly amount
- Welcome bonus: 3 credits

### Free Credit Methods
- Watch ad (1 credit, 1 per 24hr)
- Reading streak (1 credit every 3 consecutive days)
- Leave feedback (1 credit per story, cap 1/day)
- Referral (3 credits per unique referral who generates)
- Social post (1 credit per verified post, max 3/month)
- Reader earnings on published stories (front-loaded curve, see strategic-decisions.md §4.1)

### Creator Earnings Curve
| Reads | Credits earned |
|-------|---------------|
| 10 | 10 (1 per read) |
| 50 | 18 (1 per 5 after 10) |
| 100 | 28 (1 per 5) |
| 500 | 68 (1 per 10 after 100) |
| 1,000 | 118 |
| 10,000 | 478 (1 per 25 after 1000) |

Anti-gaming: self-read guard, min read time, account age throttle, velocity anomaly detection, session diversity cap, per-story daily cap (10 credits), dedup (1 crediting read per user/story/day). Full spec in strategic-decisions.md §6.

## Build & Deploy

```bash
# Start Supabase locally
supabase start

# Deploy edge functions
supabase functions deploy generate-story
supabase functions deploy grant-credit
# etc.

# Apply migrations
supabase db push

# Set secrets
supabase secrets set ANTHROPIC_API_KEY=xxx
supabase secrets set OPENAI_API_KEY=xxx
supabase secrets set ADAPTY_WEBHOOK_SECRET=xxx
supabase secrets set FIREBASE_SERVICE_ACCOUNT_KEY=xxx
```

## Build Phases (Roadmap)

See `ROADMAP.md` for the full phased execution plan.

1. **Phase A (Foundation):** Supabase project + fix critical bugs + deploy existing functions
2. **Phase B (Generation):** Wire DALL-E 3 cover images + edge-tts audio narration
3. **Phase C (Monetization):** Adapty webhook HMAC + AdMob SSV verification
4. **Phase D (Social):** Follow/bookmark/like toggles + publish-chapter with FCM
5. **Phase E (Anti-Gaming):** record-read endpoint + creator earnings curve + pending credits
6. **Phase F (Discovery):** Feed endpoints + search + author profile + analytics
7. **Phase G (Push Notifications):** register-device + FCM integration + notification triggers + crons
8. **Phase H (Seed & Polish):** Seed library content + referral verification + cron jobs

## Build Log

**Every session that modifies code, schema, or infrastructure MUST append an entry to `build-log.md`.** This is the chronological record of what changed and when. Read it at the start of each session to understand current state.

## Reference Material

- **Strategic decisions (authoritative):** `references/strategic-decisions.md` — overrides Blueprint where they conflict
- **Product blueprint:** `references/story-generator-app.md` — original architecture spec
- **Story generation prompt:** `prompts/story-generator.md`
- **Seed library data:** `seed-data/`
- **Build log:** `build-log.md` — chronological change record
- **Backend roadmap:** `ROADMAP.md` — phased execution plan with checklists
