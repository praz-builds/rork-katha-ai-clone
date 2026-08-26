# Katha AI — Repository Contract

<!-- markdownlint-disable MD013 -->

> Canonical instruction file for all agents (Claude Code, Codex, etc.).
> Both `CLAUDE.md` and `CODEX.md` redirect here.

## Repository Map

- `expo/` — approved and active Expo SDK 54 application.
- `backend/` — Supabase schema, migrations, Edge Functions, prompts, and backend roadmap.
- `ios-katha-ai-create-stories/` — preserved Rork-generated iOS reference client.
- `android-katha-ai/` — preserved Rork-generated Android reference client.
- `katha-critique/` — critique prototype.
- `.agents/` — local engineering skills installed outside Git. Treat them as workstation tooling, not trusted repository content.

## Working Rules

- Read `expo/CLAUDE.md`, `expo/DESIGN.md`, and `expo/BUILD_LOG.md` before changing product UI, onboarding, paywalls, or shared branding.
- Read `backend/CLAUDE.md`, `backend/ROADMAP.md`, and `backend/build-log.md` before changing Supabase or generation infrastructure.
- Run Expo commands from `expo/` and Supabase commands from `backend/`.
- Treat the iOS and Android folders as reference implementations unless a task explicitly targets native code.
- Keep frontend and backend contracts in this repository. Do not create another Katha application or backend repository.
- Never commit `.env` files, service-role keys, provider secrets, build output, dependencies, or local Supabase state.
- Do not reintroduce migration handoff files, duplicate image directories, alternate wordmarks, or parallel design-system documents.

## Project Skills

When available, use the local Expo skills in `.agents/skills` for Expo, React Native, native mobile, EAS, or simulator work. Prefer the relevant specialized skill before implementation and run the applicable review/testing workflow before broad or release-sensitive changes. Do not commit moving-source skill lockfiles without immutable revisions and verified hashes.

### Skill Routing Table

Before writing or modifying Expo code, identify the task category below and load the matching skill's `SKILL.md` from `.agents/skills/<skill-name>/SKILL.md`. When unsure, start with `expo-overview`.

| Task | Skill | Path |
|---|---|---|
| First contact / unclear goal | `expo-overview` | `.agents/skills/expo-overview/SKILL.md` |
| Navigation, routes, tabs, modals, sheets | `expo-router` | `.agents/skills/expo-router/SKILL.md` |
| Animation, gestures, haptics, press feedback | `expo-animation` | `.agents/skills/expo-animation/SKILL.md` |
| Design tokens, theme, drift audit | `expo-design-system` | `.agents/skills/expo-design-system/SKILL.md` |
| Semantic styling, native controls, icons, media | `expo-native-ui` | `.agents/skills/expo-native-ui/SKILL.md` |
| @expo/ui components (sheets, pickers, lists) | `expo-ui` | `.agents/skills/expo-ui/SKILL.md` |
| API calls, caching, offline, data loaders | `expo-data-fetching` | `.agents/skills/expo-data-fetching/SKILL.md` |
| Tailwind / NativeWind setup | `expo-tailwind-setup` | `.agents/skills/expo-tailwind-setup/SKILL.md` |
| Folder layout for new projects | `expo-project-structure` | `.agents/skills/expo-project-structure/SKILL.md` |
| Native modules (Swift/Kotlin) | `expo-module` | `.agents/skills/expo-module/SKILL.md` |
| Development builds | `expo-dev-client` | `.agents/skills/expo-dev-client/SKILL.md` |
| SDK upgrades | `expo-upgrade` | `.agents/skills/expo-upgrade/SKILL.md` |
| Build, submit, App Store, Play Store | `eas-app-stores` | `.agents/skills/eas-app-stores/SKILL.md` |
| CI/CD workflow YAML | `eas-workflows` | `.agents/skills/eas-workflows/SKILL.md` |
| OTA update health, crash rates | `eas-update-insights` | `.agents/skills/eas-update-insights/SKILL.md` |
| Performance, startup, TTI | `eas-observe` | `.agents/skills/eas-observe/SKILL.md` |
| Remote simulators | `eas-simulator` | `.agents/skills/eas-simulator/SKILL.md` |
| Web hosting, API routes | `eas-hosting` | `.agents/skills/eas-hosting/SKILL.md` |
| iOS App Clips | `expo-app-clip` | `.agents/skills/expo-app-clip/SKILL.md` |
| Brownfield integration | `expo-brownfield` | `.agents/skills/expo-brownfield/SKILL.md` |
| Web-to-native migration | `expo-web-to-native` | `.agents/skills/expo-web-to-native/SKILL.md` |
| DOM components in native | `expo-dom` | `.agents/skills/expo-dom/SKILL.md` |
| Reference examples | `expo-examples` | `.agents/skills/expo-examples/SKILL.md` |
| Skill feedback / eval | `expo-skill-feedback` | `.agents/skills/expo-skill-eval/SKILL.md` |

