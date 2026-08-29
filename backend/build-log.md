# Katha AI — Build Log

<!-- markdownlint-disable MD013 MD024 -->

> Chronological record of all changes made across sessions.
> Every session that modifies code, schema, config, or infrastructure MUST append an entry here.

---

## 2026-08-29 — Production smoke test: three blocking defects found and fixed

**Session:** Ran the first real authenticated end-to-end test of the generation pipeline. It failed immediately, surfacing two pre-existing production defects that meant the backend had never served a single successful request, plus one defect in the series prompt system.

### 1. No table GRANTs (migration 00012)

RLS policies filter rows; they do not grant table privileges. Migrations 00001-00002 enabled RLS and created 26 policies but never issued a `GRANT`, and the project has no blanket default privileges. Measured state before the fix:

- `authenticated`: 16 of 17 tables returned `42501 permission denied`
- `service_role`: 17 of 17 returned `42501`
- The only reachable table was `profiles`, because 00006 happened to grant it explicitly

`00012` issues grants that mirror the existing policies exactly, so no operation is granted that lacks a policy and RLS stays the row-level authority. All 16 real tables were confirmed RLS-enabled first. The 00006 hardening is preserved: `profiles` keeps its column-level SELECT and `REVOKE UPDATE (status) ON stories` is re-asserted. `generation_operations` and `payment_event_backlog` stay service-only.

### 2. Migration 00008 recorded as applied but never ran (migration 00014)

All eight taxonomy columns were missing from `public.stories` while every other migration's columns were present, including 00009's. Drift was isolated to 00008.

This was the direct cause of the HTTP 500s: `generate-story` inserts `audience_mode`, `primary_genre`, `spice_level`, `identity_lenses` and `trope_modules` as its first write, which failed with `42703` and was swallowed by the handler's catch-all. `complete_story_generation` would have failed the same way on `content_rating`.

The v5.1 taxonomy shipped in PR #28 had therefore never functioned against this database. `00014` re-applies 00008 steps 1-10 idempotently; step 11 is skipped because 00010 supersedes it.

### 3. Series state echoed instead of advanced (prompt fix)

Continuations returned a complete `series_state` with every key populated, but copied verbatim from the input. Chapter 2's stored state was byte-identical to chapter 1's, so continuity froze and the finale would have worked from stale state.

Two changes, both verified by probing the model directly with a fixed fixture:

- The mid-series and finale contracts now state that returning the state unchanged is a failure, with per-field requirements (`next_chapter_pressure` must describe the next chapter, answered hooks move to `resolved_hooks`, the new hook is added to `open_hooks`).
- The output schema is now the final section of the continuation prompt. It had sat 2.4k characters from the end, behind the narrative rules, so the model's last instruction was about prose rather than format.

Before the fix the probe showed the state echoed verbatim; after, `next_chapter_pressure` changed and `open_hooks` grew from 2 to 3.

### 4. Premature trigger reverted (migration 00013)

`00012` originally bundled an `auth.users -> profiles` trigger. It was broken (`pg_catalog.nullif` is not a callable function, and the failing call sat in the DECLARE section where the EXCEPTION handler is not yet active), so it aborted every `auth.users` insert. Since there is no signup flow yet, `00013` drops it rather than shipping a corrected version. Profile creation belongs with the signup work; `credit_ledger.user_id` references `profiles(id)`, so a profile row must exist before credits can be granted.

### Results

`backend/scripts/smoke-series-generation.py` — 57 assertions across 11 groups. Three consecutive runs after the self-heal fix: 57/57, 57/57, 57/57, zero leaks. (Before it: 57/57, 57/57, 56/57.) The single miss was the model writing a real `hook_type` and `hook_text` but not recording that hook in `open_hooks`, so a later chapter had nothing to pay off. The chapter itself was sound and the credit was correctly settled, so refunding would have discarded good work for a bookkeeping miss. `continue-story` now appends the chapter's `hook_text` to `open_hooks` when the model omits it. No fixture leaked in any run.

- Seed validation: 15/28/32-char seeds rejected with 400, no credit charged
- Standalone: `standalone` role, `hook_type` none, stored `series_state` `{}`, 1028 words, 1 credit
- Idempotent replay: same chapter id, `replayed: true`, no second charge
- Series opening: `series_opening`, hook set, `central_conflict` / `open_hooks` / `next_chapter_pressure` populated, 846 words
- Mid-series: `mid_series`, state advanced from chapter 1
- Finale: `finale`, `hook_type` none, state retained
- Kids series: `content_rating` kids, 600-900 band, safe hook type
- Legacy `is_series: true` still maps to series
- Seed sweep 41 to 100 chars across six genres
- Credit exhaustion returns 402
- 12 operations all `completed`, no stuck reservations, no unexpected refunds

Seeds are written as a real user would type them (lowercase, casual) and span the full accepted 40-100 range.

### 5. Finale clears next_chapter_pressure server-side

The stricter assertions added during review caught the finale leaving `next_chapter_pressure` populated — pressure toward a chapter that will never exist. The finale contract asks for it to be empty but the model did not comply. `continue-story` now forces it, matching how `hook_type` and `hook_text` are already forced for finales. Deterministic rather than dependent on model compliance.

### Review hardening

- The trigger was removed from the `00012` source as well, so a fresh database never creates it and `00013` is a no-op there. It still matters for the linked project, where the original `00012` already ran.
- `req()` in the smoke harness returns status `0` on transport, TLS, timeout and decode failures instead of raising, and the whole flow runs under `try/finally`. Previously only `HTTPError` was handled, so a network fault would have skipped cleanup and left test stories, profiles, ledger rows and operations in the production project.
- The mid-series assertion was `new_state != ch1_state`, which any unrelated field change would satisfy. It now asserts the fields the contract names: `next_chapter_pressure` rewritten, `open_hooks` grown, and progress recorded in `character_changes` / `relationship_state` / `resolved_hooks`. The finale adds three equivalents.

`CREATE INDEX CONCURRENTLY` was raised for the two `00014` indexes and deliberately not applied: it cannot run inside a transaction block and `supabase db push` wraps each migration in one, so a separate migration would not help either. `stories` holds 0 rows and both indexes already exist.

### 6. LLM robustness

Running the suite repeatedly surfaced intermittent generation failures that a single run hid. The signature was `hook_type: none` plus a byte-identical `series_state` — `parseStructuredOutput` catching a `JSON.parse` failure and silently degrading to the text parser, which returns `hook_type: "none"` and an empty state. A broken chapter was persisted and a credit charged.

