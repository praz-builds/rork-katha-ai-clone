# Katha AI Monorepo Build Log

<!-- markdownlint-disable MD013 -->

## 2026-08-31 — Story generation moved off Anthropic to a four-provider chain

Story generation no longer reads any Claude/Anthropic credential. `_shared/llm.ts` calls provider HTTP APIs directly, in order, and refunds the credit only if every position fails. Merged as PRs #39, #40 and #41.

```
gemini-3.1-pro-preview
  -> OpenRouter google/gemini-2.5-flash   (pinned, priced)
  -> OpenAI: gpt-5.6-luna, gpt-5-mini, gpt-4o-mini
  -> openrouter/free                      (last resort)
```

`gpt-5.6-luna` serves production today. Full engineering detail is in `backend/build-log.md`; this entry records what matters at the monorepo level.

### Three things worth carrying forward

- **`openrouter/free` is not a fallback position.** It routes to a random free model per request. In production it served a paragraph rewrite from `cohere/north-mini-code:free` — a code model writing prose — and timed out on a story generation. Every model whose identity is known in advance now runs ahead of it.
- **OpenAI model access is per-project, not per-org.** Granting Luna at org level left `403 Project ... does not have access to model` in place. Worse, `GET /v1/models` listed Luna throughout the outage: that endpoint returns the catalogue, not the entitlement, so it cannot be used to probe access. Only a real completion request settles it.
- **Persistent failure telemetry paid for itself immediately.** `public.error_events` (migration `00018`) diagnosed a total-chain outage from one row — the parallel `models`, `codes` and `statuses` arrays reading `gemini=rate_limited/429`, `gemini-2.5-flash=provider_error/402`, `gpt-5.6-luna=auth_failed/403`, `openrouter/free=timeout` (a client-side abort, so its `status` is null) — with no log spelunking. Fingerprints `e113a07ec4385e039cd8453b37d69c9d` and `c3cdcc232b713a738c724bb5a65bb111`, `occurrences = 1` each, neither recurring since. The `AGENTS.md` Observability Gate now requires every production-level test to persist its failures this way.

### Schema

Migrations `00018`-`00023` and `00025` applied to `iafeuxgoiknncgyjmugd`. `error_events.user_id` is a detached identifier: profile deletion can neither be blocked by nor rewrite append-only telemetry, and `00025` supplies the erasure path that detaching otherwise removed — an `AFTER DELETE` trigger, an on-demand `erase_user_error_telemetry(uuid)`, and a 90-day retention backstop, all service-role only, all preserving the event row.

### Verification

- 128 Deno tests, `deno fmt --check` and `deno check` clean; Expo typecheck, lint, Jest and web export pass.
- Production `smoke-app-surface.py` **26 / 26** and `smoke-series-generation.py` **58 / 58**.
- Quality read across romance / thriller / fantasy: 1085-1353 words, in band, distinct openings and titles.

### Known risks — both closed on the code side 2026-09-03

- **One credential behind everything.** `OPENAI_API_KEY` authenticated DALL·E 3 covers *and* story text, so one spend cap or rotation took down both. `_shared/llm.ts` now reads `OPENAI_STORY_API_KEY` ahead of it while `_shared/image.ts` keeps the original. Setting that secret is the entire remaining change; leaving it unset preserves current behaviour.
- **The chapter word band was prompt-enforced only** — `gpt-5-mini` had a 2,026-word chapter against a 500-1500 band persisted and charged for. `wordBandFor()` is now the single source of truth for prompt and validation alike, and a generation outside 0.75x-1.25x of the band falls through to the next provider instead of reaching the database. Every length instruction in `story-prompts.ts` — base rules, Kids Mode, continuation rules and the user prompt — is rendered from that band rather than from its own copy of the numbers, so there is no longer a string literal that can disagree with the validator.

Both remaining items are account actions with no deploy behind them: set `OPENAI_STORY_API_KEY`, and clear the Gemini (`429`) or OpenRouter (`402`) billing block to restore provider-level redundancy ahead of OpenAI.

## 2026-08-22 — Canonical Repository Consolidation

