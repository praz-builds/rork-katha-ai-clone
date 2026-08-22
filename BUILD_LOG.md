# Katha AI Monorepo Build Log

## 2026-08-22 — Canonical Repository Consolidation

- Confirmed `praz-builds/rork-katha-ai-clone` as the canonical product repository.
- Added the approved Expo SDK 54 application under `expo/` while preserving the existing Swift and Kotlin clients.
- Imported the complete `praz-builds/katha-ai-backend` history under `backend/`, including Supabase migrations, Edge Functions, prompts, roadmap, and backend build log.
- Kept installed `.agents/` skills local and ignored rather than vendoring third-party scripts or committing unverifiable moving-source lock entries.
- Unified root `CLAUDE.md`, `CODEX.md`, and `README.md` so new tasks start with the full product context.
- Added `.coderabbit.yaml` with automatic incremental reviews and path-specific mobile, backend-security, iOS, Android, and documentation guidance.
- Authorized the CodeRabbit GitHub App for the canonical repository and opened the consolidation PR as the first automatic-review verification target.
- The former standalone backend repository is retained as historical read-only source until the consolidation PR is merged and verified; all new Katha work belongs here.

### Verification

- Expo TypeScript check passed.
- Expo production web export passed with 25 intentional assets.
- Imported `backend/` tree matched `praz-builds/katha-ai-backend@69c84fc` exactly before scoped documentation updates.
- Linked Supabase migrations `00001` through `00004` match the remote project.
- Remote Supabase database lint completed with no schema errors; six deployed Edge Functions reported active.
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
- Removed the committed mutable session handoff and moving-source skill lock; `SESSION_HANDOFF.md` remains available locally and ignored for copy-paste use.
- PR #3 remains unmerged until CodeRabbit formally approves the latest fixes.

### Follow-up validation

- Deno format, type checks, and lint passed for all changed Edge Functions.
- Eleven Adapty authorization, lifecycle, deterministic refund-event, and SKU tests passed.
- All five migrations parsed and applied to an in-memory PostgreSQL-compatible runtime.
- Four migration behavior tests passed for generation accounting, completion/refund races, feedback idempotency, and provider transaction uniqueness.
- Expo TypeScript compilation passed.

### Deployment status

- `backend/supabase/migrations/00005_secure_credit_operations.sql` and the modified Edge Functions remain undeployed.
- Production enablement still requires Adapty authorization and product-ID verification.
- AdMob rewards remain disabled until server-side verification is implemented.
