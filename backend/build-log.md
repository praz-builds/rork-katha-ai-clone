# Katha AI — Build Log

<!-- markdownlint-disable MD013 MD024 -->

> Chronological record of all changes made across sessions.
> Every session that modifies code, schema, config, or infrastructure MUST append an entry here.

---

## 2026-08-15 — Project scaffolding

**Session:** Initial project setup (from Story For My Kid Claude Code session)

### Changes

- Created the backend workspace, now located at the repository-relative `backend/` directory
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
- The full fix-up list is retained in this build-log entry and `ROADMAP.md`.

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
- Added durable `generation_operations` state keyed by client request ID; story/chapter completion and compensation now update operation state atomically, completed requests replay existing results, and refunded continuations can retry with a new request.
- Added feedback request idempotency, updated reader/comment RLS policies in the forward migration, bounded continuation prompt context, strict generation input limits, abortable LLM timeouts, strict library pagination, and fully qualified Adapty product IDs.
- Trial conversions now grant the paid-period credits. Refund events fail closed with a retryable response until the explicit clawback policy is implemented.
- Enforced the locked short-story-only generation contract in both the Edge Function and Expo request payload.
- Added PGlite regression tests for exactly-once generation debit/refund behavior, completion/refund races, idempotent feedback rewards, and cross-account provider transaction replay prevention.
- Added five-minute stale-reservation reconciliation on client retry; abandoned generation work is refunded while late successful completion still wins under the operation row lock.
- Added `payment_event_backlog` so unimplemented Adapty refund clawbacks are visible and retryable instead of existing only in logs.
- Added stable SQLSTATE handling for concurrent chapter reservations, shared request/operation parsers, cross-story feedback replay rejection, bounded library filters, and validated OpenAI response decoding within the abort deadline.
- Replaced calendar-day ad-reward uniqueness with an index supporting a future atomic rolling 24-hour verification transaction.
- Made fallback Adapty refund event IDs deterministic from the raw request body and covered provider-ID priority plus replay stability in tests.
- Aligned the runtime and canonical generation prompt to the locked 500-1500 word short-story contract and updated the Sonnet model identifier.
- Added malformed-body and UUID validation, mandatory client request IDs, explicit unpublished chapter state, refund-replay semantics, owner-safe story update grants, and reader-visibility RLS coverage.
- Annual Adapty events fail closed until monthly allocation scheduling is implemented; provider SKU coverage is checked against the complete allowlist.
- Confirmed the current generation runtime is text-only; cover images and audio narration remain undeployed Phase B work.
- Confirmed rewarded AdMob credits remain disabled pending direct signed SSV callbacks, server-issued user-bound claim nonces, global transaction replay protection, and atomic cooldown/grant handling.
- Added migration `00006_public_data_hardening.sql` to restrict profile reads to display-safe columns, remove client story-status updates, and index title search with `pg_trgm`.
- Isolated the title-search index in migration `00007_story_title_search_index.sql` so current Supabase CLI runners can execute `CREATE INDEX CONCURRENTLY` outside their batched transaction.
- Replaced wildcard CORS with an exact `ALLOWED_ORIGINS` allowlist and added cached preflight responses.
- Preserved generated paragraph boundaries through a shared response parser, switched continuation credit errors to stable SQLSTATE handling, and made payment-backlog retries preserve terminal rows.

### Deployment status

- Code changes and migrations were reviewed and merged through PR #3, then deployed to the linked Supabase project on 2026-08-22.
- Migrations `00005`, `00006`, and `00007` plus the changed Edge Functions are deployed.
- `ALLOWED_ORIGINS` is configured for the exact local Expo web origin `http://localhost:8090`; add the exact production Expo web origin before serving production browser clients.
- Adapty dashboard authorization and exact product IDs must match the server configuration before production webhook traffic is enabled.
- Adapty refund clawbacks and monthly allocation for annual plans remain explicit production blockers; refund events currently fail closed rather than being acknowledged without accounting.

## 2026-08-22 — Concurrent story-title search index

- Added `00007_story_title_search_index.sql` with `idx_stories_title_trgm`, a concurrent GIN trigram index for leading-wildcard title search.
- Kept the pipeline-incompatible index statement in its own migration so current Supabase CLI migration runners execute it outside the batched transaction.
- The migration was deployed to the linked Supabase project on 2026-08-22.

## 2026-08-22 — Controlled backend release to Supabase

