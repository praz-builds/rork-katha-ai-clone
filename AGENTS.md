# Katha AI -- Repository Contract

<!-- markdownlint-disable MD013 -->

> Canonical instruction file for all agents (Claude Code, Codex, etc.).
> Both `CLAUDE.md` and `CODEX.md` redirect here.

## Repository Map

- `source-of-truth/` -- **the four canonical documents. If any other file in this repository disagrees with one of them, the file there is right and the other is stale -- this file included.** See [`source-of-truth/README.md`](source-of-truth/README.md) for precedence between them.
  - `CREDITS_AND_PRICING.md` -- every credit price, plan price, grant, store SKU, earn mechanic, render tier and unit cost. Any pricing question is answered there and nowhere else.
  - `STORY_GENERATION_FLOW.md` -- the create flow: every field, label, ordering rule and post-generation step.
  - `STORY_PROMPT_SYSTEM.md` -- the prompt architecture (was `backend/prompts/story-generator.md`).
  - `ONBOARDING_FLOW.md` -- onboarding, both paywalls, the one-time offer, the blocked-credits sheet.
- `expo/` -- approved and active Expo SDK 54 application.
- `backend/` -- Supabase schema, migrations, Edge Functions, prompts, and backend roadmap.
- `ios-katha-ai-create-stories/` -- preserved Rork-generated iOS reference client.
- `android-katha-ai/` -- preserved Rork-generated Android reference client.
- `katha-critique/` -- critique prototype.
- `.agents/` -- local engineering skills installed outside Git. Treat them as workstation tooling, not trusted repository content.

## Working Rules

- Read `expo/CLAUDE.md`, `expo/DESIGN.md`, and `expo/BUILD_LOG.md` before changing product UI, onboarding, paywalls, or shared branding.
- Read `backend/ROADMAP.md` and `backend/build-log.md` before changing Supabase or generation infrastructure.
- **Read the relevant `source-of-truth/` document before touching what it governs** -- pricing/credits, the create flow, the prompt system, or onboarding. They are canonical; never hardcode a value that contradicts one, and never copy their tables into another file. A change that crosses two of them updates both in the same commit.
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

## Observability Gate (MANDATORY after production testing)

**Every agent session that runs a production-level test MUST persist its failures to `public.error_events`.** The skill is at `.agents/skills/error-logging/SKILL.md`; the helper is `_shared/errors.ts`.

A production-level test is any run against deployed infrastructure: a smoke suite, a generation batch, a manual `curl` against a deployed function. Supabase function logs have short retention, so a failure that produced only a `console.error` or a line of chat output is gone within days -- and every incident then gets investigated from scratch.

The rules:

1. **Every failure gets a row**, with the correct bucket (`generation.story`, `generation.cover`, `llm.provider`, `credits`, ...) and severity (`critical` / `high` / `medium` / `low`). A failure reported only in chat did not happen as far as the system is concerned.
2. **Query `error_event_summary` before fixing.** If `occurrences > 1` this is a recurrence, not a new bug, and the fix belongs at the root cause.
3. **Cite fingerprints in the build-log entry**, so `backend/build-log.md` and the log agree.
4. **Never tick a ROADMAP checkbox** for a test that was not actually run and did not actually pass.

`logError()` never throws and never blocks the response path -- a telemetry failure degrades to a console line. Keep the existing `console.error` alongside it for live tailing.

`context` stores identifiers and enums only. Never story prose, seeds, prompts, or any free user text.

## Infrastructure & Services

| Service | Purpose | Key / Config | Status |
|---------|---------|-------------|--------|
| **Supabase** | DB, Auth, Storage, Edge Functions | Project `iafeuxgoiknncgyjmugd`, Seoul (ap-northeast-2) | Live |
| **OpenAI** | Cover images (gpt-image-1) | `OPENAI_API_KEY` in Supabase secrets + `backend/.env` | Set |
| **Gemini** | Story generation primary (Gemini 3.1 Pro Preview) | `GEMINI_API_KEY` in Supabase secrets | Set, currently quota-blocked (`429 RESOURCE_EXHAUSTED`) |
| **OpenRouter** | Free-router story generation fallback | `OPENROUTER_API_KEY` in Supabase secrets | Set, currently carrying fallback traffic |
| **RunPod** | Audio narration (MiniMax Speech 02 HD) | `RUNPOD_API_KEY` in Supabase secrets; public endpoint `minimax-speech-02-hd` | Set |
| **PostHog** | Analytics (EU Cloud) | `phc_onpzv6Zkxv7SATYPHRM2oWQ7JTPmpETXV9ZHNV4b8cpm` | Set |
| **RevenueCat** | Subscriptions + credit packs + paywalls | Public SDK key in `expo/src/lib/revenuecat.ts`; webhook secret in Supabase secrets | Pending dashboard setup |
| **Firebase/FCM** | Push notifications (iOS + Android) | Requires `google-services.json` in `expo/`; `FIREBASE_SERVICE_ACCOUNT_KEY` in Supabase secrets | Not yet wired |
| **Sentry** | Error tracking | DSN | Not yet set |
| **AdMob** | Rewarded video for free credits | Needs server-side verification (SSV) | Not yet wired |

