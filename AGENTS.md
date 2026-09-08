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
- `docs/research/*.md` -- tracked craft-research memos backing specific `GENRE_VOICES` modules (an explicit exception in `.gitignore`; the rest of `docs/research/` and all of `docs/design/` stay gitignored, local-only agent working artifacts).
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

Findings from external scanners -- what was fixed, what was dismissed and why -- are recorded in [`SECURITY_TRIAGE.md`](SECURITY_TRIAGE.md). Add to it rather than re-triaging the same advisory next quarter.

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
| **Gemini** | Story generation fallback (Gemini 3.1 Pro Preview) | `GEMINI_API_KEY` in Supabase secrets | Set, currently quota-blocked (`429 RESOURCE_EXHAUSTED`) |
| **OpenRouter** | Story generation primary (Muse Spark) + free-router last resort | `OPENROUTER_API_KEY` in Supabase secrets | Set, serving all generation |
| **RunPod** | Audio narration (MiniMax Speech 02 HD) | `RUNPOD_API_KEY` in Supabase secrets; public endpoint `minimax-speech-02-hd` | Set |
| **PostHog** | Analytics (EU Cloud) | `phc_onpzv6Zkxv7SATYPHRM2oWQ7JTPmpETXV9ZHNV4b8cpm` | Set |
| **RevenueCat** | Subscriptions + credit packs + paywalls | Public SDK key in `expo/src/lib/revenuecat.ts`; webhook secret in Supabase secrets | Pending dashboard setup |
| **Firebase/FCM** | Push notifications (iOS + Android) | Requires `google-services.json` in `expo/`; `FIREBASE_SERVICE_ACCOUNT_KEY` in Supabase secrets | Not yet wired |
| **Sentry** | Error tracking | DSN | Not yet set |
| **AdMob** | Rewarded video for free credits | Needs server-side verification (SSV) | Not yet wired |

### LLM Fallback Chain

OpenRouter (`meta/muse-spark-1.3-contributor`, then `meta/muse-spark-1.3`) -> Gemini 3.1 Pro Preview -> OpenAI (`gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini`) -> OpenRouter Free Router. Always refund credit on total failure. Story generation uses direct provider HTTP APIs from Edge Functions; do not add Claude/Anthropic SDKs, CLI calls, or Hostinger dependencies.

**Reordered 2026-09-05.** OpenRouter now leads on all four generation paths (`generate-story`, `continue-story`, `edit-story`, `shape-story`). `OPENROUTER_MODEL` is the single configured default. `PHASE_END_SHARE` was re-balanced with the reorder — cumulative shares are openrouter 0.5, gemini 0.65, openai 0.93, free 1.0 — because moving a phase without moving its share hands the new leader the old leader's slice and starves whoever now runs last.

**The contributor tier is `404` until an account setting changes.** `meta/muse-spark-1.3-contributor` is ~17x cheaper because it trains on prompts and completions, and the OpenRouter account's privacy setting blocks training-tier endpoints: `"Paid model training violation (account settings): 1 endpoint excluded"`. Change it at https://openrouter.ai/settings/privacy — that is a data decision (users' story ideas and generated prose go to the provider for training), and no deploy is involved either way. Until then `meta/muse-spark-1.3` serves; it was measured on 2026-09-05 returning schema-valid JSON in ~11s.

**Credential requirement.** Story generation reads `GEMINI_API_KEY`, then `OPENROUTER_API_KEY`, then `OPENAI_STORY_API_KEY` falling back to `OPENAI_API_KEY`. A missing key is classified as `not_configured` and the chain falls through to the next provider. The old Claude/Anthropic secret names are intentionally ignored.

**Set `OPENAI_STORY_API_KEY` to stop stories and covers sharing a blast radius.** `OPENAI_API_KEY` also authenticates `gpt-image-1` in `_shared/image.ts`. While it is the only key set, one spend cap, rate limit, revocation or rotation takes down covers *and* stories together — and with Gemini and OpenRouter unavailable, every position that can serve authenticates with it. The code already prefers the dedicated key; setting the secret is the whole change, and leaving it unset preserves current behaviour.

