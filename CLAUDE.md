# CLAUDE.md

## Product Context

AI story generator mobile app. Users create personalized stories on demand with cover art and optional audio narration. Includes a curated free library for discovery and retention. Credits are the monetization currency.

**This is a separate product from Story For My Kid (storyformykid.com).** Different brand, different app, broader audience (not kids-only). The website continues independently.

Competitive reference: Okudu AI (~$30K/mo revenue, 84K downloads, launched Dec 2024).

## Architecture

### Two Workstreams

1. **Rork** (mobile app) — React Native screens, navigation, native SDKs (Adapty, AdMob, Supabase Auth)
2. **VS Code / Claude Code** (backend) — Supabase Edge Functions, database schema, generation pipeline, credit ledger, webhook handlers

**Rule:** If it touches money, credits, or API keys — VS Code agent. If it's a screen — Rork. If both — Rork calls an Edge Function.

### Stack

- **Database + Auth + Storage:** Supabase (new project, separate from storyformykid.com)
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Story generation:** Anthropic SDK (Sonnet 4.6 primary, Haiku 4.5 fallback, gpt-4o-mini last resort)
- **Image generation:** DALL-E 3 or Flux (cover art per story)
- **Audio narration:** edge-tts (en-US-JennyNeural, Rate: -15%)
- **Billing:** Adapty (subscriptions + credit packs + paywall A/B testing)
- **Ads:** AdMob (rewarded video for free credits, server-side verification)
- **Analytics:** PostHog
- **Mobile app:** React Native (Expo), built via Rork

### Key Patterns from Story For My Kid (reusable knowledge)

These patterns were battle-tested in the storyformykid.com project:

- **LLM fallback chain:** Sonnet 4.6 (60s timeout) -> Haiku 4.5 (30s) -> gpt-4o-mini (30s). Always refund credit on total failure.
- **Never use `claude --print` CLI for generation** — adds 70-100s overhead. Use Anthropic SDK directly.
- **edge-tts narration:** Voice en-US-JennyNeural, Rate -15%. Output is MPEG 2 Layer III at 48kbps CBR. Duration formula: `file_size_bytes * 8 / 48000` seconds.
- **Image generation:** "Pixar-inspired" is a HARD BLOCK in OpenAI moderation. Use "3D CGI animated film style". Build retry logic (up to 3 attempts) with simplified scene language on moderation rejection.
- **Supabase webhook patterns:** Use async verification. CF Workers need `constructEventAsync()` — Edge Functions may differ but verify.
- **Never include "AI", "generated", "artificial intelligence"** in public-facing image metadata.

## Database

Schema is in `supabase/migrations/`. Key tables:

- `profiles` — user identity, linked to Supabase Auth
- `credit_ledger` — append-only ledger (every credit change is a row)
- `stories` — generated + curated stories
- `chapters` — story content (supports multi-chapter)
- `characters` — per-story character definitions
- `comments` — user feedback per story/chapter
- `streaks` — reading streak tracking
- `ad_rewards` — daily ad credit claims (1 per 24hr)
- `referrals` — referral tracking

**Credit ledger pattern:** Never update rows — only insert. Balance = last row's `balance_after`. Atomic deduction via `INSERT ... WHERE balance_after >= 0`.

## Edge Functions

All in `supabase/functions/`. Each is a Deno/TypeScript handler:

| Function | Method | Purpose |
|----------|--------|---------|
| `generate-story` | POST | Orchestrator: auth -> credit check -> deduct -> LLM -> image -> audio -> return |
| `continue-story` | POST | Generate next chapter for existing story |
| `deduct-credit` | POST | Atomic credit deduction (pre-generation) |
| `grant-credit` | POST | Server-side ad reward verification (AdMob SSV) |
| `library` | GET | Paginated curated story feed for Discover |
| `feedback` | POST | Comments/ratings + feedback credit reward |
| `adapty-webhook` | POST | Subscription/purchase event handler |

Shared utilities in `supabase/functions/_shared/`.

## Monetization

### Credits
- 1 credit = 1 generation (story or chapter, includes cover image)
- Credit packs: $2.99/3, $7.99/10, $14.99/25
- Monthly sub: $6.99/mo (20 credits + ad-free + premium voices)
- Yearly sub: $49.99/yr (25 credits/mo + ad-free + premium voices)
- Subscription credits carry over up to 2x monthly amount

### Free Credit Methods
- Watch ad (1 credit, 1 per 24hr)
- Reading streak (1 credit every 3 consecutive days)
- Leave feedback (1 credit per story, one-time)
- Referral (3 credits per unique referral who generates)
- Social post (1 credit per verified post)

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
```

## Build Order

1. **Phase 1 (Read-Only):** Schema + seed library + GET /library endpoint
2. **Phase 2 (Generation):** POST /generate-story + credit ledger + POST /continue-story
3. **Phase 3 (Monetization):** Adapty webhook + AdMob SSV + grant/deduct credit
4. **Phase 4 (Engagement):** Streaks + feedback rewards + referrals
5. **Phase 5 (Growth):** Premium voices, offline, community, multi-language

## Reference Material

- Full product blueprint: `references/story-generator-app.md`
- Story generation prompt: `prompts/story-generator.md`
- Seed library data: `seed-data/`