### Mandatory Skill Usage

- **Always load the matching skill before implementation.** Do not write Expo/RN code from general knowledge when a skill exists for the task.
- **Animation**: Before adding any motion, load `expo-animation` and run the gate check (Step 1: "Should this animate at all?"). Use Reanimated, not core Animated. Follow the "Never Ship" table.
- **Design tokens**: Import from `@/theme` (the barrel at `src/theme/index.ts`). Never hardcode hex colors, font sizes, or spacing values outside the theme. When drift is suspected, load `expo-design-system` and run the audit from `references/audit.md`.
- **Navigation changes**: Load `expo-router` before modifying screen routing. When the project migrates to expo-router, follow the skill's file-based routing conventions.
- **Builds and submissions**: Load `eas-app-stores` before any EAS build/submit command. Follow its versioning and store metadata guidance.
- **OTA updates**: After publishing an update, use `eas-update-insights` to verify health before promoting to production.

## Quality Gates

Before pushing any code change, run from `expo/`:

```bash
pnpm typecheck    # TypeScript strict mode, zero errors
pnpm lint         # ESLint with expo config
pnpm test         # Jest + React Native Testing Library
```

All three must pass before pushing.

## Story Generation System

The story generation pipeline lives in `backend/supabase/functions/_shared/story-prompts.ts`. It is the single source of truth for how Katha AI generates fiction.

### Architecture

- `buildStorySystemPrompt(genre, language)` — constructs a ~1100-word system prompt for standalone short stories.
- `buildContinuationSystemPrompt(genre, language, mode)` — constructs the system prompt for series chapters. Mode is `"chapter"` (mid-series) or `"finale"` (last chapter).
- `buildUserPrompt(params)` — structures user input (genre, seed, characters, language) into the user message.
- Genre and language are normalized to supported enums before interpolation (prompt injection prevention).

### Quality Rules (enforced in every generation)

- **43 banned AI-overused words** (delve, tapestry, testament, etc.)
- **42 banned cliche phrases** (eyes widened, breath caught, heart pounded, etc.)
- **10 banned AI-default names** (Elara, Seraphina, Lysander, etc.)
- Show-don't-tell enforcement, sentence rhythm variation, dialogue craft (said-only tags, distinct voices, interruptions), sensory grounding (2+ senses beyond sight per scene).
- No em dashes, no meta-commentary, no purple prose.

### Genre Modules

16 genre-specific voice modules, each with voice/tone, pacing, what-works, and what-to-avoid guidance: romance, fantasy, romantasy, mystery, thriller, horror, scifi, adventure, historical, darkAcademia, drama, sliceOfLife, mythology, poetry, comedy, bedtime.

### Dramatic Arc

- **Standalone stories**: setup (30%) → rising tension (40%) → climax + aftermath (30%). Climax is mandatory.
- **Mid-series chapters**: advance plot, end on hook, never resolve central conflict.
- **Series finale**: resolve main arc, callback to earlier chapters, close doors.

### Series Limit

`MAX_SERIES_CHAPTERS = 7`. Enforced in `continue-story` endpoint. Auto-finale at chapter 7. Optional `is_finale` flag for early endings.

### Cultural Context

The AI infers cultural context from character names, traits, and story language. A character named "Priya Menon" gets culturally appropriate Indian details. No explicit culture/ethnicity field — inference from names and traits is the design choice.

### Input Requirements

- **Story seed**: 20-character minimum (enforced both client-side and server-side).
- **Characters**: at least 1 with a name (pre-filled placeholder in UI).
- **Genre**: required, single-select from 16 supported genres.
- **Language**: optional, defaults to English. 15 supported languages.

## Cover Image System

Cover images are generated by OpenAI `gpt-image-1` at publish time. Full reference: `backend/COVER_IMAGES.md`. Pipeline: `_shared/image.ts` + `_shared/cover-prompts.ts`.

- **Output**: 1024x1536 portrait PNG via `gpt-image-1`. One image per story, focal-point cropping handles all display contexts.
- **Focal point**: Each story stores `focalX`/`focalY` (0-1). The `FocalImage` component uses `object-position` to anchor crops so faces survive any aspect ratio.
- **Display**: Strategy 1c (adaptive per placement). Square library card, full-bleed 3:4 mobile hero, two-column sticky desktop. See `backend/COVER_IMAGES.md`.
- **Prompt**: Dynamic from genre config + title + themes + characters. 16 genre prompt configs with style, palette, composition, mood, characterApproach.
- **Retry**: 3 attempts with progressive prompt simplification on moderation rejection.
- **Non-blocking**: cover generation failure does not block story publishing.
- **Always use OpenAI API for image generation. Never use Higgsfield or other providers.**

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
