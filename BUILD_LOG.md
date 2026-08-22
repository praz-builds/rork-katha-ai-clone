# Katha AI Monorepo Build Log

## 2026-08-22 — Canonical Repository Consolidation

- Confirmed `praz-builds/rork-katha-ai-clone` as the canonical product repository.
- Added the approved Expo SDK 54 application under `expo/` while preserving the existing Swift and Kotlin clients.
- Imported the complete `praz-builds/katha-ai-backend` history under `backend/`, including Supabase migrations, Edge Functions, prompts, roadmap, and backend build log.
- Added the reproducible project-local skill manifest in `skills-lock.json`; installed `.agents/` content remains local and ignored rather than vendoring third-party scripts.
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
- PR #3 remains unmerged until validation passes and a fresh CodeRabbit full review approves the fixes.