- Confirmed `praz-builds/rork-katha-ai-clone` as the canonical product repository.
- Added the approved Expo SDK 54 application under `expo/` while preserving the existing Swift and Kotlin clients.
- Imported the complete `praz-builds/katha-ai-backend` history under `backend/`, including Supabase migrations, Edge Functions, prompts, roadmap, and backend build log.
- Kept installed `.agents/` skills local and ignored rather than vendoring third-party scripts or committing unverifiable moving-source lock entries.
- Unified root `CLAUDE.md`, `CODEX.md`, and `README.md` so new tasks start with the full product context.
- Added `.coderabbit.yaml` with automatic incremental reviews and path-specific mobile, backend-security, iOS, Android, and documentation guidance.
- Authorized the CodeRabbit GitHub App for the canonical repository and opened the consolidation PR as the first automatic-review verification target.
- The former standalone backend repository is retained as historical read-only source until the consolidation PR is merged and verified; all new Katha work belongs here.

### Release Verification

- Expo TypeScript check passed.
- Expo production web export passed with 25 intentional assets.
- Imported `backend/` tree matched `praz-builds/katha-ai-backend@69c84fc` exactly before scoped documentation updates.
- Linked Supabase migrations `00001` through `00004` match the remote project.
- Remote Supabase database lint completed with no schema errors; seven deployed Edge Functions reported active.
- `.coderabbit.yaml` passed the official CodeRabbit v2 JSON schema.

## Canonical Paths

- Product client: `expo/`
- Backend: `backend/`
- Product design contract: `expo/DESIGN.md`
- Approved app state: `expo/BUILD_LOG.md`
- Backend roadmap: `backend/ROADMAP.md`
- Backend history: `backend/build-log.md`
- Repository review policy: `.coderabbit.yaml`

## 2026-08-22 — CodeRabbit Security Remediation

- Confirmed PR #3 was not approved: CodeRabbit failed to post its inline review and marked the backend import as critical merge risk despite a misleading green completion status.
- Configured failed CodeRabbit runs to fail their commit status and limited automatic reviews to pull requests targeting `main`.
- Added a mandatory `codex/*` feature-branch workflow, a local pre-push guard, and a pull request merge checklist. GitHub server-side branch protection remains unavailable for this private repository on the current plan.
- Added migration `00005_secure_credit_operations.sql` to serialize and deduplicate credit mutations, require service-role execution, use text references, and atomically persist a generated story with its first chapter.
- Kept historical ledger references untouched and introduced a separate operation key so legitimate older continuation rows cannot block migration deployment.
- Disabled generic client-controlled credit deductions and unverified ad-reward grants.
- Hardened Adapty webhook authentication, product validation, user mapping, and transaction idempotency.
- Added refund handling for failed story and continuation persistence.
- Added Deno tests for Adapty authorization and event validation, plus in-memory PostgreSQL checks for RPC permissions, idempotency, concurrency, feedback caps, and atomic story completion.
- CodeRabbit's successful full review formally requested changes with 26 inline findings. The branch now addresses the verified quick wins and adds durable, client-keyed generation operation state so debit, completion, replay, and refund paths are idempotent.
- CodeRabbit's follow-up review requested four additional changes. Expo was already documented as active, generation now enforces the locked short-story-only contract, and operation identity is separated from historical ledger references. The request to use `CREATE INDEX CONCURRENTLY` was not applied because Supabase migrations run transactionally and PostgreSQL prohibits concurrent index creation inside a transaction.
- Added executable PGlite regression tests for exactly-once generation debits, idempotent compensation, completion/refund races, replay-safe feedback rewards, and cross-account Adapty transaction replay prevention.
- Added retry-driven reconciliation for stale generation reservations so an Edge Function termination cannot leave a credit permanently reserved.
- CodeRabbit's review of commit `5cc161a` requested 15 further changes. The branch now rejects cross-story feedback key reuse, persists unhandled billing refunds for reconciliation, uses stable database conflict codes, validates search filters and provider payloads, centralizes operation parsing, and preserves generation request IDs across retries.
- Replaced calendar-day ad-reward uniqueness with an indexed rolling 24-hour contract for the future verified server transaction.
- CodeRabbit's review of `5fcff1d` reduced the remaining set to four. Configured Expo builds now return validated server-generated stories and surface backend failures, refund backlog fallback IDs are deterministic across retries, and the FCM/device-token roadmap uses HTTP v1 service-account authentication with update-capable ownership policies.
- CodeRabbit's review of `26774a5` reported no further code findings. Its three documentation notes were corrected: the deployed function count is seven, stale `MEMORY.md` references are removed, and the planned device-token schema now records non-null ownership/platform fields plus the complete owner RLS policy set.
- A final full review of `851c623` surfaced cross-repository contract gaps. The remediation aligns the 500-1500 word prompt, validates all JSON/UUID/request IDs, protects engagement counters from client writes, records explicit draft chapter publication state, makes refund replays observable, tests reader RLS after publication, and accumulates fractional reader earnings as integer half-credit units.
- Annual subscription events now fail closed until monthly allocation scheduling is implemented; the app cannot silently grant only one month's credits for a yearly purchase.
- Removed the committed mutable session handoff and moving-source skill lock; `SESSION_HANDOFF.md` remains available locally and ignored for copy-paste use.
- CodeRabbit's full review of `32021ba` requested 27 additional contract and documentation changes. The branch now adds safe public-profile grants, indexed title search, stable application SQLSTATEs, environment-allowlisted CORS, moderation-aware Anthropic retries, rejected-payment backlog persistence, paragraph-safe response parsing, bounded library pagination, and synchronized current-vs-planned product documentation.
- At this checkpoint, PR #3 remained unmerged pending formal CodeRabbit approval of the latest fixes.