- `response_format: { type: "json_object" }` on the OpenAI fallback. The prompts require a JSON object but nothing enforced it, so occasional prose or fences broke parsing.
- `openAIContent` ignored `finish_reason`. A `length`-truncated response is partial JSON, so it now throws and the existing refund path runs instead of persisting a truncated chapter.

### 7. Field-wise series state merge

`isEmptySeriesState` is all-or-nothing, so a *partial* model response was not "empty" and overwrote stored values with blanks — one run showed a finale erasing `central_conflict` while filling `resolved_hooks`. `mergeSeriesState()` now merges per field, preferring the new value and keeping the stored one wherever the model left a blank. `next_chapter_pressure` deliberately does not carry over, since a finale clears it on purpose.

### Harness corrections

- Cleanup deleted only the story ids the run tracked. A generation that fails after the story row is inserted leaves an orphan, which blocked the profile delete with a foreign-key 409 and the auth-user delete with a 500. Cleanup now deletes `stories?author_id=eq.{uid}`, with `generation_operations` first since it references stories.
- `11.2 no unexpected refunds` treated any refund as a defect. A refund after a genuine model failure is the system working as designed. Replaced with `11.3` (every refund matches a generation failure the harness observed) and `11.4` (every operation reached a terminal state), and the harness now prints `last_error` so a refund is diagnosable.
- The `try` block started after fixture creation, so a failure during setup skipped `finally` and leaked the auth user. It now opens before the first request, verified by fault injection.
- Returning status `0` from `req()` instead of raising introduced a new gap: a create that succeeds server-side but times out on the response leaves `uid` unassigned, so cleanup skipped the account. Cleanup now looks the fixture up by exact email through the admin API. Fault-injected to confirm, which also surfaced two accounts stranded by earlier runs; both were purged.

74 Deno tests pass (was 68). `deno check` clean. Both edge functions redeployed.

---

## 2026-08-29 — Expo sends story_mode instead of legacy is_series

**Session:** Aligned the Expo client with the generation request contract documented in PR #30.

### Change

- `expo/src/lib/api.ts` `generateStory()` sent `is_series: draft.isSeries ?? false`. The backend still maps that legacy boolean, but `story_mode` is the current contract and takes precedence in `validateGenerationRequest`. The client now sends `story_mode: draft.isSeries ? "series" : "standalone"` and no longer sends `is_series`.
- The `isSeries` boolean stays as local Create Studio draft/UI state. Only the wire format changed, so `CreateStudioScreen.tsx` is untouched.

### Tests

- New `expo/src/__tests__/api-generation-contract.test.ts` (8 tests) pins the request contract: `story_mode` is `series` / `standalone` / defaults to `standalone`, `is_series` is absent, `request_id` passes through for idempotent retries, the server `story_mode` and `chapter_role` map back onto the returned story, and `continue-story` sends `is_finale` correctly for finale and mid-series chapters.
- Expo suite: 41 tests pass (was 33). Typecheck clean, lint 0 errors and no new warnings.

### Note

- No backend change. `is_series` remains supported server-side for older clients; this only stops the shipped client from depending on the legacy path.

---

## 2026-08-29 — Series state hardening (PR #30 review fixes)

**Session:** Resolved all 11 actionable CodeRabbit findings on PR #30 (`codex/series-state-generation`) and hardened the series-state pipeline for production.

### Schema

- Added migration `00010_series_state_hardening.sql`. Migration `00009` was already applied to the linked project, so these corrections ship as a follow-up rather than an edit to an applied migration. Every statement is idempotent.
  - Named table-level `CHECK` constraints for `stories.story_mode`, `chapters.chapter_role`, and `chapters.hook_type`. `00009` declared them inline on `ADD COLUMN IF NOT EXISTS`, which silently skips the constraint when the column already exists.
  - Repaired the `00009` `chapter_role` backfill, which evaluated the `finale` branch before confirming the parent story is a series.
  - Rebuilt both completion RPCs so an invalid `hook_type` raises like the other enum parameters instead of being silently downgraded to `'none'`.
  - `complete_continuation_generation` now retains the stored `series_state` when `p_series_state` is `NULL` or `'{}'`, so one incomplete model response can no longer erase accumulated continuity.

### Prompt safety

- Persisted series state is no longer interpolated bare into the system-instruction channel. `formatSeriesStateBlock()` wraps it in an explicitly delimited `<series_state>` block labelled as untrusted data, with instructions to ignore any directive inside it.
- `formatSeriesState()` strips the fence pattern from the payload, so a crafted state value cannot close the block and escape into the instruction channel.
- Applied to the continuation system prompt, the initial user prompt, and the `continue-story` user prompt (which previously embedded raw `JSON.stringify(seriesState)`).

### Kids mode + series

- `buildAudienceModeRules()` now receives `storyMode` and `chapterRole`. Kids series openings and mid-series chapters get a reconciled ending contract: the immediate scene must resolve safely, while the larger story question may stay open only as a gentle, non-threatening invitation. Hook types are restricted to `unanswered_question`, `arrival`, and `decision`.
- Kids standalone stories and kids series finales keep the original unconditional "problems are resolved" ending rule.

### Shared normalizer

- `parseSeriesState()` and `isEmptySeriesState()` are now exported from `_shared/story_text.ts`. `continue-story` imported them and dropped its duplicate parser, which applied different limits (500/240 chars, no trimming) than the shared one (1000/500 chars, trimmed and filtered). Stored state now normalizes identically on both the generation and continuation paths.
- `continue-story` falls back to the prior stored state when the model returns an empty `series_state`.
- `generate-story` passes an explicit `EMPTY_SERIES_STATE` fallback for series stories.

### Stability

- The optional Chapter 1 callback lookup in the finale path no longer throws. A transient read error on that enrichment query previously aborted the continuation after the credit reservation existed.

### Docs

- `backend/prompts/story-generator.md`: one UI genre contract. The taxonomy table now matches the shipped Expo list (13 creation cards; `cozyFantasy` and `paranormalRomance` marked backend-only).
- `backend/ROADMAP.md`: planned device-token migration renumbered to `00011` to clear the `00009` collision.

### Second review pass