### LLM Fallback Chain

Gemini 3.1 Pro Preview -> OpenRouter `google/gemini-2.5-flash` -> OpenAI (`gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini`) -> OpenRouter Free Router. Always refund credit on total failure. Story generation uses direct provider HTTP APIs from Edge Functions; do not add Claude/Anthropic SDKs, CLI calls, or Hostinger dependencies. As of 2026-08-31 both preferred positions are blocked upstream — Gemini returns `429 RESOURCE_EXHAUSTED` and the pinned OpenRouter model returns `402 Insufficient credits` — so OpenAI `gpt-5.6-luna` is the model actually serving generation, with `gpt-5-mini` and `gpt-4o-mini` behind it and `openrouter/free` the last resort.

**Credential requirement.** Story generation reads `GEMINI_API_KEY`, then `OPENROUTER_API_KEY`, then `OPENAI_API_KEY`. Note `OPENAI_API_KEY` is currently shared with DALL·E 3 cover generation in `_shared/image.ts`, so the two share a blast radius; splitting them is a Phase A task. A missing key is classified as `not_configured` and the chain falls through to the next provider. The old Claude/Anthropic secret names are intentionally ignored.

**Model IDs:** `gemini-3.1-pro-preview`, `google/gemini-2.5-flash`, `gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini`, `openrouter/free`.

**The OpenAI position is an ordered list, not one model.** `OPENAI_MODELS` in `_shared/llm.ts` tries `gpt-5.6-luna`, then `gpt-5-mini`, then `gpt-4o-mini`. Model access is granted per OpenAI **project**, not just per org — granting at org level alone still leaves `403 ... does not have access to model`. `/v1/models` lists models the project cannot call, so it is useless as an access probe; the only reliable check is an actual completion request. Granting access upstream needs no deploy — the 403 stops happening and the better model takes over, which is exactly how Luna went live on 2026-08-31.

**Reasoning models take a different chat-completions contract.** `gpt-5.6-luna` and `gpt-5-mini` require `max_completion_tokens`, reject `max_tokens`, and ignore `temperature`; they also take `reasoning_effort: "low"`, because prose does not benefit from long deliberation and every reasoning token is latency the reader waits through. Reasoning tokens are counted *inside* that budget, so the reasoning path carries 2x headroom over the visible story length — without it a long story is truncated by the budget its own reasoning consumed. `gpt-4o-mini` and the OpenRouter path keep the legacy `max_tokens` + `temperature` shape, because OpenRouter still routes to models that only understand it. The `reasoning` flag on each `OpenAIModelSpec` selects the shape; never assume a new model shares the old one.

**Every model whose identity is known in advance is tried before the free router.** `openrouter/free` routes to a random free model per request, so its output cap, latency and prose quality are not repeatable, and free-tier daily caps apply. Production has seen it hand a *code* model a prose rewrite, and a routed model whose output cap is under `max_tokens` returns `finish_reason: "length"`, which the parser rejects. It is the last-ditch attempt before the caller refunds the credit — never a position production leans on.

**Each provider gets a bounded slice of the deadline.** `PHASE_END_SHARE` in `_shared/llm.ts` caps each phase at a cumulative fraction of `deadlineMs` (35% / 50% / 90% / 100%). Moderation retries are otherwise bounded only by the shared deadline, so one slow provider would consume the whole budget and every fallback would abort before sending a request.

