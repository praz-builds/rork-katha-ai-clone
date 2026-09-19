# Katha AI -- Repository Contract

<!-- markdownlint-disable MD013 -->

> Canonical instruction file for all agents (Claude Code, Codex, etc.).
> Both `CLAUDE.md` and `CODEX.md` redirect here.

## Repository Map

- `source-of-truth/` -- **the four canonical documents. If any other file in this repository disagrees with one of them, the file there is right and the other is stale -- this file included.** See [`source-of-truth/README.md`](source-of-truth/README.md) for precedence between them.
  - `CREDITS_AND_PRICING.md` -- every credit price, plan price, grant, store SKU, earn mechanic, render tier and unit cost. Any pricing question is answered there and nowhere else.
  - `STORY_GENERATION_FLOW.md` -- the create flow: every field, label, ordering rule and post-generation step.
  - `STORY_PROMPT_SYSTEM.md` -- the prompt architecture (was `backend/prompts/story-generator.md`).
  - `ONBOARDING_FLOW.md` -- onboarding, both paywalls, the blocked-credits sheet. (The one-time offer was removed 2026-09-10; §14 records why.)
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
5. Walk the full flow: intro timing, persona branching, form validation, building transition, notification education, personalized paywall, post-paywall OTP entry, success, Home handoff. There is no one-time offer step -- it was removed 2026-09-10 (`source-of-truth/ONBOARDING_FLOW.md` §14).

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

### Sentry push alerts (narration)

`error_events` stays the system of record for every failure -- Sentry, wired via `_shared/sentry.ts` (backend) and `captureError()` in `expo/src/lib/analytics.ts` (client), is a push notification layered on top of it, not a replacement. Both fire independently for the same failure; neither can make the other fail, and a Sentry outage never blocks or fails the response it is reporting on. The same PII rule applies to a Sentry event as to an `error_events` row: identifiers and enums only, never story prose, a seed, a prompt, or an entity name.

**Two config values must both be set before any of this reaches Sentry:**

1. `SENTRY_DSN` in Supabase secrets (backend, narration alerting).
2. `sentryDsn` in `expo/app.json` (client).

Neither is set today. A missing value is a hard no-op on that side -- the backend's SDK import is dynamic and is never even fetched without `SENTRY_DSN`, and the client's `captureError` checks whether `initSentry()` actually configured the SDK before doing anything. **Do not assume narration alerts are live without confirming both secrets are set** -- an agent (or the product owner) checking "is this wired" must check the secret, not just the code.

## Infrastructure & Services

| Service | Purpose | Key / Config | Status |
|---------|---------|-------------|--------|
| **Supabase** | DB, Auth, Storage, Edge Functions | Project `iafeuxgoiknncgyjmugd`, Seoul (ap-northeast-2) | Live |
| **Gemini** | Story generation fallback (Gemini 3.1 Pro Preview) | `GEMINI_API_KEY` in Supabase secrets | Set, currently quota-blocked (`429 RESOURCE_EXHAUSTED`) |
| **OpenRouter** | Story generation primary (Muse Spark) + free-router last resort | `OPENROUTER_API_KEY` in Supabase secrets | Set, serving all generation |
| **RunPod** | Audio narration (MiniMax Speech 02 HD) | `RUNPOD_API_KEY` in Supabase secrets; public endpoint `minimax-speech-02-hd` | Set |
| **PostHog** | Analytics (EU Cloud) | `phc_onpzv6Zkxv7SATYPHRM2oWQ7JTPmpETXV9ZHNV4b8cpm` | Set |
| **RevenueCat** | Subscriptions + credit packs + paywalls | Public SDK key in `expo/src/lib/revenuecat.ts`; webhook secret in Supabase secrets | Pending dashboard setup |
| **Firebase/FCM** | Push notifications (iOS + Android) | Requires `google-services.json` in `expo/`; `FIREBASE_SERVICE_ACCOUNT_KEY` in Supabase secrets | Not yet wired |
| **Sentry** | Error tracking, incl. narration alerting (see Observability Gate above) | `SENTRY_DSN` in Supabase secrets (backend) + `sentryDsn` in `expo/app.json` (client) | Not yet set |
| **AdMob** | Rewarded video for free credits | Needs server-side verification (SSV) | Not yet wired |

### LLM Fallback Chain

OpenRouter (`meta/muse-spark-1.3-contributor`, then `meta/muse-spark-1.3`) -> Gemini 3.1 Pro Preview -> OpenRouter Free Router. Always refund credit on total failure. Story generation uses direct provider HTTP APIs from Edge Functions; do not add Claude/Anthropic SDKs, CLI calls, or Hostinger dependencies.

**Reordered 2026-09-05.** OpenRouter now leads on all four generation paths (`generate-story`, `continue-story`, `edit-story`, `shape-story`). `OPENROUTER_MODEL` is the single configured default. `PHASE_END_SHARE` is re-balanced whenever a phase moves, because moving a phase without moving its share hands the new leader the old leader's slice and starves whoever now runs last. Cumulative shares are now **openrouter 0.92, gemini 0.96, free 1.0** (they were 0.5 / 0.65 / 0.93 / 1.0 while OpenAI held a position, then 0.7 / 0.9 / 1.0). See the callout below for why the paid phase is no longer split evenly between its two models.

> ### ⚠️ The blocking generation budget is bounded by a 150-second gateway. Read this before changing `GENERATION_DEADLINE_MS`.
>
> **Resolved 2026-09-09.** The 120s budget genuinely could not fit the work: a
> real chapter takes **55.5-76.4 seconds** (four production measurements,
> `meta/muse-spark-1.3-contributor`, 1,846-1,904 words), and the OpenRouter
> phase split its window evenly across two models, so every attempt was under
> half a chapter long. Production recorded exactly that —
> `codes: [timeout, timeout, timeout, timeout]`, `all_providers_failed`, credit
> refunded after ~126s, with a healthy credential. **Do not start by rotating
> keys.**
>
> Three things were decided, and they are now pinned by
> `_shared/llm-deadline.test.ts`:
>
> 1. **`GENERATION_DEADLINE_MS` is 125s**, not 120s and not 200s. The ceiling is
>    `EDGE_REQUEST_IDLE_TIMEOUT_MS`: Supabase returns **504 after 150 seconds
>    with no bytes sent, on every plan** (worker wall clock is 150s free / 400s
>    paid; the idle timeout does not vary). A blocking generation sends nothing
>    until it is done, so the whole handler lives under 150s. 125s of provider
>    chain + ~15s of grounding, reservation, persistence and response leaves 10s
>    of margin. **This binds `generate-story`, `edit-story` and `shape-story`.
>    It does not bind the streamed paths** — a stream's first byte arrives in
>    seconds and each chunk resets the clock, which is why `STREAM_DEADLINE_MS`
>    is 180s and is correct.
> 2. **The paid phase is not split evenly.** Under a 150s ceiling only one model
>    can be given a chapter's worth of time, so the **last** model in
>    `OPENROUTER_MODELS` owns the whole 115s window and every model in front of
>    it gets an 8s probe (`OPENROUTER_PROBE_MS`). This was sized for an account
>    where the contributor tier answered `404` in well under a second, so
>    probing it cost nothing. **That premise expired on 2026-09-09** — the
>    contributor tier is serving (see the note below the callout), so the probe
>    now spends 8s in front of a model that can actually write the chapter.
>    The fix is to **reorder the models** — a chapter does not fit in a probe —
>    rather than to widen the probe. Not done here; it belongs with a
>    generation-chain change, not with the entity-gate fix.
> 3. **There is only one real attempt, and the share table says so.** 125s
>    cannot hold two 76s generations. Gemini (0.04 share, ~5s) and the free
>    router (0.04, ~5s) exist to turn a *fast* refusal into a fallback, not to
>    write a chapter. Do not "fix" this by splitting evenly again; that is the
>    arithmetic that produced four timeouts. If the product needs a true
>    fallback chain on a blocking path, the answer is `202 Accepted` plus
>    polling, not a bigger number — a bigger number only moves the failure from
>    "credit refunded" to "504, and the client never learns what happened".
>
> **A disabled phase does not give its slice back to the phase in front of it.**
> The shares are cumulative offsets from one start, so a phase removed by
> `LLM_DISABLED_PROVIDERS` is skipped instantly and everything *after* it
> inherits the time. Gemini is disabled in production (429-exhausted since
> 2026-08-31), so the live chain is OpenRouter's 115s and then the free router.
> Making Gemini a real fallback again means moving its **share**, not just its
> secret.
>
> **Known and unfixed: the word band overshoots on the streamed path.** A
> standalone adult chapter measured 1,904 words against a 500-1,500 band, and a
> series chapter 2,116 against 600-900. The streamed path cannot retry what the
> reader has already read, so an out-of-band chapter is logged
> (`streamed_chapter_outside_band`) and kept. **Do not fix it by lowering
> `max_tokens`** — that was tried and produced a chapter with no ending; see
> the `CHAPTER_REASONING_HEADROOM_TOKENS` note in `_shared/story-stream.ts`.