**Session:** Deployed the reviewed PR #3 backend hardening set to the canonical Supabase project.

### Infrastructure

- Linked the monorepo backend checkout to Supabase project `iafeuxgoiknncgyjmugd`.
- Applied migrations `00005_secure_credit_operations.sql`, `00006_public_data_hardening.sql`, and `00007_story_title_search_index.sql` with `supabase db push`.
- Deployed all seven Edge Functions from the reviewed monorepo state:
  - `generate-story`
  - `continue-story`
  - `deduct-credit`
  - `grant-credit`
  - `library`
  - `feedback`
  - `adapty-webhook`
- Deployed `adapty-webhook` with JWT verification disabled so provider callbacks can reach the function after `ADAPTY_WEBHOOK_SECRET` is configured.
- Set `ALLOWED_ORIGINS=http://localhost:8090` for local Expo web verification. Production browser traffic remains blocked until the exact production origin is known and added.

### Verification

- `supabase db push --dry-run` reported only `00005`, `00006`, and `00007` pending.
- `supabase db push` applied `00005`, `00006`, and `00007` successfully.
- `supabase migration list --linked` now reports local and remote migrations `00001` through `00007` aligned.
- `supabase functions list --project-ref iafeuxgoiknncgyjmugd` reports all seven functions ACTIVE; `adapty-webhook` has `verify_jwt=false`.
- `/Users/mac16/.deno/bin/deno fmt --check supabase/functions supabase/migrations/00005_secure_credit_operations_test.ts` passed.
- `/Users/mac16/.deno/bin/deno check ...` passed for shared utilities, all function entrypoints, and the migration test.
- `/Users/mac16/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/_shared/*_test.ts supabase/migrations/00005_secure_credit_operations_test.ts` passed: 25 tests.
- `POST /functions/v1/adapty-webhook` without `ADAPTY_WEBHOOK_SECRET` returns `503` with `Webhook is not configured`, confirming fail-closed behavior.
- `OPTIONS /functions/v1/library` from `http://localhost:8090` returns `Access-Control-Allow-Origin: http://localhost:8090`.
- The same preflight from `https://example.com` returns no `Access-Control-Allow-Origin`.

### Remaining blockers

- `ANTHROPIC_API_KEY` is not configured in Supabase secrets; `OPENAI_API_KEY` is configured.
- `ADAPTY_WEBHOOK_SECRET` is not configured, and dashboard authorization/product IDs still need verification before real Adapty traffic.
- The exact production Expo web origin is not known; add it to `ALLOWED_ORIGINS` before production browser clients call the functions.
- No authenticated test user/JWT was available in this session, so live `generate-story`, `continue-story`, `feedback`, and disabled credit endpoint behavior were not exercised end to end.
- Annual subscription monthly allocation, refund clawbacks, and AdMob SSV remain production blockers.

## 2026-08-26 — Genre-aware anti-slop story prompt system

**Session:** Production-grade story generation prompt rewrite, dramatic arc guidance, series structure.

### Story Generation Prompt System

- Created `_shared/story-prompts.ts` (540+ lines): genre-aware prompt builder replacing the 31-line generic prompt in `_shared/prompts.ts`.
- **Anti-slop rules**: 43 banned AI-overused words, 42 banned cliche phrases, 10 banned AI-default character names.
- **Craft rules**: show-don't-tell enforcement, sentence rhythm variation, dialogue craft (said-only tags, distinct character voices, interruptions), sensory grounding (2+ senses beyond sight), no em dashes, no meta-commentary.
- **16 genre-specific voice modules**: romance, fantasy, romantasy, mystery, thriller, horror, scifi, adventure, historical, darkAcademia, drama, sliceOfLife, mythology, poetry, comedy, bedtime.
- **Cultural context**: AI infers culture from character names and traits naturally.
- **Language-aware**: 15 supported languages normalized before prompt interpolation.
- Genre and language normalized to supported enums to prevent prompt injection.

### Dramatic Arc & Series Structure

- **Standalone stories**: setup 30%, rising tension 40%, climax + aftermath 30%. Climax is mandatory.
- **Mid-series chapters** (`mode: "chapter"`): advance plot, end on hook, never resolve central conflict.
- **Series finale** (`mode: "finale"`): resolve main arc, callback to earlier chapters, close doors.
- `MAX_SERIES_CHAPTERS = 7` enforced in `continue-story` endpoint.
- Auto-finale at chapter 7. Optional `is_finale` flag for early endings.

