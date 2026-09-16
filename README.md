# Katha AI

Single monorepo for the Katha AI product, mobile clients, Supabase backend, product design contract, and project-local engineering guidance.

## Active Workspaces

| Path | Purpose |
| --- | --- |
| [`expo/`](expo/) | Approved Expo SDK 54 client and primary product workspace |
| [`backend/`](backend/) | Supabase migrations, Edge Functions, prompts, and backend roadmap |
| [`ios-katha-ai-create-stories/`](ios-katha-ai-create-stories/) | Preserved Rork iOS reference implementation |
| [`android-katha-ai/`](android-katha-ai/) | Preserved Rork Android reference implementation |
| [`katha-critique/`](katha-critique/) | Story critique prototype |

Start each task with [`CLAUDE.md`](CLAUDE.md). Product UI decisions live in [`expo/DESIGN.md`](expo/DESIGN.md), the approved application state is recorded in [`expo/BUILD_LOG.md`](expo/BUILD_LOG.md), and backend progress is recorded in [`backend/build-log.md`](backend/build-log.md).

## Run Expo

```bash
cd expo
pnpm install
pnpm start
```

## Run Supabase Locally

```bash
cd backend
supabase start
```

The Supabase project id is committed in `backend/supabase/config.toml`; credentials and provider secrets must remain outside Git.

## Pull Request Reviews

Pull requests targeting `main`, including incremental updates, are reviewed automatically by **CodeAnt** (`@codeant-ai`). [`.coderabbit.yaml`](.coderabbit.yaml) is a leftover from the previous reviewer and configures nothing. Direct work on `main` is prohibited; the complete merge gate is defined in [`CLAUDE.md`](CLAUDE.md).

Run `scripts/setup-repo.sh` after cloning to enable the tracked pre-push guard that rejects direct local pushes to `main`.