**The contributor tier IS serving. Corrected 2026-09-09.** This note previously said `meta/muse-spark-1.3-contributor` was `404` by account data policy (`"Paid model training violation (account settings): 1 endpoint excluded"`) and that `meta/muse-spark-1.3` was the only model that could answer. That is no longer true and the account setting at https://openrouter.ai/settings/privacy has evidently changed: the contributor tier answered a live classification prompt in **23.4s** on 2026-09-09, and it is the model named in the successful chapter-generation timings (55.5-76.4s, 1,846-1,904 words). It is ~17x cheaper because it trains on prompts and completions, which remains a live data decision — users' story ideas and generated prose go to the provider for training — but it is a decision about whether to *keep* using it, not about whether it works.

**What this invalidates.** Anything in this file or in code comments that reasons from "`OPENROUTER_MODELS[0]` fails in a round trip and costs nothing" is now wrong, and two places depended on it: `OPENROUTER_PROBE_MS` (an 8s probe in front of the leader on the generation chain — a chapter does not fit in a probe, so **reorder the models rather than widening it**, as callout item 2 already says) and `FAST_OPENROUTER_RESERVE_MS` (sized for a fast failure). Re-read both before changing either. `meta/muse-spark-1.3` was measured on 2026-09-05 returning schema-valid JSON in ~11s and 25.5s on the classification prompt.

**Credential requirement.** Story generation reads `GEMINI_API_KEY`, then `OPENROUTER_API_KEY`. A missing key is classified as `not_configured` and the chain falls through to the next provider. The old Claude/Anthropic secret names are intentionally ignored, and so are `OPENAI_API_KEY` / `OPENAI_STORY_API_KEY` — see below.

**OpenAI is removed from every chain (2026-09-08).** The credential was revoked and is not returning, so the position it authenticated is gone from `_shared/llm.ts` and `_shared/image.ts` rather than left dormant. This matters because a keyless provider does not fail loudly — `key()` returning undefined means *skip* throughout this codebase — so a half-removed position would sit in the chain costing a branch and a slice of the generation deadline while never being able to answer. `OPENAI_API_KEY` and `OPENAI_STORY_API_KEY` are now read by nothing; a test asserts that setting either does not resurrect a provider. Its 0.28 share of the generation deadline went to the leader and to Gemini, because an unclaimed slice is not saved time, it is time the remaining phases are forbidden from using.

**Output is schema-constrained, not prose-requested.** `_shared/story_schema.ts` defines the story JSON schema once. Gemini receives it as `responseSchema`; OpenRouter receives it through `response_format` with `strict: true`. Before this, the prompt only *described* the shape, and a valid-JSON-wrong-shape response fell through to the plain-text parser, persisting a chapter with a placeholder `hook_type: "none"` and an empty `series_state` while still charging a credit.

**`max_tokens` is 16,000 for generation**, 2,000 for paragraph edits (OpenRouter doubles both for its own reasoning headroom). The previous 4,096 truncated a chapter plus its `series_state` mid-JSON. The `max_completion_tokens` / `reasoning_effort` shape went with the OpenAI position; no remaining provider accepts it.

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
REVENUECAT_WEBHOOK_SECRET=xxx
SUBSCRIPTION_GRANT_CRON_SECRET=xxx
FIREBASE_SERVICE_ACCOUNT_KEY=xxx
RUNPOD_API_KEY=xxx
ALLOWED_ORIGINS=https://REPLACE_WITH_EXPO_WEB_ORIGIN,http://localhost:8090
```

`ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist for browser clients. Native clients do not send an `Origin` header.

**Run the web app on port 8090, not 8081.** The deployed `ALLOWED_ORIGINS`
secret contains `http://localhost:8090` and does **not** contain 8081, and the
CORS preflight for a disallowed origin returns 204 with no
`Access-Control-Allow-Origin` header — so the browser silently blocks every
edge-function call and the app looks like it has no backend at all. Symptom: 0
credits, no visible error, nothing in `error_events` (the failure happens
before any handler runs). Diagnose it with:

```bash
curl -i -X OPTIONS "$SUPABASE_URL/functions/v1/bootstrap-user" \
  -H "Origin: http://localhost:8090" -H "Access-Control-Request-Method: POST"
# an allowed origin echoes back: access-control-allow-origin: http://localhost:8090
```

**Guest credits are capped at 3 grants per network per day** (`GUEST_BOOTSTRAP_WINDOW_LIMIT`).
A day of local testing exhausts that, and every new guest session then boots
with `balance: 0, rate_limited: true` — which is correct behaviour, not a bug,
and is not fixed by incognito because the window is scoped to the network.
Starting a story costs 1 credit, so a rate-limited session cannot create
anything. Top up real ledger rows with:

```bash
./scripts/grant-credits.sh all 500   # every guest session; refuses real accounts
./scripts/grant-credits.sh <uuid> 200
```

It writes through `grant_credit` with the service role, exactly as the welcome
bonus does, so the number on screen stays true. Load the app once first (that
creates the `profiles` row), run it, then reload.

### Android emulator (local, this Mac)

The dev Mac (2017 Intel MacBook Pro, 4 cores, 16 GB, macOS 13.7 Ventura) has a
full local Android toolchain, installed machine-wide in the home folder on
2026-09-14. There is no Mac app icon for it; everything runs from a terminal.

| Piece | Where |
|---|---|
| JDK 17 (Temurin) | `~/Library/Java/JavaVirtualMachines/jdk-17.0.20.1+1` |
| Android SDK | `~/Library/Android/sdk` (platform 36, build-tools 36.0.0, NDK 27.1, emulator, platform-tools) |
| AVD | `Pixel_7_API_36` (Android 16, x86_64 Google APIs image, `hw.gpu.mode=swiftshader_indirect`) |
| Env vars | `~/.android-env.sh`, sourced by `~/.bash_profile` and `~/.zshrc` |
| Dev client | `ai.katha.createstories` debug build, installed on the AVD; APK at `expo/android/app/build/outputs/apk/debug/app-debug.apk` |

