# Katha AI — Build Log

<!-- markdownlint-disable MD013 MD024 -->

> Chronological record of all changes made across sessions.
> Every session that modifies code, schema, config, or infrastructure MUST append an entry here.

---

## 2026-09-08 UTC — Eight review findings: an SSRF-by-redirect close, a read-count gate, and a practice vocabulary that finally agrees

**Session:** Verified and fixed eight findings from an automated review pass
(`codex/review-hardening`), plus one test that could not fail regardless of
whether the code it covered was correct. All eight were confirmed real
against the working tree; none were refuted. Not committed -- left for
review.

1. **SSRF via redirect (narration audio).** `fetchAllowedAudioUrl` in
   `_shared/narration-audio.ts` now fetches with `redirect: "manual"` and
   re-validates the host allowlist on every hop (capped at 5), instead of
   checking only the URL it was first handed and letting `fetch` follow
   redirects on its own past the check.
2. **Unbounded base64 decode.** `decodeBase64Audio` now refuses a payload
   over `MAX_AUDIO_BASE64_CHARS` (the 50 MB ceiling expressed in encoded
   characters) before calling `atob`, mirroring the URL path's existing cap.
3. **Read counts inflatable by any authenticated caller.** New migration
   `00052_read_visibility_gate.sql` redefines `record_story_read` (00046) to
   fold in the same readability predicate `save_phrase` (00047) already
   uses -- `is_public or is_curated or author_id = caller` -- plus a
   non-author additionally needing the specific chapter published. An
   unreadable story fails with the identical "Story not found" a missing one
   would, so the message cannot be used to probe for a private story's
   existence. The author's own unpublished-story path is unchanged.
4. **Practice outcome vocabulary mismatch.** Canonical vocabulary is the
   backend's four-value `again | hard | good | easy`
   (`record-practice`'s `OUTCOMES` set and the `record_phrase_practice` SQL
   check constraint in 00047 already agreed on it, with real
   spaced-repetition math keyed off those exact values). The client's
   two-button UI keeps its `know | again` vocabulary but now maps onto the
   canonical one at the wire boundary (`PRACTICE_OUTCOME_WIRE_VALUE` in
   `expo/src/lib/phrases.ts`): `again -> again`, `know -> good`.
5. **Saved-phrase id contract.** `save-phrase/index.ts` now returns
   `phrase_id` at the response root as the `saved_phrases` row's own `id`
   (the column `unsave-phrase` deletes by), not nested under `phrase` and
   not the row's unrelated `phrase_id` foreign-key column into
   `phrase_corpus`.
6. **Remote list hiding local phrases.** `listSavedPhrases` in
   `expo/src/lib/phrases.ts` now unions the remote answer with any local-only
   entry the remote list omits (`mergeSavedPhrases`), instead of replacing
   the local cache outright.
7. **Untracked provider job.** `generate-audio/index.ts` now separates
   "provider accepted a job" from "we recorded it": if
   `markChapterAudioJobStarted` fails after RunPod already accepted the job,
   the new `cancelRunpodNarration` (`_shared/narration-audio.ts`, backed by
   `runpodCancelUrl` in `_shared/runpod.ts`) best-effort cancels it before the
   row is marked failed, so a retry cannot race a still-running untracked job.
8. **Concurrent preview seedings.** `seed-voice-previews/index.ts` adds a
   module-level in-flight `Map` (`ensureVoicePreviewOnce`) so a second
   caller for a voice already being generated on the same warm instance
   reuses the first caller's promise instead of starting a second provider
   job. Judged proportionate to a service-role, idempotent-outcome, rarely
   concurrent endpoint -- no lock table added.
9. **A test that could not fail.** `voices/index.test.ts`'s fixture held
   only active voices, so the endpoint's `is_active` filtering could regress
   to nothing and the suite would still pass. Added an inactive voice to the
   fixture and made the stub honor the `is_active=eq.true` filter the way a
   real table would, so the test now fails if filtering regresses (verified
   by temporarily removing the filter from `_shared/voices.ts` and watching
   it fail, then restoring it).

**Verification:** `deno test --allow-env --allow-net --allow-read
supabase/functions`: **621 passed, 0 failed** (607 baseline, +14 new).
`deno test --allow-env --allow-net --allow-read supabase/migrations`: **90
passed, 0 failed** (84 baseline, +6 new, all in the new
`00052_read_visibility_gate_test.ts`). `deno check` and `deno fmt --check`
clean on every touched file. Expo `tsc --noEmit`: clean. Expo `jest`: **451
passed, 0 failed** (447 baseline, +4 new). Every new test that asserts a fix
was confirmed to fail against the pre-fix code by temporarily reverting just
that file with `git stash` and re-running.

---
## 2026-09-08: Onboarding preview survives its own failures

### Changed

- The onboarding preview no longer dead-ends. Every empty shape used to land on
  a "Preview needs one more try" screen whose only certain exit was Back to
  details - after the writer had typed an idea, chosen a shelf, entered a cast,
  verified an email and watched a loader. The preview is now built from their
  own words when the model gives us nothing: `fallbackTitle` from the idea, the
  shelf they chose, the cast they entered, and one line naming the chapter plan
  as something written when the story starts.
- A shape already in hand is reused when a later request is refused. The warm
  request is keyed on the whole brief, so walking back to add one moment spends
  another of the six shapes a minute the backend allows; `lastShape` keeps the
  preview the writer already earned instead of losing it to the seventh.
- The retry screen keeps Try again (it is now only reached when a retry can
  succeed) and gains "Continue without it", so no provider outage can hold a
  verified writer on an apology.
- `shape-story` says why a shape is empty: `rate_limited`, `provider_failed` or
  `unavailable`. A refused rate-limit claim used to be indistinguishable from a
  model returning nothing, and the client read both as non-retryable content
  failure - so a capacity ceiling was reported to the user as a bad idea.
- The onboarding opening prompt asks for 90-120 words in exactly two
  paragraphs, down from 120-180 in two or three. The preview renders
  `slice(0, 2)` clamped to three lines and two, and `finish()` never carries
  `opening` into the draft, so everything past the clamp was generated, paid
  for, waited on and dropped. A test now holds the band and the clamp together.
- `generateFastStructuredText` reserves a tail for the runner-up instead of
  splitting its window evenly by model index. `OPENROUTER_MODELS[0]` is 404 by
  account data policy today, so `[1]` inherits the window and the measured
  8-11s shape lands; an even split would have handed `[0]` 13.5s of
  onboarding's 45s the day that policy changes, aborting normal requests near
  the finish. Leader now gets 21s, runner-up 27s.
- Migration 00046 removes both anonymous ceilings on shaped previews: the 500
  a day across the whole project, and the 30 a day per anonymous network scope.
  Onboarding is anonymous, so the first was a cap on how many people could ever
  be shown a shaped preview in a day and the second rationed one office or cafe
  to thirty. Neither could stop an abuser - a shared ceiling only decides which
  innocent user absorbs the abuse - so what survives is the per-user window of
  six a minute, which is scoped to whoever is actually doing the damage.
  `shape-story` stops computing an HMAC of a guest's address for a parameter
  nothing reads any more, and the guest-without-a-scope path that silently
  refused to shape at all is gone with it.

### Loader

- The crafting loader's hold-on-last-stage fix is not in this branch. The bar
  used to fill to 100%, snap back to 4% and re-read stage one - at the 8-11s
  this screen actually waits, a claim the screen then withdrew. The fix was
  written here, picked up by the brand work rebuilding the same file, and
  reached main in PR #82, which also retired the progress bar outright. That
  answers the same complaint more completely than capping the bar did, so
  nothing is owed here; recorded so the fix is not written a second time.

### Still open

- `anonymous_story_shape_rate_limits` and `anonymous_story_shape_global_limits`
  are dead as of 00046 - nothing reads or writes them. Dropping them is a
  destructive change and was deliberately not smuggled in behind a policy one.
- Splitting the refusal reason by which window was hit needs the RPC to return
  more than a boolean. With one window left this matters less than it did.

### Verification

- `pnpm typecheck` clean, `pnpm lint` no new findings, `pnpm test` 444 passed
  across 51 suites (3 rewritten to the new contract, 3 added).
- `deno test -A supabase/functions/` 553 passed, 0 failed (3 added).
- `deno test -A supabase/migrations/` 83 passed, 0 failed (4 added; three in
  00039 and one in 00034 retired with a note in place, because they asserted
  ceilings 00046 deletes and every migration test runs the whole stack).

## 2026-09-08 IST — Onboarding preview wait timing and loader polish

### Changed

- Expo-only change: the writer onboarding details CTA now warms the single
  onboarding `shape-story` request as soon as the complete brief is known, so
  the email/code steps overlap the model latency and the wait screen only covers
  the unresolved tail.
- Replaced the generic center mark in the crafting loader with a simplified
  Katha app-icon draw/fill animation, porting the SwiftUI LogoDraw behaviour to
  React Native SVG + Reanimated for iOS and Android.
- Fixed the warmed-request failure race: a failed warm result is retained until
  the crafting screen consumes it, then cleared so an explicit retry performs a
  fresh request.

### Live Smoke

- Ran 5 live onboarding `shape-story` requests against the configured Supabase
  project using anonymous sessions.
- Shape latency: min 10.3s, median 11.3s, average 11.7s, max 14.2s.
- End-to-end anonymous auth + bootstrap + shape latency: 13.4s to 16.8s.
- All 5 returned usable shapes with title and opening. No production-level
  failures occurred, so no `public.error_events` rows were written.

### Verification

- `pnpm test -- --runTestsByPath src/__tests__/crafting-loader.test.tsx src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: 3 suites, 91 tests passing.
- `pnpm typecheck` clean.
- `pnpm lint` exits with 0 errors and the existing warning set.
- `pnpm exec jest --runInBand`: 34 suites, 331 tests passing.
- `pnpm exec expo-doctor`: 18/18 checks passing with local Node 22 in PATH.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- Local Expo web started on `http://localhost:8091/` because 8090 was occupied by another Katha checkout.

## 2026-09-07 UTC — Entity grounding, a retired spice tier, and private by default

**Session:** Three tracks built in parallel by sub-agents against disjoint file
ownership, then integrated. Stories can now be grounded in facts about the real
entities they name; the `explicit` spice tier is gone and romance is written to
a higher craft floor instead; and a story cannot become public because a caller
forgot to say otherwise.

### Entity grounding

A story naming a real entity was written from model recollection alone, and the
failure was not "the model does not know" — it is that a US-weighted model is
confidently wrong about long-tail and regional figures in ways an informed
reader catches on the first page. "Maharaj" is an honorific, not a surname.

The pipeline is classify -> decide -> card -> prompt layer, and the decision in
the middle is the point: `needsGrounding` asks *will the model get this wrong*,
not *is this famous*. Churchill and Spider-Man are known cold and get nothing;
Shivaji Maharaj gets a card.

- `_shared/grounding-types.ts`, `entity-classify.ts`, `grounding-card.ts`,
  `grounding-search.ts` — vocabulary, classifier, fact card, and a Brave
  provider behind `GROUNDING_SEARCH_ENABLED` + `BRAVE_SEARCH_API_KEY`. Both
  unset, so **phase 1 ships on model knowledge alone**: the cheap test of
  whether a structured card fixes the register errors before paying for search.
- `_shared/grounding-pipeline.ts` — the only module that sequences the three
  parts, so the two callers cannot disagree about order or about what a failure
  means. Every failure path returns empty, which renders as the prompt every
  story had before this existed.
- Migration `00045` — `stories.grounding`, `stories.grounding_entities`, and
  the `entity_grounding` cache. The cache is the whole cost design: entities
  repeat across users far more heavily than ideas do, and a card for a dead
  17th-century king does not change between requests. TTL by class.
- `buildGroundingBlock` is inserted into `buildUserPrompt` directly after the
  cast, because the highest-value field on a card is how the entity is named
  and addressed. It returns `""` for no cards, so an ungrounded prompt is
  byte-identical to what it was.

**Two hard rules, enforced in code rather than in a prompt.** A
`private_individual` is never searchable — `searchable` is derived from the
class on read, so no payload can talk the pipeline into sending a user's child
to a search vendor — and raw retrieved text never reaches the story prompt, only
a validated card, which contains prompt injection to a call that can emit
nothing but a schema.

**Where it runs.** Normally in `shape-story`, concurrently with shaping
(`allSettled`, so grounding cannot take the shaped brief down with it) — free,
and spent while the writer edits chips. Only onboarding calls that endpoint, so
a Create-studio story would have arrived ungrounded; both generation transports
now start a bounded fallback (`GENERATION_GROUNDING_DEADLINE_MS`, 9s) before
`begin_story_generation` and await it after, overlapping the measured 1.4-2.2s
opening round trip. Skipped entirely when the client supplied cards.

`continue-story` replays the stored cards rather than re-deriving them: chapter
seven must call an entity what chapter one called it, and re-classifying per
chapter would spend two calls a chapter and still let the name forms drift.

Cards reach generation through the client, which is safe because a tampered card
only degrades the tamperer's own story and is fenced like any user text — but
`validateGroundingCards` still caps count, field lengths and list sizes at the
boundary, because every card byte is a prompt token somebody pays for.

### Explicit retired, craft floor raised

`SpiceLevel` is now `sweet | steamy`. `stories.spice_level` and `content_rating`
keep CHECK constraints admitting `'explicit'` and `feed`/`library` still filter
on it, so the value must round-trip: retirement is enforced in code, not by a
destructive constraint migration. An inbound `explicit` now **normalizes down**
to `steamy` instead of returning 403 — a stale client build must not fail a
generation the writer is waiting on.

A `## Language Floor (ABSOLUTE)` block with 31 enumerated crude terms sits in
**layer 1**, not the spice layer, so no combination of tier, genre, lens,
audience mode or language drops it. `scanCrudeLexicon` is the defence-in-depth
detector, following the living-author precedent including its honest
over-match: a case-sensitive lowercase-only regex keeps a character named Dick
from firing it, and unscannable terms (`cock`, `prick`, `bang`) stay
prompt-only.

`_shared/content-scan.ts` wires it into all three generation paths as
**report-only**. Rejecting and retrying would buy a second 11-30s generation on
the word of a regex with known over-matches, and cannot help the streamed path
at all — the reader has already seen every word. The floor is the control; this
scan measures whether it holds. Escalate from that data, not before it.

Both spice branches were rewritten as technique rather than prohibition —
prohibition alone produces timid, flat intimacy, which is a worse product than
what it replaced.

### Private by default

`publish-story` read a missing `visibility` as `"public"`, so any caller that
merely forgot the field published to the feed. Now `resolveVisibility()`,
defaulting to private, with a regression test that fails if it is flipped back.
`expo/src/lib/api.ts` now always sends the field explicitly rather than relying
on whichever build of the function is deployed.

**A regression was caught and reverted during integration.** A proposed
migration re-granted `SELECT, INSERT` on `public.stories` to `authenticated`,
restating a grant from `00015` verbatim — but `00034` had deliberately revoked
`insert, update` on that table and dropped the matching policies, because story
creation and publication are service-owned. `00034`'s own test
("clients cannot bypass the service-owned story publication path") caught it.
The migration was dropped entirely: the invariant it aimed at was already
enforced, and a revoke-then-regrant migration is pure risk. **The lesson is in
the test, not in the migration** — any future migration that re-grants INSERT or
UPDATE on `stories` fails it, which is exactly what it is for.

The related claim that `00045` broke PGlite migration replay
(`normalize(x, NFKC)`) did **not** reproduce: PGlite parses the unqualified
form, verified directly, and the full migration suite passes.

### Verification

- `deno check` clean across all `_shared/*.ts` and every function `index.ts`.
- `deno test supabase/functions`: **464 passed, 0 failed** (baseline 361).
- `deno test supabase/migrations`: **44 passed, 0 failed**.
- `deno fmt --check`: the 6 remaining unformatted files
  (`send-push`, `feed/index.test.ts`, `story-shape.ts`, `edit-story`,
  `comments` x2) are pre-existing and were not touched.
- `expo/`: `pnpm typecheck` clean, `pnpm test` **30 suites / 304 tests passed**
  (Node v22.23.0).

### Known gaps, deliberately not closed

- **Web search is built but off.** Phase 2 turns it on for the narrow
  `needsGrounding` set once phase 1 shows whether cards alone are enough.
- **Covers are not grounded yet.** `cover-prompts.ts` still works from genre
  config, so a Shivaji cover is generated without the card. This is now a
  quality bug rather than a legal one.
- **`entity_grounding_prune()` has no caller.** It needs a scheduler entry
  alongside `refresh-subscription-grants`.
- **`feed`'s continue-reading rail** fetches stories from the reader's own
  `story_reads` without re-checking `is_public`. Harmless while there is no
  unpublish feature; it becomes a stale-visibility path the moment one ships.
- **The publish gate for real-entity stories is not built.** `grounding_entities`
  is being recorded from now on precisely so that gate is a `WHERE` clause
  later rather than a backfill over the whole corpus.

---

## 2026-09-07 UTC — Brief fidelity, chapter steering, an honest cover, and Write the rest

**Session:** Four changes to the create flow, in the order they depend on each
other. Everything the user types in the brief now reaches the model, the writer
can steer each chapter, the cover step stops lying about when the cover is made,
and the remaining chapters can be handed over in one action.

### Moments were re-promised on every chapter

A series handed all five moments to every chapter under "each must happen
somewhere in the story", and nothing recorded that one had landed. The model
either wrote a moment twice or held all five for the finale. `series_state`
gained `delivered_moments`; the prompt now partitions the list into delivered
(do not repeat) and owed, and adds runway pressure once the chapters remaining
no longer cover what is owed. The merge is an append-only union allowlisted
against the story's own moments, so neither a partial response nor an inventive
one can shrink the set or inject text into it. `series_state` is `jsonb`, so no
migration was needed, and a story predating the key reads as `[]`.

### `avoid` was the weakest line in the prompt, and never reached the art

It sat fifth of twelve blocks reading "keep this out of the story where
reasonably possible" — a hedge on a negative constraint, in the position least
likely to survive. It now sits at the tail after moments, stated as a
constraint. It is also threaded through `generateStoryMedia` into
`buildCoverPrompt` as an explicit exclusion, sanitized before it reaches the
image provider and preserved at every rung of the safety fallback ladder.

### `next_instruction` existed on the server and no client sent it

`continue-story` has validated it all along and `story-prompts.ts` already
carried the rule that typed direction outranks the approved beat. Only the UI
was missing. The end of a chapter now offers an optional 300-character box above
a Continue button carrying its price; blank sends nothing, and the box clears
only on success so a failed continuation keeps what was typed.

### The cover step described work that had already happened

It showed a gradient concept card rather than the real cover, promised the cover
would be made "when you publish" when `generate-story` schedules the art the
moment chapter 1 persists, and collected a cover note into state nothing read,
beside a permanently disabled Regenerate button. Per `STORY_GENERATION_FLOW.md`
§10.4 the step is removed rather than repaired: the editor header reveals the
thumbnail when the art lands, and review shows the real cover with an honest
`cover_status`.

**Migration 00044** adds `stories.cover_regen_count` and `stories.cover_prompt`
(the latter did not exist, despite being referenced in a 00027 comment), plus
`claim_cover_regeneration` and `finish_cover_regeneration`. The new
`regenerate-cover` function reserves through the existing `kind='cover'`
operation path, inheriting idempotency and auto-refund. `requires_credit` is
decided inside the claim, under the same advisory lock and `for update` that
claims the row — reading it in the Edge Function and acting a round trip later
is what turns two fast taps into two free covers. The counter moves only in the
statement that writes the URL, so an exhausted generation costs nothing and does
not spend the free retry.

### Write the rest

`continueOnce` is now the only continuation path; the run loops it. Each chapter
stays its own request, reservation and credit. Stop lets the in-flight chapter
finish rather than abandoning a reservation the server is already writing
against, a failure ends the run without retrying, and the "What happens next?"
box is ignored and not consumed by a run — stated in the confirm sheet and under
the button.

### Verification

- Backend: `deno test --allow-env --allow-net --allow-read
  backend/supabase/functions/_shared/` — **337 passed, 0 failed** (291 on the
  base commit). `deno check` passes on every `functions/*/index.ts`, including
  the new `regenerate-cover`. `deno fmt --check` clean on the three gated files.
- Expo: `pnpm typecheck` 0 errors; `pnpm lint` 0 errors (17 pre-existing
  warnings, none in touched files); `npx jest --ci` — **305 passed, 30 suites**
  (274/27 on the base commit).
- Type-checking note: an intermediate agent ran the backend suite with
  `--no-check` and reported four type errors it had introduced as pre-existing.
  They were real and are fixed. The base commit was re-measured clean to confirm
  it, and every gate above was re-run by the orchestrator rather than trusted.
- **No Supabase function was deployed and no production-level test was run
  against deployed infrastructure**, so no `error_events` rows were required.
  Migration 00044 is unapplied; `regenerate-cover` is undeployed. Both must ship
  before the cover UI is exercised against production.

## 2026-09-06 UTC — Main Create single-screen correction

**Session:** Corrected the Expo main Create UI after review: the main story-generation flow is one screen, not Idea → Review. Character craft remains the only separate full-screen surface.