- **Kids series word range.** A kids series chapter was receiving the 500-1200 standalone range from both prompt layers while the continuation contract asks for 600-900. `buildAudienceModeRules()` now emits a 600-900 length rule for any series chapter, and `buildUserPrompt()` prioritizes the series range over the kids standalone range. Kids standalone keeps 500-1200.
- **Migration lock profile.** `00010` now runs the backfill repair first, then adds each CHECK constraint `NOT VALID`. Validation moved to `00011_validate_series_constraints.sql`: `supabase db push` runs each migration file in one transaction, so a `VALIDATE CONSTRAINT` inside `00010` would hold that migration's `ACCESS EXCLUSIVE` lock until commit and give no concurrency benefit. Splitting it lets `00010` commit first so the scan runs under its own `SHARE UPDATE EXCLUSIVE` lock. `VALIDATE CONSTRAINT` is a no-op on an already-valid constraint, so `00011` is safe against the database where `00010` had already validated them.
- **Docs.** `story-generator.md` no longer describes Bedtime as a mode separate from `kids`. The Kids Day / Kids Bedtime sections are relabelled as tonal *registers* with an explicit "style guidance, not a contract" note, and their unenforced word ranges (500-1200 / 400-800) were removed, since `buildAudienceModeRules()` is the single source of the enforced Kids constraints. The Series Chapter Structure section now documents `story_mode` as the request contract, marks `is_series` as a legacy compatibility field, and defines `is_finale` as a `continue-story` request hint (not a stored field) that, along with reaching `MAX_SERIES_CHAPTERS`, makes the server derive `chapter_role: "finale"`.
- `ROADMAP.md` records migrations 00001-00011 as applied, both edge functions as redeployed, and moves the planned device-token migration to `00012`.

### Deployment

- Migrations `00010_series_state_hardening.sql` and `00011_validate_series_constraints.sql` applied to `iafeuxgoiknncgyjmugd`. `supabase migration list` shows 00001-00011 local and remote.
- `generate-story` and `continue-story` redeployed, both ACTIVE at v9.
- The redeployed functions are compatible with the 00009 RPC signatures, so the deploy did not depend on 00010 landing first.

### Validation

- 68 Deno tests pass (was 53). Added prompt-injection regression tests with hostile text in `SeriesState` fields, fence-escape tests, kids opening/mid-series/standalone/finale prompt tests, and shared-normalizer contract tests.
- `deno check` clean for `generate-story`, `continue-story`, and the changed shared modules.
- Expo `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm test` 33 passed.
- Security scan: no secrets in the diff, no dynamic SQL, `SECURITY DEFINER` + `SET search_path = ''` + service-role-only grants preserved on both rebuilt RPCs.

---

## 2026-08-28 — Production series state for generation

**Session:** Implemented end-to-end series-mode generation contracts across prompt spec, Supabase schema/RPCs, Edge Functions, parser tests, and Expo API typing.

### Changes

- Added migration `00009_series_state_generation.sql` with `stories.story_mode`, `stories.series_state`, and chapter-level `chapter_role`, `first_line`, `previously_summary`, `hook_type`, and `hook_text`.
- Extended `complete_story_generation` and `complete_continuation_generation` RPCs so generated chapter metadata and series continuity state persist atomically with existing credit operation locks.
- Updated `generate-story` to honor `story_mode` / legacy `is_series`, pass story/chapter role into prompts, and persist opening-chapter hooks for series.
- Updated `continue-story` to pass stored `series_state` into continuation prompts, include Chapter 1 context for finales, auto-mark Chapter 7 as finale, and persist updated hooks/state.
- Extended structured output parsing, validation, prompt tests, and Expo response mapping for series metadata.
- Updated `backend/prompts/story-generator.md` and `backend/ROADMAP.md` to reflect the implemented runtime contract.

### Dependency Notes

- RunPod remains an audio-only dependency through `generate-audio` / `audio-status`; text generation, story-mode prompts, and Supabase series state do not require RunPod changes.
- Production deployment still needs migration `00009` applied and Edge Functions redeployed.

---

## 2026-08-28 — Create Studio: Progressive Editor, generating overlay, series flow

**Session:** Full Create Studio UX overhaul — generation loading overlay, series chapter flow, cover preview, publish review, and 12 polish fixes.

### Progressive Editor Flow (Variation B)

Replaced the direct editor-to-publish modal with a 6-step flow:
`setup -> generating -> editor -> cover preview -> publish review -> publishing`

- **Generating overlay**: dark theme with glowing orange orb, concentric rotating rings, genre-aware rotating phrases with italic keyword highlights, secondary status line. Star field background.
- **Editor**: "Next" button replaces "Publish" in header and toolbar. Chapter tabs with `+` tab for series. Chapter heading hidden for standalone stories.
- **Cover preview**: genre gradient placeholder card with title overlay, "Regenerate Cover" button with custom prompt input ("Describe your ideal cover").
- **Publish review**: story card with mini cover, chapter list (series only), "What happens next" info card, sticky "Keep as Draft" / "Publish" bottom bar.

### Series Flow

- **"Make it a series" toggle** on setup screen with word count guidance (600-900 per chapter, up to 7 chapters).
- **Chapter `+` tab** in editor tab bar for adding chapters (1 credit each).
- **`continueStory()` API wrapper** calls `continue-story` endpoint with `is_finale` support.
- **Mode-aware overlay**: different phrases for story/chapter/finale generation.
- Auto-finale at chapter 7.

### API Wrappers Added (`expo/src/lib/api.ts`)

- `continueStory(storyId, requestId, isFinale?)` — calls `continue-story` endpoint
- `editParagraph(storyId, chapterId, paragraphIndex, instruction, options?)` — calls `edit-story` endpoint
- `publishStory(storyId)` — calls `publish-story` endpoint
- All three have local mock fallbacks when Supabase isn't configured.

### Mock Story Upgrade

- `localGeneratedStory()` now returns 6 genre-aware paragraphs (500-800 words) matching the 500-1500 word production spec. Was ~100 words.
- Simulates realistic 3.5-6s generation time.
- Genre-specific opening paragraphs for romance, thriller, mystery, horror, fantasy, sci-fi.
- Genre-aware creative mock titles replace `titleFromSeed()` (which just capitalized first 5 words of seed).

### UX Polish (12 fixes)

1. Toggle chips (Kids, LGBTQ+, Vampire) now single-select
2. Character fields empty by default (was pre-filled with "Mira")
3. Character placeholder: "Role, personality, and what drives them"
4. Header buttons responsive single-line ("Next >")
5. Chapter heading hidden for standalone stories
6. Action toolbar reordered: Edit, Rewrite, Expand, Shorten, Custom, Delete
7. "Change tone" removed from action toolbar
8. Paragraph editing wired to real `edit-story` API with local fallback
9. Cover prompt input for custom cover description
10. Review screen hides chapter list for standalone
11. Review bottom bar with sticky Publish/Draft buttons
12. "What happens next" info card in review

### Spec Updates (`backend/prompts/story-generator.md`)

- **Title Generation** section: 2-6 words, evocative not descriptive, genre examples
- **Word Count Enforcement** table: min/max per mode, rejection at <300 words
- **Series Chapter Structure**: cliffhanger rules for Ch 1-6, finale rules for Ch 7