### Input Validation

- Story seed minimum raised from 4 to 20 characters (client-side and server-side).
- Language field now sent from Expo client to backend API.

### Files Changed

- `_shared/story-prompts.ts` (NEW)
- `generate-story/index.ts` (updated)
- `continue-story/index.ts` (updated)
- `expo/src/screens/CreateStudioScreen.tsx` (updated)
- `expo/src/lib/api.ts` (updated)
- `expo/src/i18n/en.json`, `es.json`, `pt.json` (updated)

### Documentation

- Created `AGENTS.md` as canonical repo instruction file for all agent sessions.
- `CLAUDE.md` and `CODEX.md` simplified to redirect to `AGENTS.md`.

### PR Status

- PR #24 (`codex/story-prompt-system`): CodeRabbit APPROVED after 4 review rounds.

---

## 2026-08-26 — Cover image system, sample stories, dev tooling, instruction consolidation

**Session:** Full-day production session covering cover image generation, focal-point display, 3 sample stories, developer tooling, Expo skills integration, and instruction file consolidation.

### Cover Image Pipeline (PR #25)

- **`_shared/image.ts`** (198 lines): OpenAI `gpt-image-1` integration at 1024x1536 portrait. Handles base64 response decoding, 3-attempt retry with progressive prompt simplification on moderation rejection, uploads to Supabase Storage.
- **`_shared/cover-prompts.ts`** (235 lines): 16 genre-specific prompt configs (style, palette, composition, mood, characterApproach). `normalizeGenre()` prevents prompt injection via own-property check. `buildCoverPrompt()` assembles dynamic prompts from genre + title + themes + characters.
- **`backend/COVER_IMAGES.md`** (189 lines): Canonical reference for the entire cover system — prompt structure, focal point math per viewport, genre table, API call spec, retry strategy, display layouts.

### Focal-Point Display System (Strategy 1c)

- **`FocalImage` component** (`KathaPrimitives.tsx`): Renders web-native `<img>` with `object-fit: cover` + `object-position` for focal-point-aware cropping. React Native Web's Image component ignores `objectPosition`, so raw `<img>` is required. Falls back to standard RN Image on native.
- **Story type extended**: Added `focalX?: number` and `focalY?: number` (0-1) to `domain.ts` Story type.
- **Per-placement crop math**: Library card (1:1 square, y = focalY - 0.07), mobile hero (3:4 full-bleed, y = focalY - 0.02), desktop cover (3:4 sticky, y = focalY).

### Reader Screen Redesign

- **Mobile (< 768px)**: Full-bleed 3:4 hero image with LinearGradient fade into page background, floating white pill back button.
- **Desktop (>= 768px)**: Two-column layout — 200px sticky cover on left, reading column on right. `maxWidth: 700`, centered.
- **Chapter navigation**: Pill-style chapter selector (Ch 1 / Ch 2 / Ch 3) for multi-chapter stories. Audio stops and unloads on chapter switch.
- **Voice toggle**: Hidden when only one narration voice is available.
- **All existing features preserved**: audio playback, engagement bar, comments, author card, bookmark, share.

### Library Card Redesign

- Square (1:1) cover tile with focal-point anchoring, no text overlay on image.
- Title + meta line ("Genre . Xk reads") below the card.
- Card width ~172px, borderRadius 20, warm shadow.
- Rail gap reduced from 20px to 12px.

### 3 Production-Grade Sample Stories

Generated via the story prompt system and validated against all anti-slop rules:

| Story | Genre | Language | Chapters | Words | Cover | Audio |
|-------|-------|----------|----------|-------|-------|-------|
| The Vanilla Problem | romance | EN | 1 | 1,632 | OpenAI gpt-image-1 | Seed Audio (Brielle) |
| The Decimal Point | mystery | EN | 3 | 3,006 | OpenAI gpt-image-1 | Seed Audio (Holden) |
| Las cien luces de Don Aurelio | bedtime | ES | 1 | 1,048 | OpenAI gpt-image-1 | Inworld TTS (Lupita) |

QA results: 0 banned words, 0 banned phrases, 0 banned names, 0 em dashes, 0 bad dialogue tags across all 5 texts.

### Developer Tooling (PR #26)

