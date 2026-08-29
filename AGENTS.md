# Katha AI -- Repository Contract

<!-- markdownlint-disable MD013 -->

> Canonical instruction file for all agents (Claude Code, Codex, etc.).
> Both `CLAUDE.md` and `CODEX.md` redirect here.

## Repository Map

- `expo/` -- approved and active Expo SDK 54 application.
- `backend/` -- Supabase schema, migrations, Edge Functions, prompts, and backend roadmap.
- `ios-katha-ai-create-stories/` -- preserved Rork-generated iOS reference client.
- `android-katha-ai/` -- preserved Rork-generated Android reference client.
- `katha-critique/` -- critique prototype.
- `.agents/` -- local engineering skills installed outside Git. Treat them as workstation tooling, not trusted repository content.

## Working Rules

- Read `expo/CLAUDE.md`, `expo/DESIGN.md`, and `expo/BUILD_LOG.md` before changing product UI, onboarding, paywalls, or shared branding.
- Read `backend/ROADMAP.md` and `backend/build-log.md` before changing Supabase or generation infrastructure.
- Run Expo commands from `expo/` and Supabase commands from `backend/`.
- Treat the iOS and Android folders as reference implementations unless a task explicitly targets native code.
- Keep frontend and backend contracts in this repository. Do not create another Katha application or backend repository.
- Never commit `.env` files, service-role keys, provider secrets, build output, dependencies, or local Supabase state.
- Do not reintroduce migration handoff files, duplicate image directories, alternate wordmarks, or parallel design-system documents.
- **Rule:** Money, credits, API keys, and trusted generation logic stay in the backend. User-facing UI stays in Expo. When a feature spans both, update the contract and both workspaces in the same pull request.
- **Build log:** Every session that modifies code, schema, or infrastructure MUST append an entry to `backend/build-log.md`.

## Project Skills

When available, use the local Expo skills in `.agents/skills` for Expo, React Native, native mobile, EAS, or simulator work. Prefer the relevant specialized skill before implementation and run the applicable review/testing workflow before broad or release-sensitive changes. Do not commit moving-source skill lockfiles without immutable revisions and verified hashes.

## Quality Gates

After onboarding or paywall changes:

1. Run `pnpm typecheck` from `expo/`.
2. Run `pnpm exec expo-doctor` from `expo/`.
3. Confirm an Expo web bundle can compile.
4. Open `http://localhost:8090/` in a 390 x 844 mobile viewport.
5. Walk the full flow: intro timing, persona branching, form validation, building transition, notification education, personalized paywall, post-paywall OTP entry, one-time offer, success, Home handoff.

## Security Gate (MANDATORY before pushing to GitHub)

**Every agent session MUST run `/security-scan` before pushing code to GitHub.** The skill is at `.agents/skills/security-scan/SKILL.md`. It runs entirely on the CLI agent (no external API keys needed).

What it checks:
1. Secrets & credentials exposure (hardcoded keys, .gitignore gaps)
2. Injection vulnerabilities (SQL, command, prompt injection)
3. Authentication & authorization gaps (missing auth, RLS, ownership checks)
4. Input validation (unbounded strings, missing UUID validation)
5. Mobile-specific issues (AsyncStorage PII, deep link hijacking, unencrypted storage)
6. Infrastructure misconfig (CORS, error exposure, debug flags)

If the scan finds CRITICAL or HIGH issues, **fix them before pushing**. MEDIUM and LOW findings should be documented and tracked for follow-up.

To run: use the `security-scan` skill or spawn 3 parallel sub-agents (secrets, injection/auth, deps/mobile/infra) for thorough coverage.

## Infrastructure & Services