### Documentation Updates

- `AGENTS.md`: Updated Create Studio flow description, migration count
- `ROADMAP.md`: Refactored — Phase A marked DONE, completed items in collapsible sections, Phase B cover items checked, migration numbers fixed, language distribution corrected
- `backend/prompts/story-generator.md`: Title rules, word count, series structure

### New Files

- `expo/src/components/GeneratingOverlay.tsx` — dark orb loading overlay
- `expo/src/data/generating-phrases.ts` — genre-aware phrase templates with keyword slots

### Modified Files

- `expo/src/screens/CreateStudioScreen.tsx` — full Progressive Editor rewrite
- `expo/src/lib/api.ts` — 3 API wrappers, mock upgrade, genre-aware titles
- `expo/src/types/domain.ts` — `isSeries` on CreateDraft
- `backend/ROADMAP.md` — refactored phases
- `backend/prompts/story-generator.md` — title/word count/series spec

---

## 2026-08-27 — Security audit + critical/high fixes

**Session:** Created custom security-scan skill, ran full audit via 3 parallel CLI agents, fixed all critical and high code-level findings.

### Security Skill

- Created `.agents/skills/security-scan/SKILL.md` — zero-dependency security scanning powered by the CLI agent itself. Covers 8 categories: secrets, injection, auth, input validation, dependencies, infrastructure, mobile, data privacy.
- Installed `@openai/codex-security` v0.1.20 globally + 14 skill files synced. Not used for scanning (requires gpt-5.6-sol access); custom skill used instead.

### Audit Results

- **2 CRITICAL, 6 HIGH, 9 MEDIUM, 5 LOW** findings across 330+ files.
- 3 parallel scan agents: secrets exposure, injection/auth, deps/mobile/infra.

### Fixes Applied (commit 7baea6a)

| ID | Severity | Fix |
|---|---|---|
| CRIT-2 | Critical | `audio-status`: parseUuid() on story_id/chapter_id, voice_id allowlisted. Path traversal eliminated. |
| HIGH-2 | High | `edit-story`: tone allowlisted to 10 values, custom notes wrapped + truncated. Prompt injection mitigated. |
| HIGH-3 | High | `generate-audio`: parseUuid() replaces raw string checks. |
| HIGH-4 | High | `audio-status`: ownership verification before writing audio_url. |
| HIGH-5 | High | `feed`: fixed following_id -> author_id column name (was crashing returning-user feed). |

### Remaining (non-code)

- CRIT-1: Rotate OpenAI API key at platform.openai.com
- HIGH-1: Rate limiting (needs Redis/KV — follow-up PR)
- HIGH-6: Set production CORS origin in Supabase secrets

---

## 2026-08-27 — Create Studio UX polish + draft persistence

**Session:** Product UX improvements to the Create flow and draft auto-save.

### Changes

- **Genre chips**: emoji-driven pills in 2-row horizontal scroll (Tumblr-style).
  Romance cluster positioned for genre variety visibility.
- **Toggle chips**: added Kids (audience mode), LGBTQ+ (identity lens), Vampire
  (trope module) as tappable chips below genre picker.
- **Dynamic seed hints**: progressive coaching text that changes as user types.
  Warm red pre-threshold, green when ready.
- **Premise chips**: 3 genre-specific example premises per genre, horizontal
  scroll, max-width 260px. Disappear after 20 chars typed.
- **Hero toggle**: replaced green RN Switch with custom Pressable toggle
  (orange thumb on light-orange track). Works on web, iOS, Android.
- **Draft persistence**: `AsyncStorage`-based auto-save with 500ms debounce.
  Drafts restored on mount, cleared on successful generation, expire after 7 days.
- **Library layout**: compact StoryCards as horizontal rows (96px cover + text),
  proper margins and spacing.
- **Header alignment**: CREATE eyebrow + credits pill on same horizontal line.
- **Renamed "Story seed" to "Your story idea"**.
- **Languages**: English + Spanish (removed Portuguese from create flow).

---

## 2026-08-27 — Story Generator v5.1 implementation

**Session:** Full implementation of v5.1 taxonomy across backend + Expo.

### Changes

- **Migration 00008:** Added `primary_genre`, `audience_mode`, `identity_lenses`, `trope_modules`, `spice_level`, `content_rating`, `first_line`, `previously_summary` columns. Backfills from `genre[]`. Replaces `complete_story_generation` RPC with extended 10-param signature.
- **New `_shared/types.ts`:** 15 primary genres, audience modes, identity lenses, spice levels, 10 trope modules, genre-aware constraint maps, migration map, interfaces.
- **New `_shared/validation.ts`:** Request validation with genre normalization, spice clamping, trope filtering, audience constraints, 40-char seed minimum.
- **Rewrote `_shared/story-prompts.ts`:** Modular 10-layer assembly (base + engine + genre + audience + identity + trope + spice + continuation + language + JSON schema). Added 4 new genre modules (darkRomance, cozyFantasy, paranormalRomance, contemporary). Deprecated genres map to new ones. Old 2-arg signatures kept as backward-compat wrappers.
- **Updated `_shared/story_text.ts`:** Added `parseStructuredOutput()` for JSON parsing with text fallback.
- **Updated `_shared/cover-prompts.ts`:** Added darkRomance, cozyFantasy, paranormalRomance, contemporary configs. Removed drama, sliceOfLife. Updated `normalizeGenre()`.
- **Updated `generate-story/index.ts`:** Uses new validation, inserts `primary_genre` + taxonomy fields, parses structured JSON output, derives content_rating server-side, passes extended RPC params.
- **Updated `continue-story/index.ts`:** Reads new story columns, builds modular continuation prompt, uses structured output parser.
- **Updated `feed/index.ts`:** Selects `primary_genre`, uses it for affinity scoring, excludes `content_rating = 'explicit'`.
- **Updated `library/index.ts`:** Filters by `primary_genre` instead of `genre[]` contains, excludes explicit content.
- **Expo `domain.ts`:** 13 UI genres, `CreateDraft` with `primaryGenre`, `audienceMode`, `spiceLevel`, `identityLenses`, `tropeModules`.
- **Expo `theme.ts`:** 13 genre labels and gradients.
- **Expo `seed.ts`:** 13 genres, remapped drama/bedtime stories.
- **Expo `api.ts`:** Sends new fields, reads `primary_genre` from response.
- **Expo `CreateStudioScreen.tsx`:** Updated draft type, genre selector uses 13 genres, 40-char seed minimum.
- **Expo `KathaOnboardingFlowV2.jsx`:** 14 genre options (13 + Other).
- **46 backend tests** (16 validation + 22 prompts + 8 parser): all pass.
- **33 Expo tests** (theme, seed, i18n, analytics, supabase): all pass.