- Backend behavior was not changed in this pass. Character image generation remains a separate request only when the user asks for it, and the paid story call remains the final Create action with the completed draft payload.
- A later UI density pass changed only Expo-visible hierarchy/copy: Genre left with an icon, Kids Mode as a compact switch, optional Premise as the visible context label, and denser More options.
- No Supabase functions were deployed and no production-level tests were run, so no `error_events` entry was required.
- Verification from `expo/`: focused Create/API Jest suites passed (32 tests), `tsc --noEmit` passed, and the web export passed using the bundled Node runtime.

## 2026-09-05 UTC — Create flow hierarchy and character-image contract

**Session:** Main Create was realigned with the new product direction: the two-screen onboarding-style split is not the main creation flow, characters are primary, other controls sit under More options, and character images are a separate call before paid story generation.

- Updated `source-of-truth/STORY_GENERATION_FLOW.md` from Idea → Shape → Review to Idea → Review and start for main Create.
- Revised the character contract so Craft character supports Create image/Reimagine/Edit/Delete and story generation waits for any character-image request the user started.
- Added `generate-character-image`, a callable Edge Function that authenticates the user, validates the draft character fields, calls the existing character-portrait image path, and returns a draft portrait URL without starting story generation.
- Extended backend generation validation and character persistence so `portrait_url` from a pre-generated draft character survives the final story call and lands on `characters.portrait_url`.
- No production-level backend test or deploy was run in this session, so no `error_events` entry was required.
- Verification from `expo/`: focused Create/API Jest suites passed (31 tests) and `tsc --noEmit` passed using the bundled Node runtime. Backend `deno check`, `deno test` for validation, and `deno fmt --check` passed for the touched Edge Function/shared files. `pnpm` itself was blocked by the existing ignored-build approval prompt.
## 2026-09-06 UTC — Streaming finally reaches a user

**Session:** The Create flow generates through the streamed path and renders
prose as it arrives. This closes the gap the previous entry flagged.

### What was wrong

Streaming was built, deployed, measured and verified with `curl`, and **no
screen called it**. `CreateStudioScreen` still imported the buffered
`generateStory`, so every real user waited the full ~49 seconds in front of a
loader while the fast path sat unused behind it. The endpoint being fast was
never the feature.

That is worth recording as a process failure rather than a code one. The work
was reported as done at the point the last file compiled, and everything
measurable about it looked finished: the endpoint streamed, the transport parsed
frames, the API function handed over chunks, the tests passed. **A client that
collected every chunk and painted once at the end would have satisfied all of
it.** That is precisely what shipped. The last hop was left to another agent
because of file ownership, which was a reasonable process decision and a bad
product one - nobody could use the thing.

### What it does now

All three paths render as they arrive: the first chapter, `Continue`, and
paragraph edits. `StreamingProse` shows completed paragraphs and the partial
trailing one, because waiting for a paragraph to close would put the reader back
in front of a blank screen for most of the generation. It follows the text down
until the reader scrolls and then stops following - yanking the viewport away
mid-sentence is worse than letting text arrive below the fold. It does not
animate a cursor: the text already arrives at a real rate, and a second invented
rhythm would be the same lie as a timed progress bar.

The loader hands off on the first token with no minimum. Prose at three seconds
means reading at three seconds.

Failure after prose has appeared keeps the prose. The credit is already
refunded, so the text stays with the failure stated underneath it and a way off
the screen. A failed paragraph edit restores the original text - the streamed
rewrite has been painting over it, so without that the writer is left holding
half a sentence where their finished one used to be.

### The test that matters

`create-streaming-integration.test.tsx` renders the real screen, releases SSE
frames one at a time, and asserts the prose is on screen **while the response is
still open**. Every other test passes whether the screen streams or buffers;
this one does not. If the screen ever goes back to collecting chunks and
painting at the end, it fails.

The existing Create contract test mocked `generateStory` and would have gone on
passing while the user got nothing until the end. It now mocks
`generateStoryStreaming`, which is the honest assertion.

### Gates

`tsc` clean, `eslint` 0 errors, **223 Jest / 18 suites**, **288 Deno tests**.
The web bundle builds clean and carries the new component.

---

## 2026-09-06 UTC — Streaming the reading loop, and the grant that made push a no-op

**Session:** `continue-story` and `edit-story` stream, notifications are wired
to the two moments they exist for, and two small open items closed.

### Streaming the rest of the loop

Measured against production: a streamed continuation puts prose on screen at
**4.9s against a 31.0s total**, and the persisted chapter matches the streamed
text word for word. `continue-story` is the more valuable of the two, because a
reader deep in a series triggers it repeatedly and is less patient each time
than they were on chapter one.

**Both are a branch inside the existing function rather than a second
function**, and that is the decision worth recording. `generate-story-stream`
was written separately because its replay paths made the point of no return hard
to see. Neither of these has that problem: every rejection they can make happens
before the model is called. Branching keeps one preparation path, and it let the
persistence and refund logic become closures both transports call. The
continuity merge in `continue-story` decides what an absent `series_state` field
means, and the optimistic-concurrency predicate in `edit-story` is the only
thing standing between two overlapping edits and a silently discarded one.
Neither should ever exist twice.

Streaming is opted into per request with `stream: true`, so a client that does
not ask gets the buffered response byte for byte.

The continuation prompt gained an output mode rather than a second builder. A
test asserts the JSON and prose prompts differ only after `## Output Format`, so
a change to the continuation rules, the band or the finale instructions cannot
reach one path and miss the other.

**A note on robustness that was not the goal.** During testing the *buffered*
continuation failed twice at the 120s chain deadline while the streamed one
succeeded on the same story and model. Recorded codes: `timeout` on both
OpenRouter positions, `429` on all three OpenAI models, partly self-inflicted
load from a day of testing. But the asymmetry is structural: the buffered path
gives each OpenRouter model a 30s slice to return a complete 32k-budget
structured chapter, while the streamed path commits on a first token arriving in
about 2.4s. Streaming is more tolerant of a slow provider, not only faster to
first paint.

### Push was wired to nothing, and could not have worked anyway

The onboarding notify screen asks for the single push permission iOS grants per
install, and no completion path ever sent one. Wiring it surfaced the reason
nobody had noticed:

**`push_tokens` had no grant for `service_role`.** 00037 locked the table with
`revoke all ... from public, anon` and granted `authenticated` its own rows, but
granted the sending role nothing, so `send-push` failed at its first query with
`42501: permission denied for table push_tokens`. Every call. Nothing had called
it, so the table looked correct and the function looked finished. Migration
00043 grants it.

That is the lesson worth keeping: **the bug was invisible from the code and
obvious from the first real call.** A feature is not done at its last file, it
is done when something exercises it end to end.

The send moved into `_shared/notify.ts` so a generation path fires it in process
rather than one edge function calling another over HTTP. `send-push` stays and
delegates, so token lookup, batching, receipt reading and dead-token pruning
have one implementation.

A story notifies when its **media task** finishes, not when the chapter is
persisted: the text has been readable for a while by then, but the cover is what
makes the row look finished in Library, and that task is the only place that
knows the whole job is done. A continuation notifies when its chapter lands.

**Consent is read from the OS per request and must be a literal `true`.** A push
sent to somebody who declined can be neither un-sent nor re-asked. Tests pin
that `"true"`, `1` and `"yes"` are all refused.

Still unverified: a notification arriving on a real device. That needs an EAS
build with APNs credentials. Everything up to the Expo call is exercised.

### Two small items closed

The crafting loader's K asked for `fontWeight: 900` on `Baloo2.ttf`, a variable
font. React Native cannot drive a weight axis, so it rendered at the 400 default
- and the axis stops at **800**, so 900 was never reachable by any means. A
static 800 instance is cut from the variable file and bundled as its own family.

`ONBOARDING_FLOW.md` section 9 specified "Here's the shape of it." as the
blueprint heading; the screen shipped as "Your idea just became a story." The
spec is corrected to the code rather than the reverse, with the reasoning
recorded.

### Gates

`tsc` clean, `eslint` 0 errors, **210 Jest / 16 suites**, **288 Deno tests**.
Migration 00042 applied; `send-push`, `generate-story`, `generate-story-stream`,
`continue-story` and `edit-story` deployed.

---

## 2026-09-05 UTC — Create release integration and production smoke

**Session:** Integrated the Create flow, prompt-system v6, story planning,
streaming generation, guest bootstrap, and the independently completed writer
onboarding without changing its implementation. Removed trope from the active
product and runtime contracts; kids Values remains a separate kids-only field.

### Production result

A real browser run from `http://localhost:8090` used the placeholder email/OTP
handoff, bootstrapped a guest with 3 credits, shaped a detailed adult romance,
added two character sheets, reviewed the plan, and generated the story through
the deployed backend. `The Jam and the Lease` completed as operation
`552cd049-b2d0-40a6-90dd-01ab4bb3cb5a`: one 1,852-word chapter, a ready cover,
and portraits for Anahita Contractor and Arjun Mehta. The operation persisted as
`completed` with no error. A blank inferred character returned by one shaping
response exposed an `Untitled character` card; the client now drops blank names
and has a regression test.

The first attempt used port 8091, which is intentionally absent from the exact
CORS allowlist. That production-test failure is persisted as fingerprint
`2a3d4e128810941ae09a6dac57c2f0d8` (`client.app` /
`smoke_origin_not_allowlisted`, one occurrence). The shaping telemetry queried
before release remains `5e60930b2675d2d6d146c232c7c22648` (provider failure,
four occurrences) and `ba02a878d8d5170b715ac51addcc235a` (unhandled shaping,
three occurrences); both are diagnosed by the preceding entry.

### Release hardening

- Replaced invalid placeholder values in `pnpm-workspace.yaml`'s install-script
  allowlist with explicit approvals and restored the audited `uuid` override.
- Terra security review found no create-flow release vulnerabilities. It did
  surface a pre-existing high-risk paid narration path: any story owner could
  repeatedly send arbitrary text to RunPod with no credit or idempotency gate.
  Fresh narration is now blocked until the canonical one-credit audio-unlock
  operation exists; already cached narration remains playable.
- `audio-status` now performs an ownership-checked cached lookup and cannot
  contact RunPod. An initial fix authorized the chapter before polling, but a
  Terra re-review correctly rejected it because ownership did not bind the
  caller-supplied job id to that chapter. Provider polling stays closed until
  that binding is durable, closing the status/output IDOR rather than masking it.
- The constrained residual risk is draft prose and character details in
  AsyncStorage for seven days. Supabase auth tokens use SecureStore on native.
- `pnpm audit` still reports two high `image-size@2.0.2` parser advisories in
  Metro's build-only dependency graph. The registry still has no `2.0.3`
  release, so the documented patched version cannot be installed; Metro only
  reads repository-controlled assets in this workflow.

### Gates

Expo: TypeScript clean, 210 Jest tests / 16 suites, lint 0 errors (17 existing
warnings), Expo Doctor 18/18, and production web export passed. Backend: 307
Deno tests passed; all Edge Functions typechecked and 67 files passed
`deno fmt --check`. Remote migrations match local through `00041`.

---

## 2026-09-06 UTC — What the streaming numbers actually mean, and what is still not wired

**Session:** No code change. This entry exists because the latency numbers from
2026-09-05 are the kind that get quoted later without their context, and because
one honest gap in that entry needs stating plainly.

### The gap first: streaming is built and deployed, and nothing calls it

`generate-story-stream` is live and verified end to end. `generateStoryStreaming()`
exists in `expo/src/lib/api.ts` and is tested. **No screen calls it.**
`CreateStudioScreen` imports `generateStory` -- the buffered path -- and that is
still what every real user gets.

So the 8.8x is a property of the endpoint, measured with `curl`, not something a
person using the app experiences today. Wiring it into `CreateStudioScreen` and
`WriterOnboarding` is the remaining work, and it is small: the transport, the
event protocol and the error handling are done. Nobody should read the previous
entry as "the app is fast now".

### What 5.6 seconds and 49 seconds mean

The 49 seconds never changed. It is how long the model takes to write a
1,800-word chapter, and no amount of engineering makes a model write faster.

What changed is **when the first word appears**. Before, the reader watched a
loader for 49 seconds and the whole chapter arrived at once. Now the first
sentence appears at 5.6 seconds and the rest arrives as it is written, at
roughly reading speed.

The reason this matters is not that 5.6 is a smaller number than 49. It is that
**the reader is no longer idle.** A person reads at about 250 words a minute, so
1,800 words is around seven minutes of reading. The chapter finishes generating
about 45 seconds in, long before they reach the end of what is already on screen.
The remaining 43 seconds of generation happen *underneath* the reading and are
never experienced as waiting at all.

That is the whole mechanism, and it is worth stating in the negative too: this is
not a speed optimisation. Total work went slightly **up**, because the streamed
path makes a second call for metadata. We traded a small amount of total cost for
the removal of nearly all of the perceived cost.

### Why 49 seconds of nothing is worse than it sounds

Waiting is not linear. A blank screen gives a person no evidence that anything is
happening, so they supply their own explanation, and after about ten seconds the
explanation is usually "this is broken". The three things they do next are refresh,
press the button again, or leave. Two of those cost a credit.

A streaming screen answers the question continuously. The user is not being asked
to trust that work is happening, they are watching it happen. This is also why
the loader's progress stages are now driven by real pipeline transitions rather
than a timer: a bar that moves on a timer is making a claim it cannot support,
and a user who catches it doing that stops believing the rest of the screen.

### What this technique does and does not transfer to

**It transfers directly to `continue-story` and `edit-story`.** Both are the same
shape as `generate-story` was: one model call, one long wait, one response.
Neither streams today. `continue-story` is the bigger win of the two, because a
reader deep in a series triggers it repeatedly and is even less patient than a
first-time creator. The work is largely reuse: `_shared/story-stream.ts` already
carries the SSE parser, the one-way fallback and the two-clock timeout, and the
client already has the transport. `edit-story` is smaller but nearly free once
the first is done, and the paragraph editor is a place where waiting is
especially visible because the user is looking directly at the text being changed.

**It does not transfer to images or audio.** Nothing is produced incrementally
there. An image provider returns a finished file; there is no first-token
equivalent and no partial image worth showing. The corresponding technique is
different and is already partly in place: media is generated on a background task
after the response, `stories.cover_status` tracks it, and the concept card is a
legitimate final look while it runs. What is missing is the delivery half. The
client learns the cover is ready by asking again, and `send-push` exists but is
wired to nothing, so a user who leaves the screen is never told. That is the real
media latency work, and it is a notification and subscription problem rather than
a streaming one.

Audio sits between the two. Narration is generated as a whole file today, but TTS
can be produced and played in chunks, so a chapter could begin playing seconds
after the request instead of after the whole file renders. That is a genuine
streaming opportunity and a larger piece of work than the text paths, because it
needs the player to consume a stream rather than a URL.

### The engineering summary, for the record

Three things were done, and only the first is a latency change:

1. **The transport changed from request/response to Server-Sent Events**, so
   tokens reach the client as the model produces them rather than after it
   finishes.
2. **The generation was split in two** because a strict JSON schema cannot be
   streamed usefully. Prose streams as text; the structured fields are recovered
   by a second call afterwards.
3. **The failure model was rewritten around a commit boundary.** Once prose has
   reached the reader, the system can no longer retry, swap providers, or discard
   the output, so every failure path had to be re-decided for a world where the
   user has already seen part of the answer.

---

## 2026-09-05 UTC — Streaming, the shape-story deadline, and a backend security pass

**Session:** The writer-flow tree committed and deployed, `shape-story` diagnosed and fixed, streamed generation built end to end, and a full audit of the 35 migrations and 18 edge functions actioned. Five commits on `codex/create-flow-rebuild`.

### `shape-story` was never a deploy problem

The handoff recorded `{"shape": null}` in production as an undeployed function. It reproduces on freshly deployed code, so that diagnosis was wrong, and the real cause is worth writing down because it is invisible from the response body: **the call site took the library's 8-second default deadline, and the call takes longer than that.**

The budget is split before it is spent. `FAST_OPENROUTER_SHARE` gives OpenRouter 60%, and that window is divided again across the two models in `OPENROUTER_MODELS`, so the leader got roughly 2.4 seconds. Measured against the live model the same day:

| variant | observed |
|---|---|
| onboarding (n=4) | 8.2s, 9.2s, 11.4s, 33.6s |
| create studio (n=4) | 5.7s, 5.8s, 6.3s, 7.5s |

Every provider aborted mid-flight, the chain exhausted, and the handler's own catch answered `null` — which is also what it answers when the user is rate-limited and when the model genuinely fails. Three different conditions, one response. That is why this took a day to find, and it is the observability lesson worth carrying: `shape: null` should not be the answer to "you are rate-limited", "the provider failed" and "you have no profile row".

Onboarding now gets 45s because it is prefetched and warms behind the details, email and code screens; the Create studio gets 30s because the writer is watching it. Verified end to end after deploy: real title, three beats, a cast.

**Fingerprints** (`error_event_summary`, per the observability gate): `5e60930b2675d2d6d146c232c7c22648` (`llm.provider` / `story_shape_failed`, 4 occurrences, first seen 08:09 UTC) is the deadline exhaustion. It predates this session's testing, which is what confirms the failure was live in production rather than an artefact of the smoke runs. `ba02a878d8d5170b715ac51addcc235a` (`generation.story` / `story_shape_unhandled`, 3 occurrences) is the missing-`profiles`-row foreign-key violation described below.

A second, quieter bug surfaced on the way: an authenticated user with no `profiles` row cannot shape at all. `claim_story_shape_request` inserts into a table whose `user_id` references `profiles`, `handle_new_user` was dropped in `00013`, and the resulting foreign-key violation is swallowed into the same `{"shape": null}`. In practice the client always calls `bootstrap-user` first, so it is latent rather than live. It is recorded here rather than fixed, because the fix is the observability change above, not a patch to the RPC.

### Streaming

The headline. Generation was request/response end to end, so the reader watched a loader for the whole completion. Measured against production: **first prose at 5.6s against a 49.1s total, an 8.8x improvement in the only latency a reader experiences.** Same model, same prompt, same story.

New `_shared/story-stream.ts` and `generate-story-stream/`. `generate-story` is untouched and stays the path for retries, replays and clients that cannot stream. Three design decisions carry the reasoning, and all three are commented in the code:

**The call is split.** `chapter_body` lives inside a strict JSON schema, so streaming it means recovering a string that is still being escaped, in an order the schema does not guarantee. Prose streams as plain text; a second structured call turns the finished prose into title, themes, hook and `series_state`. It runs after the reader is already reading, so it costs perceived latency nothing, and it keeps the field a series cannot be continued without behind a strict schema rather than a partial-JSON parser. The metadata schema is *derived* from `STORY_OUTPUT_JSON_SCHEMA` rather than restated, so the two cannot drift.

**Fallback becomes one-way.** Before the first token a provider is swapped silently. After it, it cannot be, because restarting rewrites text under the reader's eyes. `StreamCommittedError` is that boundary; the credit refunds either way and the prose already shown stays on screen.

**Two clocks, not one.** A stream fails by never starting and by stalling once started, and a single total-response timeout cannot tell those apart: 70s kills nothing, 20s kills every chapter. Time-to-first-token and time-between-chunks are separate.

**The word band could not be enforced by `max_tokens`, and this was tried before it was rejected.** `max_tokens` caps reasoning and content together, so headroom for one is headroom for the other — a 2,000-token reasoning allowance produced a 2,331-word chapter against a 1,200-1,600 band and never hit the cap, because the headroom *was* the overrun. Tightening it produced a 2,114-word chapter that simply stops. A chapter that runs long is flawed; a chapter with no ending is broken. So the cap is now a runaway guard only, the band is stated twice in the prompt, and `chapterLengthVerdict` reports the miss.

**Open item, and it is a real one:** this model wrote 2,056, 2,114 and 2,331 words across three runs against a 1,200-1,600 band, with the band stated in two separate prompt sections. The streamed path cannot retry what has already been read. Either the bands move or the model does, and `CREDITS_AND_PRICING.md` moves with whichever, because narration is priced per word. This also implies the *non-streamed* path may be rejecting these same generations through `requireUsableChapterLength` and refunding — worth measuring before the next change to either.

On the client, neither obvious transport works: `supabase.functions.invoke()` buffers the whole body, and React Native's `fetch` returns a null `response.body`, so streaming code written against the web platform compiles, runs, and silently never streams. Expo SDK 54's `expo/fetch` exposes a real `ReadableStream`, which is why this needed no new dependency. It cannot be loaded under jest-expo, so it is mapped to a stub in `jest.config.js`.

### The audit

A full read of every migration and edge function. Real findings, actioned in one commit:

- **`audio-status` path injection.** `job_id` was interpolated into the RunPod URL with only a truthiness check while its two sibling parameters went through `parseUuid`. The URL parser normalizes dot-segments, so a crafted id reached a different RunPod endpoint carrying our account's API key. Verified blocked in production after deploy.
- **`generate-audio`** bypassed the 128KB body bound by using `req.json()`, and stringified `voice_id` instead of allowlisting it.
- **`profiles` had `USING` with no `WITH CHECK`** plus a table-wide UPDATE grant, so a user could rewrite their own row's `id` to another user's and could write the anti-fraud columns. Verified in production: legitimate updates still succeed, id and `referred_by` writes now 403.
- **`claim_story_shape_request` incremented the global anonymous counter before a check that could still reject**, and `return false` in plpgsql does not roll back. One guest at 30 requests a minute burned 24 of the project's 500 daily slots to serve 6.
- **Six ledger reads still tie-broke on `id desc`** — a random UUID — when `00026` added `ledger_sequence` for exactly that purpose. `refresh_subscription_grant` writes two rows in one transaction with identical `created_at`, so the balance shown after a renewal was a coin flip. A test now scans every function in `public` and fails on any ledger read using a different tie-breaker.
- Plus: no index on `characters.story_id`, a `feed` query that could pull ~75,000 rows into an isolate at a deep page, a lost-update race in `edit-story` across its model call, and an IPv6 grant scope that mis-derived the /64 for compressed addresses.