| Service | Purpose | Key / Config | Status |
|---------|---------|-------------|--------|
| **Supabase** | DB, Auth, Storage, Edge Functions | Project `iafeuxgoiknncgyjmugd`, Seoul (ap-northeast-2) | Live |
| **OpenAI** | Cover images (gpt-image-1) | `OPENAI_API_KEY` in Supabase secrets + `backend/.env` | Set |
| **Anthropic** | Story generation (Sonnet 5 primary, Haiku 4.5 fallback) | `ANTHROPIC_API_KEY` in Supabase secrets | NOT YET SET — see Credential requirement below |
| **RunPod** | Audio narration (MiniMax Speech 02 HD) | `RUNPOD_API_KEY` in Supabase secrets; public endpoint `minimax-speech-02-hd` | Set |
| **PostHog** | Analytics (EU Cloud) | `phc_onpzv6Zkxv7SATYPHRM2oWQ7JTPmpETXV9ZHNV4b8cpm` | Set |
| **Adapty** | Subscriptions + credit packs + paywall A/B | Public key in `expo/src/lib/adapty.ts`; webhook secret in Supabase secrets | Set |
| **Firebase/FCM** | Push notifications (iOS + Android) | Requires `google-services.json` in `expo/`; `FIREBASE_SERVICE_ACCOUNT_KEY` in Supabase secrets | Not yet wired |
| **Sentry** | Error tracking | DSN | Not yet set |
| **AdMob** | Rewarded video for free credits | Needs server-side verification (SSV) | Not yet wired |

### LLM Fallback Chain

Sonnet 5 (60s timeout) -> Haiku 4.5 (30s) -> gpt-4o-mini (30s). Always refund credit on total failure. Never use `claude --print` CLI for generation (adds 70-100s overhead); use the Anthropic SDK directly.

**Use the canonical undated model IDs:** `claude-sonnet-5`, `claude-haiku-4-5`. Anthropic's current model IDs are complete as written; dated snapshot forms exist for some models but are not the documented identifier for these, and the codebase standardises on the undated alias. (The previous `claude-haiku-4-5-20251001` was replaced on that basis, not because it was observed to fail — the Anthropic path has never executed here, so no such observation exists.)

**Credential requirement.** `ANTHROPIC_API_KEY` must be an API key from console.anthropic.com, prefix `sk-ant-api03-`. A `sk-ant-oat01-` value is an OAuth access token minted by `claude` CLI login against a Claude subscription: it expires within hours, so generation breaks mid-session, and subscription auth is a developer-tool credential that is not licensed to serve end-user traffic. The two are separately billed on the same account.

**Output is schema-constrained, not prose-requested.** `_shared/story_schema.ts` defines the story JSON schema once and both providers enforce it — Anthropic via `output_config.format`, OpenAI via `response_format` with `strict: true`. Before this, the prompt only *described* the shape, and a valid-JSON-wrong-shape response fell through to the plain-text parser, persisting a chapter with a placeholder `hook_type: "none"` and an empty `series_state` while still charging a credit.

**`max_tokens` is 16,000 for generation**, 2,000 for paragraph edits. The previous 4,096 truncated a chapter plus its `series_state` mid-JSON.

**Provider failures are typed.** `classifyLlmError()` maps SDK error classes to a stable `LlmFailure` (`provider`, `model`, `code`, `status`, `retryable`) rather than string-matching messages. On total failure `generateStoryText` throws `AllProvidersFailedError`, whose `toContext()` returns identifiers and enums only — safe to pass straight to error telemetry.

### Supabase Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `audio` | Narration MP3s | Public read, service role upload |
| `covers` | Cover image PNGs | Public read, service role upload; **NEEDS CREATION** |

### Local Dev

```bash
# backend/.env (never committed)
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx
ADAPTY_WEBHOOK_SECRET=xxx
FIREBASE_SERVICE_ACCOUNT_KEY=xxx
RUNPOD_API_KEY=xxx
ALLOWED_ORIGINS=https://REPLACE_WITH_EXPO_WEB_ORIGIN,http://localhost:8090
```

`ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist for browser clients. Native clients do not send an `Origin` header.

## Database

Schema is in `backend/supabase/migrations/` (8 migrations: 00001-00008).

### Key Tables

| Migration | Tables |
|-----------|--------|
| **00001 (Core)** | `profiles`, `credit_ledger`, `stories`, `chapters`, `characters`, `comments`, `streaks`, `ad_rewards`, `referrals` |
| **00003 (Social)** | `story_reads`, `story_followers`, `user_followers`, `bookmarks`, `story_likes` |
| **00005 (Operations)** | `generation_operations`, `payment_event_backlog` |
| **Not yet created** | `device_tokens` (Phase G -- FCM/APNs token storage) |

### Credit Ledger Pattern

- Append-only. Never update rows.
- Service-only RPCs serialize mutations per user and require a new `operation_key` for idempotency without rewriting historical references.
- Balance = newest ledger row by `created_at`, then `id`.
- **Reasons:** `purchase`, `subscription`, `ad_reward`, `streak`, `feedback`, `referral`, `social`, `generation`, `welcome`, `refund`, `reader_earning`.

### Security Gate

- Generation requests use client-stable IDs and durable `reserved`, `completed`, or `refunded` operation state.
- AdMob rewards stay unavailable until server-side verification is implemented.
- Do not deploy credit or generation changes outside the reviewed migration/function set.

## Edge Functions

All in `backend/supabase/functions/`. Each is a Deno/TypeScript handler.

### Implemented

| Function | Method | Purpose | Notes |
|----------|--------|---------|-------|
| `generate-story` | POST | Auth -> reserve credit -> LLM -> persist -> return | Text path done; image/audio Phase B |
| `continue-story` | POST | Next chapter (author-only), max 7 chapters | Text path done |
| `library` | GET | Paginated curated feed with genre filter + search | Done |
| `feedback` | POST | Comments + one-time feedback credit reward | Done |
| `adapty-webhook` | POST | Idempotent subscription/purchase credits | Needs dashboard secret + product IDs |
| `generate-audio` | POST | MiniMax Speech 02 HD narration | Accepts `language` in body |
| `audio-status` | GET | Check audio generation status | Done |
| `feed` | GET | Feed endpoint | Done |
| `edit-story` | POST | Paragraph-level AI editing | Done |
| `publish-story` | POST | Mark story published, trigger cover generation | Done |
| `deduct-credit` | POST | Legacy generic endpoint | Disabled |
| `grant-credit` | POST | AdMob SSV reward verification | Disabled until SSV |

### Shared Utilities (`_shared/`)

`adapty.ts`, `cors.ts`, `cover-prompts.ts`, `credits.ts`, `edge-tts.ts`, `image.ts`, `llm.ts`, `operations.ts`, `prompts.ts`, `story-prompts.ts`, `story_text.ts`, `uuid.ts` (plus test files).

### TODO Functions by Phase

| Function | Purpose | Phase |
|----------|---------|-------|
| `record-read` | Anti-gaming pipeline | E |
| `publish-chapter` | Mark published + FCM notifications | D |
| `follow-story` / `unfollow-story` | Story follow toggles | D |
| `follow-user` / `unfollow-user` | Author follow toggles | D |
| `bookmark` / `unbookmark` | Bookmark toggles | D |
| `like` / `unlike` | Like toggles | D |
| `feed/for-you`, `feed/trending`, `feed/rising`, `feed/new` | Personalized + variant feeds | F |
| `search` | Full-text search (pg_trgm + tsvector) | F |
| `author/:username` | Public author profile | F |
| `story/:id/analytics` | Author-only per-story analytics | F |
| `register-device` | Store FCM token | G |
| `send-notification` | Push via FCM | G |
| `referral-verify` | Referral fraud checks | H |

## Story Generation System (v5.1)

The generation pipeline lives in `backend/supabase/functions/_shared/story-prompts.ts`. Shared types in `_shared/types.ts`, validation in `_shared/validation.ts`. The prompt spec is `backend/prompts/story-generator.md`.

### Architecture (v5.1 modular layers)

System prompts are assembled from 10 layers:
1. **Base craft + safety** -- anti-slop, show-don't-tell, rhythm, dialogue, formatting, safety rules
2. **Story engine** -- protagonist, want, obstacle, stakes, irreversible choice, emotional turn, genre payoff, final image
3. **Primary genre module** -- 15 voice modules with voice/pacing/what-works/what-to-avoid
4. **Audience mode** -- kids constraints (ages 4-10, 500-1200 words, safe content)
5. **Identity lens** -- queer lens guidance
6. **Trope module** -- werewolf/vampire/enemiesToLovers/etc. rules per genre
7. **Spice module** -- sweet (fade to black), steamy (sensuality on-page), explicit (feature-flagged)
8. **Continuation/finale** -- mid-series and finale rules
9. **Language** -- 15 supported languages
10. **Output schema** -- structured JSON output format

API:
- `buildStorySystemPrompt({ primaryGenre, audienceMode?, identityLenses?, tropeModules?, spiceLevel?, language? })` -- modular system prompt.
- `buildContinuationSystemPrompt({ ...above, mode: "chapter" | "finale" })` -- continuation prompt.
- `buildUserPrompt({ primaryGenre, audienceMode?, tropeModules?, spiceLevel?, seed, characters?, language? })` -- user message.
- Old 2-arg signatures (`buildStorySystemPrompt(genre, language)`) still work as deprecated wrappers.

### Taxonomy

- **15 primary genres**: romance, romantasy, darkRomance, cozyFantasy, paranormalRomance, fantasy, scifi, thriller, mystery, horror, contemporary, historical, adventure, comedy, poetry.
- **13 UI genres** (cozyFantasy + paranormalRomance are DB-only, hidden from UI).
- **2 audience modes**: adult (default), kids (toggle chip in UI).
- **Spice levels**: sweet (default), steamy, explicit (feature-flagged off).
- **Identity lenses**: queer.
- **10 trope modules**: werewolf, vampire, enemiesToLovers, secondChance, forcedProximity, smallTown, fatedMates, forbiddenLove, lockedRoom, secretIdentity. Genre-constrained.
- **Genre migration map**: drama/sliceOfLife/darkAcademia -> contemporary, mythology -> fantasy, kids/bedtime -> adventure, lgbtq/motivational/spirituality -> contemporary.

### Quality Rules (enforced in every generation)

- **43 banned AI-overused words** (delve, tapestry, testament, etc.)
- **42 banned cliche phrases** (eyes widened, breath caught, heart pounded, etc.)
- **10 banned AI-default names** (Elara, Seraphina, Lysander, etc.)
- Show-don't-tell enforcement, sentence rhythm variation, dialogue craft (said-only tags, distinct voices, interruptions), sensory grounding (2+ senses beyond sight per scene).
- No em dashes, no meta-commentary, no purple prose.

### Structured Output

LLM returns JSON: `{ title, chapter_title, chapter_body, word_count, themes, first_line, previously_summary }`. Parsed by `parseStructuredOutput()` with text-based fallback via `parseGeneratedStoryText()`.

### Validation

`validateGenerationRequest()` in `_shared/validation.ts`:
- Normalizes genre via migration map
- Forces sweet spice in kids mode
- Rejects darkRomance in kids mode
- Rejects explicit spice (MVP gate)
- Clamps spice to genre-allowed set
- Filters tropes to genre-allowed set
- Strips identity lenses in kids mode
- 40-char seed minimum, 1000-char ceiling

`deriveContentRating(audienceMode, spiceLevel)` -> kids/steamy/explicit/sweet (stored on story row).

### Series Limit

`MAX_SERIES_CHAPTERS = 7`. Enforced in `continue-story` endpoint. Auto-finale at chapter 7. Optional `is_finale` flag for early endings.

### Cultural Context

The AI infers cultural context from character names, traits, and story language. No explicit culture/ethnicity field -- inference from names and traits is the design choice.

### Input Requirements

- **Story seed**: 40-character minimum (enforced both client-side and server-side).
- **Characters**: optional (pre-filled placeholder in UI).
- **Genre**: required, single-select from 13 UI genres.
- **Language**: optional, defaults to English. 15 supported languages.

## Cover Image System

Cover images are generated by gpt-image-1 at publish time. The pipeline lives in `backend/supabase/functions/_shared/image.ts` with genre-specific prompt templates in `_shared/cover-prompts.ts`. Full reference: `backend/COVER_IMAGES.md`.

### Model & Output

- **Provider**: OpenAI API only. Never use other image providers.
- **Model**: `gpt-image-1`.
- **Output size**: `1024x1536` portrait (2:3 ratio, native book cover format).
- **Quality**: `"medium"`.
- **Response format**: base64 (`b64_json`). Decode to PNG bytes.
- **Storage**: Supabase Storage `covers/{story_id}/cover.png`, public read.

### Prompt Construction

`buildCoverPrompt()` assembles prompts from four layers:

1. **Genre config** (static per genre from `GENRE_PROMPTS`): style, palette, composition, mood, characterApproach (`"scene"` | `"silhouette"` | `"portrait"`).
2. **Story-specific context** (dynamic): title, themes (up to 4).
3. **Character integration** (dynamic): scene (no explicit characters), silhouette (distant figure), portrait (three-quarter view).
4. **Invariant suffix**: no text/titles/words/letters/watermarks, portrait orientation, centered composition, professional book cover art quality.

### Retry Strategy

| Attempt | Strategy |
|---------|----------|
| 0 | Full prompt: genre + title + themes + characters |
| 1 | Simplified: genre + title + 2 themes, no characters |
| 2 | Generic: genre + title only |

After 3 failures, returns `null`. Story publishing is never blocked.

### Focal-Point System

Every cover stores `{ focalX, focalY }` (0-1) on the Story record (default `0.5, 0.5`).

| Placement | Aspect | Y Offset | Where |
|-----------|--------|----------|-------|
| Library card | 1:1 square | `focalY - 0.07` | Home feed rail, library grid |
| Mobile hero | 3:4 portrait | `focalY - 0.02` | Reader screen, < 768px |
| Desktop cover | 3:4 portrait | `focalY` (direct) | Reader left column, >= 768px |

`FocalImage` component in `expo/src/components/KathaPrimitives.tsx` renders web via raw `<img>` with `object-position` (RN Web's Image ignores it) and native via standard RN Image with `resizeMode="cover"`.

### 16 Genre Prompt Configs

| Genre | Style | Palette | Characters |
|-------|-------|---------|------------|
| romance | warm illustrated, soft painterly | warm corals, sunset oranges, blush pinks | portrait |
| fantasy | epic illustration, rich painterly | deep emerald, royal purple, antique gold | silhouette |
| romantasy | lush fantasy, jewel-tone | deep amethyst, rose gold, midnight blue | portrait |
| mystery | noir, high contrast, chiaroscuro | dark slate, deep navy, single red accent | silhouette |
| thriller | stark cinematic, bold angular shadows | pure black, bright crimson, cold steel grey | silhouette |
| horror | dark atmospheric, desaturated | near-monochromatic greys, sickly green | silhouette |
| scifi | retro-futuristic, neon glow | deep space black, electric cyan, neon magenta | silhouette |
| adventure | bold cinematic, saturated color | warm amber, sunset orange, ocean teal | silhouette |
| historical | rich period illustration, ornamental | warm sepia, aged gold, burgundy wine | portrait |
| darkAcademia | moody gothic, candlelit, oil painting | deep mahogany, aged ivory, forest green | silhouette |
| drama | emotional painterly, expressive | muted earth tones, overcast greys | scene |
| sliceOfLife | warm cozy, gentle watercolor | warm caramel, soft sage, dusty rose | scene |
| mythology | mythological, bold ancient art | deep terracotta, burnished bronze, saffron | portrait |
| poetry | ethereal abstract, dreamy watercolor | soft lavender, misty grey-blue, pale rose | scene |
| comedy | vibrant pop, bold outlines | sunshine yellow, electric blue, hot pink | scene |
| bedtime | soft dreamy, moonlit glow | midnight navy, moonlight silver, warm amber | scene |

### Moderation Rules

- "Pixar-inspired" is a HARD BLOCK in OpenAI moderation. Use "3D CGI animated film style".
- Never include "AI", "generated", "artificial intelligence" in public-facing image metadata.

### Checklist for New Genres

1. Add genre voice module to `_shared/story-prompts.ts`.
2. Add genre prompt config to `_shared/cover-prompts.ts` (style, palette, composition, mood, characterApproach).
3. Add genre to `expo/src/types/domain.ts` GENRES array.
4. Add genre label to `expo/src/theme/theme.ts` genreLabels.
5. Add genre gradient to `expo/src/theme/theme.ts` genreGradients.
6. Add genre to `expo/src/data/seed.ts` genres array.

## Audio Narration System

### Provider & Model

- **Primary**: MiniMax Speech 02 HD on RunPod public endpoint (`minimax-speech-02-hd`). Used for English.
- **Fallback**: edge-tts (placeholder for non-English). Voice: `en-US-JennyNeural`, Rate: -15%. Output: MPEG 2 Layer III at 48kbps CBR. Duration formula: `file_size_bytes * 8 / 48000` seconds.

### Voices

| Language | Female | Male | Provider |
|----------|--------|------|----------|
| EN | Aria | Kai | RunPod (MiniMax) |
| ES | Elvira | Alvaro | edge-tts (placeholder) |

4 additional EN voices reserved for Premium Voices (paid subscribers).

### Pipeline

- Audio generated at publish time (both voices), cached permanently in Supabase Storage bucket `audio`.
- Storage path: `{story_id}/{chapter_id}/{voice_id}.mp3`. Public read, service role upload.
- `generate-audio` edge function accepts `language` in request body; callers must pass it explicitly.
- Language routing: EN -> RunPod, all others -> edge-tts.
- Reader shows voice toggle (female/male names from `getDefaultVoices(lang)`).
- Free users: 1 credit to unlock audio. Paid users: included.
- Inngest integration for auto-generation on publish is planned but not yet wired.

## Monetization

### Product Context

**Katha AI -- Create Stories.** AI-powered mobile-first story platform. Users read curated + community stories for free. Creating stories costs credits. Separate product from Story For My Kid (storyformykid.com). Audience: adults 20-40, casual readers + aspiring writers.

### Key Product Decisions

- **Single currency: Credits.** No coins, no gems, no dual wallets. Backend tracks provenance via `credit_ledger.reason`.
- **Every story starts as a short story.** AI decides length (500-1500 words). No length picker. Stories become Series when author adds chapters.
- **Author-only continuation.** Only the original author can add chapters.
- **Genre is single-select; themes are LLM-generated** (3-6 free-form tags per story).
- **3-credit welcome bonus.**
- Kids mode off by default, PIN-gated in parental controls.

### Credits Pricing

| Product | Price | Credits |
|---------|-------|---------|
| Pack (small) | $2.99 | 3 |
| Pack (medium) | $7.99 | 10 |
| Pack (large) | $14.99 | 25 |
| Monthly sub | $6.99/mo | 20/mo + ad-free + premium voices |
| Yearly sub | $49.99/yr | 25/mo + ad-free + premium voices |

Subscription credits carry over up to 2x monthly amount.

### Free Credit Methods

| Method | Amount | Limits |
|--------|--------|--------|
| Watch ad | 1 credit | 1 per rolling 24 hours (disabled until SSV) |
| Reading streak | 1 credit | Every 3 consecutive days |
| Leave feedback | 1 credit | 1 per story, cap 1/day |
| Referral | 3 credits | Per unique referral who generates |
| Social post | 1 credit | Per verified post, max 3/month |
| Reader earnings | Curve below | Anti-gaming pipeline |

### Creator Earnings Curve

| Reads | Credits earned |
|-------|---------------|
| 10 | 10 (1 per read) |
| 50 | 18 (1 per 5 after 10) |
| 100 | 28 (1 per 5) |
| 500 | 68 (1 per 10 after 100) |
| 1,000 | 118 |
| 10,000 | 478 (1 per 25 after 1000) |

Anti-gaming: self-read guard, min read time, account age throttle, velocity anomaly detection, session diversity cap, per-story daily cap (10 credits), dedup (1 crediting read per user/story/day). Full spec in `backend/references/strategic-decisions.md` section 6.

## App Architecture

### Navigation

3-tab layout: **Home** | **Create** (+, raised) | **Library**. Profile is a top-right avatar overlay, not a tab.

- `TabKey`: `"home" | "create" | "library"`. `Screen` includes `{ name: "profile" }`.
- **CreateStudioScreen** (`expo/src/screens/CreateStudioScreen.tsx`): Progressive Editor flow (setup -> generating -> editor -> cover preview -> publish review -> publishing). Tab bar remains visible. Series mode adds chapter tabs with `+` tab in editor. Standalone stories skip chapter headings.
- **Reader**: Substack-style engagement bar, author card, comments preview.
- **Library**: 4 segments -- Saved, History, My Stories, Comments.

### Onboarding

- Entry point: `expo/src/screens/KathaOnboardingComplete.jsx`.
- Composes `KathaOnboarding.jsx` and `KathaOnboardingFlowV2.jsx`.
- 390 x 844 geometry, shared wordmark, fixed intro slots, read/write/both branches.
- `KathaOnboardingFlowV2` emits collected result through `onDone`; persist when account/profile wiring is added.
- Do not restore prototype's "Replay the flow" action. Success CTA hands off directly to Home.
- Keep email/OTP after the paywall action; do not reintroduce mandatory authentication before personalization and value delivery.
- Do not hard-code localized pricing when Adapty integration begins; render from store payload.

### Product Integration Boundaries

- Email/OTP, notification permission, subscriptions, restores, and offer purchases are currently UI handoff points. Keep callbacks explicit for Supabase/Adapty/native wiring.
- Notification education: `Allow` is where the real native permission request must be inserted; only granted native response may set consent true.

### Production SDK Initialization

All SDK initialization runs in `App.tsx` useEffect: `initSentry()`, `initPostHog()`, `initAdapty()`, `setupAndroidChannel()`. All SDKs gracefully no-op when API keys are empty.

- `expo/src/lib/analytics.ts`: Sentry + PostHog. Use `trackEvent(name, props)` and `identifyUser(id, traits)`.
- `expo/src/lib/adapty.ts`: Adapty v4. Use `getPaywallProducts()` and `purchaseProduct()`.
- `expo/src/lib/notifications.ts`: expo-notifications. Use `requestNotificationPermission()` and `getPushToken()`.
- `expo/src/lib/firebase-analytics.ts`: Firebase Analytics with safe dynamic imports.
- `expo/src/lib/tracking-transparency.ts`: iOS ATT. Call `requestTrackingPermission()` before analytics.

### Design System

- Fonts: `BricolageGrotesque`, `HankenGrotesk`, `Baloo2` (bundled locally).
- Assets: `expo/assets/covers` and `expo/assets/avatars`. Do not recreate `assets/images` (removed as duplicate).
- i18n: `expo/src/i18n/` -- i18next with EN/ES/PT. Not yet wired to components.
- API keys via `Constants.expoConfig.extra` (app.json); convert to `app.config.ts` for `EXPO_PUBLIC_*` env vars before production.

## Build & Deploy

### Backend

```bash
supabase start                                 # Start Supabase locally
supabase db push                               # Apply migrations
supabase functions deploy generate-story       # Deploy a single function
supabase secrets set ANTHROPIC_API_KEY=xxx     # Set a secret
```

### Required Supabase Secrets

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ADAPTY_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `RUNPOD_API_KEY`, `ALLOWED_ORIGINS`.

### Expo

```bash
cd expo && pnpm install                        # Install dependencies
pnpm typecheck                                 # TypeScript check
pnpm exec expo-doctor                          # Expo health check
pnpm approve-builds                            # Needed for @firebase/util, @sentry/cli, protobufjs
```

Node v22.23.0 for typecheck (v24 has tsc shim issues).

## Build Phases (Roadmap)

See `backend/ROADMAP.md` for the full phased execution plan with checklists.

| Phase | Focus |
|-------|-------|
| **A** | Supabase project + fix critical bugs + deploy existing functions |
| **B** | Wire gpt-image-1 cover images + MiniMax/edge-tts audio narration |
| **C** | Adapty webhook HMAC + AdMob SSV verification |
| **D** | Follow/bookmark/like toggles + publish-chapter with FCM |
| **E** | record-read endpoint + creator earnings curve + pending credits |
| **F** | Feed endpoints + search + author profile + analytics |
| **G** | register-device + FCM integration + notification triggers + crons |
| **H** | Seed library content + referral verification + cron jobs |

## Mandatory Git Workflow

- Never commit or push directly to `main`.
- Before editing, fetch `origin/main` and create a `codex/<task-slug>` branch from it.
- Commit only task-related files to the feature branch, push it, and open a pull request targeting `main`.
- After every code-changing push, wait for CodeRabbit's incremental review.
- Merge only when CodeRabbit's latest review completed successfully and approved the changes, no CodeRabbit message says failed or requests changes, all actionable conversations are resolved, required validation passes, and the branch is current with `main`.
- A green CodeRabbit commit status alone is not approval. Read the latest review body and formal review state.
- Merge through GitHub and delete the feature branch afterward. Never push a merge commit directly to `main`.
- Exceptions require explicit user authorization and documentation in the pull request.

CodeRabbit reviews `main` pull requests, including drafts and incremental pushes, and fails its status when review execution fails. The tracked `.githooks/pre-push` guard blocks direct local pushes to `main`; run `scripts/setup-repo.sh` once in each clone. GitHub branch protection is unavailable for this private repository on its current plan, so this documented merge gate remains mandatory.

## Reference Material

- **Strategic decisions (authoritative):** `backend/references/strategic-decisions.md` -- overrides Blueprint where they conflict.
- **Product blueprint:** `backend/references/story-generator-app.md` -- original architecture spec.
- **Cover images (full reference):** `backend/COVER_IMAGES.md`.
- **Backend roadmap:** `backend/ROADMAP.md` -- phased execution plan with checklists.
- **Build log:** `backend/build-log.md` -- chronological change record.
- **Expo design contract:** `expo/DESIGN.md`.
- **Expo build log:** `expo/BUILD_LOG.md`.