### Notes

- `genre text[]` column kept for backward-compat reads. New writes populate both `genre` and `primary_genre`.
- `explicit` spice is feature-flagged (rejected at validation).
- 5-screen Create flow redesign is follow-up PR.

---

## 2026-08-27 — Story prompt v5.1 production spec

**Session:** Reviewed the research-backed v5 prompt architecture and converted
the backend prompt reference into a production implementation contract.

### Changes

- Updated `backend/prompts/story-generator.md` from v2.0 to v5.1 production
  spec.
- Locked the proposed taxonomy to 15 user-facing adult genre cards, with LGBTQ+
  as a separate queer identity lens/toggle instead of a primary genre.
- Documented genre-aware spice layering with `sweet`, `steamy`, and
  feature-flagged `explicit`; MVP recommendation is Sweet + Steamy only.
- Reframed Kids and Bedtime as audience modes that force Sweet content and have
  separate safety/read-aloud constraints.
- Added the required story-engine layer, structured-output contract, safety
  boundaries, implementation dependency checklist, and known current mismatches
  for the production implementation pass.

### Notes

- No runtime TypeScript, schema, or Expo UI files were changed in this session.
  The next implementation pass must update backend prompt builders, request
  validation, Supabase columns, feed/library filters, Expo genre controls, and
  cover prompt mappings together.

---

## 2026-08-15 — Project scaffolding

**Session:** Initial project setup (from Story For My Kid Claude Code session)

### Changes

- Created the backend workspace, now located at the repository-relative `backend/` directory
- **CLAUDE.md** — project context, architecture, build instructions for Claude Code sessions
- **Supabase schema (migration 00001):** profiles, credit_ledger, stories, chapters, characters, comments, streaks, ad_rewards, referrals — 9 tables with indexes
- **RLS policies (migration 00002):** row-level security for all tables
- **Edge Functions scaffolded:**
  - `generate-story` — full orchestrator (auth, credit deduct, LLM fallback chain, refund on failure)
  - `continue-story` — next chapter generation (author-only)
  - `deduct-credit` — atomic credit deduction endpoint
  - `grant-credit` — AdMob SSV reward verification + 24hr cooldown
  - `library` — paginated curated story feed with genre filter + search
  - `feedback` — comments + one-time feedback credit reward per story
  - `adapty-webhook` — subscription/purchase event handler
- **Shared utilities:** `_shared/credits.ts` (append-only ledger), `_shared/llm.ts` (Sonnet → Haiku → gpt-4o-mini), `_shared/cors.ts`
- **Story generator system prompt v1.0** — `prompts/story-generator.md`
- **Blueprint reference** — copied from Story For My Kid project
- **Strategic decisions doc** — `references/strategic-decisions.md` (product identity, credit economy, growth loops, anti-gaming pipeline, content model, CTA strategy, discovery/feed model)
- **Schema migration 00003** — delta additions from strategic decisions (story_reads, story_followers, user_followers, bookmarks, story_likes, engagement counters, chapter publishing state, language/themes, pending credits, referral chain)
- **Git initialized** with initial commit

### Decisions locked