- **ESLint 9**: `eslint.config.js` (flat config with `eslint-config-expo`). 0 errors, 22 warnings (pre-existing).
- **Jest 29**: `jest.config.js` (jest-expo preset, pnpm transforms, `@/` alias). 5 suites, 33 tests.
- **Test suites**: theme tokens, i18n key parity, analytics no-op, supabase config, seed data validation.
- **CI**: `.github/workflows/ci.yml` — typecheck + lint + test on every PR. Pinned action SHAs, `permissions: contents: read`, pnpm 11.
- **Dependencies added**: `react-native-reanimated@~4.1.7`, `react-native-gesture-handler@~2.28.0`, `expo-haptics@~15.0.8`, `eslint@^9`, `eslint-config-expo`, `jest`, `jest-expo`, `@testing-library/react-native`.
- **Design tokens**: `typography.ts` (7 text styles), `shadows.ts` (3 elevation levels), `motion.ts` (3 duration tokens), `index.ts` barrel export.
- **Design drift fixes**: 30+ hardcoded `#FFFFFF` replaced with `colors.surface`, barrel import fixes in 3 files.

### Expo Skills Integration

27 Expo skills installed locally from `github.com/expo/skills` into `.agents/skills/`:

| Category | Skills |
|----------|--------|
| Core | expo-overview, expo-router, expo-animation, expo-design-system, expo-native-ui, expo-ui |
| Data | expo-data-fetching |
| Build | expo-dev-client, expo-module, expo-upgrade, expo-project-structure |
| EAS | eas-app-stores, eas-workflows, eas-update-insights, eas-observe, eas-simulator, eas-hosting |
| Platform | expo-app-clip, expo-brownfield, expo-web-to-native, expo-dom, expo-tailwind-setup |
| Reference | expo-examples, expo-skill-eval, expo-api-docs, expo-review |

**Skill routing table** added to AGENTS.md mapping every task category to its skill path.
**Mandatory skill usage rules**: animation gate check, design token imports from barrel, navigation via expo-router skill.

### Theme Token Expansion

8 new sepia design tokens added to `theme.ts` for the reader/cover design handoff:

`sepiaHeading`, `sepiaBody`, `sepiaMuted`, `sepiaSecondary`, `sepiaAccent` (darkened to `#A64C1C` for 4.5:1 contrast), `sepiaButton`, `sepiaPlaceholder`, `sepiaToggleTrack`

### Instruction File Consolidation

- **`AGENTS.md`** expanded from 150 to 456 lines with 15 sections. Now contains ALL information previously split across root CLAUDE.md, backend/CLAUDE.md, and expo/CLAUDE.md: infrastructure & services, database schema, edge functions, monetization, audio narration, app architecture, build & deploy.
- **`CLAUDE.md`** (root): Replaced duplicate content with 5-line redirect to AGENTS.md.
- **`CODEX.md`**: Replaced chain redirect (CODEX → CLAUDE → AGENTS) with direct redirect to AGENTS.md.
- **`backend/CLAUDE.md`**: Replaced 233-line standalone file with 5-line redirect to AGENTS.md (all info synthesized into the canonical file).
- **`story-generator.md`**: Updated from v1.0 (35 lines, basic rules) to v2.0 (120 lines) matching the story-prompts.ts implementation.

### OpenAI API Key

- Key set in Supabase secrets (updated by user).
- Key saved to `backend/.env` for local development (gitignored).
- Model confirmed: `gpt-image-1` (dall-e-3 no longer available on this project's API key).

### PR History

| PR | Title | Status |
|----|-------|--------|
| #25 | Cover image system with focal-point cropping and sample stories | MERGED (3 rounds, 16 comments addressed) |
| #26 | Dev tooling, design tokens, test coverage, and drift fixes | MERGED (CodeRabbit approved) |
| #24 | Genre-aware anti-slop story prompt system + instruction consolidation | MERGED (rebased onto main, CodeRabbit approved) |

### Files Changed (across all 3 PRs)

- 33 files changed, ~3,600 insertions
- New backend files: `_shared/story-prompts.ts`, `_shared/cover-prompts.ts`, `_shared/image.ts`, `COVER_IMAGES.md`
- New expo files: 3 cover images, 5 test suites, 4 design token files, ESLint config, Jest config, CI workflow
- Updated: `App.tsx`, `KathaPrimitives.tsx`, `domain.ts`, `seed.ts`, `images.ts`, `theme.ts`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `backend/CLAUDE.md`, `story-generator.md`
