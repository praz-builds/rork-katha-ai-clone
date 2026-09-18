# Session prompt: make long generated stories hold together

Paste everything below the line into a new Claude Code session opened at the repo root.

---

You are working on Katha AI (repo root: this checkout). Read `AGENTS.md` first and follow it: branch `codex/<slug>` from `origin/main`, PR, CodeAnt review, resolve every thread, merge only when green. Match the codebase's style: long comments that explain WHY.

## The job
Make multi-chapter stories written by the production pipeline **coherent from the first chapter to the last**, so a reader never meets a fact that changed, a scene that replays, a clock that runs backwards, or an ending that contradicts the setup. This is the biggest quality problem in the product today, and it hits every user who writes a series.

## Evidence (read before designing anything)
On 2026-09-18, 83 "Katha Originals" (1–15 chapters) were written through the real pipeline (`generate-story-stream` then `continue-story` with `stream: true`, `story_flow: "auto"`) and read in full by editor agents. **Not one story passed as written.** Six had to be regenerated from scratch, **all of them 8–10 chapters long**. The full record is in `backend/originals/`:
- `reviews-batch*.jsonl`: one line per story, with verdict, scores, and `issues[]` with chapter numbers, severity and quotes. Start with batches 1, 3, 8, 13, 14 and 24, which hold the regenerate verdicts.
- `edits-batch*.jsonl`: the exact find/replace fixes editors had to make. This is the best catalogue of failure modes. Each `notes` field summarises what was wrong.
- `briefs*.json`: the requests sent, including `beats` (per-chapter plans) for long stories.
- `REVIEW_GUIDE.md`, `EDIT_GUIDE.md`, `BEATS_GUIDE.md`, `run-originals.ts`, `export-for-review.ts`, `verify.ts`: the tooling that produced and checked them. Reuse it as your evaluation harness.

The failure modes, most frequent first:
1. **Fact drift across chapters.** Names, ages, dates, currencies, counts, who-owns-what and backstory are retold differently. Examples:
   - A dead husband given the heroine's own name.
   - A birthday that moves from the 9th to the 7th.
   - A 1983 vial labelled two different ways.
   - A backstory told three incompatible ways (Low Orbit Lullaby, Salt Notary, Hyenas).
   - A man who is 79 in one chapter and "thirty" in another.
2. **Scenes and reveals replayed as if new.** The midpoint reveal happens three times (Cartographer's Heir, chapters 2, 12 and 14). A planned moment is replayed as new in a later chapter (Garúa, Sun Came Back Wrong).
3. **Clocks that break.** A deadline story whose rescue happens after the deadline (Zanzibar draft). A calendar that collapses (Returned on Thursdays draft). A timetable-based mystery whose times contradict each other (Shimla, which failed twice).
4. **Mysteries that stop being fair.** The final clue is impossible, clues are never planted, the solution contradicts earlier chapters.
5. **Duplicate chapter titles** in auto-run series.
6. **Brief text pasted into prose.** The model echoes `moments` entries or character descriptions verbatim. `SeriesState.delivered_moments` stores moments verbatim and may be feeding this. Check.

What already exists: `SeriesState` in `_shared/types.ts` (central_conflict, open/resolved hooks, promised_payoffs, world_facts, character_changes, next_chapter_pressure, delivered_moments). There is also a `previously_summary`, a limited previous-chapter window plus a "Chapter 1 callback context" in `continue-story/index.ts`, and optional `beats` (a per-chapter plan the blueprint screen fills). **Per-chapter `beats` reduced drift but did not stop it.** Low Orbit Lullaby, rewritten with beats that restated the fixed backstory, still drifted in chapters 8–10. Returned on Thursdays had beats and still collapsed its calendar until every beat carried its date and fixed facts.

## Already being fixed in other PRs (do not duplicate; build on them once merged)
- `codex/prose-integrity`:
  - An optional `title` in the request.
  - A prose-integrity pass that strips JSON residue, model notes, "Chapter N" meta text and pasted brief sentences.
  - Previous chapter titles passed to continuation, with a duplicate-title guard.
- `codex/stream-resilience`: server keep-alive and client stall recovery.
- `codex/pipeline-fixes`: the entity privacy gate removed.
- `codex/cover-prompt-fixes`: cover-prompt fixes.

## What to build (a design proposal first, then the build)
Propose, then implement, a continuity system. At minimum:
1. **A story bible that cannot drift.** A structured, persisted record extracted at story start and updated after every chapter:
   - canonical facts: names, ages, relationships, occupations, physical traits, key objects and who holds them, places, money and units;
   - the in-story **calendar and clock** (current date and time, the deadline and time remaining);
   - **the truth** (the secret, the mystery solution, the magic system's rules and costs);
   - **scenes and reveals already shown**, with the chapter they happened in.

   Every continuation prompt gets it as "FIXED FACTS: do not contradict; do not re-reveal". Decide whether this extends `SeriesState` or is a new column, and write the migration.
2. **An automatic plan for long stories.** When a series is 5+ chapters and has no `beats`, generate a chapter-by-chapter plan before chapter 1 (reuse or extend `shape-story` / `_shared/story-shape.ts`). Each beat carries its date and the facts it depends on (see `BEATS_GUIDE.md`, which is what worked). For mysteries, fix the solution, the clue placements and the red herrings up front.
3. **A continuity check after each chapter.** A cheap structured model call compares the new chapter against the bible and returns contradictions and re-reveals. On a hard contradiction, regenerate once with the contradiction named. On anything left, log it through `_shared/errors.ts` so the rate is measurable. Keep cost and latency bounded, and say how.
4. **Moments must never be quoted.** Stop storing or echoing moments in a way that invites verbatim reuse, and prove it with the integrity pass's log counts.
5. **An evaluation harness:** a script that generates a fixed set of 6–8 long test stories (reuse briefs from `backend/originals/briefs*.json`, especially the ones that failed: low-orbit-lullaby, nine-oclock-zanzibar, last-train-from-shimla, returned-on-thursdays, cartographers-heir, a-winter-for-the-eagle). Then run the review agents over them (`REVIEW_GUIDE.md`), and report issues per chapter before and after your change. **Success means the regenerate-class failures (1–4 above) drop to near zero on 8–15 chapter stories.** Put the numbers in the PR.

## Constraints
- Generation runs as a house account on production OpenRouter credit, which is shared with real users. Keep test runs small, and check the balance (`GET https://openrouter.ai/api/v1/credits`) before large runs.
- Streamed paths only for anything interactive (`generate-story-stream`, and `continue-story` or `reimagine-chapter` with `stream: true`). The buffered paths cannot exceed the gateway's 150s.
- Every change that touches money or generation must log failures to `public.error_events` (AGENTS.md, Observability Gate).
- Kids mode stays safe: the continuity system must not weaken the kids safety layers.
- Deno tests for every new `_shared` module, and jest for any client change. `tsc`, lint and all tests green.
- Deploying edge functions and running the migration on production are part of done, and must be verified with one real 8-chapter generation after deploy.

## Also worth doing while you are in there (smaller, from the same reviews)
- **Brand names still appear** despite the prompt. Measure with the integrity pass's brand log, then decide whether a post-pass is needed.
- **Kids and educational fact accuracy.** Editors had to correct wrong science several times, and some of it was wrong in dangerous ways: counting thunder while outdoors, a glass mirror put in a kiln, and a backwards satellite-signal idea. Consider a fact-check pass for `audience_mode: "kids"` and the educational genre.
- **The pipeline sometimes writes past its word band** (`streamed_chapter_outside_band` in `error_events`).