**Daily routine (what "run the emulator" means).** Two terminals, in this order:

```bash
# Terminal 1: boot the phone. Restores a snapshot, well under a minute. Leave it alone.
emulator -avd Pixel_7_API_36

# Terminal 2: start Metro. Wait for "Waiting on http://localhost:8081" AND for the
# first "Android Bundled" line before touching the phone.
cd expo && pnpm start --dev-client
```

Then, on the phone: open Katha AI from the app drawer, tap the
`http://10.0.2.2:8081` row (green dot) in the Development servers list. Fast
Refresh is on; edits under `src/` show up without a rebuild.

Agent-driven variant (non-login shell, no window interaction):

```bash
. ~/.android-env.sh
emulator -avd Pixel_7_API_36 >/tmp/emulator.log 2>&1 &
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 5; done
adb reverse tcp:8081 tcp:8081
cd expo && (pnpm start --dev-client >/tmp/metro.log 2>&1 &)
adb shell am start -n ai.katha.createstories/.MainActivity
# tap the server row (1080x2400 coordinates), then screenshot to verify
adb shell input tap 533 635
adb exec-out screencap -p > /tmp/app.png
```

**Rebuild only when native code changes** (new package with native code, a
change to `app.json` plugins, or an Expo SDK bump):

```bash
cd expo && pnpm android      # = expo run:android: prebuild, Gradle, install. 20-40 min on this CPU.
```

Rules and known failure modes:
- `expo/android/` and `expo/ios/` are generated by prebuild and gitignored. Never commit them; edit `app.json` and config plugins instead.
- **Do not run the emulator while Gradle is building or Metro is doing its first bundle.** On four cores the guest starves, its clock jumps, and every open socket dies: Metro shows "Cannot connect", Supabase calls fail with status 0, and the app sits on the orange spinner. That was the 2026-09-14 "bootstrap failed" incident; Supabase was fine.
- Orange spinner that never clears = the one-shot guest bootstrap in `App.tsx` failed and does not retry. Cmd+M in the emulator window (or `adb shell input keyevent 82`) then Reload.
- GPU mode `host` crashed the emulator twice on this Mac's Radeon; `swiftshader_indirect` is persisted in the AVD config and is the only mode to use. It is CPU-rendered, so the phone is sluggish. Expect it.
- A "System UI isn't responding" dialog right after boot is the same slowness. Tap Wait.
- The RevenueCat "no public SDK key for APP_ENV=local" toast is expected in dev; purchases are disabled there by design.
- If `adb devices` is empty while the emulator window is open, the emulator crashed and is showing a crash-report dialog behind other windows. `pkill -f qemu-system-x86_64`, `rm ~/.android/avd/Pixel_7_API_36.avd/*.lock`, relaunch.
- **iOS cannot be built or simulated on this Mac.** Ventura caps Xcode at 15.2 and Expo SDK 54 needs 16.1+, and the hardware cannot upgrade past Ventura. Never suggest `expo run:ios` or the iOS Simulator here. iOS testing is the real iPhone via an EAS internal build, or an EAS iOS simulator build run in Appetize.io.
- Android-only testing covers shared JS logic but not iOS safe areas, keyboard, StoreKit purchases, ATT/notification prompts, or iOS native pod builds. Check those on the iPhone before any TestFlight or store submission.

## Database

Schema is in `backend/supabase/migrations/`. Remote production has every migration through `00090` applied (`00089` and `00090` pushed 2026-09-16) except the deliberately absent `00016` and `00024`. All **37** edge functions are deployed, so schema and code are in step. `00056` is the renumbered `story_shape_no_anonymous_ceiling` (it shared version `00046` with `engagement_persistence`, and `schema_migrations` keys on version). Before adding one, read the remote state with `supabase migration list` and take the next free number from that, never from a local directory listing -- a stale branch will not show the newest files and will collide.

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
| **00050 (Entity visibility gate)** | `stories.entity_gate_reason` + the CHECK that makes `is_public = true` with a reason set an invalid row |
| **00058 (Classification status)** | `stories.entity_classification_status` (`ok` / `unavailable` / null-for-legacy), plus `error_events.bucket` widened to accept `grounding`, `engagement` and `phrase.learning` |
| **00087 (One-credit start + auto runs)** | `begin_story_generation` deducts 1; `stories.auto_run_through_chapter`; `generation_operations.auto_run_id` / `.claimed_at`; `reserve_auto_chapter_run` and `refund_auto_chapter_run` |
| **00089 (Launch economy)** | `streak_milestones`, `tester_accounts`, `reviewer_signin_attempts`; `profiles.entitlement_override` / `.avatar_id` / `.referral_code`; `comments.credit_claimed_at` / `.credit_ledger_id`; `referrals.claimed_at` / `.credited_at` plus `unique(referred_id)`; `streak_ladder()`, `claim_comment_credit`, `ensure_identity`, `settle_referrals` |
| **00090 (Report targets + read gate)** | Target-aware `content_reports` reason and details constraints (a story's four reasons vs a comment's eight; 1,000 vs 2,000 characters); the comment-credit read gate now also requires a `story_reads` row whose **server-set** `read_at` is 60s or more older than the comment; `streak_ladder()` gets the grants every other 00089 function has; `idx_story_reads_user_story_read_at` |

### Credit Ledger Pattern

- Append-only. Never update rows.
- Service-only RPCs serialize mutations per user and require a new `operation_key` for idempotency without rewriting historical references.
- Balance = newest ledger row by `created_at`, then **`ledger_sequence`**, never `id`. UUIDs are not chronological, and `refresh_subscription_grant` writes two rows in one transaction with an identical `created_at`, so ordering by `id` returns one of them at random. `00040` fixed the six functions that still did this, and its test scans every function in `public` and fails on any new one that gets it wrong.
- **`SELECT ... FOR UPDATE SKIP LOCKED` must never be used in the credit RPCs.** They take `pg_advisory_xact_lock` plus `FOR UPDATE` on a single row keyed by `user_id`, and they must *block* under contention. Skipping would return "no row" and silently drop a deduction or a grant. `SKIP LOCKED` is correct only for independent queue rows, where skipping a row another worker already holds is the point.
- **Auto-continue pre-buys its whole run, and the run is atomic.** `story_flow = 'auto'` means the reader asked not to be interrupted, so when chapter one lands `reserve_auto_chapter_run` works out `min(chapters the balance affords, chapters left in the plan)`, reserves **all of them in one transaction** and records the last one on `stories.auto_run_through_chapter`. A partial reservation is the failure it is designed against: six affordable must mean six reserved or none. Each chapter still gets its own `generation_operations` row and its own `deduct_credit`, so every existing refund path prices a chapter by reading the debit keyed to its operation. `reserve_generation_operation` CLAIMS a pre-bought row rather than inserting a second one (`claimed_at` is what stops two requests claiming the same paid chapter), and `refund_auto_chapter_run` hands back the unused remainder through `refund_generation_operation`, which is idempotent per operation. **Auto still never extends past the plan** -- extension is a deliberate tap (`p_extend_to_chapter`, 00085). Interactive stories and the chapter-end fallback reserve one chapter at a time, unchanged.
- **Reasons:** `purchase`, `subscription`, `ad_reward`, `streak`, `feedback`, `referral`, `social`, `generation`, `welcome`, `refund`, `reader_earning`, `chargeback`, `lapse`. The column keeps every value for ledger-history compatibility, but only `purchase`, `subscription`, `streak`, `feedback`, `welcome`, `referral`, `generation`, `refund`, `chargeback`, and `lapse` are live under the current economy; `ad_reward`, `social` and `reader_earning` are retired (`source-of-truth/CREDITS_AND_PRICING.md` §5). `feedback` came back on 2026-09-16 (decision 51) as the claim `claim_comment_credit` writes, not as the retired post-time faucet.

