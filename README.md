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

Pull requests targeting `main`, including incremental updates, are reviewed automatically — but **not** by the GitHub Action. The standing reviewer is a claude.ai cloud routine fired by webhook on every pull request, and CodeAnt AI reviews alongside it. The routine posts as `praz-builds` rather than as a bot and is not an Action, so it appears in neither `gh run list` nor `gh workflow list`: **to check whether a pull request was reviewed, read its comments.**

[`.github/workflows/claude-review.yml`](.github/workflows/claude-review.yml) and [`claude-mention.yml`](.github/workflows/claude-mention.yml) are a fallback, gated off behind the repository variable `CLAUDE_ACTION_ENABLED`. Until that variable is set and an `ANTHROPIC_API_KEY` secret exists, **writing `@claude` in a thread reaches nobody and you get no reply at all** — the job is skipped silently, so nothing indicates the request was received.

Direct work on `main` is prohibited; the complete merge gate is defined in [`AGENTS.md`](AGENTS.md).

Run `scripts/setup-repo.sh` after cloning to enable the tracked pre-push guard that rejects direct local pushes to `main`.