**Model IDs:** `meta/muse-spark-1.3-contributor`, `meta/muse-spark-1.3`, `gemini-3.1-pro-preview`, `gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `openrouter/free`. (`google/gemini-2.5-flash` held the OpenRouter position until 2026-09-05.)

**The OpenAI position is an ordered list, not one model.** `OPENAI_MODELS` in `_shared/llm.ts` tries `gpt-5.6-luna`, then `gpt-5-mini`, then `gpt-4o-mini`. Model access is granted per OpenAI **project**, not just per org — granting at org level alone still leaves `403 ... does not have access to model`. `/v1/models` lists models the project cannot call, so it is useless as an access probe; the only reliable check is an actual completion request. Granting access upstream needs no deploy — the 403 stops happening and the better model takes over, which is exactly how Luna went live on 2026-08-31.

**Reasoning models take a different chat-completions contract.** `gpt-5.6-luna` and `gpt-5-mini` require `max_completion_tokens`, reject `max_tokens`, and ignore `temperature`; they also take `reasoning_effort: "low"`, because prose does not benefit from long deliberation and every reasoning token is latency the reader waits through. Reasoning tokens are counted *inside* that budget, so the reasoning path carries 2x headroom over the visible story length — without it a long story is truncated by the budget its own reasoning consumed. `gpt-4o-mini` and the OpenRouter path keep the legacy `max_tokens` + `temperature` shape, because OpenRouter still routes to models that only understand it. The `reasoning` flag on each `OpenAIModelSpec` selects the shape; never assume a new model shares the old one.

**The Muse Spark models reason inside `max_tokens`, and that is how they fail silently.** Measured 2026-09-05: `max_tokens: 1200` with no reasoning control returned HTTP `200`, `finish_reason: "length"`, 1,197 reasoning tokens and an **empty content string**; `max_tokens: 8000` with `reasoning: {effort: "low"}` returned clean JSON on 957 reasoning + 1,408 completion tokens. So `openRouterRequestShape` sends an explicit `reasoning: { effort: "low" }` and floors the budget at `OPENROUTER_MIN_OUTPUT_TOKENS` (8,000) on top of a 2x multiplier — a multiplier alone leaves the paragraph editor at 4,000 and the onboarding shaping call at 1,800, which is the failing row. An empty-content `200` is rejected at the provider boundary by `openAICompatibleContent` and falls through to the next model; it must never be treated as a usable result. Reasoning tokens bill at the completion rate, so cost per call is far above prompt-plus-visible-output.

**Every model whose identity is known in advance is tried before the free router.** `openrouter/free` routes to a random free model per request, so its output cap, latency and prose quality are not repeatable, and free-tier daily caps apply. Production has seen it hand a *code* model a prose rewrite, and a routed model whose output cap is under `max_tokens` returns `finish_reason: "length"`, which the parser rejects. It is the last-ditch attempt before the caller refunds the credit — never a position production leans on.

**Each provider gets a bounded slice of the deadline.** `PHASE_END_SHARE` in `_shared/llm.ts` caps each phase at a cumulative fraction of `deadlineMs` (35% / 50% / 90% / 100%). Moderation retries are otherwise bounded only by the shared deadline, so one slow provider would consume the whole budget and every fallback would abort before sending a request.

**The OpenAI window is split again, per model.** The models in `OPENAI_MODELS` share the OpenAI phase, so a stalled preferred model would spend the whole window and `remainingDuration` would abort the model behind it before `fetch` was called — the same starvation, one level down. The window is divided evenly across the list so the last model is always reachable. Covered by a regression test that stalls the preferred model and asserts the fallback is still sent.

**Output is schema-constrained, not prose-requested.** `_shared/story_schema.ts` defines the story JSON schema once. Gemini receives it as `responseSchema`; OpenRouter and OpenAI receive it through `response_format` with `strict: true`. Before this, the prompt only *described* the shape, and a valid-JSON-wrong-shape response fell through to the plain-text parser, persisting a chapter with a placeholder `hook_type: "none"` and an empty `series_state` while still charging a credit.

**`max_tokens` is 16,000 for generation**, 2,000 for paragraph edits (32,000 and 4,000 as `max_completion_tokens` on the reasoning path). The previous 4,096 truncated a chapter plus its `series_state` mid-JSON.

**The chapter word band is enforced, not just requested.** `wordBandFor()` in `_shared/types.ts` is the single source of truth — `600-900` for a series chapter whatever the audience, `500-1200` standalone kids, `500-1500` standalone adult — and both the prompt and `requireUsableStoryOutput()` read it. A generation outside `wordBandBounds()` (0.75x floor, 1.25x ceiling) is unusable and falls through to the next provider like malformed JSON; drift inside the tolerance is logged only. The count comes from `chapter_body`, never from the model's self-reported `word_count`, because a model that ignores the band is not a reliable narrator of how badly it ignored it. Before this, nothing checked the result and `gpt-5-mini` had a 2,026-word chapter persisted and charged for.

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

Schema is in `backend/supabase/migrations/`. Remote production has every migration through `00041` applied except the deliberately absent `00016` and `00024`. Before adding one, read the remote state with `supabase migration list` and take the next free number from that, never from a local directory listing -- a stale branch will not show the newest files and will collide.

`_test.ts` files live alongside the `.sql` in this directory. The CLI skips them by filename pattern, which is why they are safe there, but they are not migrations and must never be numbered as if they were.

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
| **00034-00036 (Story shape + plan)** | `story_shape_rate_limits`, `anonymous_story_shape_rate_limits`, `anonymous_story_shape_global_limits`, `stories.beats` |
| **00035 (Guest bootstrap)** | `anonymous_bootstrap_rate_limits`, `anonymous_bootstrap_global_limits` |
| **00037 (Push)** | `push_tokens` |
| **00038-00041 (Hardening)** | Profile update policy, shape-claim ordering, ledger tie-breaker, `characters.story_id` index |
| **00043-00044 (Comments + covers)** | Threaded comments/votes/moderation, cover regeneration counters |
| **00045 (Entity grounding)** | `entity_grounding` (shared expiring fact-card cache, service-role only), `stories.grounding`, `stories.grounding_entities` |

### Credit Ledger Pattern

- Append-only. Never update rows.
- Service-only RPCs serialize mutations per user and require a new `operation_key` for idempotency without rewriting historical references.
- Balance = newest ledger row by `created_at`, then **`ledger_sequence`**, never `id`. UUIDs are not chronological, and `refresh_subscription_grant` writes two rows in one transaction with an identical `created_at`, so ordering by `id` returns one of them at random. `00040` fixed the six functions that still did this, and its test scans every function in `public` and fails on any new one that gets it wrong.
- **`SELECT ... FOR UPDATE SKIP LOCKED` must never be used in the credit RPCs.** They take `pg_advisory_xact_lock` plus `FOR UPDATE` on a single row keyed by `user_id`, and they must *block* under contention. Skipping would return "no row" and silently drop a deduction or a grant. `SKIP LOCKED` is correct only for independent queue rows, where skipping a row another worker already holds is the point.
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
| `generate-story` | POST | Auth -> reserve credit -> LLM -> persist -> return | Buffered path. Kept for retries, replays, and non-streaming clients |
| `generate-story-stream` | POST | The same contract, delivered as Server-Sent Events | **Preferred path.** First prose at ~5.6s against a ~49s total |
| `shape-story` | POST | One structured call: title, cast, beats, opening | Onboarding + Create studio; rate-limited per user and per network |
| `bootstrap-user` | POST | Anonymous profile + welcome grant, rate-limited | Must run before any other authed call: several tables FK to `profiles` |
| `register-push-token` | POST | Upsert an Expo push token for the caller | Done |
| `send-push` | POST | Service-role fan-out via Expo, with receipt handling | Not yet wired to a completion path |
| `continue-story` | POST | Next chapter (author-only), max 7 chapters | Text path done |
| `library` | GET | Paginated curated feed with genre filter + search | Done |
| `feedback` | POST | Comments + one-time feedback credit reward | Done |
| `revenuecat-webhook` | POST | Idempotent subscription/purchase credits | Needs dashboard secret + product IDs |
| `refresh-subscription-grants` | POST | Monthly annual-plan grant refresh | Invoked by a protected scheduler |
| `generate-audio` | POST | Cached narration lookup | Fresh RunPod generation is blocked until the durable 1-credit audio unlock exists |
| `audio-status` | GET | Cached narration lookup | Provider polling is blocked until jobs have a durable chapter binding |
| `feed` | GET | Feed endpoint | Done |
| `edit-story` | POST | Paragraph-level AI editing | Done |
| `publish-story` | POST | Mark story published, trigger cover generation | Done |
| `deduct-credit` | POST | Legacy generic endpoint | Disabled |
| `grant-credit` | POST | AdMob SSV reward verification | Disabled until SSV |

### Shared Utilities (`_shared/`)

`chapters.ts`, `cors.ts`, `cover-prompts.ts`, `credits.ts`, `edge-tts.ts`, `errors.ts`, `guest-bootstrap.ts`, `image.ts`, `llm.ts`, `media.ts`, `operations.ts`, `prompts.ts`, `push.ts`, `revenuecat.ts`, `runpod.ts`, `story-prompts.ts`, `story-shape.ts`, `story-stream.ts`, `story_schema.ts`, `story_text.ts`, `types.ts`, `uuid.ts`, `validation.ts`, `voices.ts` (plus test files).

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

## Story Generation System (v6)

The generation pipeline lives in `backend/supabase/functions/_shared/story-prompts.ts`. Shared types in `_shared/types.ts`, validation in `_shared/validation.ts`. The prompt spec is `source-of-truth/STORY_PROMPT_SYSTEM.md`.

### Architecture (v6 modular layers)

System prompts are assembled from 9 layers:
1. **Base craft + safety** -- anti-slop, show-don't-tell, rhythm, dialogue, formatting, safety rules
2. **Story engine** -- protagonist, want, obstacle, stakes, irreversible choice, emotional turn, genre payoff, final image
3. **Primary genre module** -- 19 voice modules with voice/pacing/what-works/what-to-avoid
4. **Audience mode** -- kids constraints (ages 4-10, 500-1200 words, safe content)
5. **Identity lens** -- queer lens guidance
6. **Spice module** -- sweet (fade to black), steamy (sensuality on-page), explicit (feature-flagged)
7. **Continuation/finale** -- mid-series and finale rules
8. **Language** -- 15 supported languages
9. **Output schema** -- structured JSON output format

API:
- `buildStorySystemPrompt({ primaryGenre, audienceMode?, identityLenses?, spiceLevel?, language?, chapterLength?, plannedChapterCount? })` -- modular system prompt.
- `buildContinuationSystemPrompt({ ...above, mode: "chapter" | "finale" })` -- continuation prompt.
- `buildUserPrompt({ primaryGenre, audienceMode?, spiceLevel?, seed, characters?, language?, storyValues?, writingStyle?, avoid?, chapterLength?, plannedChapterCount? })` -- user message.
- Old 2-arg signatures (`buildStorySystemPrompt(genre, language)`) still work as deprecated wrappers.

### Taxonomy

- **19 primary genres**: romance, romantasy, darkRomance, cozyFantasy, paranormalRomance, fantasy, scifi, thriller, mystery, horror, contemporary, historical, adventure, comedy, poetry, educational, fanfiction, folktale, sliceOfLife.
- **12 UI genres** (2026-09-08 taxonomy), in display order: adventure, comedy, educational, fanfiction, folktale, historical, scifi, fantasy, mystery, horror, sliceOfLife, romance (romance deliberately last). `UI_GENRE_ORDER` in `_shared/types.ts` is the canonical order.
- **7 DB-only genres, removed from the UI but never from the database**: romantasy, darkRomance, paranormalRomance, cozyFantasy, poetry, thriller, contemporary. A story already written in one keeps reading, continuing and rendering in that genre's own voice module forever -- only a NEW submission of one is migrated (see below). This follows the precedent this same rule set before 2026-09-08 for cozyFantasy and paranormalRomance.
- **2 audience modes**: adult (default), kids (full-width segmented control in Shape).
- **Spice levels**: sweet (default), steamy. `explicit` was retired 2026-09-07 (not merely feature-flagged) -- see `source-of-truth/STORY_PROMPT_SYSTEM.md`. Spice itself left the product surface 2026-09-08: there is no user-facing spice picker any more, and an ABSENT `spice_level` is a first-class safe path that defaults per genre (`GENRE_DEFAULT_SPICE`, `sweet` as the final backstop) rather than an edge case. Inferring spice from the story idea's own prose is a stated follow-up, not yet implemented.
- **Identity lenses**: queer.
- **Genre migration map** (`GENRE_MIGRATION_MAP` in `_shared/types.ts`, applied only to new submissions, never to a stored value): drama/darkAcademia -> contemporary, mythology -> fantasy, kids/bedtime -> adventure, lgbtq/motivational/spirituality -> contemporary, thriller -> mystery, contemporary -> sliceOfLife, poetry -> folktale, romantasy/darkRomance/paranormalRomance -> romance, cozyFantasy -> fantasy.
- **Researched voice modules (2026-09-08)**: educational, fanfiction and folktale's first-pass `GENRE_VOICES` modules were revised against a dedicated craft-research pass (`docs/research/educational.md`, `docs/research/fanfiction.md`, `docs/research/folktale.md`; tracked, not gitignored -- see `.gitignore`'s `docs/research/*.md` exception). Folktale's module explicitly names, in its own text, each global craft rule it suspends (Show Don't Tell for interiority, Sentence Rhythm for repetition, the anti-cliche instinct and the pacing "don't resolve too neatly" rule for formulaic open/close) rather than silently contradicting them -- no other genre gets these carve-outs, and the base rules are unchanged for everyone else. Two memo recommendations are deliberately NOT implemented yet: educational's fact/fiction closing-disclosure mechanism (a schema change, not a prompt change) and fanfiction's grounding extension (a new `EntityClass` and `GroundingCard` fields, owned by a separate workstream -- do not implement alongside unrelated genre-module work). Full detail in `source-of-truth/STORY_PROMPT_SYSTEM.md`'s Genre Modules and Deferred Research Recommendations sections.
- **Mystery absorbs Thriller's engine for new submissions; Slice of Life inherits Contemporary's module by reference** (2026-09-08). Mystery and Thriller have different engines (puzzle-and-revelation vs. dread-and-momentum); `GENRE_VOICES.mystery` was rewritten to cover both rather than concatenated, and `GENRE_VOICES.thriller` stays untouched so an existing thriller story keeps its own module. `GENRE_VOICES.sliceOfLife` and `GENRE_VOICES.contemporary` point at the same `CONTEMPORARY_VOICE` object in `story-prompts.ts` rather than duplicating the text, so the two genres cannot silently drift apart.

### Quality Rules (enforced in every generation)

- **43 banned AI-overused words** (delve, tapestry, testament, etc.)
- **42 banned cliche phrases** (eyes widened, breath caught, heart pounded, etc.)
- **10 banned AI-default names** (Elara, Seraphina, Lysander, etc.)
- Show-don't-tell enforcement, sentence rhythm variation, dialogue craft (said-only tags, distinct voices, interruptions), sensory grounding (2+ senses beyond sight per scene).
- No em dashes, no meta-commentary, no purple prose.

### Structured Output

LLM returns JSON: `{ title, chapter_title, chapter_body, word_count, themes, first_line, previously_summary }`. Parsed by `parseStructuredOutput()` with text-based fallback via `parseGeneratedStoryText()`.

### Streaming (`_shared/story-stream.ts`, `generate-story-stream/`)

The preferred generation path. First prose reaches the reader at ~5.6s against a ~49s total, measured in production: an 8.8x improvement in the only latency a reader experiences. Same model, same prompt, same story.

Rules an agent touching this must not break:

- **Prose streams as plain text; metadata is a separate structured call.** `chapter_body` is a field inside a strict schema, so streaming it means recovering a string that is still being escaped, in an unguaranteed order. Do not try to incrementally parse the JSON. `series_state` in particular must stay behind a strict schema or series continuation breaks.
- **The metadata schema is derived from `STORY_OUTPUT_JSON_SCHEMA`, never restated.** A field added to one must not be able to go missing from the other.
- **Fallback is one-way.** A provider may be swapped before the first token and never after, because the reader has already read prose. `StreamCommittedError` marks that boundary. The credit refunds either way and whatever was shown stays on screen.
- **Two timeouts, not one:** time-to-first-token and time-between-chunks. A single total-response timeout cannot separate "never started" from "stalled", and any value is wrong for one of them.
- **Do not size `max_tokens` to the word band.** It caps reasoning and content together, so headroom for one is headroom for the other, and it can only ever stop the model mid-word. This was tried and produced a chapter with no ending. The cap is a runaway guard; the band is stated in the prompt and reported by `chapterLengthVerdict`.
- **Client transport must be `expo/fetch`.** `supabase.functions.invoke()` buffers, and React Native's global `fetch` returns a null `response.body` -- code written against the web streaming API compiles, runs, and silently never streams.

**Known open item:** this model overshoots the word band, writing 2,056-2,331 words against a 1,200-1,600 band with the band stated twice in the prompt. The streamed path cannot retry what has been read. Either the bands move or the model does, and `source-of-truth/CREDITS_AND_PRICING.md` moves with it because narration is priced per word.

### Validation

`validateGenerationRequest()` in `_shared/validation.ts`:
- Normalizes genre via migration map
- Forces sweet spice in kids mode
- Rejects darkRomance in kids mode
- Rejects explicit spice (MVP gate)
- Clamps spice to genre-allowed set
- Strips identity lenses in kids mode
- One non-whitespace-character seed minimum, 1000-char ceiling

`deriveContentRating(audienceMode, spiceLevel)` -> kids/steamy/explicit/sweet (stored on story row).

### Series Length

`planned_chapter_count` is 3, 7 or 15. `continue-story` enforces that stored
limit and automatically treats its final planned chapter as a finale. An
optional `is_finale` flag can end a series early.

### Cultural Context

The AI infers cultural context from character names, traits, and story language. No explicit culture/ethnicity field -- inference from names and traits is the design choice.

### Input Requirements

- **Story idea**: one non-whitespace character minimum, 1000-character ceiling.
- **Characters**: optional, maximum 3; detailed fields live in the Craft character screen.
- **Genre**: required primary genre, with up to two editable secondary genre tags.
- **Language**: new Create submissions support English and Portuguese. Existing stories retain legacy language support.

## Cover Image System

Chapter 1's art **is** the story's cover, and it is generated with chapter 1 rather than at publish (`source-of-truth/STORY_GENERATION_FLOW.md` decisions 38 and 40). The pipeline lives in `backend/supabase/functions/_shared/image.ts` with genre-specific prompt templates in `_shared/cover-prompts.ts`. Full reference: `backend/COVER_IMAGES.md`.

### Model & Output

- **Provider**: OpenAI `gpt-image-1` first, then OpenRouter as fallback.

  **This rule changed on 2026-09-03.** It read "OpenAI API only. Never use other image providers", and that was correct while covers were unwired: there was nothing to keep running. Now that chapter 1's art is compulsory and generated on the paid path, a single-provider image pipeline means one OpenAI outage, spend cap or per-project entitlement gap takes cover generation to zero — and `OPENAI_API_KEY` is shared with story generation, so the two have one blast radius.

  The fallback is `google/gemini-3.1-flash-image`, then `google/gemini-2.5-flash-image`, both through OpenRouter. **There is no free image model on OpenRouter** — every model advertising `image` in `output_modalities` is priced — so this is a cheaper and independent fallback, not a free one.

  **Still banned: Higgsfield, and any provider not named here.** Adding a position is a deliberate change to this rule, not an implementation detail.

  **Providers do not agree on output format, and the same provider need not stay consistent.** During evaluation, `gemini-3.1-flash-lite-image` returned JPEG for a request that `gemini-3.1-flash-image` and `gemini-2.5-flash-image` answered with PNG. Content type is therefore sniffed from magic bytes rather than assumed, the stored extension follows the actual format, and an unrecognised payload is refused rather than stored — it is far likelier to be an error body than a fourth image format. Never hardcode `image/png`.
- **Model**: `gpt-image-1`.
- **Output size**: `1024x1536` portrait (2:3 ratio, native book cover format).
- **Quality**: `"medium"`.
- **Response format**: OpenAI returns base64 (`b64_json`); OpenRouter returns a `data:` URL on `choices[0].message.images[0].image_url.url`. Two shapes, two readers — do not reuse one for the other.
- **Storage**: Supabase Storage `covers/{story_id}/cover.<ext>`, public read, where the extension follows the sniffed format (`png`, `jpg` or `webp`). Character portraits sit at `covers/{story_id}/characters/{character_id}.<ext>`. The public URL is authoritative for the stored path — do not reconstruct it from the requested one.

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

### 19 Genre Prompt Configs

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
| educational | clean editorial, crisp linework | chalkboard teal, warm marigold, cream paper white | scene |
| fanfiction | vibrant fan-art, glossy digital-painting | saturated duotone accents, deep contrast background | portrait |
| folktale | woodcut-inspired, bold flat shapes | burnt umber, mustard gold, forest green | silhouette |

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
- **1 credit = 1 AI action**, not 1 story. **Charged today: 1 credit per generation** -- `generate-story` makes exactly one reservation, because neither the cast nor chapter art is built. **Contracted** (`source-of-truth/CREDITS_AND_PRICING.md` §1, not yet shipped): starting a story is 3 -- cast + chapter 1's words + chapter 1's art, which becomes the cover -- then 1 per further chapter, or 2 illustrated. `expo/src/lib/pricing.ts` keeps the two apart; never render a contracted price to a user.
- **Reading is free, unlimited, on every tier, forever.** No caps, no metering, no daily pass.
- **Audio is 1 credit per chapter, unlocked permanently.** No voice tiers.
- **Drafting is free**: unlimited manual editing, 3 free AI redrafts and 20 free paragraph edits per chapter, 1 free cover regeneration per paid cover.
- **Shipped today:** generation selects a Short, Standard or Long chapter band and stores a planned length of 3, 7 or 15 chapters. Continuations advance one chapter at a time and derive the finale from that stored length. The broader Create rebuild remains governed by `source-of-truth/STORY_GENERATION_FLOW.md`.
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