## Grounding and the Entity Visibility Gate

Two features share one classifier and must not share one posture.

**Grounding cards** are prompt enrichment. `resolveGrounding` classifies an
idea, buys a fact card for each entity worth grounding, and caches cards per
entity in `entity_grounding` (00045). It fails open by construction: every
failure returns an empty result, and the story is written from model knowledge,
which is what every story had before the feature existed.

**The entity visibility gate** is a safety control. A story whose idea names a
`living_public_figure` or a `private_individual` is forced private
(`_shared/entity-visibility-gate.ts`, migration 00050 plus its CHECK
constraint). Historical figures, real places, real events and organisations do
**not** gate — a story about Shivaji Maharaj or the Taj Mahal is exactly what
grounding exists to serve.

> ### ⚠️ This gate was inert in production from its first deploy until 2026-09-09. Read this before changing a grounding budget.
>
> Entity classification **never once succeeded**. Every failure was silent.
> Measured on production 2026-09-09, both live models answered a
> classification-shaped prompt correctly and completely — `Taylor Swift /
> living_public_figure`, `Mumbai / real_place` — in **23.4s**
> (`meta/muse-spark-1.3-contributor`) and **25.5s** (`meta/muse-spark-1.3`).
> The code gave that call **~4.8s**: `generateFastStructuredText` defaulted to
> 8s, `FAST_OPENROUTER_SHARE` took 60% of it, and the generation path's own
> `GENERATION_GROUNDING_DEADLINE_MS` (9s) left the leading model **0 ms**. So
> `shape-story` returned `grounding_entities: []` and `gating_reason: null` for
> every idea, stories persisted `entity_gate_reason: null`, and a Taylor Swift
> story generated with `visibility: "public"` on a real account **was published
> publicly**.
>
> Four things fixed it, and they are load-bearing together:
>
> 1. **Classification is split from cards and runs concurrently with
>    generation.** `classifyIdea` gets `CLASSIFICATION_DEADLINE_MS` (40s, sized
>    from the 25.5s measurement) and is started before
>    `begin_story_generation`, then awaited when the chapter is persisted
>    55-100s later — so a realistic budget costs the writer **no** latency.
>    Cards keep `GENERATION_GROUNDING_DEADLINE_MS` (9s) because they must be in
>    the prompt before the first token, and take whatever part of the same
>    classification lands inside it (`groundingCardsWithin`). **Do not "fix"
>    latency here by shortening the classification budget, and do not put it in
>    front of the prose.**
> 2. **`FAST_OPENROUTER_SHARE` is 1.0.** OpenAI was removed from every chain on
>    2026-09-08, so the 0.4 held back for a runner-up phase was time nothing
>    was allowed to spend. Restore a fraction the day a second phase is added
>    behind the OpenRouter loop, and not before.
>
>    | fast-path call | caller budget | leading model gets, before / after |
>    |---|---|---|
>    | onboarding shape | 45s | 21.0s / 39.0s |
>    | create-studio shape | 30s | 12.0s / 24.0s |
>    | grounding cards (generation) | 9s | **0 ms** / 3.0s |
>    | entity classification (generation) | **40s** (new) | — / 34.0s |
>
>    `fastOpenRouterDeadlines(deadlineMs, models)` is the arithmetic:
>    `window = deadlineMs * FAST_OPENROUTER_SHARE`, the last model owns the
>    window, and each model in front of it gives up one
>    `FAST_OPENROUTER_RESERVE_MS` (6s) so a stalled leader can never abort the
>    runner-up before `fetch` is called. `llm.test.ts` pins every row.
> 3. **The publish decision fails closed, and only that decision.**
>    `_shared/publish.ts` refuses a public request when classification produced
>    no verdict (`classification_unavailable`), in the order guest →
>    classification unavailable → entity gate → database constraint.
>    `stories.entity_classification_status` (00058) carries the same fact to
>    `publish-story`, which refuses on the explicit value `'unavailable'` only —
>    null means "generated before 00058" and still publishes. Grounding itself
>    still fails open everywhere else.
> 4. **The failure is logged.** Every classification that fails, times out or
>    returns unparseable output writes an `error_events` row with
>    `bucket: 'grounding'`, `severity: 'high'`,
>    `errorCode: 'entity_classification_unavailable'`, and a context of
>    `failure`, `code` and `elapsed_ms` — never the idea, never an entity name.
>    `entity-classify.ts` still documents "silent failure is the contract for
>    the whole grounding path"; that contract holds for cards and **is void for
>    the gate**. A control that silently does nothing is the root cause here.
>
> **Known limit:** `shape-story`'s pre-generation warning is a courtesy, not a
> gate. It awaits shaping and grounding together in front of a waiting writer,
> so it answers only when classification is cheap. A null `gating_reason` there
> means "no warning to show", never "checked and clear". A completed
> classification cannot be cached for the later generation: `entity_grounding`
> is keyed `(canonical_name, entity_class)` per entity, and a classification is
> keyed by the idea — reusing it would need a new idea-keyed cache.

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
| `continue-story` | POST | Next chapter (author-only), max 7 chapters | Streams on `stream: true`; both transports return `story.series_state` / `story.beats` alongside the chapter |
| `reimagine-chapter` | POST | Rewrite one existing chapter, optionally recasting it | Streams on `stream: true`. Forks the story for a non-author. 1 credit, refunded on failure |
| `library` | GET | Paginated curated feed with genre filter + search; `?scope=mine` for the writer's own | Returns `cover_image_url`, `cover_status`, `chapters(count)`, `previously_summary`, `beats`, `series_state` — everything the Home "Your stories" rail and the chapter-end chips need |
| `feedback` | POST | Posts a comment. Grants nothing: since migration 00089 the credit is claimed separately through `credit-claims` | Done |
| `credit-claims` | POST | `action: "list"` returns the caller's claimable comments with their block reasons; `action: "claim"` pays one | Verifies the JWT, then calls `comment_credit_claims` / `claim_comment_credit` as service role. Every rule (40 characters, somebody else's story, a read recorded before the comment, the per-story / per-day / per-month caps) is re-derived in SQL under a lock; the function checks none of them |
| `referral` | POST | `action: "code"` returns the caller's invite code and standing; `action: "claim"` records a code entered by an account under 7 days old | Pays nothing. `claim_referral_code` records the relationship, `settle_referrals` grants both halves under `referral:referrer:{id}` and `referral:invitee:{id}` once the invitee has generated and is 24h old |
| `reviewer-signin` | POST | Exchanges the store reviewer's fixed six-digit code for a magic-link `token_hash` the client verifies | **The only new `verify_jwt = false` function** -- the reviewer has no session to present, so the protections are inside it: one allowlisted address, a peppered HMAC, a constant-time compare, an identical `401 {"error":"invalid"}` for every failure, and a per-email/per-IP lockout. `tester_accounts.user_id` is authoritative for which account the link may resolve to. **The plaintext code lives in `backend/.reviewer-code.local`, which is git-ignored, and is never written into the repository** |
| `revenuecat-webhook` | POST | Idempotent subscription/purchase credits | Needs dashboard secret + product IDs |
| `refresh-subscription-grants` | POST | Monthly annual-plan grant refresh | Invoked by a protected scheduler |
| `generate-audio` | POST | Cached narration lookup | Fresh RunPod generation is blocked until the durable 1-credit audio unlock exists |
| `audio-status` | GET | Cached narration lookup | Provider polling is blocked until jobs have a durable chapter binding |
| `feed` | GET | Feed endpoint | Done |
| `edit-story` | POST | Paragraph-level AI editing, **and** the notepad's whole-chapter save | A body with `chapter_body` takes the save path (no model, 200k char ceiling) before any paragraph validation |
| `publish-story` | POST | Mark story published, trigger cover generation | Done |
| `deduct-credit` | POST | Legacy generic endpoint | Disabled |
| `grant-credit` | POST | AdMob SSV reward verification | Disabled until SSV |