`00016_error_events.sql` was deleted. It was never applied and creates the same objects as `00018`, which shipped and which `00019`-`00025` then evolved; replaying it risked re-adding what those deliberately changed.

### The three Postgres questions that prompted this session

**Object storage: already correct.** No `bytea`, no blobs, no large objects anywhere. All media is in Supabase Storage buckets and Postgres holds only text URLs. One correction to the premise: RunPod is the TTS *generator*, not the store — `audio-status` copies the result into the `audio` bucket. The durable store for audio and images is the same thing.

**Unlogged tables: considered and skipped.** The five rate-limit tables qualify, but it is one tiny row-write per request, so the WAL saving is noise at current volume, and unlogged tables restore *empty* from Supabase's physical backups. Not worth the caveat for a gain nobody would feel.

**On the "1,000-1,200 rps" figure:** Postgres will not be the wall. `anonymous_story_shape_global_limits` and `anonymous_bootstrap_global_limits` are one row per calendar day behind an advisory lock, so every anonymous request in a day serializes through a single row — a hard limit in the low hundreds. Sharding the counter is the fix when it is needed. It is not needed yet.

### Gates

`tsc --noEmit` clean, `eslint` 0 errors (17 pre-existing warnings), **209 Jest tests / 16 suites**, **Deno suite green**. Migrations `00038`-`00041` applied to `iafeuxgoiknncgyjmugd`; `shape-story`, `generate-story-stream`, `audio-status`, `generate-audio`, `edit-story`, `feed`, `bootstrap-user`, `register-push-token` and `send-push` deployed.

---

## 2026-09-05 UTC — Muse Spark as the default generation model, and the reasoning-token trap it brought

**Session:** `meta/muse-spark-1.3-contributor` wired as the configured default across every generation path, the provider chain reordered so OpenRouter leads, phase shares re-balanced, and the cost basis recomputed from measured spend. No deploy, no commit.

### The ordering decision

OpenRouter now leads in code rather than by configuration. The alternative was `LLM_DISABLED_PROVIDERS=gemini`, and it was rejected: disabling Gemini does not demote it, it deletes it, and the requirement was that the fallback chain still exist and still work. Leading in code also means the default takes effect on deploy with no secret to remember, which is the point — walking through onboarding has to produce a real story.

Order is now OpenRouter (`meta/muse-spark-1.3-contributor`, then `meta/muse-spark-1.3`) -> Gemini 3.1 Pro Preview -> OpenAI (three models) -> free tier.

`PHASE_END_SHARE` was re-balanced with the reorder, from `gemini 0.35 / openrouter 0.5 / openai 0.9 / free 1.0` to `openrouter 0.5 / gemini 0.65 / openai 0.93 / free 1.0`. These are cumulative, so moving a phase and leaving its share behind hands the new leader the old leader's 15% slice and starves whoever now runs last. The leader takes half because two models share it. Gemini keeps 15%: it has hard-failed with `429` since 2026-08-31 and a quota-blocked provider needs enough time to say so and no more.

`generateFastStructuredText` was the path that would have been missed by assuming one constant covered everything. It is what `shape-story` calls, which is what onboarding calls, and it did not use the chain at all — it went straight to the first non-reasoning OpenAI model with **no fallback**. It now leads with `OPENROUTER_MODEL` and keeps the OpenAI model behind it, with the 8s deadline split 60/40 so a stalled leader cannot abort the fallback before `fetch` is called.

### Two facts from live testing that inverted the brief

**The contributor tier cannot serve a request on this account.** A real call returns `404`: `"Paid model training violation (account settings): 1 endpoint excluded"`. The tier is cheap because it trains on prompts and completions, and the account's OpenRouter privacy setting blocks exactly that. It is wired as the default anyway — the day the setting changes at https://openrouter.ai/settings/privacy the cheaper tier starts winning with no deploy, the same way Luna's entitlement went live. `meta/muse-spark-1.3` sits immediately behind it, so the `404` costs one round trip.

**Both Muse Sparks are reasoning models, and reasoning tokens are counted inside `max_tokens`.** Measured the same day: `max_tokens: 1200` with no reasoning control returned HTTP `200`, `finish_reason: "length"`, 1,197 reasoning tokens and an **empty content string**. That is a success status carrying nothing. `openAICompatibleContent` already rejected it — both on `finish_reason: "length"` and on empty content — so it falls through rather than persisting a blank chapter, which was verified rather than assumed. But a position that always fails is not a position, so `openRouterRequestShape` now sends an explicit `reasoning: { effort: "low" }` and floors the budget at 8,000 tokens on top of a 2x multiplier. The floor is the part that matters: the multiplier alone leaves the paragraph editor at 4,000 and the onboarding shaping call at 1,800, and 1,800 is the failing row.

`OPENROUTER_TIMEOUT_MS` went 30s -> 70s. 30s was set when this position was a fallback running a fast non-reasoning model. As the primary serving a 16,000-token visible budget it is not defensible; at 70s the phase share (60s of the 120s deadline) is the binding constraint, which is where the budget decision belongs.

### Cost basis, recomputed from a measurement rather than a rate card

A live shaping call billed **$0.006099** for ~154 prompt tokens and 1,408 completion tokens, **957 of them reasoning**. Two-thirds of the completion bill was thought. Every earlier text figure in this repo was a naive prompt-plus-visible-output calculation and understated cost by several multiples.

Per ~1k-word chapter: **$0.0160** on `meta/muse-spark-1.3`, **$0.0009** on the contributor tier. The live figure is $0.0160, which is **4x more expensive than the $0.004 it replaces**, not cheaper — the saving is entirely on the tier that is currently blocked. Blended creation cost moves from $0.0092-$0.0274 to **$0.0198-$0.0326** per credit. §4's margins are computed against $0.0423 and are therefore still conservative, but the cushion narrowed from 4.6x to 1.3x; that was checked rather than assumed and is written into `CREDITS_AND_PRICING.md` §2.

### Verification

- `deno check supabase/functions/_shared/llm.ts`: clean. Also clean for `generate-story`, `continue-story`, `edit-story`, `shape-story`.
- `deno test --allow-env --allow-net supabase/functions/_shared`: **241 passed**, of which `llm.test.ts` is 41 (6 new). New coverage: the default model id and its fallback, phase shares cumulative/ordered/summing to 1 with the leader largest, the budget floor against every caller's `maxTokens`, an end-to-end `404`-by-data-policy fallthrough that asserts the standard tier serves the story, an end-to-end empty-content `200` on the edit path, and `shape-story` leading with the default model.
- `deno fmt --check` clean on both changed files.
- No production-level test was run, so no `error_events` entry was required.

---

## 2026-09-03 UTC — Story creation flow to production: deployed, measured, made faster

**Session:** Credentials consolidated, the media/latency/security work built and deployed, migrations 00027-00031 applied to the live project, and the flow verified end to end against production. Builds on #46's contract rather than duplicating it.

### A migration-numbering collision, and how it was resolved

This work started from a branch that predated #45/#46 and independently took migration numbers 00027-00030, **and applied them to the production database.** Main's `00027_story_flow_contracts` and `00028_validate_story_flow_contracts` had never been applied, so those version numbers were already marked done remotely and main's contract migrations would have been silently skipped forever — the widened `generation_operations.kind`, the `(story_id, chapter_number, kind)` reservation index and `planned_chapter_count` would never have existed in the database while every file said they did.

Resolved by taking main's contract as the base, renumbering this work to 00029-00031, repairing the remote history (`migration repair --status reverted 00027 00028 00029 00030`) and re-pushing, which applied all five in order. Migration 00029 carries a guarded cleanup for the duplicate `characters.image_url` the earlier numbering created — it raises rather than dropping if the column holds data — and 00030 explicitly drops the twelve-argument `begin_story_generation` overload, because `create or replace` does not replace a function whose argument types changed; it creates a second one beside it, and a caller with the old shape would still resolve to a definition that writes none of the brief.

**The lesson for `AGENTS.md`'s numbering rule:** reading remote state with `supabase migration list` is not sufficient. A number can be taken by a file already merged to main and not yet applied. Check both.

### Credentials

`backend/.env` is the single local source of truth for backend secrets, mode 600, with a committed `backend/.env.example` documenting the shape. `expo/.env` carries only public `EXPO_PUBLIC_*` values — the Supabase URL, the anon key, and the app environment. Both gitignored; history scanned — no `.env` has ever been committed and no key material appears in any tracked file. Removed two dead duplicates: `app.json`'s `expo.extra.supabaseUrl`/`supabaseAnonKey` (nothing reads them; `src/lib/supabase.ts` reads `process.env`), and the Adapty key in `expo/.env.example`, left from the RevenueCat migration.

### What live testing found that unit tests could not

**The OpenRouter free tier does not work.** `OPENROUTER_FREE_MODELS` was chosen by filtering the catalogue on `supported_parameters` containing `structured_outputs`. Run against the real schema with `strict: true`, that metadata proved aspirational: two models returned `finish_reason: length` after 108-119s emitting reasoning into `content`, two ignored the schema outright, three returned 429, one 403, and `openrouter/free` routed a **code** model to write prose. Only `nvidia/nemotron-3-ultra-550b-a55b:free` ever produced valid output, and it errored on the second attempt. The list is now that model plus the blind router, with the full table in the source so nobody re-adds a model from metadata again.

The recharge's real value is position 2: **`google/gemini-2.5-flash` answered in 10.6s with a schema-valid 520-word chapter**, having returned 402 before. It is the model serving production.

**The OpenRouter image path works, and returns JPEG.** `choices[0].message.images[0].image_url.url` as a data URL was correct, and the cover produced was a clean 2:3 noir portrait with no text. But `gemini-3.1-flash-lite-image` returns **JPEG** where the other two return PNG, and `uploadToStorage` hardcoded `image/png` — it would have stored a file whose declared type was a lie. Now sniffed from magic bytes, with the extension and public URL following the actual format.

**The image chain skipped its own fallbacks.** `safetyLevel` was carried across providers so a rejected prompt would not be re-sent — but uncapped, three rejections from OpenAI pushed it to the maximum and the loop guard then skipped both OpenRouter models *without sending a request*. The whole reason to try a second provider is that its filter is a different filter.

**The replay path returned 500.** `pg_catalog.coalesce(...)` — `coalesce` is a SQL construct, not a function in `pg_catalog`, so it raised `42883`, but only on the branch a first generation never touches. A retry with the same `request_id` failed instead of replaying the chapter it had already paid for.

### Latency: measured, then cut

`generate-story` now returns stage timings, because latency here is not guessable — the isolate runs in-region with the database, so the instinct to optimise DB calls is usually wrong.

| | before | after |
|---|---|---|
| Pre-LLM (ours) | 1,419-2,184 ms | **651-944 ms** |
| Provider chain | 10.7-24.1 s | unchanged |
| Post-LLM (ours) | 223-537 ms | 228-764 ms |

`begin_story_generation` (00030) collapses three sequential round trips — idempotency select, story insert, credit reservation — into one, and is also the correctness fix: the insert and the deduction share a transaction, so an insufficient-credit request leaves no orphaned `generating` story for a best-effort delete that could itself fail. The character insert now runs concurrently with the LLM request, and `media.ts` is dynamically imported after persistence so a cold isolate does not parse the image stack to serve text.

**The model is ~95% of the wall clock**, roughly proportional to output length at 12-15 ms per word: 780 words takes 13s, 1,968 words takes 25s. Server overhead is now under a second. Cutting the rest is a product decision — `202` plus polling, or an output contract that can stream — not an optimisation. Schema-constrained JSON cannot stream a readable chapter.

**Feed N+1 removed.** `continueReading` issued a chapter count and a read count *per story*, sequentially — up to twenty round trips to choose three cards. Now two batched queries and an in-memory tally. Migration 00031 adds the three indexes matching the feed's actual `ORDER BY` clauses, built `CONCURRENTLY`.

### Correctness and security closed

- **Custom paragraph edits were broken in production.** The client sent `custom_notes`; the function has always read `custom_note`. Every custom edit returned 400 with the user's note sitting unread in the body. Client corrected; server accepts both, because older builds are already on devices.
- **Prompt injection.** Every user-authored value is wrapped in `<katha:...>` fences, with the delimiter stripped from the value so a user cannot close their own span, and one rule in the system prompt saying what the fence means.
- **Cover generation had no caller.** `generateCoverImage` was dead code; `cover_image_url` was never written by anything. Chapter 1's art and the cast's portraits now generate on a background task after the response is flushed, with `cover_status`/`cover_started_at` (00029) so the client can tell "not tried" from "in flight" from "failed" — a distinction a null URL cannot make.
- **Kids-mode genre blocking** widened from `darkRomance` alone to all four genres section 3 removes from the interface.
- **Request bodies were parsed before any size check.** Now refused on `Content-Length` before reading and on length before `JSON.parse`; `publish-story`'s per-chapter cap drops from 200,000 characters to 60,000.
- **Publishing discarded every hand edit.** The editor writes to React state and `publishStory` sent only a story id, so the server published the model's original text at the moment the user committed. Publish now carries title and chapter content, persists them before flipping visibility, refuses a chapter id that matches no row, and blocks on an emptied chapter rather than silently publishing stale text.
- **Gemini can be removed from the chain by configuration** (`LLM_DISABLED_PROVIDERS`). Config rather than a circuit breaker: isolates share no memory, and a table-backed breaker would put a round trip on the hot path to save latency.

### Verified in production

`scripts/smoke-generation-matrix.py` — **55 checks, 0 failures**, against the deployed functions: covers ready, portraits 2/2, kids-mode refusals, chapter lengths stored verbatim, series continuation carrying the world layer, idempotent replay, `google/gemini-2.5-flash` answering. 178 backend and 49 Expo unit tests green. `error_event_summary` shows no new failures from the run.

### CodeRabbit review

Twenty-four findings, all addressed. The ones that were real defects rather than polish:

- **The fence was only half a fence.** The idea and the setting went through `userField`, which delimits; character name, description, background, appearance and each moment went through `fenceUserText` alone, which strips the delimiter and then interpolates the value as bare prompt prose. A background reading `SYSTEM: ignore the output schema` arrived in the same position as the instructions with nothing marking it as data — the exact failure the fence exists to prevent, on the longest free-text fields in the request. The test passed anyway, because it only asserted the delimiter could not be duplicated.
- **The dynamic import could fail a paid request after the text existed.** `await import("../_shared/media.ts")` sat inside the outer `try`, and it rejects when module resolution or a remote dependency fetch fails on a cold isolate. The comment above it claimed nothing below could fail the request; that was true of `media.ts` internals and false of the import itself.
- **`NOT VALID` plus `VALIDATE` in one file buys nothing.** `supabase db push` runs each migration inside one transaction, so `ADD CONSTRAINT ... NOT VALID` holds its `ACCESS EXCLUSIVE` lock to commit and the validation runs under it. Split into 00032.
- **A failed publish still reported success.** The `catch` discarded every failure and execution continued to `onPublished` with `isPublished: true`. Carrying the hand edits made it worse: a swallowed failure now silently discarded the edits the change existed to preserve.
- **The first character row became unremovable.** The remove button was gated on `index > 0`, correct while `INITIAL_DRAFT` seeded row 0. With an empty cast, row 0 is one the user added — and a blank name is rejected server-side, so a user who added a character and changed their mind could not generate at all. A fix for one 400 introduced another.
- **`Sparse` was unreachable.** The meter counted genre, which always has a value, so any brief with an idea scored at least Good. A slot that is always full cannot discriminate, which is the meter's whole job.
- **Partial edits then a conflict.** `publish-story` validated each chapter id inside the write loop, so a bad id at position three returned 409 after positions one and two were persisted. Now the whole set is checked before any of it is written.
- **`raw.length` counts UTF-16 code units, not bytes**, so a body of multi-byte characters could be several times the limit and pass. Story ideas are routinely non-Latin, which makes that the normal case rather than an adversarial one.
- **The portrait ladder discarded the only field it had.** A character with an appearance and no description simplified straight to "a person".
- **`"returned no image"` also matched OpenAI's own error**, which is a malformed response rather than a refusal — it would have simplified a prompt nothing had rejected. Scoped to the OpenRouter message.
- **The WebP sniff checked only the tail** of the signature, not the `RIFF` container.
- **The telemetry section never asserted anything.** It printed, so the matrix could exit 0 while the view was unreadable or while the run itself had recorded failures — and the build log would then claim "no new failures" on the strength of a report nobody checked. Now two checks, scoped to the run's own start time.

**The image-provider guideline was changed deliberately, not worked around.** `AGENTS.md` and `backend/COVER_IMAGES.md` said "OpenAI API only. Never use other image providers", which was right while covers were unwired — there was nothing to keep running. Both now name the fallback chain, say why the rule changed, keep Higgsfield and unnamed providers banned, and record that providers disagree on output format.

### Still open

Async generation or streaming; `begin_continuation_generation` (continue-story still derives the next chapter number outside the reservation transaction, and `MAX_SERIES_CHAPTERS = 7` still contradicts the 3/7/15 contract); a stale-reservation sweeper; storage orphans on story deletion; edit allowances counted nowhere; feed and library at scale; and the client create flow, still one screen — the new backend fields have a wired contract and no UI producing them.


---

## 2026-09-02 UTC — Schema and contracts for the story-creation flow (B1)

**Session:** Migrations 00027/00028 and the request contract they support. Every new column is nullable or defaults to today's behaviour, so no existing **read or write path** changes. That is not the same as the migration being unconditionally safe to apply: `stories_planned_chapter_count_check` is restrictive, so 00028 can fail on pre-existing data and requires the check below first.

The two constraints are **not** alike, and the summary previously blurred them:

| Constraint | Direction | Can validation fail? |
| --- | --- | --- |
| `generation_operations_kind_check` | **Widening** — adds `cover`, `chapter_art`, `characters` | No. Every existing row satisfies the old, narrower check, so it satisfies the new one. |
| `stories_planned_chapter_count_check` | **Restricting** — a previously free integer is now `NULL, 3, 7 or 15` | **Yes.** Any existing row holding a non-null value outside that set fails 00028. |

`planned_chapter_count` was added in migration 00003 and is written by no code path in this repository, so every row is expected to hold NULL. **That expectation is unverified** — no Supabase credentials were available here — and it is a precondition of 00028, not a consequence of it. Confirm before applying:

```sql
select count(*) from public.stories
where planned_chapter_count is not null
  and planned_chapter_count not in (3, 7, 15);
```

A non-zero result must be reconciled before 00028 runs.

### Every paid image can now reserve an operation

`generation_operations.kind` was constrained to `('story', 'continuation')`, so a cover, a chapter illustration or a cast had nowhere to record itself and would have been charged outside the idempotency and auto-refund path that makes text generation safe. The constraint now admits `cover`, `chapter_art` and `characters`, and `reserve_generation_operation` accepts them.

The active-reservation index needed widening too. It was `unique(story_id, chapter_number) where status = 'reserved'`, which encodes "one paid action per chapter" — no longer true once a chapter has both text and art. A chapter's text and its own illustration could never be reserved at the same time; the second insert raised `KTH01`. The sequential flow does not hit that today, but the constraint was wrong rather than merely conservative, so it is now `(story_id, chapter_number, kind)`.

### Columns

`chapters.image_url` / `image_prompt`; `characters.portrait_url`; and on `stories`: `where_and_when`, `moments`, `story_values`, `writing_style`, `avoid`, `chapter_length`, `illustrate_chapters`. `planned_chapter_count` already existed from migration 00003, unused, and becomes the planned length — now constrained to 3, 7 or 15.

`story_values` rather than `values` because `values` is reserved in SQL.

### The 40-character seed gate is gone

`validation.ts` rejected any idea under 40 characters. It taught padding rather than structure, and the flow document replaces it with the slot-based brief-strength meter in which a one-line idea is a legitimate choice. One non-whitespace character is the floor; the 1000-character ceiling is unchanged. Removing it from the UI alone would have produced a 400 from the server, so it had to move here first.

### The cast cap was three different numbers

The client allowed 5 (`CreateStudioScreen.tsx`), the server allowed 10 (`validation.ts`), and the spec said 3 — so a user could assemble a cast the server would reject. All three are now 3, from `MAX_CAST_SIZE` in `_shared/types.ts`.

### Writing style is sanitised, not just bounded

The new free-text style field is a direct route to "write exactly like <living author>", which `source-of-truth/STORY_PROMPT_SYSTEM.md` forbids at runtime. Imitation phrasing and the name after it are stripped and the rest of the direction is kept, so "hardboiled, like Raymond Chandler" reaches the prompt as "hardboiled". A regression test covers bare initials — an earlier pattern stopped at "Ursula" and leaked "K Le Guin". The known over-match (a capitalised phrase that is not a person, such as "in the style of Gothic Horror") is documented at the function and accepted: a regex cannot tell the two apart, and losing a little craft direction is the cheaper error. This is defence in depth; the prompt layer states the rule as well.

### Also corrected

`expo/App.tsx`'s credits explainer still described the retired bundle ("one credit each for the text, its cover and its characters"). It now states the story-start price and the per-chapter price.

### CodeRabbit review, addressed