**The OpenAI window is split again, per model.** The models in `OPENAI_MODELS` share the OpenAI phase, so a stalled preferred model would spend the whole window and `remainingDuration` would abort the model behind it before `fetch` was called — the same starvation, one level down. The window is divided evenly across the list so the last model is always reachable. Covered by a regression test that stalls the preferred model and asserts the fallback is still sent.

**Output is schema-constrained, not prose-requested.** `_shared/story_schema.ts` defines the story JSON schema once. Gemini receives it as `responseSchema`; OpenRouter and OpenAI receive it through `response_format` with `strict: true`. Before this, the prompt only *described* the shape, and a valid-JSON-wrong-shape response fell through to the plain-text parser, persisting a chapter with a placeholder `hook_type: "none"` and an empty `series_state` while still charging a credit.

**`max_tokens` is 16,000 for generation**, 2,000 for paragraph edits (32,000 and 4,000 as `max_completion_tokens` on the reasoning path). The previous 4,096 truncated a chapter plus its `series_state` mid-JSON.

**The chapter word band is prompt-enforced only.** `500-1500` standalone, `600-900` per series chapter. Nothing validates `word_count` before persistence, so a model that ignores the ceiling reaches the database and the user is charged — `gpt-5-mini` produced a 2,026-word chapter this way. Tracked in `backend/ROADMAP.md`.

**Provider failures are typed.** `classifyLlmError()` maps provider errors to a stable `LlmFailure` (`provider`, `model`, `code`, `status`, `retryable`) rather than storing free text in telemetry context. On total failure `generateStoryText` throws `AllProvidersFailedError`, whose `toContext()` returns identifiers and enums only — safe to pass straight to error telemetry.

### Supabase Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `audio` | Narration MP3s | Public read, service role upload |
| `covers` | Cover image PNGs | Public read, service role upload. Created 2026-08-25; 5 MB limit; `image/png`, `image/jpeg`, `image/webp` |

### Local Dev

```bash
# backend/.env (never committed)
GEMINI_API_KEY=xxx
OPENROUTER_API_KEY=xxx
OPENAI_API_KEY=xxx
REVENUECAT_WEBHOOK_SECRET=xxx
SUBSCRIPTION_GRANT_CRON_SECRET=xxx
FIREBASE_SERVICE_ACCOUNT_KEY=xxx
RUNPOD_API_KEY=xxx
ALLOWED_ORIGINS=https://REPLACE_WITH_EXPO_WEB_ORIGIN,http://localhost:8090
```

`ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist for browser clients. Native clients do not send an `Origin` header.

## Database

Schema is in `backend/supabase/migrations/`. Remote production has migrations `00001`-`00015`, `00017`-`00023`, `00025` and `00026` applied. Before adding one, read the remote state with `supabase migration list` and take the next free number from that, never from a local directory listing -- a stale branch will not show the newest files and will collide.

### Key Tables

| Migration | Tables |
|-----------|--------|
| **00001 (Core)** | `profiles`, `credit_ledger`, `stories`, `chapters`, `characters`, `comments`, `streaks`, `ad_rewards`, `referrals` |
| **00003 (Social)** | `story_reads`, `story_followers`, `user_followers`, `bookmarks`, `story_likes` |
| **00005 (Operations)** | `generation_operations`, `payment_event_backlog` |
| **00018 (Observability)** | `error_events` + `error_event_summary` view |
| **00019 (Observability grants)** | Service-role REST access to `error_events` and `error_event_summary` |
| **00020 (Observability retention)** | Non-mutating user reference for append-only error telemetry |
| **00021 (Observability summary)** | One summary row per error fingerprint |
| **00022 (Observability validation)** | Separate validation for the `error_events.user_id` foreign key |
| **00023 (Observability retention)** | Detaches `error_events.user_id` from `profiles` so profile deletion cannot mutate, delete, or be blocked by telemetry |
| **00025 (Observability erasure)** | Nulls `error_events.user_id` on profile deletion, plus on-demand erasure and a 90-day retention backstop (service role only) |
| **00026 (Subscription credits)** | `credit_balance_buckets`, `credit_chargebacks`, `credit_spend_allocations`, `credit_lapse_operations`, `revenuecat_subscriptions` |
| **Not yet created** | `device_tokens` (Phase G -- FCM/APNs token storage) |

### Credit Ledger Pattern

- Append-only. Never update rows.
- Service-only RPCs serialize mutations per user and require a new `operation_key` for idempotency without rewriting historical references.
- Balance = newest ledger row by `created_at`, then `id`.
- **Reasons:** `purchase`, `subscription`, `ad_reward`, `streak`, `feedback`, `referral`, `social`, `generation`, `welcome`, `refund`, `reader_earning`, `chargeback`, `lapse`. The column keeps every value for ledger-history compatibility, but only `purchase`, `subscription`, `streak`, `welcome`, `referral`, `generation`, `refund`, `chargeback`, and `lapse` are live under the current economy; `ad_reward`, `feedback`, `social` and `reader_earning` are retired (`source-of-truth/CREDITS_AND_PRICING.md` §5).

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
| `revenuecat-webhook` | POST | Idempotent subscription/purchase credits | Needs dashboard secret + product IDs |
| `refresh-subscription-grants` | POST | Monthly annual-plan grant refresh | Invoked by a protected scheduler |
| `generate-audio` | POST | MiniMax Speech 02 HD narration | Accepts `language` in body |
| `audio-status` | GET | Check audio generation status | Done |
| `feed` | GET | Feed endpoint | Done |
| `edit-story` | POST | Paragraph-level AI editing | Done |
| `publish-story` | POST | Mark story published, trigger cover generation | Done |
| `deduct-credit` | POST | Legacy generic endpoint | Disabled |
| `grant-credit` | POST | AdMob SSV reward verification | Disabled until SSV |

### Shared Utilities (`_shared/`)

`revenuecat.ts`, `cors.ts`, `cover-prompts.ts`, `credits.ts`, `edge-tts.ts`, `image.ts`, `llm.ts`, `operations.ts`, `prompts.ts`, `story-prompts.ts`, `story_text.ts`, `uuid.ts` (plus test files).

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

The generation pipeline lives in `backend/supabase/functions/_shared/story-prompts.ts`. Shared types in `_shared/types.ts`, validation in `_shared/validation.ts`. The prompt spec is `source-of-truth/STORY_PROMPT_SYSTEM.md`.

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

4 additional EN voices. **No voice tiers** -- every voice is available on every tier including free (`source-of-truth/CREDITS_AND_PRICING.md` decision 5).

### Pipeline

- Audio generated at publish time (both voices), cached permanently in Supabase Storage bucket `audio`.
- Storage path: `{story_id}/{chapter_id}/{voice_id}.mp3`. Public read, service role upload.
- `generate-audio` edge function accepts `language` in request body; callers must pass it explicitly.
- Language routing: EN -> RunPod, all others -> edge-tts.
- Reader shows voice toggle (female/male names from `getDefaultVoices(lang)`).
- Audio is **1 credit per chapter, unlocked permanently**, on every tier. Re-listens, pause/resume and library re-opens are free forever. See `source-of-truth/CREDITS_AND_PRICING.md` §1.
- Inngest integration for auto-generation on publish is planned but not yet wired.

## Monetization

> **`source-of-truth/CREDITS_AND_PRICING.md` is the source of truth.** The summary below exists so
> an agent reading this contract knows the shape of the economy. Every number in
> it is a copy; if it disagrees with `source-of-truth/CREDITS_AND_PRICING.md`, that file wins.
> **Do not add pricing tables to this file.**

### Product Context

**Katha AI -- Create Stories.** AI-powered mobile-first story platform. Reading is free and unlimited, forever, on every tier. Creating and listening cost credits. Separate product from Story For My Kid (storyformykid.com). Audience: adults 20-40, casual readers + aspiring writers.

### Key Product Decisions

- **Single currency: Credits.** No coins, no gems, no dual wallets. Backend tracks provenance via `credit_ledger.reason`.
- **1 credit = 1 AI action**, not 1 story. **Starting a story is 3 credits** -- cast (1) + chapter 1's words (1) + chapter 1's art (1), which becomes the cover. Each further chapter is 1, or 2 illustrated. Charged as each chapter is written, so an abandoned story costs only what it wrote.
- **Reading is free, unlimited, on every tier, forever.** No caps, no metering, no daily pass.
- **Audio is 1 credit per chapter, unlocked permanently.** No voice tiers.
- **Drafting is free**: unlimited manual editing, 3 free AI redrafts and 20 free paragraph edits per chapter, 1 free cover regeneration per paid cover.
- **A story has a planned length: 3, 7 or 15 chapters** (default 3), chosen in More options. It drives pacing and the finale, not a batch size -- the user taps Continue for each chapter, and *Write the rest* runs the same loop from chapter 3. There is no Interactive/Auto-Write mode toggle.
- **Author-only continuation.** Only the original author can add chapters.
- **Genre is single-select; themes are LLM-generated** (3-6 free-form tags per story).
- **3-credit welcome bonus**, granted only after the user declines both the paywall and the one-time offer.
- Kids mode off by default, PIN-gated in parental controls.

### Plans, packs, and grants

All plan prices, grants, packs, SKUs, trials, and offers are defined only in
`source-of-truth/CREDITS_AND_PRICING.md` §3. Do not duplicate those values here.

Rules that constrain every future change:

- **Subscription grants do not roll over**, and **credits lapse with the subscription** — when a plan ends the whole balance goes to zero, including earned and pack-purchased credits. What survives is the user's library, their unlocked audio, and free unlimited reading. Lapse must never be silent: 3-day pre-expiry warning stating the exact balance at risk, the same number in the cancellation flow. **Open item: confirm with App Review that voiding purchased pack credits is permitted** (`source-of-truth/CREDITS_AND_PRICING.md` §12).
- **A subscription must always be the best price per credit against any pack it competes with.** Re-run the inversion check in `source-of-truth/CREDITS_AND_PRICING.md` §4 whenever a price or grant changes.
- **Writer yearly is the binding constraint** at 40% margin at full burn. Test every pricing change against that row first.

### Free credit methods

> Deliberately not reproduced. `source-of-truth/CREDITS_AND_PRICING.md` §5 is the only place these amounts and limits are written down, and this file's own working rules forbid copying its tables. The mechanics are: a reading streak, a referral, and a one-off welcome bonus.

A streak is consecutive days with reading activity (one chapter finished or 60s+ dwell, recorded server-side). Missing a day resets to zero and rewards restart at day 2. The ladder is self-capping, so no monthly ceiling is enforced.

The failed-generation **auto-refund stays** (`refund_generation_operation`) but is not an earn mechanic and is not on this table.

**Removed from the economy** -- do not reintroduce without amending `source-of-truth/CREDITS_AND_PRICING.md`: rewarded-ad credits, comment/feedback rewards, social post rewards, reader earnings, the flat daily app-open credit, premium voice tiers, and the 2x carry-over cap.

**Live defect:** `create_feedback` still grants a credit for a one-character comment, daily, uncapped. Disable before launch.


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
- Do not hard-code localized pricing when RevenueCat integration begins; render from store payload.

### Product Integration Boundaries

- Email/OTP, notification permission, subscriptions, restores, and offer purchases are currently UI handoff points. Keep callbacks explicit for Supabase/RevenueCat/native wiring.
- Notification education: `Allow` is where the real native permission request must be inserted; only granted native response may set consent true.

### Production SDK Initialization

All SDK initialization runs in `App.tsx` useEffect: `initSentry()`, `initPostHog()`, `initRevenueCat()`, `setupAndroidChannel()`. All SDKs gracefully no-op when API keys are empty.

- `expo/src/lib/analytics.ts`: Sentry + PostHog. Use `trackEvent(name, props)` and `identifyUser(id, traits)`.
- `expo/src/lib/revenuecat.ts`: RevenueCat Purchases. Use offerings/packages, managed paywalls, and Customer Center.
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
supabase secrets set GEMINI_API_KEY=xxx OPENROUTER_API_KEY=xxx  # Set story-generation credentials
```

### Required Supabase Secrets

`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `SUBSCRIPTION_GRANT_CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `RUNPOD_API_KEY`, `ALLOWED_ORIGINS`.

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
| **C** | RevenueCat webhook verification + AdMob SSV verification |
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

> The four canonical documents are in `source-of-truth/` (see the Repository Map). Everything below is secondary and yields to them.

- **Strategic decisions:** `backend/references/strategic-decisions.md` -- overrides Blueprint where they conflict.
- **Product blueprint:** `backend/references/story-generator-app.md` -- original architecture spec.
- **Cover images (full reference):** `backend/COVER_IMAGES.md`.
- **Backend roadmap:** `backend/ROADMAP.md` -- phased execution plan with checklists.
- **Build log:** `backend/build-log.md` -- chronological change record.
- **Expo design contract:** `expo/DESIGN.md`.
- **Expo build log:** `expo/BUILD_LOG.md`.