### Follow-up validation

- Deno format, type checks, and lint passed for all changed Edge Functions.
- Thirteen Adapty authorization, lifecycle, deterministic refund-event, SKU-coverage, and annual fail-closed tests passed.
- Five shared CORS, UUID, and generated-text parsing tests passed.
- All seven migrations parsed and applied to an in-memory PostgreSQL-compatible runtime.
- Seven migration behavior tests passed for generation accounting, completion/refund races, feedback idempotency, provider transaction uniqueness, stable SQLSTATEs, deterministic legacy replay, and public-data grants.
- Expo TypeScript compilation passed.
- Historical blueprint Markdown lint passed with zero issues.

### Deployment status

- Migrations `00005`, `00006`, and `00007` plus the modified Edge Functions were deployed to Supabase project `iafeuxgoiknncgyjmugd` on 2026-08-22.
- `ALLOWED_ORIGINS` is configured for local Expo web verification at `http://localhost:8090`; production browser enablement still requires the exact production Expo web origin.
- Story-generation provider credentials are deployed. After the 2026-08-30 UTC provider migration, generation uses Gemini -> OpenRouter Free Router -> `gpt-4o-mini`; Gemini is currently quota-blocked and OpenRouter is carrying fallback traffic. Production enablement still requires Adapty authorization, `ADAPTY_WEBHOOK_SECRET`, and exact product-ID verification.
- AdMob rewards remain disabled until server-side verification is implemented.

## 2026-08-22 — Backend Controlled Release

- Linked the backend workspace to Supabase project `iafeuxgoiknncgyjmugd`.
- Applied remote migrations `00005_secure_credit_operations.sql`, `00006_public_data_hardening.sql`, and `00007_story_title_search_index.sql`.
- Deployed all seven reviewed Edge Functions from the canonical monorepo: `generate-story`, `continue-story`, `deduct-credit`, `grant-credit`, `library`, `feedback`, and `adapty-webhook`.
- Preserved fail-closed production gates: `adapty-webhook` returns `503` until `ADAPTY_WEBHOOK_SECRET` is configured, production browser origins are not allowlisted yet, annual subscription allocation remains disabled, refund clawbacks remain blocked, and AdMob rewards remain disabled.

### Verification

- Supabase migration dry run showed only `00005`, `00006`, and `00007` pending before deploy.
- Post-deploy migration list shows `00001` through `00007` aligned locally and remotely.
- Post-deploy function list shows all seven functions ACTIVE; `adapty-webhook` has `verify_jwt=false`.
- Deno format check, Deno type check, and all 25 Deno/PGlite tests passed.
- CORS preflight allows `http://localhost:8090` and withholds `Access-Control-Allow-Origin` for `https://example.com`.