- **The seed gate was only half removed.** `validation.ts` accepted one character but `CreateStudioScreen.tsx` still required 40, so Create stayed disabled for a valid short idea. The client condition and `getSeedHint()` now match the server; the hint encourages rather than counts toward a threshold.
- **The author-name sanitiser was ASCII-only.** `[A-Z]` and `\w` stop at the first accented character, so "Gabriel García Márquez" leaked most of the name. It now uses `\p{Lu}`/`\p{L}` with the `u` flag, with regression cases for accented and non-Latin names.
- **Both new constraints are added `NOT VALID` and validated in 00028.** A plain `ADD CONSTRAINT` holds ACCESS EXCLUSIVE for the whole table scan, whether or not that scan can fail. `NOT VALID` skips the scan and holds ACCESS EXCLUSIVE only briefly — it is still an exclusive lock, just not one held for a scan — and 00028's `VALIDATE CONSTRAINT` then does the scan under SHARE UPDATE EXCLUSIVE, which does not block reads or writes. `generation_operations` is on the hot path of every generation, so the difference matters.
- **The index rebuild cannot use `CONCURRENTLY`** — `supabase db push` wraps each migration in a transaction and concurrent index builds cannot run in one. The brief lock is documented at the statement, with the conditions under which it would need to become an out-of-band rebuild.
- **Client credit amounts moved out of copy** into `expo/src/lib/pricing.ts`, the single client-side mirror of the per-action costs. It holds no plan prices, grants or SKUs.

### Second review round

- **The credits screen advertised a price the code does not charge.** The canonical document prices a story start at 3 credits — cast, chapter 1's words, chapter 1's art — but `generate-story` makes exactly one reservation, because neither the cast nor chapter art is built yet. `pricing.ts` now separates **charged today** from **contracted**, the contracted values are marked not-yet-charged, and user-facing copy reads only the charged ones.
- **The sanitiser's `i` flag applied to `\p{Lu}` as well as the trigger**, so an uppercase-letter class matched lowercase and any prose after a trigger word was read as a name: `"like the sea at dusk"` was destroyed. Trigger and name are now two regexes — the trigger case-insensitive, the name not — and three prose-preservation cases are pinned.
- **The particle list stopped mid-name.** `"Ngũgĩ wa Thiong'o"` left `"wa Thiong'o"` behind because `wa` was not listed. The set now covers the common Romance, Germanic, Arabic, Celtic and Bantu connectives.
- The style test asserted only that no author name survived, which would have passed on gutted text. It now asserts exact output for every case.

### Third review round

- **Uncased scripts bypassed the filter entirely.** Han, Kana, Arabic, Hebrew and Devanagari letters have no uppercase, so a `\p{Lu}`-anchored pattern could never match them and "in the style of 村上春樹" passed through untouched. The name token now also accepts a run of `\p{Lo}` ("Letter, other"), which is deliberately narrow: Latin lowercase is `\p{Ll}`, so admitting uncased scripts cannot resurrect the prose bug fixed in the round before.
- Removing a name from the middle of a list left its separators behind — "dreamlike, like 村上春樹, in short scenes" became "dreamlike, , in short scenes". Runs of separators now collapse to the first.

### Fourth review round

- **The cast cap did not survive a double tap.** `addCharacter` checked `draft.characters.length` from its closure rather than `prev.characters.length` inside the updater, so two taps batched in one frame both read the stale length, both appended, and the cast came out one over the cap — which `validation.ts` then rejects. The check moved inside the updater, and three tests pin it, including one that reproduces the stale-closure behaviour so the regression is described rather than merely prevented.
- `MAX_CAST_SIZE` now lives in `expo/src/lib/pricing-limits.ts` and both the screen and the tests read it, rather than the number being restated in a comment.
- **00028 guards its own precondition** instead of only documenting it. A `DO` block counts offending rows first and raises a message naming the column and the count, rather than letting `VALIDATE CONSTRAINT` abort with something generic.
- The compatibility statement now says no existing **read or write path** changes, which is what is true — it is not a claim that the migration is unconditionally safe to apply.

### Fifth review round

- **`loadDraft()` could disable auto-save for a whole mount.** The persisted draft is typed by assertion only, so nothing guarantees `characters` is an array. Reading `.length` off a missing value rejected the promise *before* `draftRestoredRef` was set, which left auto-save off and silently discarded everything the user typed afterwards. `characters` is now normalised, and the ref is set in a `finally` so a single unreadable payload cannot disable saving.
- **`generation_operations.chapter_number` is `NOT NULL` and must be positive**, but the migration never said what a story-level operation should use. The convention is now documented at the function: `story`, `continuation`, `cover` and `chapter_art` carry the chapter they belong to; `characters` carries 1, the chapter it is generated before. The `(story_id, chapter_number, kind)` index keeps all three chapter-1 reservations distinct.
- The sanitiser's two regexes are built once at module scope rather than per request. `matchAll` copies the regex internally, so sharing one instance does not mutate `lastIndex` across calls.
- The 300-character brief-field test only checked that 301 is rejected. Flipping `>` to `>=` would have passed it, so the accept side is now pinned too.
- The `NOT VALID` lock description was imprecise: `NOT VALID` still takes ACCESS EXCLUSIVE, just briefly and without a scan. Corrected.

### Validation

