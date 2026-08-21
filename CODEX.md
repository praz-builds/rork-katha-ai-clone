# Katha AI Codex Instructions

Use [`CLAUDE.md`](CLAUDE.md) as the canonical repository contract. This is one monorepo containing the approved Expo app, Supabase backend, preserved native references, product documentation, and project-local skills.

## Default Workflow

- Read the nearest scoped `CLAUDE.md` before editing: root for repository-wide work, `expo/CLAUDE.md` for the product client, and `backend/CLAUDE.md` for Supabase work.
- Use the relevant project-local skill in `.agents/skills` for Expo, React Native, native mobile, EAS, simulator, SwiftUI, Jetpack Compose, or deep-review tasks.
- Run commands from the owning workspace (`expo/` or `backend/`).
- Keep secrets, dependencies, generated output, and local service state out of Git.
- Put changes on a feature branch and use a pull request against `main`; CodeRabbit is configured to review all PRs.