### Shared Utilities (`_shared/`)

`chapters.ts`, `character-substitution.ts`, `cors.ts`, `cover-prompts.ts`, `credits.ts`, `edge-tts.ts`, `errors.ts`, `generation-done.ts`, `guest-bootstrap.ts`, `image.ts`, `llm.ts`, `media.ts`, `operations.ts`, `prompts.ts`, `publish.ts`, `push.ts`, `reimagine.ts`, `revenuecat.ts`, `runpod.ts`, `saved-characters.ts`, `sse.ts`, `story-prompts.ts`, `story-shape.ts`, `story-stream.ts`, `story_schema.ts`, `story_text.ts`, `types.ts`, `uuid.ts`, `validation.ts`, `voices.ts` (plus test files).

### The "created" story flow (2026-09-09)

Locked product decisions are in the design handoff at `docs/design/created-flow.md`. What the backend contract says:

- **Publishing is the visibility toggle, not a step.** `generate-story` and `generate-story-stream` accept `visibility: "private" | "public"` (absent means private) and apply it the moment the first chapter is persisted — `_shared/publish.ts`. The response's `visibility` is `{ requested, applied, reason }`; `reason` is the entity gate's own enum, `account_required` (a guest asked to publish), or `gate_constraint`. There is no separate review step.
- **The `done` payload is built once**, by `_shared/generation-done.ts`, for both transports. Its nesting is `{ story, chapter, balance, model, timings, visibility }` — extend it, never flatten it. `DONE_PAYLOAD_LOCATIONS` ties every field of `STORY_OUTPUT_JSON_SCHEMA` to where it lands, and the test fails if a schema field has no home. That is what stopped `beats` and `themes` from quietly dropping out of the streamed payload.
- **Saved characters are per user** (`user_characters`, migration 00057), auto-populated from every finished story's cast. A brief may reference one by `saved_character_id`; an id the caller does not own is dropped rather than failing a paid generation.
- **Reimagining somebody else's chapter forks their story.** `fork_story` copies the row, its chapters and its cast into a private story owned by the caller, with `stories.forked_from_story_id` set. The fork is looked up before it is created, keyed on (source story, caller), so a reader ends up with one copy however many chapters they rewrite.
- **`apply_to_all_chapters` renames, it does not regenerate.** `_shared/character-substitution.ts`: whole-word and Unicode-aware, possessives follow for free, ALL CAPS is preserved, a first name stands in for a full name, a surname alone does not, and **pronouns are never rewritten**. Regenerating every chapter would cost a credit each and rewrite prose the reader chose to keep.

#### Wire shapes a client agent codes against

`reimagine-chapter` request:

```
{ story_id, chapter_number, request_id, stream?: boolean,
  prompt?: string,
  character_replacements?: [
    { from_name,
      to: { saved_character_id } | { name, appearance?, background? },
      apply_to_all_chapters: boolean } ] }
```

