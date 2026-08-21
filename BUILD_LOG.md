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