- 145 Deno tests pass with main merged in (9 new here, 5 from #43), `deno check` clean on every edge function, `deno fmt --check` clean.
- Expo typecheck clean, 0 lint errors, 41 Jest tests pass.
- **Migrations were not applied.** No Supabase credentials were available in this environment, so 00027/00028 are unreviewed against a live database and no production smoke test was run.

---

## 2026-09-02 UTC — The prompt reads the word band instead of restating it

**Session:** CodeRabbit review follow-up on the word-band work below. `wordBandFor()` was described as the single source of truth, but `story-prompts.ts` still carried four independent copies of the numbers, so the prompt and the validator could drift apart in exactly the way the helper was introduced to prevent.

### What changed

Every length instruction the model reads is now rendered from `wordBandFor()`:

| Site | Was | Now |
| --- | --- | --- |
| `buildBaseRules()` | `500-1500 words` | `${band.min}-${band.max} words` |
| `buildAudienceModeRules()` (Kids) | `600-900` / `500-1200` | the band for that mode |
| Continuation rules | `600-900 words` | the series band |
| `buildUserPrompt()` | three literal ranges | the band for that mode |

`buildStoryPromptBody()` resolves the band once and passes it down, so a single call decides what the whole prompt says. This also removes a live bug: a kids **standalone** prompt previously stated `500-1500` in its Hard Rules and `500-1200` in its Kids Mode block, giving the model two different ceilings in one prompt.

### Why it matters beyond the review

Chapter length becomes a user-facing control (Short / Standard / Long) in the create-flow rebuild. With the numbers centralised, that is a change to one function; with four string literals it would have been four chances to ship a prompt that contradicts the validator.

### Two inline findings, both real

**The Kids Mode length rule fought its own minimum.** It read `500-1200 words maximum. Shorter is better.` — an instruction to undershoot, sitting next to a floor of 500. A generation below 0.75x that floor is rejected by `requireUsableStoryOutput()` and burns a provider fallback, so the sentence was buying failed generations. It now reads `500-1200 words. Aim for the lower half of that range, but never go under 500.`, which keeps the brevity Kids Mode wants and the floor the validator enforces.

An existing test pinned the old sentence verbatim. It now asserts the band rather than the wording around it, which is what its name always claimed.

**`AGENTS.md` and `BUILD_LOG.md` both said covers use DALL·E 3.** `_shared/image.ts` requests `gpt-image-1`. Corrected in both.

### Validation

- 136 Deno tests pass on this branch merged with main, including five new ones: four assert the prompt quotes `wordBandFor()` for every mode combination and that a kids prompt never leaks the adult ceiling, and one pins the Kids Mode floor against the instruction that used to contradict it.
- `deno check` clean across every edge function; `deno fmt --check` clean on the CI file list.

---

## 2026-09-02 UTC — A source-of-truth folder, a corrected cost basis, and every story-flow open item closed

**Session:** Documentation only. No code, no schema, no deploy. Bucket B0 of the story-creation rebuild, and the gate for the buckets after it, because everything in the create flow that displays or charges a price reads from these files.

### `source-of-truth/`

Four documents move into one folder with an explicit precedence order, stated in `source-of-truth/README.md`:

| File | Canonical for |
| --- | --- |
| `CREDITS_AND_PRICING.md` | money — prices, grants, SKUs, render tiers, unit costs |
| `STORY_GENERATION_FLOW.md` | the create flow |
| `STORY_PROMPT_SYSTEM.md` | prompt architecture *(was `backend/prompts/story-generator.md`)* |
| `ONBOARDING_FLOW.md` | everything before Home |

`STORY_GENERATION_FLOW.md` and `ONBOARDING_FLOW.md` were untracked working files and enter version control here for the first time. Every cross-reference in `AGENTS.md`, the roadmap, the build logs, `backend/references/` and the Expo docs was repointed, and all 31 relative markdown links in the repository resolve.

### The priced unit was wrong

The pricing file priced a *chapter* at 3 credits — text, cover, characters — written when a story was assumed to be roughly one chapter long. A story is 3, 7 or 15 chapters, so re-casting the characters and regenerating the cover on every chapter was not a price, it was a bug.

**Starting a story is now 3 credits** (cast + chapter 1's words + chapter 1's art, which is the cover). Each further chapter is 1, or 2 illustrated. A 3-chapter story is 5 credits; a 15-chapter story is 17. Charged per chapter as written, so an abandoned story costs what it wrote.

Decision 10, which had removed chapter illustrations as a priced action, is amended: chapter art is one feature with the cover — chapter 1's compulsory, chapters 2–N optional at 1 credit behind a toggle that is off by default.

### The cost basis was stale, and this is the larger finding

The `~$0.031` per-chapter text figure descended from the retired Anthropic rate card. The live chain serves `gpt-5.6-luna` at **~$0.004** per ~1k-word chapter, so text is an order of magnitude cheaper than any image and creation cost is now dominated by images.

Blended creation cost is **$0.0092–$0.0274 per credit** depending on story shape, not `$0.0423`.

**§4 of the pricing file is consequently understated** — its plan table, inversion check and Writer-yearly "constraint of record" all compute against `$0.0423`, some rows by 20 points or more. Conservative rather than wrong, since no margin is overstated, but it is now recorded as the largest known inaccuracy in that file (§12 item 10) rather than left implicit.

Three render tiers become constraints rather than defaults, to be pinned in code with tests: cover 1024×1536 medium, chapter art 1024×1024 medium, portraits 1024×1024 low.

### All seven story-flow open items closed

§14 previously listed seven unresolved items, two of them release-blocking. None is open.

- **The portrait "loss" never existed.** The −$0.18-per-cast figure priced portraits at the cover tier and tested a single action against a floor the pricing file defines on a blended basis. There is no loss at any cast size up to five. The cast cap is nonetheless 3 (was 4) — a product bound, not a margin one.
- **The chapter-art attach rate is not a launch dependency.** At the fixed tiers, 100% attach clears the floor at 3, 7 and 15 chapters.
- **The writing-mode toggle is removed.** One flow: read, optionally steer, Continue. *Write the rest* appears from chapter 3 with an itemised confirm, a Stop that keeps what it wrote, and resume after a kill. This removes the orchestration requirement entirely — one Continue is one existing `continue-story` call, one reservation, one credit.
- **Chapters are 3 · 7 · 15**, a planned length driving pacing and finale derivation, replacing `MAX_SERIES_CHAPTERS`.
- Inference re-runs only on a non-trivial diff and never overwrites a user-edited value; portraits surface in a cast strip on the title screen rather than inline; kids mode does not filter the feed at launch; `draft.seed` keeps its column name.

A new §15 records what the document no longer says, so a reader landing mid-file is not misled. Superseded reasoning is marked rather than deleted.

### Validation

- 125 Deno tests pass; `deno check` clean across every edge function.
- Expo typecheck, lint and Jest pass.
- All 31 relative markdown links in the repository resolve.
- **Not run:** the production smoke suites in `backend/scripts/`, which require `SUPABASE_SERVICE_ROLE_KEY`. No credentials were available in this environment, and no generation was exercised against production.

---

## 2026-09-01 UTC — Closed the two open risks from the provider migration

**Session:** Enforced the chapter word band server-side and split the story-generation credential from the cover credential. Both were carried as known risks out of the Luna work; both are now closed on the code side.

### The word band is enforced, not just requested

`wordBandFor()` in `_shared/types.ts` is the single source of truth — `600-900` for a series chapter whatever the audience, `500-1200` standalone kids, `500-1500` standalone adult. The prompt builder and `requireUsableStoryOutput()` both read it, so the instruction and the check can no longer drift apart.

- The count comes from `chapter_body`, never the model's self-reported `word_count`. A model that ignores the band is not a reliable narrator of how badly it ignored it, and every persistence path counts the body anyway.
- Outside `wordBandBounds()` — 0.75x floor, 1.25x ceiling — the output is unusable and falls through to the next provider exactly like malformed JSON. The credit is refunded if the whole chain fails, which beats charging for a chapter that breaks reading-time estimates and narration cost downstream.
- Inside the tolerance but outside the stated band, the drift is logged and the story is kept. The band is a writing instruction, not a contract a model can hit exactly; enforcing it literally would throw away good stories. Production series chapters legitimately land at 905-945 against a 600-900 band.
- The 2,026-word `gpt-5-mini` chapter that motivated this is now a regression test, alongside the observed production spreads (846-1,353 on the standalone band, 905-945 on the series band) as the must-not-reject cases.

### Story generation has its own credential

`_shared/llm.ts` now reads `OPENAI_STORY_API_KEY` ahead of `OPENAI_API_KEY`; `_shared/image.ts` still reads `OPENAI_API_KEY`. `OPENAI_API_KEY` authenticated both `gpt-image-1` covers and story text, so one spend cap, rate limit, revocation or rotation took down covers and stories together — and with Gemini (`429`) and OpenRouter (`402`) unavailable, every position that can serve authenticates with it.

Setting the secret is now the entire remaining change and no deploy follows it. Leaving it unset preserves current behaviour, so this is safe to land ahead of the key existing.

### Validation

- `deno fmt --check`, `deno check`, **134 deno tests** pass (six new: the band mapping, runaway rejection, the must-not-reject production spreads, series-band narrowing, the no-band path, and credential precedence).
- Production `smoke-app-surface.py`: **26 / 26**; assertion 5.3 names `gpt-5.6-luna`.
- Production `smoke-series-generation.py`: **58 / 58**, with the length guard live: 1,237 words standalone, 860 and 869 on the series band. No legitimate generation was rejected.

### Still open, and both are account actions

- Set `OPENAI_STORY_API_KEY` in Supabase secrets.
- Gemini `429` and OpenRouter `402` remain unresolved, so there is still no provider-level redundancy ahead of OpenAI. Adding OpenRouter credits is the cheapest fix — `google/gemini-2.5-flash` is already pinned and deployed in that position.

## 2026-08-31 UTC — GPT-5.6 Luna live in the OpenAI position

**Session:** Made the OpenAI position an ordered model list — `gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini` — diagnosed and cleared a project-level entitlement block on Luna, and recorded the fallback-credential work in the roadmap. Luna now serves all production generation. PRs #40 and #41.

- `OPENAI_MODELS` makes the OpenAI position an ordered list rather than a single model: `gpt-5.6-luna`, `gpt-5-mini`, then `gpt-4o-mini`. Each entry records its own `LlmFailure`, so telemetry distinguishes an unentitled model from a broken one. The last entry must never be entitlement-gated, or an unentitled project has no working OpenAI position at all.
- Luna is a reasoning model, so the direct OpenAI call needed a second chat-completions dialect: `max_completion_tokens` instead of `max_tokens`, no `temperature`, and `reasoning_effort: "low"` because prose does not benefit from long deliberation and every reasoning token is latency the reader waits through. Reasoning tokens are counted inside the completion budget, so it carries 2x headroom over the visible story length. The OpenRouter path keeps the legacy `max_tokens` + `temperature` shape, since it still routes to models that only understand it.
- `OPENAI_TIMEOUT_MS` raised 30s -> 60s and `PHASE_END_SHARE` rebalanced to 35/50/90/100% to give the reasoning model room.

**Production result on first deploy (superseded the same day — see "Luna went live" below):** Luna returned `403 Project ... does not have access to model gpt-5.6-luna`. The model ID is correct; the OpenAI project simply is not entitled to it. The first deploy — Luna alone, replacing `gpt-4o-mini` — took generation down: every position failed and `generate-story` returned 500. The ordered-list fallback restored it in the same session. Granting project access upstream will switch production to Luna with no deploy.

The `error_events` telemetry added in this branch diagnosed it directly, with no log spelunking: one `all_providers_failed` row carrying parallel `models`, `codes` and `statuses` arrays showed `gemini=rate_limited/429`, `google/gemini-2.5-flash=provider_error/402`, `gpt-5.6-luna=auth_failed/403`, and `openrouter/free=timeout` with a null `status`, since an abort never receives an HTTP response. This is the first incident the table has paid for.

Fingerprints, per the Observability Gate in `AGENTS.md`:

| Fingerprint | Bucket | Code | Occurrences |
| --- | --- | --- | --- |
| `e113a07ec4385e039cd8453b37d69c9d` | `llm.provider` | `all_providers_failed` | 1 |
| `c3cdcc232b713a738c724bb5a65bb111` | `generation.story` | `post_deduction_failed` | 1 |

Both first and last seen `2026-08-31 18:59:59 UTC`, `occurrences = 1` in `error_event_summary` — a single incident, not a recurrence, and neither has reappeared since the ordered-list fallback landed.

### Validation

- `deno fmt --check`, `deno check`, **128 deno tests** pass, including a stalled-Luna regression that proves `gpt-4o-mini` is still sent when the preferred model hangs.
- The OpenAI window is split evenly per model rather than shared. A shared deadline let a stalled preferred model spend the whole window, and `remainingDuration` then aborted the model behind it before `fetch` was called — the same starvation `PHASE_END_SHARE` prevents between providers, recurring one level down inside the OpenAI position.
- Production `smoke-app-surface.py`: **26 / 26**; assertion 5.3 names `gpt-5.6-luna` after the entitlement was granted (`gpt-4o-mini`, then `gpt-5-mini`, on the runs before it).
- Production `smoke-series-generation.py`: **58 / 58**.

### Luna went live the same day

Granting model access at the **org** level was not sufficient: the 403 names a *project*, and the project allowlist is enforced on top of the org grant. Once access was granted on `proj_XsPb…` the chain switched to Luna with no deploy — the 403 simply stopped.

Two things worth remembering from the diagnosis:

- `GET /v1/models` listed `gpt-5.6-luna` for the whole outage. That endpoint returns the catalogue, not the entitlement, so it is useless as an access probe. A temporary diagnostic function that issued real completion requests settled it in one call: Luna `403` on both `/v1/chat/completions` and `/v1/responses`, while `gpt-5.5` and `gpt-5.4` returned `200` on the same key. The diagnostic was deleted immediately after.
- `gpt-5-mini` was added between Luna and `gpt-4o-mini` while access was pending, trading cost for quality against the only model then serving: `gpt-5-mini` ~$0.006/story against `gpt-4o-mini` ~$0.002. It stays as the second tier now that Luna is entitled, and costs the product nothing there — Luna at ~$0.004 is both cheaper *and* better than it, so `gpt-5-mini` only bills when Luna itself fails.

  Per ~1k-word story, at list prices (~700 prompt + ~3,000 completion tokens including reasoning):

  | Model | $/M in | $/M out | ~$/story |
  | --- | --- | --- | --- |
  | `gpt-4o-mini` | 0.15 | 0.60 | 0.002 |
  | `gpt-5.6-luna` | 0.20 | 1.20 | 0.004 |
  | `gpt-5-mini` | 0.25 | 2.00 | 0.006 |

Observed while `gpt-5-mini` was serving: one story came back at **2026 words** against a 500-1500 band, in-band on the surrounding runs. The band is prompt-enforced only and nothing rejects an over-length chapter, so a stronger model that ignores the ceiling reaches persistence. Not reproduced under Luna (1085-1353 words across romance/thriller/fantasy), so it is not currently biting — tracked in the roadmap rather than fixed here.

### Provider status after the fix

| Position | Status |
| --- | --- |
| `gemini-3.1-pro-preview` | `429 RESOURCE_EXHAUSTED` — Google AI quota/billing |
| OpenRouter `google/gemini-2.5-flash` | `402 Insufficient credits` — add OpenRouter credits |
| OpenAI `gpt-5.6-luna` | **serving all production generation** |
| OpenAI `gpt-5-mini`, `gpt-4o-mini` | fallback tiers, healthy |

## 2026-08-31 UTC — CodeRabbit follow-up for provider and telemetry hardening

**Session:** Addressed the CodeRabbit review on PR #39. The chain at the time was Gemini -> OpenRouter Free Router -> `gpt-4o-mini`; it was reordered later the same day so the random free router sits last, and the OpenAI position became a model list. See the Luna entry above for the current shape.

- Gemini and OpenAI-compatible provider paths now parse HTTP bodies with `response.text()` and defensive JSON parsing, preserving HTTP status classification even when an error body is plain text.
- Gemini prompt-level `promptFeedback.blockReason` is classified as a moderation rejection before candidate validation, and moderation matching no longer uses the broad bare `safety` substring.
- Error-context sanitization tests now exercise `sanitizeErrorContext()` directly for circular values while preserving allowlisted request identifiers.
- Restored migration `00018` to its original summary-view grouping shape and kept migration `00021` as the sole corrective one-row-per-fingerprint migration.
- Clarified that `00016_device_tokens.sql` remains a pending Phase G migration.
- Added and applied migration `00022` to validate the replacement `error_events.user_id` foreign key separately from the `NOT VALID` constraint creation.
- Added and applied migration `00023` so `error_events.user_id` is a detached identifier and profile deletion cannot mutate, delete, or be blocked by historical telemetry.
- Redeployed production `generate-story`, `continue-story`, and `edit-story` to project `iafeuxgoiknncgyjmugd`.

### Review follow-ups (2026-08-31 UTC)

- `ProviderModerationRejectedError` replaces the plain `Error` thrown at every moderation site. `classifyLlmError` records it as `moderation_blocked` with `retryable: false`, so `error_events` no longer files a known, non-retryable content-policy refusal as `unknown` / retryable. `isModerationRejection` still matches it by message, so the softening-retry ladder is unchanged.
- Migration `00025` gives the detached `error_events.user_id` an erasure path. `00023` removed the foreign key so telemetry could neither block nor be rewritten by profile deletion, which left the identifier with no lifecycle. `00025` nulls it on profile deletion via an `AFTER DELETE` trigger, adds `erase_user_error_telemetry(uuid)` for a request arriving after the profile is gone, and `prune_error_event_user_ids(interval)` as a 90-day retention backstop. All three are service-role only and always preserve the event row. Verified in production: profile deletion stayed non-blocking, the event row survived, `user_id` was nulled.
- Chain docstring in `_shared/llm.ts` and the provider note in `AGENTS.md` now name the deployed order and the provider actually serving.
- Added the `series_state` incomplete-shape fixture that exercises the required-key loop in `hasCompleteStoryShape`.

### Validation

- `deno fmt --check supabase/functions supabase/migrations`: passed.
- `deno check` for `generate-story`, `continue-story`, `edit-story`, `_shared/llm.ts`, and `_shared/errors.ts`: passed.
- `deno test --allow-env --allow-net supabase/functions/_shared`: **124 passed**.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-pr39`: passed with bundled Node on PATH; output written to `/tmp/katha-web-export-pr39`.
- Provider-chain reorder verified in production after redeploying `generate-story`, `continue-story`, `edit-story`:
  - `smoke-app-surface.py`: **26 / 26**. Assertion 5.3 now names `gpt-4o-mini`; the same assertion named `cohere/north-mini-code:free` before the reorder.
  - `smoke-series-generation.py`: **58 / 58**.
  - Live quality read across romance / thriller / fantasy seeds: 846-1100 words, in-band, genre-appropriate prose, with `themes`, `series_state` (`open_hooks`, `world_facts`, `promised_payoffs`, `central_conflict`), `chapter_role`, `hook_type` and `hook_text` all persisted.
  - Observed chain in production today: Gemini `429 RESOURCE_EXHAUSTED` -> OpenRouter `google/gemini-2.5-flash` `402 Insufficient credits` -> `gpt-4o-mini` serves. Prose quality is therefore capped at `gpt-4o-mini` until one of the two upstream billing blockers is cleared; no code change is needed when they are.
- Security scan: no committed Gemini/OpenRouter keys or service-role-style secrets found. Existing `image-size` high advisories remain upstream-blocked pending a published patched release.
- Production smoke after redeploy:
  - `smoke-app-surface.py`: **26 / 26**, with the known cover-generation pending note unchanged.
  - `smoke-series-generation.py`: **58 / 58**, with zero observed generation failures and no stuck `reserved` operations.

## 2026-08-31 UTC — Gemini/OpenRouter story-generation chain deployed

**Session:** Replaced the active story-generation provider chain with Gemini -> OpenRouter `google/gemini-2.5-flash` -> `gpt-4o-mini` -> OpenRouter Free Router, removed Anthropic/Claude runtime dependency from `_shared/llm.ts`, set the new Supabase secrets, unset old Claude/Anthropic secret names where present, and deployed the generation functions.

### Runtime changes

- `_shared/llm.ts` now calls provider HTTP APIs directly in this order: `gemini-3.1-pro-preview`, OpenRouter `google/gemini-2.5-flash`, `gpt-4o-mini`, then OpenRouter `openrouter/free`.
- The second position is a pinned, priced OpenRouter model (65k output cap, native structured output, billed through OpenRouter so a Google-side quota block on `GEMINI_API_KEY` does not take it down).
- `openrouter/free` moved from the second position to last. It routes to a random free model per request under free-tier daily caps: the 2026-08-31 app-surface smoke run caught it serving a paragraph rewrite from `cohere/north-mini-code:free`, a code model, and a story generation timed out against it at 30s. Every model whose identity is known in advance now runs first, and the router is only the last attempt before the caller refunds the credit.
- Each provider phase is capped at a cumulative fraction of the shared deadline (`PHASE_END_SHARE`: 40% / 60% / 85% / 100%). Moderation retries are otherwise bounded only by the shared deadline, so a slow first provider could exhaust the budget and abort every fallback before it sent a request.
- Story-generation requests are schema-constrained for all providers: Gemini `responseSchema`; OpenRouter/OpenAI strict `response_format`.
- Old Claude/Anthropic env names are intentionally ignored. Regression coverage proves `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, and `CLAUDE_TOKEN` cannot authenticate generation.
- A provider returning HTTP 200 with malformed or empty story JSON now counts as `malformed_response` and falls through to the next provider instead of reaching persistence and refunding after credit deduction.

### Observability

- Added migrations `00018` and `00019` for durable `error_events` telemetry and service-role REST access.
- Added migration `00020` so profile deletion cannot mutate historical `error_events` rows.
- Added migration `00021` so `error_event_summary` keeps one row per fingerprint and derives the highest observed severity.
- Wired `generate-story`, `continue-story`, and `edit-story` to log all-provider failures and post-deduction failures without storing story prose, prompts, seeds, or titles.
- Production provider probe showed Gemini primary is currently quota-exhausted (`429 RESOURCE_EXHAUSTED`) and OpenRouter recovered. Logged as `llm.provider` / `medium`, fingerprint `40df49d1980191986aa6f5db0e3cc1e7`.
- A production app-surface smoke found one refunded `generate-story` failure from empty/malformed provider output. Queried first, then fixed at the provider-chain boundary. Fingerprint `b6d4d193620fba18cfb6fb2273d88656`, occurrences `1` when triaged.

### Validation

- Deno check passed for `_shared/llm.ts`, `_shared/errors.ts`, `generate-story`, `continue-story`, and `edit-story`.
- Deno tests: **124 passed**.
- Security scan: no committed provider keys or Supabase secrets found. `postcss` and `uuid` advisories fixed through `expo/pnpm-workspace.yaml` overrides and a refreshed Expo lockfile. `image-size` still reports two high advisories via Expo/Metro, but the audited registry exposes no patched `2.0.3` release yet; latest available remains `2.0.2`.
- Expo typecheck, lint, and Jest passed locally (`41 / 41`). Expo Doctor now passes 14 / 18 checks: `react-native-worklets` is fixed, while local `npm` absence and the pre-existing CI-compatible `eslint-config-expo` / `jest-expo` version mismatch remain.
- Deployed `generate-story`, `continue-story`, and `edit-story` after the final fix.
- Production smoke after final deploy:
  - `smoke-app-surface.py`: **26 / 26**, with the known cover-generation pending note unchanged.
  - `smoke-series-generation.py`: **58 / 58**.

**Open:** Gemini is configured but not usable until quota/billing is fixed on the Google AI project. OpenRouter Free Router is currently carrying story generation and edit fallback successfully.

## 2026-08-30 — Backend verified end to end

**Session close.** Every edge function is deployed from `main` and exercised against the live project.

### `audio-status` told pollers to retry a job that will never exist

Any non-ok RunPod response was mapped to **502**, which means "upstream is broken, try again". An unknown or expired job id is not an upstream fault, so a polling client would spin forever. RunPod 404 now maps to 404; genuine upstream failures keep 502 and carry `upstream_status` so the cause survives into the logs.

### Final state

| Suite | Result |
|---|---|
| `smoke-series-generation.py` | **58 / 58** |
| `smoke-app-surface.py` | **26 / 26**, 1 pending |
| Deno unit tests | **121** |
| Edge functions deployed | **12 / 12** |
| Migrations applied | `00001`–`00015`, `00017` |

Defects found and fixed today, all of them by running against production rather than by reading code:

1. Production was serving a build four commits behind `main` — 683 lines of merged generation fixes were not live.
2. Five functions had never been deployed, two of them called by the client.
3. `feed` returned 500 on every call: `profiles.preferred_genres` did not exist.
4. `feed` still returned 500: `profiles.display_name` did not exist either; the column is `username`.
5. `publish-story` could never succeed — it required `chapters.is_published = true` and nothing ever set it.
6. `feed` did not typecheck; CI never checked the Deno workspace at all.
7. A stale `ANTHROPIC_API_KEY` could still have authenticated requests through the SDK's implicit env lookup.

**Still open:** the Claude leg has never executed — `CLAUDE_CODE_OAUTH_TOKEN` is unset, so all generation runs on `gpt-4o-mini`. The publish → cover pipeline is not wired on `main`. Neither is a regression; both are named in the entries below.

---

## 2026-08-30 — `feed` second missing column, and the cover pipeline is not on main

**Session:** Re-running the app-surface smoke after migration `00017` showed `feed` still returning 500. The `preferred_genres` fix was necessary but not sufficient.

### `profiles.display_name` has never existed

All four story queries in `feed` select `profiles!stories_author_id_fkey(display_name)`, and the mapper reads `profiles?.display_name`. The column on `profiles` is **`username`**:

```
{"code":"42703","message":"column profiles_1.display_name does not exist"}
```

`display_name` appears nowhere else in the repository — not in another function, not in `expo/src`, not in any migration. It was never a column; it was a guess. Switched all four selects and the mapper to `username`, keeping the response field `author_display_name` so the client contract is unchanged.

Two missing columns in one function is the same failure mode as `00008`, and it is worth naming: **a query is not verified by a typecheck.** `deno check` passes on a `.select()` string that names a column that does not exist, because the string is just a string. Only running it against the database finds these.

### The publish -> cover pipeline is not on `main`

`AGENTS.md` documents `publish-story -> generateCoverImage() -> Supabase Storage`. On `main`, **`generateCoverImage` has no caller at all** — the wiring lives in the uncommitted `regenerate-cover` work in the working tree. Publishing therefore succeeds and leaves `cover_image_url` empty.

Not a regression and not fixed here, because fixing it would collide with that in-flight branch. The smoke suite reports it as `[PENDING]` rather than a pass or a failure, so it cannot be mistaken for done.

---

## 2026-08-30 — Home feed and publishing were both structurally broken

**Session:** Deploying the five never-deployed functions exposed two client-facing paths that could not have worked. Found by a new smoke suite, not by reading the code.

### `feed` returned HTTP 500 on every authenticated call

`feed/index.ts` selects `profiles.onboarding_purpose, preferred_genres`. **`preferred_genres` was never created.** PostgREST answered `42703 column profiles.preferred_genres does not exist`, the function threw, and the Home tab got a 500 every time.

Same class as migration `00008`: code shipped against a column that only existed in someone's head. Migration `00017` adds it — `text[] not null default '{}'`, additive and safe on a live table — rather than deleting the personalisation the feed was written to use.

### `publish-story` could never succeed

It required at least one chapter with `is_published = true`, then published the story. **Nothing in the codebase ever sets `is_published`.** Not `generate-story`, not `continue-story`, and there is no chapter-level publish endpoint. `expo/src/lib/api.ts` calls `publishStory(storyId)` with a story id and nothing else, so the gate was unsatisfiable and publishing returned 400 forever.

The gate now requires a chapter to *exist*, and publishing a story publishes its chapters — which is what the single Create Studio action means. Chapters are published before the story row, so the feed can never list a story whose chapter-count query returns zero.

### Why neither was caught

Both functions had **never been deployed**. Nothing exercised them, and the CI typecheck gate would not have found either — one is a missing database column, the other a logic gap. `backend/scripts/smoke-app-surface.py` now covers library, feed, edit-story, publish-story and audio-status against the deployed project.

---

## 2026-08-30 — Full backend deployment: 12 functions live

**Session:** Brought the deployed project up to `main` and fixed the one function that could not pass the typecheck gate.

### `feed` did not typecheck

`feed/index.ts` annotated four parameters as `ReturnType<typeof createClient>`. That resolves the generic **defaults** (`schema: never`), not the instantiation `createClient(url, key)` actually returns (`schema: "public"`), so every call site failed `deno check` with TS2345. It was never caught because `feed` had never been deployed and the CI gate runs on the Expo workspace, not on the Deno functions.

Replaced with a `ServiceClient` alias derived from a real call, so the type tracks `createClient` rather than restating it.

### CI now covers the Deno workspace

The typecheck gate only ever ran on `expo/`, which is why four TS2345 errors in `feed` survived to `main`. A second CI job typechecks **every** `backend/supabase/functions/*/index.ts` by glob — so a new function is covered the day it lands rather than when someone remembers to add it — then runs the shared Deno test suite and a format check. Raised in review on PR #35.

### Deployment

All 12 edge functions deployed from `main`. Five had **never** been deployed: `audio-status`, `edit-story`, `feed`, `generate-audio`, `publish-story` — two of which (`edit-story`, `publish-story`) are called by `expo/src/lib/api.ts`, so the Create Studio edit and publish paths had been reaching functions that did not exist.

`generate-story` and `continue-story` were redeployed again after PR #34 merged, since the earlier redeploy in this log predates the OAuth resolver.

---

## 2026-08-30 — Claude OAuth-token generation credential

**Session:** Replaced the Console API-key credential for story generation with a Claude Code OAuth bearer token. Implementation originated with Codex; this session ported it onto current `main`, corrected two documentation errors, and added the test coverage.

### Branch correction (the reason this is not Codex's diff)

Codex authored its change on `codex/regenerate-cover-prompt-regressions`, which is based on `c14d3d4` — **four commits behind `main`** (PRs #30, #31, #32, #33). It therefore edited the pre-#33 `llm.ts`: 254 lines, `esm.sh/@anthropic-ai/sdk@0.30.1`, no `story_schema.ts`, no typed failures, no `editParagraph`. Landing that diff would have reverted PR #33 in full and dropped migrations `00009`-`00015` from version control.

The credential change was re-applied to `main`'s 472-line `llm.ts` on a fresh branch. Codex's working tree was left untouched.

Two documentation errors from the same staleness were corrected rather than carried forward:

- Codex's note claiming migrations `00009`-`00015` are applied remotely **with no local file** is false — all fifteen are in version control on `main`. They were absent only from its stale checkout.
- `AGENTS.md` did say "8 migrations: 00001-00008" while fifteen files existed. That line was stale on `main` (PR #32 added the files without updating it); it now reads `00001`-`00015` and directs agents to `supabase migration list` for the next free number.

### Changes

- `_shared/llm.ts`: `ANTHROPIC_API_KEY` removed. Credential resolves through `claudeAuthToken()` over `CLAUDE_CODE_OAUTH_TOKEN` -> `ANTHROPIC_AUTH_TOKEN` -> `CLAUDE_TOKEN`, first non-empty after trim. Passed to the SDK as `authToken`.
- New `ProviderNotConfiguredError`, classified `not_configured` / non-retryable. Previously a missing credential fell to the `unknown` branch and was marked **retryable**, so the chain burned both Claude attempts on a deployment gap that no retry could fix.
- Whitespace-only values are treated as absent — a secret set with a trailing newline is the common way a "configured" secret is in fact empty.

### Verification

- `deno check` clean: `_shared/llm.ts`, `generate-story/index.ts`, `continue-story/index.ts`.
- `deno fmt --check` clean for `llm.ts` and `llm.test.ts`. Repo-wide it reports 6 unformatted files under `_shared/` — **pre-existing on `main`, which has 8**; this branch formatted the two files it touched and left the rest, so a credential change does not arrive carrying formatting churn. The remaining 6 are tracked debt, not a regression.
- **119 Deno tests pass** (baseline on `main` measured at 113); 6 new, covering alias precedence, whitespace rejection, `not_configured` classification, and that a stray `ANTHROPIC_API_KEY` in the environment does **not** authenticate.
- Fault-injected both directions: re-admitting `ANTHROPIC_API_KEY` to the name list and removing `.trim()` each fail the intended test and only that test. The tests are not vacuous.
- SDK bearer transport confirmed by reading `@anthropic-ai/sdk@0.122.0` source: `authToken` produces `Authorization: Bearer <token>`; `apiKey` produces `x-api-key`. Not interchangeable.

### Not verified

**No end-to-end run against Claude.** `CLAUDE_CODE_OAUTH_TOKEN` is not set in Supabase secrets, so the Claude leg has still never executed in this project — with any credential. Whether the Anthropic API accepts a Claude Code OAuth token on `/v1/messages` via plain bearer, without additional headers, is untested here and must not be assumed. No production smoke run was performed, so no `error_events` rows were written this session.

### Deployment correction (production was serving a stale build)

`generate-story` and `continue-story` had been deployed on 2026-08-29 20:58 UTC from the stale `c14d3d4`-based tree, so **683 lines of merged generation fixes from PRs #30, #32 and #33 were on `main` but not live** — `story_schema.ts` did not exist in that build at all, meaning no schema enforcement and the old 4096-token ceiling, which is the root of the intermittent misparse.

Both were redeployed from `origin/main` (`10ecaa8`) on 2026-08-30. Verified: `generate-story` v16 -> v17 (`7fa2e09e` -> `b911ca26`), `continue-story` v19 -> v20 (`9256927a` -> `6cfcf986`), and the upload manifest lists `_shared/story_schema.ts` for both.

### Edge function inventory is not what the ROADMAP claimed

`supabase functions list` shows **7 deployed, not 10**. The ROADMAP checkbox asserting "10 edge functions deployed and ACTIVE" was ticked against a state that has never held; it is now unticked with the real inventory.

| | Functions |
|---|---|
| Deployed (7) | `adapty-webhook`, `continue-story`, `deduct-credit`, `feedback`, `generate-story`, `grant-credit`, `library` |
| **Never deployed (5)** | `audio-status`, `edit-story`, `feed`, `generate-audio`, `publish-story` |

`expo/src/lib/api.ts` calls `edit-story` (line 518) and `publish-story` (line 555), so the Create Studio edit and publish paths reach functions that do not exist in the project. `publish-story` also writes to the `covers` bucket, which does exist (see below), so deploying it is the only thing standing between the current state and a working publish path.

Not deployed in this session: the five above are a separate decision, and `publish-story` spends money on cover generation the moment it succeeds.

### Review round 1 (CodeRabbit)

- **Major, valid, fixed.** The credential was checked inside the per-model helper, so an unconfigured Claude threw the identical preflight on the Sonnet leg and again on the Haiku leg — two `not_configured` rows for one deployment gap, which inflates any occurrence count a recurrence check later reads. The check is hoisted ahead of both legs; one failure is recorded and the chain continues to OpenAI. Regression test added and fault-injected (restoring the duplicate makes it fail with `got 2`).
- **Minor, valid, fixed.** `ROADMAP.md` still recorded the dated `claude-haiku-4-5-20251001` as applied, contradicting `AGENTS.md`. Now the canonical undated id.
- **Minor, not applied.** CodeRabbit read the `2026-08-30` headings as future-dated against a review date of 2026-08-29. The dates are correct in the repo's local timezone (IST, UTC+5:30) — the redeploy recorded above ran at 2026-08-29 23:37 UTC, which is 2026-08-30 05:07 local — and the preceding entry already uses local dates. Changing them would make this entry inconsistent with the rest of the log.

### Review round 2 (CodeRabbit) — a real credential leak

- **Security, Major, valid, fixed.** `new Anthropic({ authToken })` does **not** disable API-key auth. Confirmed in `@anthropic-ai/sdk@0.122.0` source: the constructor runs `if (apiKey === undefined) apiKey = readEnv("ANTHROPIC_API_KEY") ?? null`, and `authHeaders()` returns `[apiKeyAuth(), bearerAuth()]`. A stale `ANTHROPIC_API_KEY` in Supabase secrets would therefore be sent as `X-Api-Key` **alongside** the bearer token, and could authenticate and bill traffic this project believes runs on OAuth.

  This also made the claim in the previous commit — that `ANTHROPIC_API_KEY` "is no longer read anywhere in this codebase" — **false**. The resolver ignored the name; the SDK did not. Client construction moved into `createClaudeClient()` with `apiKey: null` pinned, and `AGENTS.md` corrected.

  The earlier unit test only proved the *resolver* ignored the variable, which is why it passed while the wire was still leaking. The new test asserts the outgoing headers through an injected `fetch`: `X-Api-Key` absent, `Authorization: Bearer` present, with `ANTHROPIC_API_KEY` set in the environment. Fault-injected — removing `apiKey: null` fails it.

- **Data integrity, Major, valid.** The redeploy recorded above was from `origin/main` at `10ecaa8`, which does **not** contain the OAuth resolver. Setting `CLAUDE_CODE_OAUTH_TOKEN` alone will not activate it. `generate-story` and `continue-story` must be redeployed **after this PR merges**; tracked in Open below.

- **Minor, valid, fixed.** `ROADMAP.md` line 41 contained a raw `LegacyProjectNotLinkedError` JSON payload where the evidence should have been. Self-inflicted: an unquoted shell heredoc executed the backtick-quoted `supabase functions list` as a command substitution and pasted its error into the document. The inventory itself was gathered from a linked run and is correct; only the citation was corrupt.

### Storage buckets verified, not assumed

`AGENTS.md` and `ROADMAP.md` both said the `covers` bucket **needs creation**. It has existed since 2026-08-25: public read, 5 MB limit, `image/png` / `image/jpeg` / `image/webp`, confirmed against the storage API. Three stale checkboxes corrected.

### Open

1. **Redeploy `generate-story` and `continue-story` after this PR merges.** The current deployment is from `10ecaa8` and has no OAuth resolver, so setting the secret alone changes nothing.
2. Set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, not interactive login) and treat the first run as the real verification.
3. **Entitlement question:** the token authenticates a Claude subscription, a developer-tool entitlement separate from the metered API. Serving end-user generation from it should be confirmed with Anthropic before production traffic.
4. Until (2), every generation silently falls through to `gpt-4o-mini`. It does not fail — it gets quietly worse. Watch `error_event_summary` for `not_configured`.
5. `_shared/errors.ts`, `errors_test.ts` and `00016_error_events.sql` remain uncommitted in the working tree, along with the Observability Gate section Codex drafted for `AGENTS.md`. They are a coherent unit and belong in their own PR; documenting a helper this repo does not yet contain would be worse than leaving both out.

## 2026-08-30 — LLM layer: correct model IDs, enforced output schema, typed failures

**Session:** Repaired the Anthropic path, which has never run. Every generation in the previous session's smoke tests reached `gpt-4o-mini`, the third-choice fallback — the absent `ANTHROPIC_API_KEY` alone accounts for that, and the model IDs were separately found to be non-canonical.

### Model IDs

- `claude-haiku-4-5-20251001` -> `claude-haiku-4-5`, the canonical undated identifier. Standardising on the documented alias, **not** on an observed failure: the Anthropic path has never executed against this project, so the dated form's behaviour here is unverified either way.
- `claude-sonnet-4-6` -> `claude-sonnet-5`. Newer and cheaper: $2/$10 per MTok against $3/$15.
- SDK `@anthropic-ai/sdk` 0.30.1 -> 0.122.0, and the specifier moved from `esm.sh` to `npm:` because esm.sh returns 500 for the package's type declarations under `deno check`.

### max_tokens

Raised from 4,096 to 16,000 for generation (2,000 for paragraph edits). A ~900-word chapter plus a full `series_state` runs past 4,096, so responses truncated mid-JSON, parsed as garbage, and degraded to the text parser — the likely root of the intermittent `hook_type: "none"` chapters with frozen state.

### Output schema is enforced

`_shared/story_schema.ts` defines the story JSON schema once. Anthropic receives it via `output_config.format`, OpenAI via `response_format` with `strict: true`. The prompt previously only described the shape in prose, and a valid-JSON-wrong-shape response (`chapter_body` absent or not a string) fell through to the plain-text parser, which persisted a placeholder `hook_type: "none"` and an empty `series_state` while still spending a credit. Both providers require every property in `required` and `additionalProperties: false` for strict mode; tests pin that.

### edit-story was broken on main

`edit-story/index.ts` imports `editParagraph` from `_shared/llm.ts`, which did not exist — verified failing on `origin/main`, so it predates this work. Paragraph-level AI editing in Create Studio could not have functioned. The provider chain is now parameterised (`maxTokens`, `constrainToStorySchema`, `deadlineMs`) and `editParagraph` runs on it deliberately **without** the story schema, since it returns prose rather than JSON.

### Typed provider failures

`classifyLlmError()` maps SDK error classes — `NotFoundError`, `RateLimitError`, `AuthenticationError`, `APIConnectionError` before `APIError` since it subclasses it — to a stable `LlmFailure` (`provider`, `model`, `code`, `status`, `retryable`) rather than string-matching provider wording. `AllProvidersFailedError.toContext()` emits identifiers and enums only, so it feeds `logError({ bucket: "llm.provider" })` with no sanitizing. A test asserts context never carries prose, enforcing the `error_events` PII rule.

Secrets are now read lazily rather than at module load, so importing `llm.ts` is no longer a side effect requiring `--allow-env`.

### Credential status

`ANTHROPIC_API_KEY` remains unset. A `sk-ant-oat01-` OAuth access token was offered and declined: it is minted by `claude` CLI login against a Claude subscription, expires within hours, and subscription auth is not licensed to serve end-user traffic. An API key from console.anthropic.com (`sk-ant-api03-`) is required. Documented in `AGENTS.md`.

> **Superseded 2026-08-30** by the entry below. The project moved to an OAuth bearer token (`CLAUDE_CODE_OAUTH_TOKEN`) and no longer reads `ANTHROPIC_API_KEY`. The reasoning above still holds for the *short-lived* token minted by interactive `claude` login; it does not apply to the long-lived `claude setup-token` form. The entitlement question it raises remains open.

**Not yet verified against Claude.** The smoke suite has only ever run through the OpenAI fallback. The model IDs, schema enforcement and token ceiling are correct by construction and unit-tested, but the Anthropic path has not executed once. First run after the key is set should be treated as the real verification.

89 Deno tests pass (was 79). `deno check` clean for `generate-story`, `continue-story`, `edit-story` and the shared modules.

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

### 8. Review pass: privilege bug, silent degradation, merge intent

A full re-review surfaced six further findings, two of them defects introduced by this PR.

- **`00015`: the `authenticated` UPDATE grant on `stories` was too broad.** `00012` issued a table-level `GRANT UPDATE` and then re-asserted 00006's `REVOKE UPDATE (status)`. A column-level REVOKE cannot subtract a column from a table-level grant, so the revoke was a no-op and story owners could set `stories.status` — exactly what 00006 prevented. `00015` grants only `title`, `topic`, `cover_image_url`, `is_public`. Verified against the project: owner UPDATE of `status` returns 403, of `title` returns 204.
- **Assertions 11.3/11.4 were documented but never landed.** The string anchor stopped matching after the try/finally re-indentation and the edit silently no-oped, so the harness still carried the old `11.2 no unexpected refunds` while the build log and commit message described its replacement. Implemented and verified in the run output.
- **`mergeSeriesState` conflated omitted with emptied.** A finale returning `open_hooks: []` kept the stale hooks, contradicting the finale contract, and a new `world_facts` entry replaced all earlier ones. Merging is now presence-aware: `open_hooks` and `promised_payoffs` are live state an explicit empty clears; `resolved_hooks`, `world_facts` and `character_changes` are history that accumulates.
- **`00014` replaced `identity_lenses` outright.** On replay that would drop every other lens from a story still carrying the legacy `lgbtq` genre. It now merges `queer` in and skips rows that already have it.

### 9. Continuations no longer degrade silently

Repeated runs showed continuations returning HTTP 200 with `hook_type: "none"` and a byte-identical `series_state`. `response_format: { type: "json_object" }` guarantees syntactically valid JSON but not the right shape: when `chapter_body` is not a string, `parseStructuredOutput` falls through to the plain-text parser, whose placeholder `hook_type: "none"` and empty state were being persisted as though they were model output. The chapter ended nowhere and continuity froze for the rest of the series, with the credit still charged.

`parseStructuredOutput` now reports whether the structured parse succeeded. `continue-story` refuses to persist an unstructured continuation, and `generate-story` refuses to start a **series** on one — a series opening with no hook and no state cannot be continued. Standalone stories need neither, so they keep the text fallback. In both cases the existing refund path runs and the reader can retry.

**Known residual:** on the `gpt-4o-mini` fallback this misparse occurs intermittently — roughly one continuation in six across observed runs. It is now a loud, refunded failure rather than a silent corruption. `ANTHROPIC_API_KEY` is still unset; the prompt system was designed for Claude, and this path is the fallback.

79 Deno tests pass (was 68). `deno check` clean. Both edge functions redeployed.

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

- `../source-of-truth/STORY_PROMPT_SYSTEM.md`: one UI genre contract. The taxonomy table now matches the shipped Expo list (13 creation cards; `cozyFantasy` and `paranormalRomance` marked backend-only).
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
- Updated `../source-of-truth/STORY_PROMPT_SYSTEM.md` and `backend/ROADMAP.md` to reflect the implemented runtime contract.

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

### Spec Updates (`../source-of-truth/STORY_PROMPT_SYSTEM.md`)

- **Title Generation** section: 2-6 words, evocative not descriptive, genre examples
- **Word Count Enforcement** table: min/max per mode, rejection at <300 words
- **Series Chapter Structure**: cliffhanger rules for Ch 1-6, finale rules for Ch 7

### Documentation Updates

- `AGENTS.md`: Updated Create Studio flow description, migration count
- `ROADMAP.md`: Refactored — Phase A marked DONE, completed items in collapsible sections, Phase B cover items checked, migration numbers fixed, language distribution corrected
- `../source-of-truth/STORY_PROMPT_SYSTEM.md`: Title rules, word count, series structure

### New Files

- `expo/src/components/GeneratingOverlay.tsx` — dark orb loading overlay
- `expo/src/data/generating-phrases.ts` — genre-aware phrase templates with keyword slots

### Modified Files

- `expo/src/screens/CreateStudioScreen.tsx` — full Progressive Editor rewrite
- `expo/src/lib/api.ts` — 3 API wrappers, mock upgrade, genre-aware titles
- `expo/src/types/domain.ts` — `isSeries` on CreateDraft
- `backend/ROADMAP.md` — refactored phases
- `../source-of-truth/STORY_PROMPT_SYSTEM.md` — title/word count/series spec

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

- Updated `../source-of-truth/STORY_PROMPT_SYSTEM.md` from v2.0 to v5.1 production
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
- **Story generator system prompt v1.0** — `../source-of-truth/STORY_PROMPT_SYSTEM.md`
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
3. **System prompt fix** (`generate-story/index.ts`): hardcoded string → imported from `_shared/prompts.ts` (mirrors `../source-of-truth/STORY_PROMPT_SYSTEM.md`)
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

### RevenueCat migration (2026-09-02)

- Replaced the prior billing client and webhook with RevenueCat Purchases, RevenueCatUI, a public Test Store SDK key placeholder, entitlement mapping, Customer Center, and server-side product/credit mapping.
- Added RevenueCat webhook handling with constant-time authorization, sandbox rejection by default, `rc:{event.id}` idempotency, trial grants, refund/chargeback handling, cancellation-versus-expiration behavior, and benign-event acknowledgement.
- Added bucketed credit accounting: renewable subscription grants reset each period, purchased and earned credits remain distinct while subscribed, chargebacks clamp and record shortfalls, and expiration records an atomic negative lapse ledger row before zeroing every bucket.
- Added the protected annual monthly-refresh Edge Function and focused Deno/PGlite tests. No deployment, dashboard configuration, commit, or push was performed.

### RevenueCat CodeRabbit fixes (2026-09-02)

- Corrected the webhook contract: only `CANCELLATION` events with RevenueCat's store-refund reasons invoke the clamped chargeback path; ordinary cancellation remains active until expiration, and `REFUND_REVERSED` re-grants credit.
- Made duplicate credit-operation responses successful webhook acknowledgements, paginated annual grant refreshes by user ID, and isolated per-subscriber refresh failures without logging identifiers.
- Hardened migration `00026` with a non-blocking validation sequence, provider allowlist, monotonic ledger ordering, allocation lookup index, and partial-refund bucket restoration.
- Added regression coverage for trial refunds, both product-kind mismatch directions, refund reversals, plain unsubscribe cancellations, and partial refunds. Local verification: `deno test --allow-all supabase/functions/_shared/revenuecat_test.ts supabase/migrations/00026_subscription_credit_buckets_test.ts` (14 passed) and `deno check` on changed Edge Function modules.
- Updated RevenueCat development-build setup and canonical-economy documentation. No production-level tests were run, so no `error_events` entry was required. No deployment, dashboard configuration, commit, or push was performed.
- Reconciled the Expo onboarding callback type with its declared empty-purpose state so the required Expo typecheck remains clean.

### RevenueCat CodeRabbit round 2 (2026-09-02)

- Counted duplicate annual-refresh operation keys as successful no-ops, leaving only genuine per-subscriber failures in the refresh failure counter.
- Made store-refund retries converge: a duplicate credit deduction now still records the subscription lifecycle state. Added a regression test for a failed first subscription write followed by a duplicate-deduction retry.
- Routed the onboarding sign-in action to the email/OTP flow, retained completion only on its `onDone` callback, and typed the composed onboarding wrapper with the exported result contract.
- Replaced inaccurate credits hero copy in English, Portuguese, and Spanish with neutral action-oriented wording while client spending remains unbundled.
- Local verification: Expo typecheck, lint (23 existing warnings, 0 errors), tests (41 passed), Expo doctor (18/18), a compiled 390 x 844 web sign-in handoff, backend tests (15 passed), and `deno check` on the changed Edge Functions. No production-level tests, deployment, dashboard configuration, commit, or push were performed; no `error_events` entry was required.

### RevenueCat migration — review, merge prep, and the ads decision (2026-09-02)

- Completed CodeRabbit rounds 2 and 3 on PR #44. Round 3 fixed a dead control:
  `presentCustomerCenter()` resolved silently on web and when the SDK never
  configured, so the caller's `catch` never fired and the Katha Plus row did
  nothing. It now reports whether it presented and the caller falls back to the
  paywall. Also corrected the Portuguese `heroDescription` accent.
- **Recorded every remaining RevenueCat task as blocked on the store listing**
  (`ROADMAP.md` Phase C, "Blocked on the store listing going live"): the 10 store
  products, the production `appl_`/`goog_` SDK keys, the `katha_reader` and
  `katha_writer` entitlements and offerings, wiring the paywall to live package
  data, scheduling the monthly grant refresh, the App Review question on lapsing
  purchased packs, and the development-build requirement. All dashboard work; the
  client and webhook are complete. A release build has no billing until the
  production keys are pasted in — `activate()` logs an error and returns.
- **Ads decision: none ship in the MVP.** Added `ROADMAP.md` Phase C2 and resolved
  §12 item 7 in `../source-of-truth/CREDITS_AND_PRICING.md`. A proposal to put a house-styled
  full-screen break between chapters on the free tier, so "read without
  interruptions" could be sold as a paid benefit, was rejected — house-styled means
  it earns nothing, so it was friction with no revenue attached, and §7 already
  cites the finding that users converting to remove friction churn faster than
  those converting for positive value. Principle 1 and the §7 "never block reading"
  rule are unchanged.
- Recorded the standing rule that until ads exist, no paywall, onboarding screen or
  store listing may claim "ad-free" or "no interruptions" as a paid benefit; a
  benefit that removes nothing is a misleading-subscription risk at App Review.
- **Process note.** A second agent was working in the same checkout on the same
  branch. Work was moved to an isolated git worktree at `/private/tmp/katha-rc-fix`
  so the shared tree was never written to; that agent's uncommitted edits to
  `../source-of-truth/CREDITS_AND_PRICING.md` and its new `../source-of-truth/STORY_GENERATION_FLOW.md` were left
  untouched. Two agents sharing one working tree should be avoided — use
  `git worktree add` instead.
- No production deployment was performed in this session. The two Supabase secrets
  `REVENUECAT_WEBHOOK_SECRET` and `SUBSCRIPTION_GRANT_CRON_SECRET` are set on
  `iafeuxgoiknncgyjmugd`.

### Story prompt system migration (2026-09-04)

- Removed the retired hidden flavour taxonomy end-to-end: the shared types,
  validation, prompt assembly, client draft/request contract, generation RPC,
  persisted `stories` column, continuation reconstruction, and focused tests no
  longer accept or use it. Migration `00033_remove_trope_modules.sql` drops the
  column and replaces `begin_story_generation` with its smaller contract.
- Kept Kids Values separate and made it effective: it is sent only for Kids
  stories, fenced as untrusted input, and instructs the model to explore values
  through the story rather than state a lesson. The other stored brief fields
  (`writing_style`, `avoid`, planned length and chapter length) now affect both
  initial generation and continuation prompts.
- `wordBandFor()` now takes the creator's selected Short/Standard/Long length
  (600-900, 1,200-1,600, or 2,000-2,600 words). The same function supplies the
  prompt, output validator and continuation path. `planned_chapter_count`
  (3/7/15) now controls continuation limits and automatic finale derivation.
- Updated the canonical flow, prompt-system, pricing and onboarding documents,
  plus the repository contract, to remove stale behavior and make the retained
  contract explicit. Research notes are in `../report-source.md`.
- Local verification: 118 focused Deno tests passed and `deno check` passed for
  changed Edge Function modules. Expo TypeScript passed. The focused Expo Jest
  contract test could not start because the existing local installation lacks
  `babel-preset-expo`; dependencies were not modified. No production-level test,
  deployment, commit, or push was performed, so no `error_events` entry was
  required.

### Writer onboarding, the story plan, and push (2026-09-05)

**The story plan.** The blueprint screen has always shown the writer an ordered
outline before they pay, and nothing stored it: chapters were generated one at a
time with no plan, so the shape a user approved and the story they received were
unrelated. `stories.beats` (migration `00036`) closes that. The same free
`shape-story` call now returns the plan alongside everything else,
`validation.ts` clamps it to the planned chapter count rather than rejecting it,
and `story-prompts.ts` gained a plan layer where beat N briefs chapter N with the
remaining beats supplied as forward context. `continue-story` positions itself in
the plan by chapter number. A typed *What happens next?* outranks the beat, and
the prompt says so explicitly rather than leaving the precedence to inference.

**It is called Chapters, never Arc.** `STORY_GENERATION_FLOW.md` §1 bans `Arc`
from the interface, and the design that asked for a "story arc with regenerate"
was generated from `research/R2-onboarding-conversion.md`, which predates that
decision. Per-beat regeneration was also refused: it costs a model call per tap
and a beat rewritten alone stops setting up the one after it. Beats are instead
editable by hand - free, instant, local - and `Try another` swaps the whole plan
for the next precomputed variant, rendering only when one exists.

**One call, not two.** Onboarding needs a title and 120-180 words of real opening
that the Create studio does not. Rather than a second request, `shape-story`
takes a `variant` and widens its schema. Onboarding stays inside the one-model-call
budget in `ONBOARDING_FLOW.md` §16.

**The writer path.** `expo/src/screens/WriterOnboarding.tsx` runs idea, details,
email, crafting, blueprint, preview, paywall, one-time offer, notifications,
welcome, and hands the result to `CreateStudioScreen` as a pre-filled draft.
Generation is never automatic on arrival: the user presses `Create · 3 ✦`
themselves, so a bounce cannot silently spend a whole welcome grant.

**The crafting wait** is ported from an HTML prototype to Reanimated 4 and
`react-native-svg`, with hex values replaced by theme tokens. Its progress bar is
driven by real stage transitions and is hidden entirely in the one place where
there is nothing to measure - a single request whose stages the provider does not
report. Cycling the stage names there is truthful; a bar measuring them would not
be.

**Push.** `push_tokens` (migration `00037`), `register-push-token` and
`send-push`, over Expo Push rather than FCM and APNs directly. Receipts are read
and dead tokens pruned: acceptance is not delivery, and a sender that ignores
`DeviceNotRegistered` accumulates dead tokens until the project is throttled. The
permission ask is a soft pre-prompt, because iOS grants exactly one system dialog
per install. `POST_NOTIFICATIONS` is declared explicitly in `app.json`.

**Credits.** The welcome bonus is now 10 and the guest bootstrap is a separate
3-credit grant under `guest_bootstrap:{user_id}`. They diverge deliberately: the
named grant is protected by Apple / Google / email, the guest grant only by a
network-prefix limit of three per 24 hours, and three grants of 10 per network
per day against an unauthenticated surface is a farm. **The §2 Writer-yearly
40%-margin row has not been re-run against 10** and that is the open item this
change carries.

**Referral redemption** is deep-link attribution with a code field in Profile as
the fallback. There is no code field on the paywall and there will not be: it
tells every user without a code that someone else pays less, and the referral
pays credits rather than a discount, so a code entered there has nothing to act
on.

- Local verification: 217 Deno tests pass, `deno check` passes for every edge
  function, `deno fmt --check` passes for `_shared`. Expo typecheck passes, lint
  reports 0 errors (19 pre-existing warnings in legacy `.jsx`), and 85 Jest tests
  pass across 11 suites. No deployment, and no EAS build, so push has not been
  exercised against real APNs or FCM credentials.

## 2026-09-06: Create Flow Density Follow-Up

- Tightened the Expo Create studio single-screen layout after review feedback:
  Kids Mode now sits to the left as a native `Switch`, Genre stays on the right
  as a compact icon chip, and the genre list opens as an overlay instead of
  pushing the story form down.
- Removed the large brief-strength block from the form and replaced it with a
  small strength percentage under the final `Create` CTA.
- Reworked More Options into one compact family: chapters and chapter length use
  wrapping chips, Avoid appears before Visibility, Visibility is a native switch,
  and adult spice controls show three icon slots while keeping the unsupported
  explicit slot disabled.
- Verification: `pnpm typecheck` passed, focused Create/API Jest tests passed,
  and `pnpm exec expo export --platform web --output-dir /tmp/katha-create-flow-export-check`
  compiled successfully. `pnpm exec expo-doctor` passed 18/18 checks when run
  with the local Node/npm bin path on `PATH`. No backend code was changed in this
  pass.
## 2026-09-06: Onboarding/Create Design Consistency Pass

- Aligned the main Create and writer onboarding section headers around one black uppercase treatment, keeping primary screen titles separate.
- Standardized starter prompt rails to a mid-size preview chip across onboarding and Create, with the full starter still applied when selected.
- Changed writer onboarding chapter count and chapter length controls from wide segmented bars to wrapping chip groups.
- Flattened local back controls to a plain leading chevron treatment and normalized primary CTA height/radius to the leaner 56-point button style.
- Converted the legacy onboarding OTP UI to the same single-field code entry pattern used by the writer sign-in path.
- Verification: Expo typecheck passed, focused Create/writer-onboarding Jest tests passed, and the web export compiled. `expo-doctor` passed 15/18 checks but the remaining 3 failed because this shell cannot provide `npm` to Expo Doctor's dependency-tree checks.

## 2026-09-06: Writer Onboarding Filter Chip Follow-Up

- Lightened writer onboarding starter prompt card text to match the muted prompt-preview treatment in the main Create flow.
- Replaced the always-visible chapter and chapter-length chip rows with selected filter chips that expand into option menus.
- Updated the details-screen section labels to match the Create `Try one` typography: black, uppercase, Hanken, compact, and separate from the primary heading.
- Changed the Moments composer action to an icon-only plus button.
- Verification: Expo typecheck passed, focused writer-onboarding Jest tests passed, and web export compiled.

## 2026-09-06: Threaded Comments, Voting, Reporting, and Blocking Schema

**Migration `backend/supabase/migrations/00043_threaded_comments_moderation.sql`
is written but NOT applied.** No `supabase db push`, `migration up`, or any
other command touched the live project (`iafeuxgoiknncgyjmugd`). Applying it
is a separate, explicit decision for later.

- **Threading**: `comments.parent_id` self-references with `on delete
  cascade`, but that path is reserved for leaf comments and admin/service
  purges. The primary "delete my comment" path is a soft delete
  (`deleted_at`), because a real DELETE cascading through `parent_id` would
  destroy every reply underneath. A `before update` trigger scrubs `content`
  to `'[deleted]'` the moment `deleted_at` is first set. An earlier draft
  additionally hid reply-less tombstones from the SELECT policy; that draft
  does not work, because Postgres requires an UPDATE's *new* row to still
  satisfy the table's SELECT policy, so a policy that hides a row once
  `deleted_at` is set makes the very UPDATE that sets it fail with
  "new row violates row-level security policy" for exactly the comments a
  leaf-delete needs to hide. Caught by the companion test against a real
  Postgres, not by inspection. Visibility now never depends on `deleted_at`;
  only content does.
- **Depth guard**: `depth smallint` capped at `[0, 7]` (eight nesting levels),
  maintained by an insert trigger from the parent's stored depth (no
  recursion needed). `parent_id` is immutable after insert so a stored depth
  is never invalidated by a later re-parent. The cap exists both as a DoS
  bound on subtree reads and because eight levels of indent already consumes
  a large fraction of a phone-width screen in this mobile-first product.
- **Voting**: `comment_votes` with `primary key (user_id, comment_id)` makes
  double-voting impossible at the DB level. `comments.score` is a
  denormalized total maintained by a trigger on vote insert/update/delete, so
  sorting a thread by score never needs a live `count(*)` join. A similar
  `reply_count` denormalization avoids a live count for "N replies" UI.
- **Reporting**: one `content_reports` table, polymorphic over `story_id`
  and `comment_id` via two nullable real foreign keys plus a CHECK requiring
  exactly one to be set (not a typeless `target_type`/`target_id` pair, and
  not two separate tables — moderation needs one queryable, status-tracked
  queue). Two partial unique indexes make a duplicate report from the same
  reporter against the same target impossible. The INSERT grant is
  column-scoped to `(reporter_id, story_id, comment_id, reason, details)` —
  `status` and `reviewed_at` are excluded from the grant entirely, and there
  is no SELECT/UPDATE/DELETE policy for `authenticated` at all, so a
  reporter can file a report but never read it back or influence its
  moderation status.
- **Blocking**: `user_blocks` with `primary key (blocker_id, blocked_id)` and
  a CHECK against self-blocking. Recorded but not yet enforced anywhere:
  `backend/supabase/functions/feed/index.ts` will need a follow-up change to
  exclude blocked authors' stories from a viewer's feed. That function was
  not touched in this pass.
- **RLS**: every new table has RLS enabled and at least one policy (verified
  by inspection — a table with RLS on and no policy denies everything, which
  is the easy mistake to make). Existing `comments` grants were narrowed:
  INSERT is now column-scoped (excludes `depth`, `score`, `reply_count`,
  and the unrelated `request_id`/`reward_granted` columns from 00005), and
  new UPDATE/DELETE grants are scoped to `(content, deleted_at)` and full
  delete respectively.
- **Companion test**: `00043_threaded_comments_moderation_test.ts`, in the
  same PGlite-against-every-migration style as `00038`/`00039`/`00040`.
  7 tests, all passing: double-vote rejected (23505 on the primary key),
  self-block and duplicate-block rejected (23514 / 23505), duplicate report
  rejected (23505) and unreadable back (42501), a reporter cannot smuggle a
  non-default `status` into an insert (42501), depth capped at 8 levels
  (P0001 past that), the score trigger's arithmetic across insert/flip/
  remove, and the tombstone-scrub-not-hide behavior for both a comment with
  a live reply and a reply-less leaf.
- Verification: `deno test` over every `*_test.ts` in
  `backend/supabase/migrations/` — 36 tests pass, including all pre-existing
  suites (00005 through 00040) with no regressions, confirming the full
  00001→00042 chain applies cleanly against a fresh Postgres (via PGlite).
  `deno fmt --check` passes on the new test file. No `deno check`/lint was
  run against edge functions since none were touched. Nothing was applied to
  the live Supabase project.

## 2026-09-06: Writer Onboarding Preview and Paywall Alignment

- Finished the writer onboarding consistency pass: progress bars now appear on
  the idea and details screens, the details title is shortened to "Shape the
  Story", section labels stay on the black compact eyebrow treatment, and the
  primary details CTA is now "Create my story".
- Kept chapters and chapter length as filter chips with dropdown menus, placed
  chapter length first on the same row as chapters, and left longer chapter
  counts using the existing shaped-beat teaser instead of inventing a separate
  arc field the generation prompt does not consume.
- Polished the idea-strength line, starter prompt cards, genre filter chip
  weight, "Who's in it?" affordance, icon-only moment add button, preview
  entitlements, and minimal CTA glow.
- Replaced the raw Writer paywall with the story summary card, benefit list,
  weekly/yearly plan cards, trial badge, and "Create my story" CTA.
- Verification: `pnpm typecheck` passed, focused writer-onboarding Jest tests
  passed, full Expo Jest suite passed (20 suites / 238 tests), and Expo web
  export compiled. `expo-doctor` still passes 15/18 only because this shell
  cannot spawn `npm` for its dependency-tree checks (`spawn npm ENOENT`).
  Local web was opened at `http://localhost:8090/` and checked at 390 x 844.
  Mandatory security scan completed; it found no new UI/auth issues, and the
  blocking `image-size` audit advisories are locally patched with pnpm
  `patchedDependencies` plus targeted GHSA ignores because the advisory's
  patched `2.0.3` version is not published on npm.

## 2026-09-06: Writer onboarding consistency and paywall pass

### Changed

- Resolved the PR review's comments/moderation blockers before merge: successful
  comment posts now return `{ comment }`, feed fails closed if the read-count
  query fails, frontend report reasons use the backend enum, comment write/vote
  failures no longer replace a loaded thread with a load error, repeated vote
  taps are serialized per comment, and block failures stay on the sheet instead
  of navigating away as if the block worked.
- Aligned the writer onboarding flow to the in-app create UI: early screens now
  show the same progress treatment, section labels use the darker compact
  heading style, starter prompts use quieter helper-weight text, and the idea
  strength line is smaller than the prompt box copy.
- Changed Moments to an icon-only add action and added a help marker beside
  "Who's in it".
- Replaced the Chapters and Chapter Length segmented controls with dropdown
  filter chips in one row, with Chapter Length first.
- Reworked the preview/paywall handoff: preview continues into a story-specific
  writer paywall with the concept card, credit explanation, weekly/yearly
  choices, and "Create my story" CTA. Longer chapter-count selections keep the
  same teaser pattern instead of requiring a longer generated arc.

### Verification

- `pnpm typecheck` passed from `expo/`.
- Focused ESLint passed for `WriterOnboarding` and its tests.
- Focused writer onboarding tests passed: 2 suites, 79 tests.
- Focused review-fix tests passed: 6 suites, 107 tests.
- Full Expo Jest suite passed: 25 suites, 268 tests.
- Web export compiled to
  `/tmp/katha-writer-onboarding-paywall-export-check`.
- Backend migration/comments/feed tests passed: 58 tests.
- `pnpm exec expo-doctor` still passes 15/18 checks; the remaining checks fail
  because this shell cannot spawn `npm` (`spawn npm ENOENT`).
- Mandatory security scan completed. No new secrets/auth/injection issues were
  found in this UI pass. The only high audit findings were the known
  transitive `image-size` parser advisories through Expo/Metro; they are
  locally patched with pnpm `patchedDependencies` and the audit ignores are
  tied to that patch because `image-size@2.0.3` is not published.
- Local URL `http://localhost:8090/` was opened and returned `200 OK`.
- No production infrastructure was tested or deployed in this pass.

## 2026-09-07: Engagement persistence RPCs and Edge Functions

### Changed

- Added migration `00046_engagement_persistence.sql` for real likes,
  bookmarks, story follows, author follows, reads, and streak touches.
- Replaced broad relationship-table read policies with own-row RLS policies
  and added service-role-only `security definer` RPCs for idempotent toggles,
  `record_story_read`, and `touch_streak`.
- The story like, story follow, and read RPCs move the relationship row and
  denormalized `stories` counter under one transaction-level advisory lock;
  duplicate likes/follows and no-op unlikes/unfollows do not move counters.
- `record_story_read` enforces one persisted read per user/story/chapter within
  24 hours, marks author self-reads as `counts_for_earnings = false`, and only
  counted reads increment `stories.read_count`.
- `touch_streak` increments once per UTC calendar day, resets after a missed
  day, raises `longest_streak` without lowering it, and deliberately leaves
  `next_credit_at` untouched because streak credits are parked for this build.
- Added Edge Functions `like`, `bookmark`, `follow-story`, `follow-user`, and
  `record-read`, all using auth, UUID validation, service-role RPC calls, CORS,
  and persistent engagement error logging.
- `feed` now includes viewer relationship flags on the main feed and continue
  reading rail. `library` includes the same flags when called with a valid
  viewer JWT, while unauthenticated reads keep the existing public path.

### Verification

- `deno test --allow-env --allow-net --allow-read supabase/functions` passed:
  468 tests, 0 failed. This is up from the task baseline of 464 because
  `_shared/engagement.test.ts` adds 4 handler tests.
- `deno test --allow-env --allow-net --allow-read supabase/migrations` passed:
  53 tests, 0 failed. `00046_engagement_persistence_test.ts` adds 9 migration
  tests covering duplicate likes, no-op unlikes, concurrent-safe like shape,
  clean self-follow refusal, 24-hour read dedupe, author self-read earnings
  exclusion, once-daily streak touches, longest-streak monotonicity, and
  relationship RLS.
- `deno check` passed on every touched TypeScript file.
- `deno fmt --check` passed on every touched TypeScript file.
- No production-level test was run, so no `public.error_events` rows were
  written.
- Not pushed or deployed.

## 2026-09-06: Comment vote RPC review fix

### Changed

- Added `public.set_comment_vote(comment_id, value)` to migration 00043 and
  routed the comments Edge Function through it. Cast, change, and clear now
  happen inside one database call, while the existing vote score trigger
  remains the only writer of `comments.score`.
- Updated the comments SQL tests to exercise the RPC path, including clearing
  a vote back to zero.

### Verification

- `deno check backend/supabase/functions/comments/index.ts
  backend/supabase/functions/feed/index.ts` passed.
- `deno test --allow-read --allow-write --allow-env --allow-net
  backend/supabase/migrations/*_test.ts
  backend/supabase/functions/comments/index.test.ts
  backend/supabase/functions/feed/index.test.ts` passed: 59 tests.
- `pnpm typecheck` passed from `expo/`.
- Focused ESLint on the touched Expo files passed.
- `pnpm test --runInBand` passed from `expo/`: 25 suites, 268 tests.
- `EXPO_NO_DOTENV=1 pnpm exec expo export --platform web --output-dir
  /tmp/katha-onboarding-final-export-check` passed. Sentry warned about
  missing organization/project config, which is pre-existing local setup.
- `pnpm exec expo-doctor` still reports 15/18 checks passing and fails the
  three local package-manager checks because this shell cannot spawn `npm`.
- Security gate: secret-pattern scan found only documented placeholders/public
  config references. `pnpm audit --audit-level high` exited clean with the two
  known high `image-size` advisories ignored under the local parser patch
  documented in this session.

## 2026-09-07: Onboarding shape-story now receives the full writer brief

### Changed

- Extended the onboarding `shape-story` prompt contract to accept sanitized characters, moments, writing style, avoid text, chapter length, and planned chapter count.
- The onboarding prompt now explicitly preserves creator-supplied character names and returns a beat for each selected planned chapter count.
- `shape-story` normalizes the added fields before building the prompt; production story generation was already using these variables through `generate-story` and `generate-story-stream`.

### Verification

- `deno check supabase/functions/shape-story/index.ts supabase/functions/_shared/story-shape.ts` clean.
- `deno test --allow-env --allow-net supabase/functions/_shared/story-shape.test.ts`: 17 tests passing.
- No production-level test was run, so no `public.error_events` rows were written.
- Not pushed or deployed.

## 2026-09-06: The comments function, and blocked authors leave the feed

### Changed

- Added `supabase/functions/comments/index.ts`. One function: `GET` reads a
  story's thread as flat rows plus the caller's own vote on each; `POST` with
  an `action` handles post, vote, report, block and unblock. Every call runs on
  the anon key plus the CALLER'S JWT, so the RLS in migration 00042 is the real
  security boundary - there is no service-role client in the file to bypass it.
- Voting is insert-then-catch-23505-then-update rather than an upsert, because
  00042 grants UPDATE on `value` only; an upsert would need privileges on
  `user_id` and `comment_id` that are deliberately not granted. The score is
  owned by a trigger and never adjusted in application code, or it would count
  twice.
- Duplicate reports and duplicate blocks return a clean already-done success
  rather than a 500 from the unique index. Unblock exists: a block a user
  cannot undo is a trap.
- `supabase/functions/feed/index.ts` now excludes stories by authors the caller
  has blocked, in BOTH feed paths, filtered inside the query rather than after
  the page slice. Filtering after the slice would short-page the blocker and
  start skipping rows on deeper pages. A caller with no blocks issues a
  byte-identical query to before, and anonymous callers pay nothing.

### Verification

- `deno check` clean on both functions.
- `comments`: 18 tests passing. `feed`: 4 tests passing. Migrations: 36 passing,
  no regressions. All against PGlite - real Postgres, no network.
- NOTHING was run against the live project `iafeuxgoiknncgyjmugd`. Migration
  00042 remains WRITTEN BUT NOT APPLIED and neither function is deployed.
- Not covered by tests: the HTTP entrypoint itself - CORS, JSON parse failures,
  the `auth.getUser()` flow and action dispatch are covered by inspection only,
  because PGlite speaks Postgres rather than the PostgREST wire protocol.

## 2026-09-07: The narration voice library - generate on first play, not at publish

### Changed

- Finished a bucket a previous session left mid-flight. `_shared/narration-entitlement.ts`
  and `_shared/narration-audio.ts` were already started; this session built on
  both rather than restarting, and completed migration `00048_voice_library.sql`
  which was already partly written.
- `00048_voice_library.sql`: `voices` (the allowlist as data - id, display name,
  language, gender, tier, provider, provider voice params, preview path, sort
  order, is_active) seeded with exactly today's 8 ids so behaviour is preserved;
  4 English voices marked `premium` per the existing contract, the other 4
  `standard`. `chapter_audio` (one row per chapter+voice - storage path,
  duration, word count at generation time, provider job id, status, generated_at)
  with a unique constraint on `(chapter_id, voice_id)` and a check constraint
  tying `status = 'ready'` to both `storage_path` and `generated_at` being set -
  which is also what forces a retry to clear both rather than leaving a stale
  path on a `pending` row. `chapters.audio_url` is untouched and commented as a
  later migration's job once nothing reads it; the migration backfills every
  existing value into a `ready` `chapter_audio` row for `aria`. RLS: `voices`
  readable by `authenticated`, `chapter_audio` readable when the reader can read
  the chapter (author, or published + public/curated) - both service-role write
  only.
- `claim_chapter_audio_generation(chapter_id, voice_id, storage_path, word_count)`:
  the one place two concurrent "generate this" requests are serialized. It takes
  an advisory lock keyed on `(chapter, voice)` plus `select ... for update`,
  returns `claimed: false` against an existing `pending` or `ready` row, and
  resets a `failed` row back to `pending` (clearing `storage_path`,
  `provider_job_id`, `generated_at`) so a retry is possible without a second row
  ever existing for the same pair.
- `_shared/voices.ts` rewritten: `STATIC_VOICES` (8 entries, mirrors the
  migration's seed) is now the fallback rather than the whole story;
  `listVoices()` / `getVoiceRecord()` read `public.voices` and fall back to the
  static list on a missing client, a query error, or an empty result, so a
  database hiccup narrows the picker instead of breaking narration. Every
  caller on the audio path goes through these two functions.
- `_shared/narration-audio.ts` gained `getChapterAudioRow()` (any status, for
  polling) alongside the existing `findReadyChapterAudio()` (ready only, for the
  cache-hit path), and `storageObjectExists()` (used to make preview seeding
  idempotent).
- `generate-audio/index.ts` rewritten. A ready `chapter_audio` row (or, as a
  pre-backfill safety net, a legacy `chapters.audio_url` on the default voice)
  is returned without touching RunPod. A miss asks `canGenerateNarration()`
  first - closed by default, unchanged from today - and only then claims the
  row and starts a RunPod job; a caller who loses the claim reports the winner's
  in-flight generation instead of starting a second one. Access is now "can this
  user read the chapter" (author, or a published chapter on a public/curated
  story), not "is this user the author" - the function was effectively
  unreachable by ordinary readers before this.
- `audio-status/index.ts` rewritten to resolve against `chapter_audio` instead
  of guessing a storage path, which is what actually lets it poll RunPod at
  all now - `AGENTS.md` recorded the missing durable job binding as the reason
  it couldn't. A `ready` or `failed` row answers directly; a `pending` row with
  no `provider_job_id` yet reports pending without polling; a `pending` row with
  a job id polls RunPod once and uploads + marks `ready`, or marks `failed` with
  the provider's error code, on that one call.
- Two new functions. `voices` (GET, authenticated): active voices for an
  optional `language` filter, with `tier` and a `preview_url` resolved from
  `preview_path`. `seed-voice-previews` (POST, service-role only - the caller's
  bearer token is compared to `SUPABASE_SERVICE_ROLE_KEY` in constant time):
  generates the one missing preview clip per voice, checked via
  `storageObjectExists()` before ever starting a provider job, so a repeat run
  costs nothing for a voice that already has one. Neither `generate-audio` nor
  `audio-status` generates a preview on their read path.
- edge-tts-provider voices (`elvira`, `alvaro`) hit a typed
  `edge_tts_not_implemented` failure on the fresh-generation and preview paths
  rather than silently claiming a job started - `_shared/edge-tts.ts` still
  returns `null` unconditionally, unchanged by this session.

### What this does not do

- No pricing, unlock, grant, or credit-ledger read/write anywhere in this
  bucket. `canGenerateNarration()` is the only place that decision is asked,
  and its body still returns today's flag-gated refusal - the credits session
  replaces the body of that one function and nothing else on this path.
- Voice `tier` is stored and served, but nothing enforces it yet - a caller
  can request a `premium` voice today and generation proceeds if the
  entitlement gate is open. Tier enforcement is credits-session work.
- `NARRATION_GENERATION_ENABLED` is unset in every environment, so production
  behaviour is unchanged by this merge - the same refusal, the same 503.

### Verification

Run from `/Users/mac16/Katha-AI-wt-backend/backend` with
`export PATH="/Users/mac16/.deno/bin:$PATH"`:

- `deno test --allow-env --allow-net --allow-read supabase/functions`:
  **525 passed, 0 failed** (baseline before this session: 468).
- `deno test --allow-env --allow-net --allow-read supabase/migrations`:
  **66 passed, 0 failed** (baseline before this session: 53; the 13 new tests
  are all in `00048_voice_library_test.ts`). Real Postgres via PGlite, no
  network - includes RLS as both `anon` and `authenticated`, the unique and
  check constraints, the claim RPC's dedup and retry behaviour proven directly
  against the function (not simulated), and the backfill proven by applying
  every migration up to but excluding `00048`, seeding a legacy
  `chapters.audio_url` by hand, then applying `00048` and reading back the
  `chapter_audio` row it produced.
- `deno check` and `deno fmt --check` clean on every file this session touched
  or added (17 files: the 3 handed off plus 14 more).
- The concurrency property ("two readers pressing Listen at once cost one
  generation") is proven at two levels: the SQL claim function directly in the
  migration test, and the HTTP handler's response to a `claimed: false` result
  in `generate-audio/index.test.ts` - true wall-clock concurrency isn't
  reachable through a stubbed single-threaded `fetch`, so the handler test
  proves the handler obeys the claim rather than proving the claim itself is
  atomic; the migration test proves that.
- NOTHING was run against the live project `iafeuxgoiknncgyjmugd`. Migration
  `00048` is written but not applied there, and none of the five touched or
  added functions (`generate-audio`, `audio-status`, `voices`,
  `seed-voice-previews`, plus the shared modules) are deployed. No production-
  level test ran, so no `public.error_events` rows were written this session.
- Not committed. Changes are left in the working tree per instructions.

## 2026-09-08 UTC — The v7 genre taxonomy: four new genres, seven quietly retired from the UI, and spice off the surface

### Changed

- **Taxonomy.** `_shared/types.ts` `PrimaryGenre` grows from 15 to 19 members:
  `educational`, `fanfiction`, `folktale`, `sliceOfLife` are new. Per product
  decision, the creation UI now shows exactly 12 genres in this order --
  Adventure, Comedy, Educational, Fanfiction, Folktale, Historical, Sci-Fi,
  Fantasy, Mystery, Horror, Slice of Life, Romance (Romance deliberately last)
  -- captured as `UI_GENRE_ORDER`. `UI_GENRES` (the membership set) drops
  `romantasy`, `darkRomance`, `paranormalRomance`, `cozyFantasy`, `poetry`,
  `thriller`, `contemporary`. None of the seven were removed from
  `PRIMARY_GENRES`, the check constraint, or `GENRE_VOICES` / `GENRE_PROMPTS` --
  they follow the precedent this repo already set for `cozyFantasy` and
  `paranormalRomance` before today: DB-valid, UI-hidden. A story already
  written in one keeps reading, continuing and rendering in that genre's own
  voice module forever.
- **The migration map is now the enforcement point, not a passthrough.**
  `GENRE_MIGRATION_MAP` gained seven entries for NEW submissions only: `thriller`
  -> `mystery`, `contemporary` -> `sliceOfLife`, `poetry` -> `folktale`,
  `romantasy`/`darkRomance`/`paranormalRomance` -> `romance`, `cozyFantasy` ->
  `fantasy`. `validation.ts`'s `normalizeGenre` had to change precedence to make
  this work: it now checks the migration map *before* the already-valid-genre
  shortcut, because all seven removed genres are still members of
  `PRIMARY_GENRES` and the old precedence (exact match wins) would have let
  every one of them pass straight through unmigrated. The two stale
  `sliceOfLife`/`sliceoflife` -> `contemporary` migration-map entries were
  deleted, since `sliceOfLife` is now a real genre and redirecting it would make
  the new genre unreachable. Same fix applied to the `sliceoflife` alias inside
  `cover-prompts.ts`'s own, separate `normalizeGenre`.
- **Kids-mode blocking had to be decoupled from the migration on purpose.**
  `darkRomance`, `paranormalRomance` and `thriller` are exactly the genres the
  new migration redirects away from their own identity, so the pre-existing
  kids-mode safety check (which ran on the *migrated* `primaryGenre`) would
  have gone silently unreachable -- a kids-mode request for `darkRomance` would
  have quietly become a sweet romance story instead of being refused. Added
  `kidsBlockedLabel()`, which checks the RAW pre-migration genre string
  (primary and secondary) instead, so an explicit ask for a genre the kids
  interface never offered is still rejected, not softened. This is what keeps
  the pre-existing `darkRomance rejected in kids mode` test passing unchanged.
- **Four new genre voice modules** in `story-prompts.ts`'s `GENRE_VOICES`, same
  shape as the existing 15 (voice/pacing/whatWorks/whatToAvoid), matched for
  length and specificity. `educational` in particular states its own guardrail
  in-module ("if it reads like a worksheet with a plot bolted on, it has
  failed") rather than relying on the universal anti-slop rules by omission --
  the existing show-don't-tell and anti-lecture rules still govern every genre,
  but a genre whose whole premise risks becoming a lesson needed the reminder
  stated where the model reads it.
- **Four new cover prompt configs** in `cover-prompts.ts`'s `GENRE_PROMPTS`
  (style/palette/composition/mood/characterApproach). Exported
  `hasCoverPromptConfig()` so a test can assert no genre in the full taxonomy --
  removed-from-UI genres included, since an existing story's cover can still
  regenerate -- is missing one.
- **Spice leaves the product surface.** No code change was needed for the
  omitted-`spice_level` path -- `validateGenerationRequest` already defaulted
  it per genre (`GENRE_DEFAULT_SPICE[primaryGenre] ?? "sweet"`) and never
  rejected its absence -- but this session pins that behaviour with tests
  across all 19 genres and documents it as a deliberate, permanent contract
  rather than an accident of the existing code path. Spice inference from the
  story idea's own prose is a stated follow-up, not implemented here.
- **Migration `00049_genre_taxonomy_v7.sql`.** Widens
  `stories_primary_genre_check` to the 19-value set. Drops and re-adds the
  constraint (`NOT VALID` then `VALIDATE`), following `00014`'s precedent for
  this exact constraint. A widened CHECK constraint can never fail `VALIDATE`
  against existing data, so add-and-validate in one migration is safe here.
  Does not touch `spice_level` or `content_rating`, which are unaffected by a
  genre change. Migrations `00045`-`00048` were left untouched per instructions.
- `story-shape.ts`'s hardcoded genre list (fed to the free shaping LLM call) now
  renders from `UI_GENRE_ORDER` instead of a stale literal string, so shaping
  never suggests a shelf the creator cannot see or edit into, and this list
  cannot drift from the taxonomy again.
- `source-of-truth/STORY_PROMPT_SYSTEM.md` and `AGENTS.md`'s Taxonomy section
  updated in the same session: genre counts, the UI table split into "shown"
  and "removed, still valid" halves, the spice-and-genre matrix, four new
  Genre Modules subsections, the migration map, and the spice-off-the-surface
  decision. `AGENTS.md`'s Cover Image System genre-config table also gained the
  three genres it was missing (the fourth, `sliceOfLife`, already had a stale
  but strikingly on-target row from an earlier draft of this same idea).

### What this does not do

- No spice inference from prose. `spiceLevel` stays exactly where it was in the
  contract, the prompt system, and stored rows; only its required-ness changed
  (it already wasn't required, and now that is documented and tested as
  intentional rather than incidental).
- No UI change. `expo/` was explicitly out of scope for this session and was
  not touched; the sibling client-side bucket is responsible for the actual
  12-card creation shelf, its labels, and its icons.
- No data migration or backfill. Every existing story keeps its stored genre
  value exactly as it was; nothing was UPDATEd.

### Verification

Run from `/Users/mac16/Katha-AI-wt-backend/backend` with
`export PATH="/Users/mac16/.deno/bin:$PATH"`:

- `deno test --allow-env --allow-net --allow-read supabase/functions`:
  **571 passed, 0 failed** (measured baseline before this session: 544 --
  the task brief's stated baseline of 476 does not match this worktree, which
  already carries the entity-grounding, phrase-pillar and voice-library
  buckets merged into `integration/all`; 544 is the real number this session
  started from and is reported instead of the brief's stale figure).
- `deno test --allow-env --allow-net --allow-read supabase/migrations`:
  **78 passed, 0 failed** (measured baseline before this session: 74, same
  caveat as above against the brief's stated 66). The 4 new tests are all in
  `00049_genre_taxonomy_v7_test.ts`, run against real Postgres via PGlite --
  each new genre plus each removed-from-UI genre inserts cleanly, an
  unaffected genre still inserts cleanly, and a genre outside the full
  taxonomy still gets `23514` (check_violation).
- `deno check` and `deno fmt --check` clean on every file this session touched
  or added (11 TypeScript/SQL files: `types.ts`, `types.test.ts` (new),
  `validation.ts`, `validation.test.ts`, `story-prompts.ts`,
  `story-prompts.test.ts`, `cover-prompts.ts`, `cover-prompts.test.ts`,
  `story-shape.ts`, `00049_genre_taxonomy_v7.sql` (new),
  `00049_genre_taxonomy_v7_test.ts` (new)).
- NOTHING was run against the live project `iafeuxgoiknncgyjmugd`. Migration
  `00049` is written but not applied there, and no function was deployed. No
  production-level test ran, so no `public.error_events` rows were written
  this session.
- Not committed. Changes are left in the working tree per instructions.

## 2026-09-08 UTC — Genre craft research applied: folktale, educational, fanfiction rewritten; mystery absorbs thriller; sliceOfLife inherits contemporary

### Context

Three research memos (`docs/research/folktale.md`, `docs/research/educational.md`,
`docs/research/fanfiction.md`) evaluated the first-pass `GENRE_VOICES` modules
the v7 taxonomy change shipped for these genres against actual folklore
scholarship, craft-research literature on didactic fiction, and fifty years of
fandom's own critical vocabulary. This session applies the three revised
modules, plus two product-owner-approved inheritances, and documents both.

### Changed

- **`.gitignore`.** `docs/research/` and `docs/design/` were caught by the
  blanket `research/`/`design/` rule added for "agent working artifacts...
  local only" (2026-09-03). Narrowed, not removed: added
  `!docs/research/`, `docs/research/*`, `!docs/research/*.md` so the three
  memos (and any future markdown memo placed there) are tracked, while any
  non-markdown file in `docs/research/` and everything under `docs/design/`
  stay gitignored exactly as before.
- **`GENRE_VOICES.folktale`, `.educational`, `.fanfiction`** replaced with the
  modules each memo proposed, adjusted only for house style: no em dashes, no
  live `BANNED_WORDS` entries quoted verbatim (the shipped educational module
  quoted "delve" as an example of textbook diction; the new whatToAvoid
  describes the failure mode instead of naming the banned word). Folktale's
  module additionally names, in its own text, each global craft rule it
  suspends and why (Show Don't Tell for interiority, Sentence Rhythm for
  patterned repetition, the general anti-cliche instinct and the "don't
  resolve too neatly" pacing rule for a formulaic open/close) rather than
  silently contradicting them -- the research documented these as genuine,
  citable collisions (Propp, Luthi, oral-formulaic theory) where folktale
  should win, and the brief required the carve-out to be visible in the
  assembled prompt, not just implied.
- **`GENRE_VOICES.mystery`** rewritten to merge in thriller's engine.
  Thriller is retired from the picker and `GENRE_MIGRATION_MAP.thriller` now
  points new submissions at mystery, so mystery had to cover both engines
  (puzzle-and-revelation, dread-and-momentum) or a migrated thriller idea
  would land on puzzle-only craft it wasn't written for. This was craft
  editing, not concatenation: four fields, same length and register as every
  neighbouring module, each one carrying both engines rather than listing
  them side by side. `GENRE_VOICES.thriller` itself is untouched -- it is
  dead code for new submissions but still the only module an existing
  thriller story reads (`story-prompts.ts`'s own genre lookup resolves a
  stored genre before ever consulting the migration map).
- **`CONTEMPORARY_VOICE`** extracted as a standalone constant, referenced by
  both `GENRE_VOICES.contemporary` and `GENRE_VOICES.sliceOfLife` (product
  decision: sliceOfLife inherits contemporary's module, they are not two
  texts that happen to match). Its four em dashes were replaced with colons
  while relocating it, for the same house-style reason as the three
  researched modules; the craft content is unchanged.
- **`GENRE_VOICES` and the `GenreVoice` interface are now exported** from
  `story-prompts.ts` (test-only use: equality and content assertions over
  genre craft; nothing else imports them).
- **`story-prompts.test.ts`**: updated the one pre-existing test whose
  distinguishing phrases no longer matched the rewritten text
  ("load-bearing", "already loves these characters", "oral and cadenced" were
  specific to the retired first-pass modules), and added nine new tests --
  each researched genre carries its own module text; sliceOfLife and
  contemporary are the same object (`===`) and render identical prompts;
  mystery's module names both engines; a migrated thriller submission
  (`GENRE_MIGRATION_MAP.thriller`) renders the mystery module; thriller keeps
  its own unmerged module; folktale names each suspended rule by the base
  layer's own rule names; and a scoped scan of the six modules this session
  touched for a literal em dash or a `BANNED_WORDS` entry (word-boundary
  match, case-insensitive). That last test is deliberately scoped to the six
  modules this session wrote or relocated (folktale, educational, fanfiction,
  mystery, contemporary, sliceOfLife) -- the twelve untouched legacy modules
  (romance, fantasy, romantasy, darkRomance, cozyFantasy, paranormalRomance,
  horror, scifi, adventure, historical, comedy, poetry) and thriller predate
  this house rule, still contain em dashes, and were explicitly out of scope
  for this session.
- **`source-of-truth/STORY_PROMPT_SYSTEM.md`**: Key v6 Decisions gained two
  bullets naming the research pass and the two inheritances; the Thriller,
  Mystery, Contemporary, Educational, Fanfiction, Folktale, and Slice of Life
  Genre Modules subsections were rewritten to describe the actual shipped
  text and cite their source memo; a new "Deferred Research Recommendations"
  section records the two recommendations this session did not implement
  (below).
- **`AGENTS.md`**: Repository Map gained a line for `docs/research/*.md`;
  the Taxonomy section gained two bullets mirroring the source-of-truth
  changes, at contract-summary length rather than full detail.

### What this does not do

- **Does not implement the educational memo's fact/fiction closing-disclosure
  mechanism** (docs/research/educational.md §3 Position 4, §4 Decision 4).
  The memo's own framing: prompt craft can reduce how often the model states
  something false with confidence, but only a visible, separately labeled
  fact/fiction seam protects a reader who cannot tell the difference from
  inside the story. That is a schema and product change (a new field,
  rendered outside the reading experience), not a prompt change, and is
  recorded as deferred in both source-of-truth docs rather than dropped.
- **Does not implement the fanfiction memo's grounding extension**
  (docs/research/fanfiction.md §3, §6 Decisions 3-5): a new
  `fandom_canon_character` `EntityClass`, a `needs_grounding` test tuned to
  OOC risk instead of obscurity, and new `GroundingCard` fields (speech
  pattern, canon-versus-fanon, relationship state). This is real, scoped work
  a sibling agent owns separately. Per the task's hard constraint, this
  session did not touch `grounding-types.ts`, `entity-classify.ts`,
  `grounding-card.ts`, `grounding-pipeline.ts`, or `publish-story/`.
- **Does not touch `GENRE_VOICES.thriller`** or any of the twelve untouched
  legacy modules. Only the six modules named above were edited.
- **Does not apply any migration.** No `.sql` file was added or changed;
  this session's scope was `_shared/story-prompts.ts`, its test file,
  `.gitignore`, and documentation.

### Verification

Run from `/Users/mac16/Katha-AI-wt-backend/backend` with
`export PATH="/Users/mac16/.deno/bin:$PATH"`:

- `deno test --allow-env --allow-net --allow-read supabase/functions`:
  **baseline 571 passed, 0 failed** (measured before any change this
  session) -> **580 passed, 0 failed** after (the nine new tests listed
  above; no test count dropped, no existing test was weakened to pass).
- `deno test --allow-env --allow-net --allow-read supabase/migrations`:
  **78 passed, 0 failed**, unchanged from baseline -- this session touched
  no migration.
- `deno check` and `deno fmt --check` clean on both files this session
  touched: `supabase/functions/_shared/story-prompts.ts` and
  `supabase/functions/_shared/story-prompts.test.ts`.
- `git status`: `docs/research/folktale.md`, `docs/research/educational.md`
  and `docs/research/fanfiction.md` are staged (`git add`), no longer
  gitignored or untracked.
- No `any`, no `@ts-ignore` in either touched file (checked by grep; the only
  matches are the English word "any" inside prose strings).
- Not committed, per instructions.
## 2026-09-08: Rate-limit the grounding fallback, without reordering it

### Changed

- Closed the residual finding on `generate-story` / `generate-story-stream`:
  `resolveGrounding`'s fallback branch (the unshaped Create-studio path, where
  the client sent no cards) now runs behind a cheap per-caller rate limit
  instead of unconditionally. The finding was that a request
  `begin_story_generation` was about to reject - no credits, a replay - had
  already paid for an LLM classification call by the time that rejection was
  known, and a caller with no credits could replay that for free.
- The fix does NOT move `resolveGrounding` after `begin_story_generation`. That
  ordering is deliberate and stays: the fallback promise is still created and
  running before `begin_story_generation` is awaited, so it still overlaps that
  RPC's measured 1.4-2.2s round trip. What changed is what the promise does
  first internally - a rate-limit check, then (only if allowed) the
  classification - rather than adding latency to the line that starts it.
- New migration `00051_grounding_fallback_rate_limit.sql`: table
  `grounding_fallback_rate_limits` (per `user_id`, 8 requests / 10 minutes) and
  `anonymous_grounding_fallback_rate_limits` (per hashed network scope, 15
  requests / 60 minutes, reusing the `anonymousGrantScope` fingerprint 00035
  already computes for guest bootstrap - a fresh anonymous JWT is free to mint,
  so a per-`user_id` counter alone does not bound that). RPC
  `claim_grounding_fallback_request(p_user_id, p_anonymous_scope_hash)` checks
  the network scope first, then the per-user counter, so a request already
  refused at the network level never consumes per-user budget it cannot use.
  No global daily table, unlike 00034/00035: those protect a paid resource
  (a free credit grant, a shaping call open to every visitor); this protects an
  LLM call that still sits in front of the credit check the caller has to pass
  to get anything paid-for, and the per-network cap is already the bound that
  matters.
- New `_shared/grounding-rate-limit.ts`: `claimGroundingFallback()` wraps the
  RPC, computing the anonymous scope hash the same way `shape-story` already
  does via `guest-bootstrap.ts`. Never throws. Fails CLOSED (skip grounding,
  generate ungrounded) on a missing anonymous network header, an RPC error, or
  a thrown exception - the same posture every other failure path in the
  grounding system already has, and the correct default for a guard that must
  never cost more than the thing it protects. Telemetry on a DB error is fired
  without being awaited (`void logError(...)`), so a broken check cannot itself
  add up to logError's 1.5s timeout to a promise chain the writer is waiting on.
- Both call sites gate the fallback with `needsGroundingFallback` (the same
  "client sent no cards" condition the code already had) before ever calling
  `claimGroundingFallback`, so a client that supplied grounding cards makes
  zero rate-limit RPC calls, exactly as it made zero `resolveGrounding` calls
  before this change.

### Numbers chosen, and why

- Per-user: 8 requests / 10 minutes. The fallback fires at most once per
  `generate-story` call, and most real Create-studio generations do not repeat
  eight times in ten minutes even accounting for retries after a failure;
  eight caps a credit-less loop at 48/hour on one session.
- Anonymous network scope: 15 requests / 60 minutes. Wider window and slightly
  higher count than the per-user limit because it has to cover several genuine
  people sharing one connection, not one caller - but it still caps a script
  that mints a fresh anonymous session per request to 15 classification calls
  per hour per network, regardless of how many sessions it mints.
- Both numbers are comments in the migration, next to the reasoning above, not
  just this log entry.

### Verification (real, observed)

- Baseline before this change: `deno test --allow-env --allow-net --allow-read
  supabase/functions` → 467 passed, 0 failed (45s). `deno test --allow-env
  --allow-net --allow-read supabase/migrations` → 45 passed, 0 failed (1m32s).
- After: `supabase/functions` → 473 passed, 0 failed (1m1s) - 6 new tests in
  `_shared/grounding-rate-limit.test.ts`. `supabase/migrations` → 53 passed,
  0 failed (1m35s) - 8 new tests in
  `00051_grounding_fallback_rate_limit_test.ts`.
- New migration test covers: under-limit caller keeps getting grounding;
  over-limit caller is refused (`false`, never an error); the limit is scoped
  per caller (exhausting user A's budget leaves user B untouched); the per-user
  window resets after 10 minutes; an anonymous caller is capped by hashed
  network scope even when each request mints a fresh anonymous `user_id`; the
  anonymous window resets after 60 minutes; a malformed scope hash is rejected
  rather than silently ungated; both new tables and the RPC are service-role
  only.
- New `_shared` test covers: a signed-in caller is checked with a null
  anonymous scope; an anonymous caller's scope hash matches
  `hashAnonymousGrantScope` byte for byte; a guest behind a proxy that omits
  the trusted network header fails closed WITHOUT spending an RPC call; an RPC
  error and a thrown rejection both fail closed and never reject the caller;
  a non-boolean truthy RPC payload is treated as a denial, not coerced.
- `deno check` and `deno fmt --check` clean on every touched/added file:
  `generate-story/index.ts`, `generate-story-stream/index.ts`,
  `_shared/grounding-rate-limit.ts`, `_shared/grounding-rate-limit.test.ts`,
  `00051_grounding_fallback_rate_limit.sql`,
  `00051_grounding_fallback_rate_limit_test.ts`.
- Not independently verified: the "client supplied cards → zero rate-limit
  calls" behavior at the live HTTP entrypoint. There is no `index.test.ts` for
  `generate-story` or `generate-story-stream` in this repo (same gap noted in
  the 2026-09-06 comments/feed entry - PGlite speaks Postgres, not the edge
  runtime), so this is verified by code inspection: `needsGroundingFallback`
  is the exact pre-existing `grounding.length || groundingEntities.length`
  condition that already gated `resolveGrounding`, now also gating
  `claimGroundingFallback`, with no other path into either call.
- Nothing pushed, deployed, or run against the live project
  `iafeuxgoiknncgyjmugd`. Migration 00051 is written but not applied. No git
  commit made, per instructions.