- App name: **Katha AI — Create Stories**
- Single currency (Credits), no dual coins/gems
- Author-only continuation (readers cannot extend stories)
- AI decides story length (no length picker)
- 3-credit welcome bonus (up from Blueprint's 2)
- Front-loaded creator earnings curve (1 credit/read for first 10, then tapering)
- Full anti-gaming pipeline required for reader earnings
- Genre is single-select; themes are LLM-generated free-form tags
- UI: English + Hindi. Generation: 15 languages

---

## 2026-08-17 — Rork app review + backend roadmap

**Session:** Full codebase review of Rork-built app (both iOS + Android) against all 12 prompts + fix-up prompt

### Changes

- **ROADMAP.md** — created phased backend execution plan (A through H)
- **CLAUDE.md** — updated architecture section (Rork is native Swift+Kotlin, not React Native), updated build phases, added Rork app status, added new edge functions to TODO list
- **build-log.md** — this entry

### Rork App Status

- **Repo:** `praz-builds/rork-katha-ai-clone` (GitHub, private)
- **Original repo** `praz-builds/rork-katha-ai` confirmed safe to delete (clone is strict superset with 16 additional files)
- **iOS:** 40+ screens in Swift/SwiftUI, Literata font bundled, all features in mock mode
- **Android:** Full parity — 40+ screens in Kotlin/Jetpack Compose, same feature set
- **All 12 prompts delivered:** Foundation, Auth, Create Wizard, Series/Continuation, Profiles, Engagement, Search/Bookmarks, Credits/Ads, Fix-up, Analytics, Parental/Language, Streaks/Notifications/Referrals/Offline/Audio

### Review Findings (critical gaps for fix-up prompt)

- Color tokens: nearly every hex deviates from spec (Rork generated own palette)
- Only 12 of 30 seed stories exist; no language field on Story model
- Home screen missing 6 of 8 sections (Continue Reading, For You, Writers You Follow, Rising, Katha's Picks, Welcome-back)
- Reader missing drop cap, progress bar, nav auto-hide
- StoryCard layout is vertical instead of spec's horizontal
- Library has 5 tabs instead of 4
- Author follower counts all wrong
- The full fix-up list is retained in this build-log entry and `ROADMAP.md`.

### Known Backend Bugs Confirmed

- `generate-story/index.ts:137` — double-deduct in response body
- `credits.ts` — race condition (read-then-write, not atomic)
- `llm.ts` — Haiku model ID outdated (Oct 2024 → should be Oct 2025)
- `generate-story` — hardcoded system prompt instead of loading from file

### TODO next session

- [ ] Phase A: Create Supabase project, fix critical bugs, deploy existing functions
- [ ] Phase B: Wire DALL-E 3 + edge-tts into generation pipeline
- [ ] User: Get API keys (Anthropic, OpenAI), create Supabase project

---

## 2026-08-17 — Phase A: Supabase setup + bug fixes + deploy

**Session:** Created Supabase project, fixed all 4 known bugs, deployed all edge functions

### Infrastructure

- **Supabase project created:** `iafeuxgoiknncgyjmugd` (region: ap-northeast-2 Seoul)
- **New key format:** publishable/secret (maps to anon/service_role)
- **Supabase CLI installed** via Homebrew (v2.114.0)
- **Project linked** and all migrations pushed
- **`.env.local` created** with project URL + keys (gitignored)
- **`config.toml` updated** with project ref, OAuth providers disabled (need real client IDs)

### Bug Fixes

1. **Double-deduct fix** (`generate-story/index.ts:137`): `newBalance - 1` → `newBalance` (was subtracting again after deductCredit already returned the post-deduction balance)
2. **Race condition fix** (`credits.ts`): replaced read-then-write pattern with atomic Postgres RPC functions (`deduct_credit`, `grant_credit`) using `FOR UPDATE` row locking
3. **System prompt fix** (`generate-story/index.ts`): hardcoded string → imported from `_shared/prompts.ts` (mirrors `prompts/story-generator.md`)
4. **Haiku model ID fix** (`llm.ts:45`): `claude-haiku-4-5-20241022` → `claude-haiku-4-5-20251001`

### Schema Changes

- **Migration 00004** (`00004_atomic_credit_rpcs.sql`): added `deduct_credit()` and `grant_credit()` Postgres functions with `SECURITY DEFINER` and `FOR UPDATE` locking
- **Migration 00001 fix**: `idx_ad_rewards_daily` — `claimed_at::date` → `date_trunc('day', claimed_at at time zone 'UTC')` (immutability fix)
- **Migration 00003 fix**: `idx_story_reads_dedup` — same `::date` → `date_trunc` fix

### New Files

- `supabase/functions/_shared/prompts.ts` — story generator system prompt as exportable constant
- `supabase/migrations/00004_atomic_credit_rpcs.sql` — atomic credit RPC functions

### Deployments

All 7 edge functions deployed and ACTIVE:

- `generate-story`, `continue-story`, `deduct-credit`, `grant-credit`, `library`, `feedback`, `adapty-webhook`

### TODO next session

- [ ] Set API key secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) once user has them
- [ ] Phase B: Wire DALL-E 3 cover images + edge-tts audio narration
- [ ] Create Supabase Storage buckets (covers, audio)
- [ ] Consider recreating project in Mumbai region for lower India latency

---

## 2026-08-22 — CodeRabbit credit and generation hardening

**Session:** Remediation of PR #3 critical merge-risk findings

### Changes

- Added migration `00005_secure_credit_operations.sql` with service-only RPC permissions, positive amount validation, text reference IDs, per-user serialization, and idempotency indexes.
- Added a nullable operation key for new idempotent mutations instead of imposing uniqueness on historical reference IDs that older continuation flows reused.
- Added atomic story completion so the story update and first chapter insert commit together.
- Changed initial and continuation generation to use deterministic credit references and refund persistence failures.
- Disabled the generic client-controlled deduction endpoint and unverified AdMob reward endpoint.
- Changed Adapty authentication to exact `Authorization` secret verification, fail-closed configuration, `customer_user_id` mapping, explicit product allowlisting, and transaction-level idempotency.
- Restricted feedback rewards to public stories not authored by the commenter, verified chapter ownership, and enforced the documented daily reward check.
- Added focused Adapty unit tests and executed all five migrations against an in-memory PostgreSQL runtime, including permission, replay, concurrency, feedback, and story-completion behavior checks.
- Added durable `generation_operations` state keyed by client request ID; story/chapter completion and compensation now update operation state atomically, completed requests replay existing results, and refunded continuations can retry with a new request.
- Added feedback request idempotency, updated reader/comment RLS policies in the forward migration, bounded continuation prompt context, strict generation input limits, abortable LLM timeouts, strict library pagination, and fully qualified Adapty product IDs.
- Trial conversions now grant the paid-period credits. Refund events fail closed with a retryable response until the explicit clawback policy is implemented.
- Enforced the locked short-story-only generation contract in both the Edge Function and Expo request payload.
- Added PGlite regression tests for exactly-once generation debit/refund behavior, completion/refund races, idempotent feedback rewards, and cross-account provider transaction replay prevention.
- Added five-minute stale-reservation reconciliation on client retry; abandoned generation work is refunded while late successful completion still wins under the operation row lock.
- Added `payment_event_backlog` so unimplemented Adapty refund clawbacks are visible and retryable instead of existing only in logs.
- Added stable SQLSTATE handling for concurrent chapter reservations, shared request/operation parsers, cross-story feedback replay rejection, bounded library filters, and validated OpenAI response decoding within the abort deadline.
- Replaced calendar-day ad-reward uniqueness with an index supporting a future atomic rolling 24-hour verification transaction.
- Made fallback Adapty refund event IDs deterministic from the raw request body and covered provider-ID priority plus replay stability in tests.
- Aligned the runtime and canonical generation prompt to the locked 500-1500 word short-story contract and updated the Sonnet model identifier.
- Added malformed-body and UUID validation, mandatory client request IDs, explicit unpublished chapter state, refund-replay semantics, owner-safe story update grants, and reader-visibility RLS coverage.
- Annual Adapty events fail closed until monthly allocation scheduling is implemented; provider SKU coverage is checked against the complete allowlist.
- Confirmed the current generation runtime is text-only; cover images and audio narration remain undeployed Phase B work.
- Confirmed rewarded AdMob credits remain disabled pending direct signed SSV callbacks, server-issued user-bound claim nonces, global transaction replay protection, and atomic cooldown/grant handling.
- Added migration `00006_public_data_hardening.sql` to restrict profile reads to display-safe columns, remove client story-status updates, and index title search with `pg_trgm`.
- Isolated the title-search index in migration `00007_story_title_search_index.sql` so current Supabase CLI runners can execute `CREATE INDEX CONCURRENTLY` outside their batched transaction.
- Replaced wildcard CORS with an exact `ALLOWED_ORIGINS` allowlist and added cached preflight responses.
- Preserved generated paragraph boundaries through a shared response parser, switched continuation credit errors to stable SQLSTATE handling, and made payment-backlog retries preserve terminal rows.

### Deployment status

- Code changes and migrations were reviewed and merged through PR #3, then deployed to the linked Supabase project on 2026-08-22.
- Migrations `00005`, `00006`, and `00007` plus the changed Edge Functions are deployed.
- `ALLOWED_ORIGINS` is configured for the exact local Expo web origin `http://localhost:8090`; add the exact production Expo web origin before serving production browser clients.
- Adapty dashboard authorization and exact product IDs must match the server configuration before production webhook traffic is enabled.
- Adapty refund clawbacks and monthly allocation for annual plans remain explicit production blockers; refund events currently fail closed rather than being acknowledged without accounting.

## 2026-08-22 — Concurrent story-title search index

- Added `00007_story_title_search_index.sql` with `idx_stories_title_trgm`, a concurrent GIN trigram index for leading-wildcard title search.
- Kept the pipeline-incompatible index statement in its own migration so current Supabase CLI migration runners execute it outside the batched transaction.
- The migration was deployed to the linked Supabase project on 2026-08-22.

## 2026-08-22 — Controlled backend release to Supabase

**Session:** Deployed the reviewed PR #3 backend hardening set to the canonical Supabase project.

### Infrastructure

- Linked the monorepo backend checkout to Supabase project `iafeuxgoiknncgyjmugd`.
- Applied migrations `00005_secure_credit_operations.sql`, `00006_public_data_hardening.sql`, and `00007_story_title_search_index.sql` with `supabase db push`.
- Deployed all seven Edge Functions from the reviewed monorepo state:
  - `generate-story`
  - `continue-story`
  - `deduct-credit`
  - `grant-credit`
  - `library`
  - `feedback`
  - `adapty-webhook`
- Deployed `adapty-webhook` with JWT verification disabled so provider callbacks can reach the function after `ADAPTY_WEBHOOK_SECRET` is configured.
- Set `ALLOWED_ORIGINS=http://localhost:8090` for local Expo web verification. Production browser traffic remains blocked until the exact production origin is known and added.

### Verification

- `supabase db push --dry-run` reported only `00005`, `00006`, and `00007` pending.
- `supabase db push` applied `00005`, `00006`, and `00007` successfully.
- `supabase migration list --linked` now reports local and remote migrations `00001` through `00007` aligned.
- `supabase functions list --project-ref iafeuxgoiknncgyjmugd` reports all seven functions ACTIVE; `adapty-webhook` has `verify_jwt=false`.
- `/Users/mac16/.deno/bin/deno fmt --check supabase/functions supabase/migrations/00005_secure_credit_operations_test.ts` passed.
- `/Users/mac16/.deno/bin/deno check ...` passed for shared utilities, all function entrypoints, and the migration test.
- `/Users/mac16/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/_shared/*_test.ts supabase/migrations/00005_secure_credit_operations_test.ts` passed: 25 tests.
- `POST /functions/v1/adapty-webhook` without `ADAPTY_WEBHOOK_SECRET` returns `503` with `Webhook is not configured`, confirming fail-closed behavior.
- `OPTIONS /functions/v1/library` from `http://localhost:8090` returns `Access-Control-Allow-Origin: http://localhost:8090`.
- The same preflight from `https://example.com` returns no `Access-Control-Allow-Origin`.

### Remaining blockers

- `ANTHROPIC_API_KEY` is not configured in Supabase secrets; `OPENAI_API_KEY` is configured.
- `ADAPTY_WEBHOOK_SECRET` is not configured, and dashboard authorization/product IDs still need verification before real Adapty traffic.
- The exact production Expo web origin is not known; add it to `ALLOWED_ORIGINS` before production browser clients call the functions.
- No authenticated test user/JWT was available in this session, so live `generate-story`, `continue-story`, `feedback`, and disabled credit endpoint behavior were not exercised end to end.
- Annual subscription monthly allocation, refund clawbacks, and AdMob SSV remain production blockers.

## 2026-08-26 — Genre-aware anti-slop story prompt system

**Session:** Production-grade story generation prompt rewrite, dramatic arc guidance, series structure.

### Story Generation Prompt System

- Created `_shared/story-prompts.ts` (540+ lines): genre-aware prompt builder replacing the 31-line generic prompt in `_shared/prompts.ts`.
- **Anti-slop rules**: 43 banned AI-overused words, 42 banned cliche phrases, 10 banned AI-default character names.
- **Craft rules**: show-don't-tell enforcement, sentence rhythm variation, dialogue craft (said-only tags, distinct character voices, interruptions), sensory grounding (2+ senses beyond sight), no em dashes, no meta-commentary.
- **16 genre-specific voice modules**: romance, fantasy, romantasy, mystery, thriller, horror, scifi, adventure, historical, darkAcademia, drama, sliceOfLife, mythology, poetry, comedy, bedtime.
- **Cultural context**: AI infers culture from character names and traits naturally.
- **Language-aware**: 15 supported languages normalized before prompt interpolation.
- Genre and language normalized to supported enums to prevent prompt injection.

### Dramatic Arc & Series Structure

- **Standalone stories**: setup 30%, rising tension 40%, climax + aftermath 30%. Climax is mandatory.
- **Mid-series chapters** (`mode: "chapter"`): advance plot, end on hook, never resolve central conflict.
- **Series finale** (`mode: "finale"`): resolve main arc, callback to earlier chapters, close doors.
- `MAX_SERIES_CHAPTERS = 7` enforced in `continue-story` endpoint.
- Auto-finale at chapter 7. Optional `is_finale` flag for early endings.

### Input Validation

- Story seed minimum raised from 4 to 20 characters (client-side and server-side).
- Language field now sent from Expo client to backend API.

### Files Changed

- `_shared/story-prompts.ts` (NEW)
- `generate-story/index.ts` (updated)
- `continue-story/index.ts` (updated)
- `expo/src/screens/CreateStudioScreen.tsx` (updated)
- `expo/src/lib/api.ts` (updated)
- `expo/src/i18n/en.json`, `es.json`, `pt.json` (updated)

### Documentation

- Created `AGENTS.md` as canonical repo instruction file for all agent sessions.
- `CLAUDE.md` and `CODEX.md` simplified to redirect to `AGENTS.md`.

### PR Status

- PR #24 (`codex/story-prompt-system`): CodeRabbit APPROVED after 4 review rounds.

---

## 2026-08-26 — Cover image system, sample stories, dev tooling, instruction consolidation

**Session:** Full-day production session covering cover image generation, focal-point display, 3 sample stories, developer tooling, Expo skills integration, and instruction file consolidation.

### Cover Image Pipeline (PR #25)

- **`_shared/image.ts`** (198 lines): OpenAI `gpt-image-1` integration at 1024x1536 portrait. Handles base64 response decoding, 3-attempt retry with progressive prompt simplification on moderation rejection, uploads to Supabase Storage.
- **`_shared/cover-prompts.ts`** (235 lines): 16 genre-specific prompt configs (style, palette, composition, mood, characterApproach). `normalizeGenre()` prevents prompt injection via own-property check. `buildCoverPrompt()` assembles dynamic prompts from genre + title + themes + characters.
- **`backend/COVER_IMAGES.md`** (189 lines): Canonical reference for the entire cover system — prompt structure, focal point math per viewport, genre table, API call spec, retry strategy, display layouts.

### Focal-Point Display System (Strategy 1c)

- **`FocalImage` component** (`KathaPrimitives.tsx`): Renders web-native `<img>` with `object-fit: cover` + `object-position` for focal-point-aware cropping. React Native Web's Image component ignores `objectPosition`, so raw `<img>` is required. Falls back to standard RN Image on native.
- **Story type extended**: Added `focalX?: number` and `focalY?: number` (0-1) to `domain.ts` Story type.
- **Per-placement crop math**: Library card (1:1 square, y = focalY - 0.07), mobile hero (3:4 full-bleed, y = focalY - 0.02), desktop cover (3:4 sticky, y = focalY).

### Reader Screen Redesign

- **Mobile (< 768px)**: Full-bleed 3:4 hero image with LinearGradient fade into page background, floating white pill back button.
- **Desktop (>= 768px)**: Two-column layout — 200px sticky cover on left, reading column on right. `maxWidth: 700`, centered.
- **Chapter navigation**: Pill-style chapter selector (Ch 1 / Ch 2 / Ch 3) for multi-chapter stories. Audio stops and unloads on chapter switch.
- **Voice toggle**: Hidden when only one narration voice is available.
- **All existing features preserved**: audio playback, engagement bar, comments, author card, bookmark, share.

### Library Card Redesign

- Square (1:1) cover tile with focal-point anchoring, no text overlay on image.
- Title + meta line ("Genre . Xk reads") below the card.
- Card width ~172px, borderRadius 20, warm shadow.
- Rail gap reduced from 20px to 12px.

### 3 Production-Grade Sample Stories

Generated via the story prompt system and validated against all anti-slop rules:

| Story | Genre | Language | Chapters | Words | Cover | Audio |
|-------|-------|----------|----------|-------|-------|-------|
| The Vanilla Problem | romance | EN | 1 | 1,632 | OpenAI gpt-image-1 | Seed Audio (Brielle) |
| The Decimal Point | mystery | EN | 3 | 3,006 | OpenAI gpt-image-1 | Seed Audio (Holden) |
| Las cien luces de Don Aurelio | bedtime | ES | 1 | 1,048 | OpenAI gpt-image-1 | Inworld TTS (Lupita) |

QA results: 0 banned words, 0 banned phrases, 0 banned names, 0 em dashes, 0 bad dialogue tags across all 5 texts.

### Developer Tooling (PR #26)

- **ESLint 9**: `eslint.config.js` (flat config with `eslint-config-expo`). 0 errors, 22 warnings (pre-existing).
- **Jest 29**: `jest.config.js` (jest-expo preset, pnpm transforms, `@/` alias). 5 suites, 33 tests.
- **Test suites**: theme tokens, i18n key parity, analytics no-op, supabase config, seed data validation.
- **CI**: `.github/workflows/ci.yml` — typecheck + lint + test on every PR. Pinned action SHAs, `permissions: contents: read`, pnpm 11.
- **Dependencies added**: `react-native-reanimated@~4.1.7`, `react-native-gesture-handler@~2.28.0`, `expo-haptics@~15.0.8`, `eslint@^9`, `eslint-config-expo`, `jest`, `jest-expo`, `@testing-library/react-native`.
- **Design tokens**: `typography.ts` (7 text styles), `shadows.ts` (3 elevation levels), `motion.ts` (3 duration tokens), `index.ts` barrel export.
- **Design drift fixes**: 30+ hardcoded `#FFFFFF` replaced with `colors.surface`, barrel import fixes in 3 files.

### Expo Skills Integration

27 Expo skills installed locally from `github.com/expo/skills` into `.agents/skills/`:

| Category | Skills |
|----------|--------|
| Core | expo-overview, expo-router, expo-animation, expo-design-system, expo-native-ui, expo-ui |
| Data | expo-data-fetching |
| Build | expo-dev-client, expo-module, expo-upgrade, expo-project-structure |
| EAS | eas-app-stores, eas-workflows, eas-update-insights, eas-observe, eas-simulator, eas-hosting |
| Platform | expo-app-clip, expo-brownfield, expo-web-to-native, expo-dom, expo-tailwind-setup |
| Reference | expo-examples, expo-skill-eval, expo-api-docs, expo-review |

**Skill routing table** added to AGENTS.md mapping every task category to its skill path.
**Mandatory skill usage rules**: animation gate check, design token imports from barrel, navigation via expo-router skill.

### Theme Token Expansion

8 new sepia design tokens added to `theme.ts` for the reader/cover design handoff:

`sepiaHeading`, `sepiaBody`, `sepiaMuted`, `sepiaSecondary`, `sepiaAccent` (darkened to `#A64C1C` for 4.5:1 contrast), `sepiaButton`, `sepiaPlaceholder`, `sepiaToggleTrack`

### Instruction File Consolidation

- **`AGENTS.md`** expanded from 150 to 456 lines with 15 sections. Now contains ALL information previously split across root CLAUDE.md, backend/CLAUDE.md, and expo/CLAUDE.md: infrastructure & services, database schema, edge functions, monetization, audio narration, app architecture, build & deploy.
- **`CLAUDE.md`** (root): Replaced duplicate content with 5-line redirect to AGENTS.md.
- **`CODEX.md`**: Replaced chain redirect (CODEX → CLAUDE → AGENTS) with direct redirect to AGENTS.md.
- **`backend/CLAUDE.md`**: Replaced 233-line standalone file with 5-line redirect to AGENTS.md (all info synthesized into the canonical file).
- **`story-generator.md`**: Updated from v1.0 (35 lines, basic rules) to v2.0 (120 lines) matching the story-prompts.ts implementation.

### OpenAI API Key

- Key set in Supabase secrets (updated by user).
- Key saved to `backend/.env` for local development (gitignored).
- Model confirmed: `gpt-image-1` (dall-e-3 no longer available on this project's API key).

### PR History

| PR | Title | Status |
|----|-------|--------|
| #25 | Cover image system with focal-point cropping and sample stories | MERGED (3 rounds, 16 comments addressed) |
| #26 | Dev tooling, design tokens, test coverage, and drift fixes | MERGED (CodeRabbit approved) |
| #24 | Genre-aware anti-slop story prompt system + instruction consolidation | MERGED (rebased onto main, CodeRabbit approved) |

### Files Changed (across all 3 PRs)

- 33 files changed, ~3,600 insertions
- New backend files: `_shared/story-prompts.ts`, `_shared/cover-prompts.ts`, `_shared/image.ts`, `COVER_IMAGES.md`
- New expo files: 3 cover images, 5 test suites, 4 design token files, ESLint config, Jest config, CI workflow
- Updated: `App.tsx`, `KathaPrimitives.tsx`, `domain.ts`, `seed.ts`, `images.ts`, `theme.ts`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `backend/CLAUDE.md`, `story-generator.md`