At least one of `prompt` and `character_replacements` is required — a rewrite with no instruction is a credit spent on a coin toss. Response (one JSON body when buffered, the `done` event's `data` when streamed):

```
{ chapter, story_id, forked_from_story_id, balance, model, timings,
  renamed: { chapters, roster } }
```

`generate-story` / `generate-story-stream` terminal payload — **this is the nesting; extend it, never flatten it**:

```
{ story:   <the story row>, plus cover_status, title, word_count,
             status: "complete", primary_genre, story_mode, series_state,
             first_line, previously_summary, themes, beats, content_rating,
             is_public,
  chapter: <the persisted chapter row: id, chapter_number, title, content,
            word_count, hook_type, hook_text, ...>,
  balance, model, timings,
  visibility: { requested, applied, reason } }
```

`continue-story` answers with `{ chapter, story: { id, series_state, beats, previously_summary }, balance, model, timings }` on **both** transports — nested under `story` on purpose, so a continuation has the same shape a first chapter does rather than a second flat spelling of the same fields.

`edit-story` takes a second, model-free path: a body carrying `chapter_body` (≤ 200,000 characters, optional `chapter_title`) is the notepad's whole-chapter save and is routed before any paragraph-edit validation. It deliberately does not use the AI path's compare-and-swap — an AI edit rewrites text it read, so a concurrent write must invalidate it; a notepad save is the writer typing at text they can see, and refusing their copy because a cover job touched the row would lose visible work. Narration is dropped either way.

`library?scope=mine` is the writer's own stories, and carries `story_mode`, `beats`, `series_state`, `planned_chapter_count` and `entity_gate_reason` beside the feed fields, because the Home rail and the chapter-end chips are rendered from a row, not from a fresh generation.

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

### Streaming (`_shared/story-stream.ts`, `generate-story-stream/`, `continue-story/`, `reimagine-chapter/`)

**Streaming is the primary transport, and it stays that way.** First prose reaches the reader at ~5.6s against a ~49s total, measured in production: an 8.8x improvement in the only latency a reader experiences. Same model, same prompt, same story. Every chapter behaves identically — a first chapter (`generate-story-stream`), a continuation (`continue-story` with `stream: true`) and a rewrite (`reimagine-chapter` with `stream: true`) share `streamChapterProse`, the same event protocol and the same `done` payload builder. A proposal to make generation blocking everywhere was raised and **retracted** on 2026-09-09; the buffered handlers remain only for retries, replays and clients that cannot stream.

Rules an agent touching this must not break:

- **Prose streams as plain text; metadata is a separate structured call.** `chapter_body` is a field inside a strict schema, so streaming it means recovering a string that is still being escaped, in an unguaranteed order. Do not try to incrementally parse the JSON. `series_state` in particular must stay behind a strict schema or series continuation breaks.
- **The metadata schema is derived from `STORY_OUTPUT_JSON_SCHEMA`, never restated.** A field added to one must not be able to go missing from the other.
- **Fallback is one-way.** A provider may be swapped before the first token and never after, because the reader has already read prose. `StreamCommittedError` marks that boundary. The credit refunds either way and whatever was shown stays on screen.
- **`STREAM_DEADLINE_MS` is 180s and is not the blocking budget.** The 150s Supabase request *idle* timeout does not bind a stream: the first byte lands in seconds and every chunk resets the clock. `GENERATION_DEADLINE_MS` (125s) exists for the blocking callers only. Do not unify the two numbers — they are bounded by different things.
- **Two timeouts, not one:** time-to-first-token (`STREAM_TTFT_MS`, 20s) and time-between-chunks (`STREAM_STALL_MS`, 25s). A single total-response timeout cannot separate "never started" from "stalled", and any value is wrong for one of them.
- **Do not size `max_tokens` to the word band.** It caps reasoning and content together, so headroom for one is headroom for the other, and it can only ever stop the model mid-word. This was tried and produced a chapter with no ending. The cap is a runaway guard; the band is stated in the prompt and reported by `chapterLengthVerdict`.
- **Client transport must be `expo/fetch`.** `supabase.functions.invoke()` buffers, and React Native's global `fetch` returns a null `response.body` -- code written against the web streaming API compiles, runs, and silently never streams.
- **Silence is abnormal; a stalled stream is replayed, not failed.** Every streamed endpoint goes through `_shared/sse.ts` (`sseStream`), which writes a `: keep-alive` comment every 15s and must not stop the run when the reader hangs up. The client (`runStreamedCall` in `expo/src/lib/api.ts`, `lib/stream-recovery.ts`) aborts after 45s with no bytes, or on a body that ends without `done`/`error`, and replays the same `request_id`: finished JSON is used as `done`, "in progress" is polled for ~3 minutes, "the previous generation failed" rotates the id. Added 2026-09-18 after a finished chapter left a reader on a 25-minute spinner. Do not add a streamed endpoint that bypasses `sseStream`.

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

## Character Portraits

`generate-character-image` draws a draft portrait from the Craft character
sheet, before any story row exists. It runs the same `_shared/image.ts` chain
as covers.

**It is rate-limited AND credited, since 2026-09-14.** Two bounds, in this
order, and neither replaces the other:

1. **12 requests/hour/user** via `claim_character_portrait_request` (migration
   00055). It bounds a burst, and it runs first so a refused burst does not also
   cost one of the six below. Unchanged.
2. **Six free character images per user, for the life of the account, then 1
   credit each** via `claim_character_image_request` (migration 00088).
   Generations and edits both count. It applies to every user — anonymous,
   free-tier and subscriber alike — and it supersedes 00084's anonymous-only
   four, carrying existing counts forward. `source-of-truth/CREDITS_AND_PRICING.md`
   §3 (*Character images*) is canonical for the number and for the fact that the
   paywall still sells "unlimited" on a plan.

One call can become six paid provider requests (two models x three safety
rungs), which is why the endpoint is bounded twice. Past the six the credit is
**reserved and refunded**, not deducted: `release_character_image_request` gives
back the credit — or the free slot — on every path that does not deliver an
image, including a 400 and the catch-all. A replayed `request_id` returns the
existing reservation rather than charging again, and a `request_id` that already
completed or refunded is answered **409 `request_id_spent`** rather than drawn a
second time.

**Every refusal fails closed.** If the claim cannot be evaluated, the endpoint
answers **503** and draws nothing — a database blip must not turn the only
bound off, and it must not hand out a free provider call either. An anonymous
caller who is out of free images and credits gets **403 `guest_portrait_cap`**
("Sign in to keep making characters."), because buying needs an account; a named
one gets **402 `insufficient_credits`**.

**One field describes a character, and it is `appearance`.** The Craft sheet
asked for a Description ("who they are") beside an Appearance ("what they look
like"), so the same person was typed twice and every prompt downstream had to
choose between two overlapping accounts. Description was retired from
collection on 2026-09-11: nothing on the client writes it, `story-prompts.ts`
and `story-shape.ts` emit a single `Appearance:` line, and the shape schema no
longer asks for it. **The `characters.description` and
`user_characters.description` columns stay, and stay readable** -- a story
written before the change has its cast only there. `characterAppearance()` in
`_shared/types.ts` is the ONE place that fallback lives; never read
`.description` directly. `generate-story` and `generate-story-stream` still
write the retired column as a mirror of `appearance`, because `_shared/media.ts`
reads the cover and chapter-art cast with `select("name, description, is_hero")`
-- delete the mirror the day those two selects read `appearance`. The reimagine
wire's `role` is the same retired field under its own name; it is still
accepted and lands in `appearance`.

**The draft portrait is drawn in the brief's `image_style`.**
`generate-character-image` accepts `image_style`, normalised by
`normalizeCoverArtStyle` (anything unrecognised, or absent, means `auto`).
Without it a writer who picked Watercolour got a house-style cast on the one
screen where they compare a portrait against the cover.

**A writer may attach a reference photo**, JPEG/PNG/WebP up to 6 MB as a data
URL. SVG is refused by allowlist — it is a document that can carry script and
remote references, not a bitmap. The image is a STYLE reference and never a
likeness target: `STYLE_REFERENCE_CLAUSE` is stated to the model *before* the
image in the message, and the reference is dropped at the last safety rung so
an attached photo cannot fail the whole ladder.

**Be accurate about what enforces that.** Code comments on this path claim the
base Safety Rules and the entity visibility gate back it up. Neither applies
here: `buildPortraitPrompt` imports nothing from `story-prompts.ts`, and the
portrait is uploaded to the public `covers` bucket before a story row exists,
so the gate — which governs `stories.is_public` — cannot reach it. Prompt text
plus the provider's own moderation is the only thing between an attached photo
and a likeness. Treat that as the known limit, not as three layers.

## Cover Image System

Chapter 1's art **is** the story's cover, and it is generated with chapter 1 rather than at publish (`source-of-truth/STORY_GENERATION_FLOW.md` decisions 38 and 40). The pipeline lives in `backend/supabase/functions/_shared/image.ts` with genre-specific prompt templates in `_shared/cover-prompts.ts`. Full reference: `backend/COVER_IMAGES.md`.

### Model & Output

- **Provider**: OpenRouter only — `google/gemini-2.5-flash-image` ("nano banana") first, then `google/gemini-3.1-flash-image`. One credential, `OPENROUTER_API_KEY`, for covers and character portraits alike.

  **This rule has changed twice.** It read "OpenAI API only. Never use other image providers", which was correct while covers were unwired: there was nothing to keep running. On 2026-09-03 OpenRouter was added behind OpenAI, because chapter 1's art is compulsory and generated on the paid path, so a single-provider pipeline meant one outage took cover generation to zero. On 2026-09-08 OpenAI was removed entirely: its key was revoked, and both positions now run on `OPENROUTER_API_KEY`. Higgsfield and any provider not named here remain banned.

  The fallback is `google/gemini-3.1-flash-image`, then `google/gemini-2.5-flash-image`, both through OpenRouter. **There is no free image model on OpenRouter** — every model advertising `image` in `output_modalities` is priced — so this is a cheaper and independent fallback, not a free one.

  **Still banned: Higgsfield, and any provider not named here.** Adding a position is a deliberate change to this rule, not an implementation detail.

  **Providers do not agree on output format, and the same provider need not stay consistent.** During evaluation, `gemini-3.1-flash-lite-image` returned JPEG for a request that `gemini-3.1-flash-image` and `gemini-2.5-flash-image` answered with PNG. Content type is therefore sniffed from magic bytes rather than assumed, the stored extension follows the actual format, and an unrecognised payload is refused rather than stored — it is far likelier to be an error body than a fourth image format. Never hardcode `image/png`.
- **Model**: `google/gemini-2.5-flash-image` ("nano banana"), with `google/gemini-3.1-flash-image` behind it.
- **Output size**: `1024x1536` portrait (2:3 ratio, native book cover format).
- **Quality**: `"medium"`.
- **Response format**: OpenRouter returns a `data:` URL on `choices[0].message.images[0].image_url.url`, not an images-endpoint `b64_json`. The decoded bytes are sniffed for their real format, never assumed — the models disagree (2.5 and 3.1 flash return PNG; 3.1-flash-lite returns JPEG).
- **Storage**: Supabase Storage `covers/{story_id}/cover.<ext>`, public read, where the extension follows the sniffed format (`png`, `jpg` or `webp`). Character portraits sit at `covers/{story_id}/characters/{character_id}.<ext>`. The public URL is authoritative for the stored path — do not reconstruct it from the requested one.

### Prompt Construction

`buildCoverPrompt()` assembles prompts from four layers:

1. **Genre config** (static per genre from `GENRE_PROMPTS`): style, palette, composition, mood, characterApproach (`"scene"` | `"silhouette"` | `"portrait"`).
2. **Story-specific context** (dynamic): title, themes (up to 4).
3. **Character integration** (dynamic): scene (the lead character placed within the scene, not posed), silhouette (a mid-distance full figure read by shape, clothing and props -- the word "silhouette" is deliberately not sent, since the appearance it came with lists facial detail), portrait (three-quarter view). No describable cast means no cast clause, in every approach.
4. **Invariant suffix**: the cover-only safe zone (top 15% free of faces; main face between 20% and 50% of the height, centred left-to-right, so the story-page hero, the 3:4 Home card and the square library card all keep it), no text/titles/words/letters/watermarks, no border/frame/decorative edge/vignette (on covers, chapter art and portraits -- no genre config may ask for a border), portrait orientation, professional book cover art quality.
5. **A picked art style opens and closes the prompt** (`Art style: ...` first, a one-line reminder last) and replaces the genre's `Visual style:` line; `auto` keeps the genre's style in its usual place.

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

- "Pixar-inspired" is a HARD BLOCK in image-model moderation. Use "3D CGI animated film style".
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
- **1 credit = 1 AI action**, not 1 story. **Charged today** (`source-of-truth/CREDITS_AND_PRICING.md` §1): starting a story is **1** -- a bundle of the cast, chapter 1's words and chapter 1's art, which becomes the cover -- then **1 per further chapter, or 2 if the story illustrates its chapters** (migration 00077, enforced in `reserve_generation_operation`). The illustrated price is taken from `stories.illustrate_chapters`, never from the caller, so a request can lower it and never raise it. A one-chapter story therefore costs **1 in total**, and a 3-chapter illustrated story is **5 = 1 + 2 + 2**.
- **The start price was settled on 2026-09-14, in the document's favour.** From 2026-09-11 this file carried the disagreement as an open decision: `source-of-truth/CREDITS_AND_PRICING.md` §Summary said a story start is **1** credit bundling three actions, `begin_story_generation` deducted **3**, and the client showed 3. Neither side was allowed to be edited to match the other, because it is a price and only the product owner can pick one. They picked 1, and **migration 00087** moved the code, the client constant (`expo/src/lib/pricing-limits.ts`) and every surface that quoted it. The numbers above are now both code and source-of-truth. `expo/src/lib/pricing.ts` still separates shipped prices from contracted ones for anything not on that list; never render a contracted price to a user.
- **Reading is free, unlimited, on every tier, forever.** No caps, no metering, no daily pass.
- **Audio is 1 credit per chapter, unlocked permanently.** No voice tiers.
- **Drafting is free**: unlimited manual editing, 3 free AI redrafts and 20 free paragraph edits per chapter, 1 free cover regeneration per paid cover.
- **Shipped today:** generation selects a Short, Standard or Long chapter band and stores a planned length of 3, 7 or 15 chapters. Continuations advance one chapter at a time and derive the finale from that stored length. The broader Create rebuild remains governed by `source-of-truth/STORY_GENERATION_FLOW.md`.
- **Author-only continuation.** Only the original author can add chapters.
- **Genre is single-select; themes are LLM-generated** (3-6 free-form tags per story).
- **3-credit welcome bonus**, granted when the user declines the paywall. (It used to require declining the one-time offer as well; that offer was removed 2026-09-10.)
- Kids mode off by default, PIN-gated in parental controls.

### Plans, packs, and grants

All plan prices, grants, packs, SKUs, trials, and offers are defined only in
`source-of-truth/CREDITS_AND_PRICING.md` §3. Do not duplicate those values here.

Rules that constrain every future change:

- **Subscription grants do not roll over**, and **credits lapse with the subscription** — when a plan ends the whole balance goes to zero, including earned and pack-purchased credits. What survives is the user's library, their unlocked audio, and free unlimited reading. Lapse must never be silent: 3-day pre-expiry warning stating the exact balance at risk, the same number in the cancellation flow. **Open item: confirm with App Review that voiding purchased pack credits is permitted** (`source-of-truth/CREDITS_AND_PRICING.md` §12).
- **A subscription must always be the best price per credit against any pack it competes with.** Re-run the inversion check in `source-of-truth/CREDITS_AND_PRICING.md` §4 whenever a price or grant changes.
- **The yearly plan is the binding constraint**, tested at the worst story shape and never the blended one. Its margin figure lives in `source-of-truth/CREDITS_AND_PRICING.md` §4 and is not copied here. Test every pricing change against that row first.
- **Country pricing is store-console work** (`source-of-truth/CREDITS_AND_PRICING.md` §3, decision 54): USD base, Google auto-convert, one manual override for India. The client renders RevenueCat's `priceString` and never converts a currency. Do not add conversion code.

### Free credit methods

> Deliberately not reproduced. `source-of-truth/CREDITS_AND_PRICING.md` §5 is the only place these amounts and limits are written down, and this file's own working rules forbid copying its tables. The mechanics are: a reading streak with a fixed ladder of milestones, a claimed comment (feedback, read-gated and capped), a code-based referral, and a one-off welcome bonus.

A streak is consecutive days with reading activity (one chapter finished or 60s+ dwell, recorded server-side). Missing a day resets to zero and rewards restart at day 2. The ladder is data (`streak_ladder()`, migration 00089) and it terminates, so no monthly ceiling is enforced on it; the feedback claim carries its own monthly cap, which is the principle-7 bound.

The failed-generation **auto-refund stays** (`refund_generation_operation`) but is not an earn mechanic and is not on this table.

**Removed from the economy** -- do not reintroduce without amending `source-of-truth/CREDITS_AND_PRICING.md`: rewarded-ad credits, social post rewards, reader earnings, the flat daily app-open credit, premium voice tiers, and the 2x carry-over cap. **Comment/feedback rewards are back as of 2026-09-16**, as a claim after a qualifying read under the caps in `source-of-truth/CREDITS_AND_PRICING.md` §5 (decision 51) -- the post-time faucet is not what returned.

**Resolved 2026-09-16:** the `create_feedback` faucet (a credit for a one-character comment, daily, uncapped) is retired by migration 00089; the RPC grants nothing and the credit is claimed through `claim_comment_credit`. **Tester accounts** (`tester_accounts`, premium override) are refused by every earn path and excluded from every metric (§9 of the pricing doc, decision 53).


## App Architecture

### Navigation

Four icon-only tabs in a floating pill, with the **Create** button beside it on the right (since PR #97, 2026-09-14; it was a raised disc in the middle of a 3-tab bar): **Home** | **Explore** | **Library** | **You** (profile) | **+ Create**. `expo/src/components/BottomTabs.tsx` is the one bar; it sits `TAB_BAR_GAP` above the bottom safe-area inset on iOS and Android, caps at `controls.tabBarMaxWidth` (480pt) on wide windows, takes its sizes from the `controls` tokens, and does not animate the switch.

- `TabKey` (`expo/src/types/domain.ts`): `"home" | "explore" | "create" | "library" | "profile"`. Profile is a real tab, not an avatar overlay.
- Every tab screen pads its scroll content by `TAB_BAR_CLEARANCE` (exported from `BottomTabs.tsx`), never a literal.
- **Home** (`expo/src/screens/HomeScreen.tsx`, one pure row-builder): Your stories -> Continue reading -> **Tonight** (`expo/src/lib/home-tonight.ts`, only when a reader answered the mood question in onboarding this session) -> Katha Originals -> one rail per onboarding genre, ordered by reads. Tonight is session-only by design ("Tonight only"); it is never persisted, and choosing Writing on the way back clears it. The order is the product owner's; do not reorder it in code.
- **Explore** (`expo/src/screens/ExploreScreen.tsx`): discovery across genres and authors (PR #86).
- **CreateStudioScreen** (`expo/src/screens/CreateStudioScreen.tsx`): the six-dropdown brief -> generating -> live reader; see "The created story flow" above and `source-of-truth/STORY_GENERATION_FLOW.md`.
- **Reader**: Substack-style engagement bar, author card, comments preview.
- **Library** (`expo/src/screens/LibraryScreen.tsx`): 3 segments -- Created, Starred, Notes.
- **You** (`expo/src/screens/ProfileScreen.tsx`): since 2026-09-16 the header is the avatar and the handle on one row with a pencil at the right, and the pencil is the only control that opens the identity editor. **There is no guest card.** The "Sign in to keep all of this" prompt is gone, because the product has no guests past the email step. **Sign out routes to the sign-in screen and leaves the device with no session** -- `signOutToSignIn` in `expo/src/lib/session.ts` clears the stored session (`scope: "local"`) and does *not* mint a replacement guest; the old `restartGuestSession` left a live anonymous identity behind the sign-in screen. Do not reintroduce it.

### Onboarding

`source-of-truth/ONBOARDING_FLOW.md` is canonical for every screen, string and transition; this section is only the map.

- Entry point: `expo/src/screens/KathaOnboardingComplete.jsx`, which composes the three-screen animated intro `KathaOnboarding.jsx` and the questionnaire `KathaOnboardingFlowV2.tsx`. It fires `onCharacterPath`, and `App.tsx` then mounts `expo/src/screens/CharacterOnboarding.tsx` (W3 pitch -> W4 Craft -> W5 email -> code -> W6 Meet -> paywall -> welcome).
- Questionnaire: name, three genre interests, then Reading / Writing / A bit of both. A **reader** then answers three questions of their own (how they like their stories, what they are in the mood for tonight, when they usually read); a writer and "both" answer two. The reader's mood feeds the Tonight rail on Home.
- **One progress row.** `expo/src/lib/onboarding-progress.ts` is the single table of steps per purpose (eight for a reader, seven for a writer or "both"); both the questionnaire and the character screens read it, and `OnboardingTopBar` draws it. W4, W5, the code screen and W6 share one pill. Do not reintroduce a second progress indicator.
- W4's CTA saves the character row and starts the portrait on the anonymous session; email/OTP covers the wait. Auth never gates the aha. Six character images per identity, then a reserved credit (migration 00088, `CREDITS_AND_PRICING.md`).
- **A name and a face are preassigned, not asked for** (2026-09-16). `ensure_identity` (migration 00089) writes a handle (`adjective_noun_NN`, checked against the reserved list) and one of the 36 creature avatars at bootstrap, so no account is ever a grey circle called "Your profile". The identity editor offers all 36 plus a photo upload; a photo clears the creature and a creature clears the photo.
- 390 x 844 geometry, light theme only, shared wordmark, fixed intro slots.
- Do not restore the prototype's "Replay the flow" action. The welcome screen hands off straight into the tabs: a writer lands on Create with the onboarding character pre-filled as the hero, a reader or "both" lands on Home (`finishCharacterOnboarding` in `App.tsx`).
- Email/OTP sits between W4 and W6 (W5 asks, the code screen verifies) so the two screens cover the portrait wait; the character already exists before the address is asked for. Do not move authentication ahead of W4, and do not reintroduce it as a gate before the aha.
- Do not hard-code localized pricing; render from the RevenueCat store payload.

### Product Integration Boundaries

- Email/OTP is live (`expo/src/lib/session.ts`, Supabase `signInWithOtp` / `verifyOtp`, UI in `components/onboarding/EmailCodeAuth.tsx`). Subscriptions, restores, and offer purchases are still UI handoff points; keep callbacks explicit for RevenueCat wiring.
- Notification permission is requested once, when the onboarding paywall closes either way (`leavePaywall` in `CharacterOnboarding.tsx` calls `enableNotifications()`). iOS grants one OS dialog per install, so do not add a second ask elsewhere; only the granted native response may set consent true.

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

`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `SUBSCRIPTION_GRANT_CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `RUNPOD_API_KEY`, `ALLOWED_ORIGINS`.

### Expo

```bash
cd expo && pnpm install                        # Install dependencies
pnpm typecheck                                 # TypeScript check
pnpm exec expo-doctor                          # Expo health check
pnpm approve-builds                            # Needed for @firebase/util, @sentry/cli, protobufjs
```

Node v22.23.0 for typecheck (v24 has tsc shim issues).

## Build Phases (Roadmap)

See `backend/ROADMAP.md` for the full phased execution plan with checklists. The Play Store go-live checklist (pre-push / post-push, dated 2026-09-16) is its own section there: `backend/ROADMAP.md` § *Play Store go-live*.

| Phase | Focus |
|-------|-------|
| **A** | Supabase project + fix critical bugs + deploy existing functions |
| **B** | Wire nano-banana cover images + MiniMax/edge-tts audio narration |
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
- After every code-changing push, wait for **CodeAnt**'s incremental review (`@codeant-ai`).
- Merge only when CodeAnt's latest review completed successfully and raised nothing outstanding, no message requests changes, all actionable conversations are resolved, required validation passes, and the branch is current with `main`.
- A green commit status alone is not approval. Read the latest review body.
- **CodeAnt skips a pull request that changes more than 100 files** and says so in a comment. A generated asset drop can trip that on a small code change -- PR #99 did, on 36 avatar files. Ask for the review explicitly with a `@codeant-ai : review` comment, and say in it which paths are worth looking at.
- Merge through GitHub and delete the feature branch afterward. Never push a merge commit directly to `main`.
- Exceptions require explicit user authorization and documentation in the pull request.

CodeAnt reviews `main` pull requests, including drafts and incremental pushes. **`.coderabbit.yaml` is still tracked and is a leftover**: CodeRabbit is no longer the reviewer that runs on this repository, and the file configures nothing today. The tracked `.githooks/pre-push` guard blocks direct local pushes to `main`; run `scripts/setup-repo.sh` once in each clone. GitHub branch protection is unavailable for this private repository on its current plan, so this documented merge gate remains mandatory.

## Reference Material

> The four canonical documents are in `source-of-truth/` (see the Repository Map). Everything below is secondary and yields to them.

- **Strategic decisions:** `backend/references/strategic-decisions.md` -- overrides Blueprint where they conflict.
- **Product blueprint:** `backend/references/story-generator-app.md` -- original architecture spec.
- **Cover images (full reference):** `backend/COVER_IMAGES.md`.
- **Backend roadmap:** `backend/ROADMAP.md` -- phased execution plan with checklists.
- **Build log:** `backend/build-log.md` -- chronological change record.
- **Expo design contract:** `expo/DESIGN.md`.
- **Expo build log:** `expo/BUILD_LOG.md`.
