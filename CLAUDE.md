# Katha AI Repository Context

This is the single canonical Katha AI repository: `praz-builds/rork-katha-ai-clone`.

## Repository Map

- `expo/`: approved and active Expo SDK 54 application.
- `backend/`: Supabase schema, migrations, Edge Functions, prompts, and backend roadmap.
- `ios-katha-ai-create-stories/`: preserved Rork-generated iOS reference client.
- `android-katha-ai/`: preserved Rork-generated Android reference client.
- `katha-critique/`: critique prototype.
- `skills-lock.json`: reproducible project-local engineering skill manifest. Installed `.agents/` content stays local and is intentionally ignored.

## Working Rules

- Read `expo/CLAUDE.md`, `expo/DESIGN.md`, and `expo/BUILD_LOG.md` before changing product UI, onboarding, paywalls, or shared branding.
- Read `backend/CLAUDE.md`, `backend/ROADMAP.md`, and `backend/build-log.md` before changing Supabase or generation infrastructure.
- Run Expo commands from `expo/` and Supabase commands from `backend/`.
- Treat the iOS and Android folders as reference implementations unless a task explicitly targets native code.
- Keep frontend and backend contracts in this repository. Do not create another Katha application or backend repository.
- Never commit `.env` files, service-role keys, provider secrets, build output, dependencies, or local Supabase state.
- Do not reintroduce migration handoff files, duplicate image directories, alternate wordmarks, or parallel design-system documents.

## Project Skills

Use the project-local Expo skills in `.agents/skills` for Expo, React Native, native mobile, EAS, or simulator work. Prefer the relevant specialized skill before implementation and run the applicable review/testing workflow before broad or release-sensitive changes.

## Pull Requests

- All product changes go through pull requests against `main`.
- CodeRabbit is configured by `.coderabbit.yaml` to review every PR, including drafts and incremental pushes.
- Resolve actionable review findings and keep validation commands in the PR description.
