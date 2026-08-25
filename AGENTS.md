# Katha AI Repository Context

<!-- markdownlint-disable MD013 -->

This is the single canonical Katha AI repository: `praz-builds/rork-katha-ai-clone`.

This file (`AGENTS.md`) is the authoritative repository-level instruction set. Both `CLAUDE.md` and `CODEX.md` defer here. For workspace-specific context, read the scoped files before editing: `expo/CLAUDE.md` for the product client, `backend/CLAUDE.md` for Supabase work.

## Repository Map

- `expo/`: approved and active Expo SDK 54 application.
- `backend/`: Supabase schema, migrations, Edge Functions, prompts, and backend roadmap.
- `ios-katha-ai-create-stories/`: preserved Rork-generated iOS reference client.
- `android-katha-ai/`: preserved Rork-generated Android reference client.
- `katha-critique/`: critique prototype.
- `.agents/`: local engineering skills installed outside Git. Treat them as workstation tooling, not trusted repository content.

## Default Workflow

- Read the nearest scoped instruction file before editing: this file for repository-wide work, `expo/CLAUDE.md` for the product client, and `backend/CLAUDE.md` for Supabase work.
- Read `expo/DESIGN.md` and `expo/BUILD_LOG.md` before changing product UI, onboarding, paywalls, or shared branding.
- Read `backend/ROADMAP.md` and `backend/build-log.md` before changing Supabase or generation infrastructure.
- Run Expo commands from `expo/` and Supabase commands from `backend/`.
- Treat the iOS and Android folders as reference implementations unless a task explicitly targets native code.
- Keep frontend and backend contracts in this repository. Do not create another Katha application or backend repository.

## Project Skills

When available, use the local Expo skills in `.agents/skills` for Expo, React Native, native mobile, EAS, simulator, SwiftUI, Jetpack Compose, or deep-review tasks. Prefer the relevant specialized skill before implementation and run the applicable review/testing workflow before broad or release-sensitive changes. Do not commit moving-source skill lockfiles without immutable revisions and verified hashes.

## Git Hygiene

- Never commit `.env` files, service-role keys, provider secrets, build output, dependencies, generated output, or local Supabase state.
- Do not reintroduce migration handoff files, duplicate image directories, alternate wordmarks, or parallel design-system documents.

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
