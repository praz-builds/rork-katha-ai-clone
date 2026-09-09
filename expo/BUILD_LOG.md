# Katha AI Build Log

<!-- markdownlint-disable MD013 -->

## 2026-09-10: Three ways of saying "a voice is being prepared"

### Changed

- **`src/components/reader/NarrationLoader.tsx` is new**, for the preparing
  state of the full-screen narration player. It is deliberately not
  `CraftingLoader`: that screen's brand mark says "Katha is writing", and a
  reader who pressed Listen is waiting on something else entirely. Three
  variants, chosen by a `variant` prop so product can compare them without the
  player changing:
  - `waveform` — seven bars breathing around a centre-weighted profile, the
    shape a level meter makes on a spoken voice. Says: a voice, warming up.
  - `halo` — a drawn headphone glyph with rings leaving the earcups and fading
    outward. Says: sound on its way to you. The closest to the reference.
  - `passage` — the chapter's own lines with a reading light travelling across
    them, clipped to the block of text. Says: this is being read.
- **The messages map to real pipeline stages, not to a timer.** `voice` (the
  voice is resolved and cached narration looked up), `requesting` (the
  (chapter, voice) row is claimed and a RunPod job started), `generating`
  (`audio-status` is answering `PENDING`), `finishing` (bytes are back and
  being stored). `NARRATION_STAGES` is exported so the player drives it from
  status; `message` overrides a line when the player knows something truer.
- **No screen here promises a duration.** The provider's queue depth is
  invisible to the app and `audio-status` answers `PENDING` or `COMPLETED`
  with nothing in between, so a countdown would be invented. A test asserts no
  stage message contains a digit or the word "second".
- **Reduced motion keeps saying something.** Each variant drops its
  translation and scale and keeps a slow opacity breath
  (`ReduceMotion.Never`, deliberately — Reanimated's default would snap the
  one animation these users have to its final value), and the progress moves
  to a discrete fill driven by the real stage: one more bar, one more ring,
  one more line takes the accent every time a stage completes. Frozen art on a
  wait screen is indistinguishable from a crash.
- **`?preview=narration-loader`** renders all three stacked with their labels
  and a stage switcher, at `src/screens/dev/NarrationLoaderPreview.tsx`. Two
  lines in `App.tsx`, following the existing `?preview=loader` pattern; both
  are `__DEV__` + web only and cannot reach a shipped build.

### Verification

- `pnpm typecheck` clean (Node 22.23.0).
- `pnpm lint`: 0 errors, the existing 24 warnings unchanged.
- `pnpm exec jest`: 75 suites, 642 tests passing (74/632 before, plus the new
  `narration-loader` suite's 10). Each variant is asserted to render, and to
  still render its message with reduced motion on.
- `pnpm exec expo export --platform web` compiled the web bundle.
- Looked at all three in Chrome at `localhost:8095/?preview=narration-loader`
  (8090 was held by another session's dev server); no console errors. Motion
  feel on device is unjudged — a laptop browser is not a verification
  environment for a 620ms loop.
- Not pushed. Not deployed.

## 2026-09-09: The story page goes dark, and a writer's own work leads Home

### Changed

- **The story page is one picture, not a card of one.** Opening a story used
  to be a light screen with the cover boxed into a rounded thumbnail near the
  top — a picture with a frame drawn around it, on a page that then listed
  facts about the story. It is now the single dark surface in the app
  (`chrome.surface`): the cover runs full-bleed for 62% of the window and
  dissolves into the ground through a gradient that ends at 100% of the same
  colour, so there is no edge, no radius and no line where the art stops and
  the page begins. Close, Save, Share and More float over the art on 55%-dark
  discs rather than sitting in a bar above it.
- **The facts read as a sentence.** Author, date, likes, comments and how far
  along the story is are one wrapping line — `@name · Aug 16, 2026 · 232 likes
  · 187 comments · 4/7 chapters` — with the handle and the comment count
  underlined because they go somewhere. A one-shot says `Standalone` rather
  than inventing a denominator; a series whose plan the query did not select
  says how many chapters exist and nothing more. Your own public story adds
  `· Public`, which is the only page allowed to claim it: a reader of someone
  else's story is already looking at a public one.
- **Read and Listen are two equal pills**, both solid orange, because an
  outlined twin reads as disabled on a dark ground and Listen is not. When a
  story has no narration Listen says so in one quiet line instead of opening a
  player that can only apologise.
- **Comments open in a dark sheet over the page.** Each row leads with the
  commenter's initial, the handle is underlined, and the age line has room for
  a `Chapter n` tag — rendered only when the row actually carries one. The
  sheet header carries a real close button; before, the only way out was a
  backdrop tap, which a screen reader could not reach and a web viewer had no
  hardware back to substitute for.
- **A story can be taken off the screen.** The 3-dot menu now offers Report
  story, Block author (never on your own story — you cannot block yourself)
  and Download as PDF. The PDF is a title page then every chapter under its
  own heading, set in a serif at book proportions: `expo-print` plus the share
  sheet on a phone, the browser's own print dialog on the web. The HTML is
  built by a pure function and tested, so the shape of what a reader takes
  away does not depend on a printer.
- **Home leads with your own stories.** A writer who has made a story opens the
  app and finds it first, in the same rail and the same card as everything
  else, last-touched first — rather than being shown the house picks and
  hunting through Library for their own work. The bar is one complete chapter,
  which is the only bar there is: a chapter is written by a single
  request/response and persisted whole, so there is no half-written story to
  represent. Before the writer has made anything the row does not exist rather
  than sitting empty. The cover is the one part that can still be missing —
  the art is painted in the background after the prose — which is what the
  gradient placeholder below is for.
- **Covers arrive quietly.** A cover that is still being painted, or that
  failed, shows its genre gradient and nothing else — no spinner, no
  "Painting…", no retry button. When the URL lands the art fades in over the
  gradient in `motion.base`. Feed cards also read the generated cover
  (`coverImageUrl`) first, so a story the writer just made keeps its art
  outside the studio.
- **The dark palette is a theme token now.** `colors.chromeSurface`,
  `chromeSurfaceRaised`, `chromeBorder`, `chromeText`, `chromeMuted`,
  `chromeTrack` and `chromeStar` were promoted out of a private object in
  `ReaderChrome.tsx` so the reader's controls and the story page draw from one
  set of values instead of two copies of five hexes.

### Fixed

- **The like count read as two words to anything parsing the meta line.**
  `{n} {likes}` rendered as separate text nodes with a space between them; it
  is one string now, so a screen reader does not pause inside the phrase.
- **The story page fetched its comments twice.** A React Native `Modal` keeps
  its children mounted whether or not it is visible, so the sheet's thread ran
  alongside the inline preview on every story a reader opened. The sheet's
  thread mounts when the sheet does.
- **The hero flashed bare ground while a cover downloaded.** The genre
  gradient now sits under the art rather than only instead of it.

### Known gaps

- **No comment can carry a chapter yet.** `comments.chapter_id` has existed
  since migration 00001, but the `comments` Edge Function neither selects it
  nor accepts it on insert, so the `Chapter n` tag is wired end to end on the
  client and renders on nothing. Serving it is a join to
  `chapters.chapter_number` in that function's SELECT; no client change is
  needed when it lands.
## 2026-09-09: Reimagine, saved characters, and being told before a credit is spent

### Changed

- **A chapter can be rewritten from the reader.** Reimagine was a button that
  opened the paragraph editor with the wand bar showing — the same screen as
  Edit, reached from a different door, and only ever for the author. It now
  opens its own sheet: the characters the story's roster actually puts on this
  page, a Replace pill per row, and a box for what should change. Either one is
  enough to submit; with neither, the button stays off rather than spending a
  credit on "rewrite this, no notes."
- **Anyone can reimagine, not just the author.** A reader of someone else's
  story gets the same sheet with the subtitle "Makes a private copy in your
  library" and the button "Reimagine in my copy"; on success a toast says
  "Saved to Your stories" and the original is untouched. Before, the control
  was hidden for non-authors entirely.
- **Swapping a character can run through the whole book.** A replaced row grows
  an "Apply to all chapters" checkbox — "Renames them everywhere in this story
  and in every chapter after this one." It is hidden for a standalone story,
  where there is nowhere else for the name to go.
- **Characters are reusable.** "Who's in it" has two tabs. **Saved** is a
  one-tap library of everyone the writer has crafted before — a chip per
  person, tapped again to remove, capped at three with "Up to three characters
  per story." when the cast is full. **New** is the Craft character flow,
  unchanged, and every character saved there is written to the library too, so
  the second story never retypes the first story's cast. The library is decided
  once per screen, not per render: finishing a character no longer yanks the
  writer to the Saved tab with the "Add a character" row vanishing under their
  thumb.
- **A public story that names a real living person is explained before it is
  written.** The writer used to turn on public, spend a credit, wait for a
  chapter, and only then be told the story would stay private. Now tapping
  Generate with a gating entity in the idea shows a card first: "This one can't
  be public", the reason in the writer's own terms, and two ways out — **Keep
  it private** (writes it, privately) or **Change my idea** (back to the brief,
  nothing spent). Historical figures, real places and real events never trigger
  it, which is the whole point of the grounding feature. The server gate stays
  the backstop for the case where shaping had not finished in time.
- The visibility toggle reads "Make it public", and says "Anyone on Katha can
  read it once it's written." when it is on — the old "This story can be shared
  after creation." described an action that no longer exists.

### Notes

- The client mirrors `_shared/entity-visibility-gate.ts` rather than importing
  it (Deno), and prefers `shape-story`'s own `gating_reason` the moment the
  backend returns one. `entity-gate.test.ts` pins both gating classes and a
  historical figure that must never gate.
- `reimagine-client.ts` and `saved-characters.ts` are deliberately outside
  `lib/api.ts`, which the backend branch is editing in parallel.
- Detected characters are the story roster filtered to names on the page; a
  character the model invented has no roster entry and is not guessed at.
## 2026-09-09: Generation lands in the reader — the editor, the review step and the publish button are gone

### Changed

- **You press Create and, about twenty seconds later, you are reading page one
  of your own story.** Before: Create put up the crafting screen for the whole
  55-76 second generation, then dropped you into a paragraph-by-paragraph draft
  editor with AI rewrite chips, a chapter tab strip, a "Write the rest" run and
  a cover review card, then a Review step with a Publish button — a small
  desktop word processor, reached by everyone, before they had read a word of
  their own story. After: the crafting screen holds only while there is nothing
  to read, and the moment whole finished pages exist the ordinary reader opens
  on page 1. The rest of the chapter arrives behind you while you read it.
- **Prose still arrives in chunks; it is never painted in front of you.** The
  transport is unchanged and deliberately so — chunked delivery is the only
  reason page 1 can be on screen at ~20s rather than at ~70s, and it is what
  keeps the request under Supabase's 150-second idle timeout. What changed is
  what a chunk is allowed to do. A page is released only when it is a whole
  page of whole paragraphs, and the boundary of a released page can never move,
  so the page you are looking at cannot grow or reflow underneath you. Nothing
  is ever typed out letter by letter or mid-sentence.
- **The last available page says the chapter is still being written** — three
  pulsing dots and "Still writing…" under the final settled paragraph, and the
  footer reads "Page 1 of 4 · writing" while that count is still a count of
  what exists. No spinner, no progress bar, no percentage: none of those are
  knowable, and all three turn reading into waiting.
- **Leaving the screen no longer kills the generation you paid for.** The
  stream, the prose it has delivered and the rule deciding how much of it you
  may see now live in a module-level session (`src/lib/generation-session.ts`),
  not in the Create screen's state. You can press back, switch tabs, or open
  the same story from Library while it is being written, and come back to
  exactly the pages you left. The story is in your library from the moment its
  first page exists.
- **Your own story opens on a bare title page.** Story title, then chapter
  title, then the prose. The cover thumbnail, the genre eyebrow, the byline and
  the "Chapter N" label are dropped for a story you wrote and for one being
  written; somebody else's story is a thing you are choosing to read, so it
  keeps all four. A standalone story shows one title, not the same name twice.
- **The reader's controls do not open until the chapter is finished.** A tap
  during generation does nothing at all. Nothing in the tray operates on prose
  that does not exist yet — you cannot search half a chapter, scrub to a page
  that has not settled, or narrate an unfinished one — and a tray of controls
  that cannot be used is a question the writer cannot answer. The first tap
  after the chapter lands opens it, and is not swallowed by the taps refused
  before it.
- **Edit is a notepad.** One text field, the whole chapter, vertical, with the
  chapter title editable above it and a Save button. The wand bar, the search
  bar, the paragraph-regenerate path and the revert icon are gone from it. It
  is the author's, and it appears only once the chapter is complete — absent
  rather than greyed out until then. Reimagine sits beside it on the same terms
  and is offered to every reader, not only the author.
- **Publishing is the "Make it public" toggle in the brief.** There is no
  Review step and no Publish button to find. A story you marked public is
  public the moment its chapter lands; a story that names a real living person
  or someone from your own life stays private, and you are told once, plainly,
  rather than being handed a policy.
- **Continuing a story turns the page instead of opening a panel.** Tapping a
  direction at the end of a chapter used to leave you at the foot of the
  chapter you had just finished, watching a second waiting surface several
  inches down a scroll. Now the reader turns to page 1 of the new chapter and
  the prose arrives there, exactly as chapter one did. One tap buys one
  chapter, however many times the card is pressed.

### Fixed

- **A double tap on an end-of-chapter direction bought two chapters.** The
  guard used to be the component's own request state; the component no longer
  makes the request, so the guard moved into it explicitly. Two presses in the
  same tick are one continuation and one credit.
- **A continuation that failed lost the direction the reader typed.** The
  session holds it, so Retry re-sends the same steer rather than asking them to
  find and retype it.
- **A generation that stopped early erased the pages it had already handed
  over.** They stay on screen, with one line under them — "Katha stopped early.
  Your credit is back." — and a Retry. The server's own message is the right
  thing to log and the wrong thing to put under half a chapter somebody is
  reading.

### Known

- The Reimagine sheet itself is not built here. `ReaderScreen` takes an
  `onReimagine` prop and `ReaderChrome` renders the control whenever it is
  supplied; the sheet lands at the marked block beside the other sheets.
- `regenerateCover` and the cover-poll helpers remain in `src/lib/api.ts` with
  no caller, and the `writeTheRest` strings remain in `src/i18n/en.json`. Both
  are dead client surface left in place because `api.ts` and the i18n bundles
  are being edited elsewhere; they render nothing.
- Native gesture behaviour is still unverified in this environment: the tests
  fire the `momentumScrollEnd` the platform would fire, not a finger drag.

## 2026-09-09: The reading experience — pages, controls, portraits, and stories that survive a reload

### Changed

- **The reader turns pages horizontally.** One screen-wide page per
  `paginateChapter` slice, snapping, with the Pages control synced in both
  directions. Word-tap phrase capture still works: `renderWord` receives a
  chapter-absolute index (`pageWordStart + i`), and only `pageIndex +/- 1`
  renders live words so offsets stay equal to page indices.
- **Controls appear on a tap and hide on the next one.** The reader opens with
  them hidden, so the page is the first thing seen. The chrome is dark on every
  reading mode: the sheet reads as "the app" and the page stays "the book".
- **Three reading modes** — Sepia (default, warm), Paper, Night. Body text
  clears WCAG AAA (7:1) on all three, enforced by `reading-themes.test.ts`, and
  no mode pairs pure black with pure white (maximum contrast is the wrong
  choice for long-form reading; it causes the halation that smears a line as
  the page turns). The gate caught a real defect on its first run: Sepia's
  secondary text was 3.30:1, below even AA, in the default mode.
- **A chapter opens with its title** — a "Chapter N" eyebrow and a rule, on
  page 1 only. `paginateChapter` gained `viewport.firstPageOffset` so page 1 is
  budgeted for the space left below the opener; absent or `0` reproduces the
  old uniform paging exactly.
- **The character portrait is rendered.** It never was: when the image was
  READY the code drew `character.name.slice(0, 1)` and mounted no `<Image>` at
  all, in both the craft sheet and the cast-list card. Generation had worked
  the whole time — verified against the live endpoint, ~12s to a real URL — so
  "the character isn't generating" was a render bug that had cost real credits.
  The card also shows a busy state now: a 12-second wait with no feedback is
  indistinguishable from a dead button.
- **End-of-chapter directions are cards, not a text box.** The suggestions were
  real (open hooks, promised payoffs, next-chapter pressure) but gated at
  `resolved.length >= 2`, so a story yielding ONE direction discarded it and
  rendered only the write-your-own box. Now `>= 1`, capped at 3, with the free
  text demoted to a collapsed CTA. The four hardcoded "Surprise me" lines are
  gone; "Let Katha decide" sends `undefined` rather than inventing a direction.
- **Streaming is transport, not presentation.** The loader holds until three
  finished pages exist or the chapter completes, then reveals settled prose.
  Only whole paragraphs settle and only whole pages count, so page 1 does not
  reflow underneath the reader.
- **A writer's own stories survive a reload.** They did not: no endpoint
  returned a private story and the client held them in a `useState` array, so
  closing the tab erased every story a writer had made while the rows sat safe
  in Postgres. `fetchMyStories` reads `stories` and `chapters` straight from
  PostgREST, where RLS has allowed an author their own work since 00002.
- **Character reference photos.** `expo-image-picker` is wired, downscaling to
  1024px and sending a data URL. It is a style reference, not a likeness
  target, and the copy says so where the writer decides whether to attach one.
- Create-flow pass: `@` on cast chips, Chapter plan removed from More options,
  the review strength card replaced by a compact meter, the "Edit" button next
  to Reimagine removed, a friction modal on unsaved character edits, and
  `SWITCH_COLORS` so the four switches cannot drift off-brand again.

### Fixed

- **Android hardware back closed the app from inside the reader.** The handler
  returned `false` expecting a navigator to take over. There is none — screens
  are a `useState` switch in `App.tsx` — so it ran Android's default and
  finished the activity. The existing test asserted `toBe(false)`, so it
  enshrined the bug rather than catching it.
- **The chapter reveal scrolled to its own end**, landing the writer at the far
  end of the three revealed pages instead of the start. `StreamingProse` now
  takes `autoFollow`, defaulting off.
- **A searched word vanished in Night mode.** The highlight was a hardcoded
  `accentSoft` behind text inheriting `theme.text`: 1.03:1. Highlights are now
  per-theme and the contrast gate covers them.
- **The Pages control was a stepper wearing a track** — one page per tap
  wherever you touched it, wrapping to page 1 at the end. Now positional, with
  the unfilled remainder actually drawn.
- **The launch mark appeared to jump between loads.** Not the launch screen,
  which is measurement-free: the generating overlay shuffles its phrase pool,
  and a `minHeight: 64` block inside a centred column moved the mark 16pt
  depending on which phrase was dealt, then again every 3.2s.

### Known

- Native gesture behaviour is unverified: no device or simulator in this
  environment. Whether a drag reaches the pager, and whether a word tap wins the
  touch negotiation against a horizontal scroller, are proven only at the React
  level.
- `CHAPTER_OPENER_HEIGHT` is a 300pt estimate that only a device can calibrate.
- The reveal threshold is measured against a fixed nominal 390x640 page, so
  "three pages" is a phone-sized claim; on a tablet it is less than one reader
  page.

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

## 2026-09-08: Writer onboarding preview warming

### Changed

- Warmed the onboarding preview `shape-story` request from the details CTA, as
  soon as the complete writer brief is known, so email/code time overlaps the
  model call and the wait screen only covers the remaining tail.
- Fixed the warmed-request failure race so a failed warm result reaches the
  retry screen once, then clears for a real retry.

### Not shipped

- A Katha app-icon draw/fill animation was built for the crafting loader and
  then removed before this landed, on the product owner's instruction. The
  loader keeps its existing rings, arcs and breathing disc. Recorded here rather
  than silently dropped, so the next person does not rebuild it assuming it was
  an oversight.

### Measurement

- Live onboarding `shape-story` smoke, n=5: shape-only min 10.3s, median 11.3s,
  average 11.7s, max 14.2s.
- End-to-end anonymous auth + bootstrap + shape ranged from 13.4s to 16.8s.
- All five returned title and opening.

### Verification

- `pnpm test -- --runTestsByPath src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: 2 suites passing.
- `pnpm typecheck` clean.
- `pnpm lint` exits with 0 errors and the existing warning set.
- `pnpm exec jest --runInBand`: 34 suites, 331 tests passing.
- `pnpm exec expo-doctor`: 18/18 checks passing with local Node 22 in PATH.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- Local Expo web started at `http://localhost:8091/`; 8090 was already occupied by another Katha checkout.

## 2026-09-06: Writer onboarding consistency and paywall pass

### Changed

- Resolved the PR review's comments/moderation blockers before merge: comment
  post parsing matches the server response shape, frontend report reasons use
  the backend enum, comment write/vote failures no longer replace a loaded
  thread with a load error, repeated vote taps are serialized per comment, and
  block failures stay on the sheet instead of navigating away as if the block
  worked.
- Brought the writer onboarding prompt, details, preview and paywall screens
  onto one visual rhythm: shared progress rows, compact dark section headers,
  quieter starter prompt cards, bolder selected filter chips and slimmer
  luminous CTAs.
- Replaced the details screen's old chapter segmented controls with Chapter
  Length and Chapters dropdown filter chips on a single row.
- Changed the detail heading to "Shape the Story", the detail CTA to "Create my
  story", the Moments action to an icon-only add button, and the preview CTA to
  "Continue".
- Replaced the raw writer subscription ask with a story-specific preview
  paywall that shows the concept card, credit math, included creation benefits,
  weekly/yearly plans, and the final "Create my story" CTA.

### Verification

- `pnpm typecheck` passed.
- Focused ESLint passed for `WriterOnboarding` and its tests.
- `pnpm test -- --runInBand src/__tests__/writer-onboarding.test.tsx
  src/__tests__/writer-onboarding-interactions.test.tsx` passed: 2 suites, 79
  tests.
- Focused review-fix tests passed: 6 suites, 107 tests.
- Full Jest suite passed: 25 suites, 268 tests.
- `EXPO_NO_DOTENV=1 pnpm exec expo export --platform web --output-dir
  /tmp/katha-writer-onboarding-paywall-export-check` passed.
- `pnpm exec expo-doctor` still passes 15/18 checks; the remaining checks fail
  because this shell cannot spawn `npm` (`spawn npm ENOENT`).
- `pnpm audit --audit-level high` exits cleanly with the two known
  `image-size` advisories ignored only after applying the local parser patch;
  `image-size@2.0.3` is not published, so a direct patched-version upgrade is
  not available.
- Local URL `http://localhost:8090/` was opened and returned `200 OK`.

## 2026-09-06: Single-Screen Main Create Flow

### Changed

- Reworked main Create into one scrollable generation screen: Genre, Kids Mode, story idea, starter chips, optional Premise, characters, More options, brief strength, credits, and `Create · 3 credits` all render together.
- Adjusted hierarchy again after product review: audience mode and Genre now share a compact parent row above the prompt, Genre opens a vertical picker, and Where/when plus Characters follow the starter prompts.
- Refined the parent row after visual review: Genre now sits left with a per-genre icon, Kids Mode is a compact switch on the right, and the genre picker is a narrow vertical menu rather than a full-width list.
- Changed the visible secondary context label from Where/when to `Premise` with an optional hint, removed helper copy under `Who's in it`, and tightened More options into a heading-style disclosure.
- Removed the main-flow `Continue` stage and the pre-story inference call from the Create UI path. The only story-generation call is the final Create action.
- Moved moments and chapter-plan editing into a lighter inline More options disclosure with writing style, chapters, length, language, visibility, spice, avoid, and chapter art.
- Kept Craft character as the only separate surface, presented through a native full-screen `Modal` with Create image/Reimagine/Edit/Delete states.

### Verification

- `jest src/__tests__/create-flow-contract.test.tsx src/__tests__/api-generation-contract.test.ts --runInBand`: passing, 32 tests.
- `tsc --noEmit`: passing.
- `expo export --platform web --output-dir /tmp/katha-single-create-flow-export-check`: passing.
- `expo export --platform web --output-dir /tmp/katha-parent-controls-export-check`: passing.
- `expo export --platform web --output-dir /tmp/katha-create-density-export-check`: passing.

## 2026-09-06: Onboarding/Create Design Consistency Pass

### Changed

- Aligned Create and writer-onboarding section labels to one black uppercase treatment, keeping primary headings separate.
- Standardized onboarding and Create starter prompt rails to mid-size preview chips.
- Replaced writer onboarding chapter segmented controls with wrapping chip groups for chapter count and chapter length.
- Flattened back controls to the same plain leading chevron treatment and normalized primary CTAs to the leaner 56-point style.
- Updated the legacy onboarding OTP screen to use the same single code field as the writer auth path.

### Verification

- `pnpm typecheck`: passing with bundled Node on `PATH`.
- `pnpm test -- --runInBand src/__tests__/create-flow-contract.test.tsx src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: passing, 86 tests.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-design-consistency-export-check`: passing.
- `pnpm exec expo-doctor`: 15/18 checks passed; remaining checks failed because Expo Doctor could not spawn `npm` from this shell.
- Local preview started at `http://localhost:8090/`.

## 2026-09-06: Writer Onboarding Filter Chip Follow-Up

### Changed

- Lightened writer onboarding starter prompt card text to match Create’s muted prompt previews.
- Replaced chapter count and chapter length rows with selected filter chips that open dropdown menus for the other options.
- Updated details-screen section labels to the Create-style black uppercase Hanken treatment.
- Changed the Moments composer action to an icon-only plus button.

### Verification

- `pnpm typecheck`: passing with bundled Node on `PATH`.
- `pnpm test -- --runInBand src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: passing, 79 tests.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-onboarding-filter-chip-export-check`: passing.
## 2026-09-05: Main Create Flow Hierarchy and Character Image Step

### Changed

- Collapsed the main Create setup from Idea → Shape → Review into Idea → Review and start. The final Create button, brief-strength meter, credits, and More options now live on the same reviewed setup surface.
- Shortened the Try one starter cards so they show a clipped three-line preview while tapping still inserts the complete prompt into the story idea field.
- Added Craft character image state: Create image, Creating, Reimagine, Edit, Delete, Image ready, and Image failed. Saving a character returns to Review and start without starting story generation.
- Added a client `generateCharacterImage` API wrapper for the new `generate-character-image` Edge Function and carried `portrait_url` through the final story-generation payload.
- Blocked final Create while a saved character image is still generating, so the story-generation call cannot start before requested character image work completes.

### Verification

- `jest src/__tests__/create-flow-contract.test.tsx src/__tests__/api-generation-contract.test.ts --runInBand`: passing, 31 tests.
- `tsc --noEmit`: passing.
- `expo export --platform web --output-dir /tmp/katha-create-flow-export-check`: passing.
- `pnpm` commands were blocked by the existing ignored-build approval prompt, so verification used the bundled Node runtime and local binaries directly.

## 2026-08-25: Audio Narration System

### Shipped

- Using **MiniMax Speech 02 HD** public endpoint on RunPod (no custom deployment needed). VibeVoice custom endpoint was abandoned (container crash-looped). Chatterbox Turbo was rejected (generative, invented content instead of reading the story).
- Created voice registry with 8 voices: 6 English (Aria, Luna, Zara, Kai, Ravi, Leo) + 2 Spanish (Elvira, Alvaro). Launch uses 2 per language (Aria+Kai for EN, Elvira+Alvaro for ES). Remaining 4 reserved for future Premium Voices feature.
- Built `generate-audio` edge function with language-aware routing: English to MiniMax Speech 02 HD (faithful TTS), Spanish to edge-tts (placeholder pending implementation).
- Built `audio-status` edge function: polls RunPod job status, decodes base64 audio, uploads to Supabase Storage `audio` bucket, updates `chapters.audio_url`.
- Added shared `_shared/edge-tts.ts` utility with voice mappings and language defaults.
- Reader screen voice toggle: shows Aria/Kai for English stories, Elvira/Alvaro for Spanish stories, auto-detected from story language field.
- Audio files stored at `{story_id}/{chapter_id}/{voice_id}.mp3` in Supabase Storage. Both voices generated at publish time and cached permanently. No recurring RunPod cost per playback.
- Input validation and ownership check on generate-audio (story author only).

### Supabase Configuration Applied

- Set `RUNPOD_API_KEY` secret
- Set `ADAPTY_WEBHOOK_SECRET` secret
- Created `audio` storage bucket (public read, service role upload)

### Audio Flow

1. Author publishes story
2. Backend calls `generate-audio` with story text + language
3. EN: submits 2 MiniMax jobs (Wise_Woman for Aria, Deep_Voice_Man for Kai)
4. ES: routed to edge-tts (synthesis pending implementation, returns PENDING_IMPLEMENTATION status)
5. On completion: audio uploaded to Storage, `chapters.audio_url` updated
6. Reader sees play/pause button with voice toggle
7. Paid users: plays instantly. Free users: 1 credit to unlock audio per story.

### Functional Reader (PR #20)

- Audio playback via expo-av (native) with working play/pause
- Like toggle with count increment/decrement
- Bookmark toggle with icon state change
- Share via clipboard (web) / Share API (native)
- Comment input with send button, adds to local list
- Follow author toggle
- Professional design: neutral gray avatars, ink buttons, flat comment layout, 16px icons

### Dual Voice (PR #21)

- Added `audioUrls` (female/male) to Chapter type
- Voice toggle loads correct gender audio
- Fallback: if gender-specific URL missing, uses generic audioUrl

### Cost Model

- MiniMax Speech 02 HD: ~$0.04 per chapter narration, ~30s generation
- 2 voices per story = ~$0.08 per published story
- Audio served from CloudFront (no CORS issues, no storage cost until we copy to Supabase)
- 1,000 stories = ~$80 MiniMax

### Primary Files

- `expo/src/data/voices.ts`: Voice registry, language defaults, genre matching.
- `backend/supabase/functions/generate-audio/index.ts`: TTS orchestrator with language routing.
- `backend/supabase/functions/audio-status/index.ts`: Job poller + Storage uploader.
- `backend/supabase/functions/_shared/edge-tts.ts`: Spanish voice mappings.

## 2026-08-23: Production Infrastructure Setup

### Shipped

- Created EAS build configuration (development/preview/production profiles, Android submit config).
- Installed and configured 12 production SDKs: @sentry/react-native, posthog-react-native, expo-notifications, expo-device, expo-constants, react-native-adapty, expo-localization, expo-splash-screen, expo-updates, expo-tracking-transparency, @react-native-firebase/app, @react-native-firebase/analytics.
- All SDK versions aligned to Expo SDK 54 compatibility via `npx expo install --fix`.
- Created `src/lib/analytics.ts`: Sentry crash reporting + PostHog product analytics with trackEvent/identifyUser/resetAnalytics. Environment from APP_ENV build config.
- Created `src/lib/adapty.ts`: Adapty v4 SDK wrapper for paywall products, purchases, and restore.
- Created `src/lib/notifications.ts`: expo-notifications setup with permission request, push token retrieval, and Android notification channels (default + stories).
- Created `src/lib/firebase-analytics.ts`: Firebase Analytics wrapper with safe dynamic imports (works in Expo Go/web, activates in EAS builds). Pre-defined AppEvents for onboarding, story creation, monetization (Google Ads ROAS), engagement, and acquisition.
- Created `src/lib/tracking-transparency.ts`: iOS App Tracking Transparency wrapper.
- Added i18n infrastructure: i18next + react-i18next + expo-localization with device locale detection. 400+ strings extracted into en.json (English), es.json (Spanish), pt.json (Portuguese).
- Updated app.json with plugins (Sentry, notifications, ATT, updates), OTA update config, and runtime version policy.
- All initialization wired in App.tsx startup (Sentry, PostHog, Adapty, Android channels).
- Created expanded .env.example with all required API key placeholders.

### Configuration Needed (User Setup)

1. `EXPO_PUBLIC_SENTRY_DSN` -- create project at sentry.io
2. `EXPO_PUBLIC_POSTHOG_API_KEY` -- create project at posthog.com
3. `EXPO_PUBLIC_ADAPTY_API_KEY` -- create app at adapty.io
4. `google-services.json` -- create Firebase project, place in `expo/` root, add `@react-native-firebase/app` to app.json plugins and set `android.googleServicesFile` path
5. Run `cd expo && eas init` to configure EAS project ID
6. Run `cd expo && eas build --profile development --platform android` for first dev build

### Verification

- TypeScript: zero errors across all new modules.
- All SDKs compile without API keys (graceful no-op when unconfigured).
- PRs #10, #11, #12 merged to main after CodeRabbit review.

### Primary Files Added

- `eas.json`: EAS Build profiles.
- `src/lib/analytics.ts`: Sentry + PostHog.
- `src/lib/adapty.ts`: Adapty v4 SDK.
- `src/lib/notifications.ts`: Push notifications.
- `src/lib/firebase-analytics.ts`: Firebase Analytics + Google Ads events.
- `src/lib/tracking-transparency.ts`: iOS ATT.
- `src/i18n/index.ts`: i18n initialization.
- `src/i18n/en.json`, `src/i18n/es.json`, `src/i18n/pt.json`: Translations.

## 2026-08-22: Approved Expo Foundation and Onboarding

### Shipped

- Migrated the Katha client into an Expo SDK 54 workspace compatible with Expo Go.
- Preserved the native Rork SwiftUI and Kotlin projects as reference implementations in the GitHub monorepo.
- Established the approved Katha AI identity through one shared `BrandWordmark` component.
- Approved bundled typography: Baloo2 for the brand, Bricolage Grotesque for display text, Hanken Grotesk for product UI, and Literata for reading.
- Built the fixed 390 x 844 animated Create, Publish, and Read introduction.
- Added character typing, generate interaction, story generation, in-place rewrite, reaction chips, real avatars, a 246-like counter, and the continuous cover marquee.
- Built the adaptive onboarding sequence: purpose, name, genres, two persona questions, profile build, notification education, paywall, account save, OTP, success, and Home callback.
- Added independent reader, writer, and mixed-user question, build, paywall, and success messaging.
- Approved `Build my profile` as the profile-completion CTA.
- Rebuilt notification education around a native permission-style center alert and an auto-scrolling, draggable review rail.
- Added a temporary tap-anywhere continuation from notification education to the paywall so product can review the complete purchase flow before native permission wiring. Background taps continue with consent unset/false.
- Personalized the paywall by purpose, top genre, content format, and user routine/blocker.
- Deferred email and OTP until after the paywall or one-time-offer action.
- Consolidated imagery into `assets/covers` and `assets/avatars`; removed the duplicate `assets/images` tree.
- Removed migration-era handoff documents, generated audit bundles, QR screenshots, and local verification artifacts from the deliverable.

### Approved Product Decisions

- `DESIGN.md` is the sole visual and product-flow contract.
- The wordmark, typography, orange/ink/warm-neutral palette, spacing, radii, and CTA hierarchy are approved.
- Purpose is the first profile question.
- Romance remains in the middle of genre discovery; Thriller, Fantasy, and Bedtime Stories lead.
- Reader, writer, and both are distinct personas throughout the flow.
- There is no replay screen after onboarding.
- Email does not block value delivery before the paywall.
- Store prices shown in the prototype are placeholders, not production pricing.

### Revision Verification

- `pnpm typecheck`: passing.
- Expo web production export: passing.
- Expo SDK dependency checks: passing for all checks that completed in the local runtime.
- Mobile browser QA at 390 x 844: completed through intro, reader persona, notification education, personalized paywall, and post-paywall account screen.
- Final visual audit: no blocking findings for rewrite, publish reactions, covers, notification education, reviews, or paywall fit.
- Browser runtime: no application errors; React Native Web reports only legacy shadow-style deprecation warnings from existing cross-platform styles.

### Integration Work Remaining

1. Replace the notification `Allow` callback with `expo-notifications` permission handling. Continue to the paywall after either allow or deny.
2. Connect paywall products, localized prices, trial eligibility, purchases, restore, and receipts through Adapty.
3. Connect email/OTP to Supabase Auth and persist the emitted onboarding profile.
4. Replace placeholder plan prices and legal copy with Adapty/store payload values.
5. Wire the final success callback to the production Home experience and persisted first-run state.
6. Validate the complete flow on physical iOS and Android devices after native integrations.

### Primary Files

- `App.tsx`: app shell, fonts, first-run entry, and Home handoff.
- `src/screens/KathaOnboarding.jsx`: approved animated introduction.
- `src/screens/KathaOnboardingFlowV2.jsx`: adaptive profile, notification, paywall, offer, account, and success flow.
- `src/components/BrandWordmark.tsx`: only approved Katha AI wordmark.
- `DESIGN.md`: canonical visual and product-flow specification.
- `CLAUDE.md`: engineering operating context for future sessions.

## 2026-08-23: Full App Rework -- Navigation, Create Studio, Paywall CRO, Reader Engagement, Backend

### Shipped

- Restructured navigation from 5 tabs to 3: Home | Create (+) | Library. Profile moved to top-right avatar overlay.
- Home screen: write-first CTA for new users, genre-based content rows (Adventure/Mystery/Fantasy), integrated search with genre filter chips, time-based greeting, continue-reading card for returning users.
- Library tab: 4 segments (Saved/History/My Stories/Comments) with empty states and bookmark/message icons.
- Profile screen: overlay with back navigation, centered user card, credits row with chevron, settings list (Notifications, Reading preferences, Katha Plus, Parental controls, Feedback), legal footer.
- CreateStudioScreen (1,653 lines): 3-step create flow -- setup (genre, seed, multi-character with hero toggle, EN/ES/PT language picker) to draft editor (paragraph-level AI actions: rewrite, expand, shorten, change tone, custom prompt, edit, delete; undo toast; pulse animation on processing) to publish (confirmation modal, cover generation simulation).
- Paywall CRO redesign: $59/yr ($4.92/mo), strikethrough $259, feature comparison table (Free vs Plus, 7 features), 3 testimonial cards with avatar photos, social proof stats (4.8 rating, 50K+ stories), sticky bottom CTA, expandable weekly plan, accessible legal links.
- Reader engagement: Substack-style engagement bar (like/comment/save/share), author card with Follow button, comments preview section.
- Intro spacing fix: reduced hero height 522 to 478, stage 360 to 340, grid closer to wordmark, bottom CTA section uses flex layout for proper fit.
- Backend: 3 new Supabase Edge Functions (feed, edit-story, publish-story) and editParagraph() in shared llm.ts.

### Backend Endpoints Added

- `feed/index.ts`: Personalized FYP -- new users get curated stories by like count, returning users get scored feed (genre affinity +3, followed author +5, trending +2, recency +1, engagement +1). Includes continue_reading array.
- `edit-story/index.ts`: Paragraph-level AI editing. Validates story ownership, splits chapter content, builds instruction-specific LLM prompt, replaces paragraph, updates word counts. No credit cost.
- `publish-story/index.ts`: Marks story as public. Validates ownership, status, and published chapter existence. Idempotent.

### Approved Product Decisions

- Write/create is the primary CTA, not read.
- Profile is a top-right avatar, not a bottom tab.
- Library replaces the old Settings/Library tabs.
- Welcome credits: currently 3 in code; product decision to increase to 5 or 10 is pending welcome flow implementation.
- Paywall pricing: $59/yr with 3-day trial (placeholder until Adapty).
- Language picker: English, Spanish, Portuguese at launch.
- Character description clearable with X button.
- Tab bar remains visible during Create Studio (hiding deferred until editor step gains its own bottom toolbar).

### CodeRabbit Review Cycle

- 4 review rounds, all actionable comments addressed.
- Remaining outside-diff comments (hardcoded prices, language forwarding to API) are intentional: Adapty not integrated, api.ts not in PR scope.
- Merged to main via squash merge after CodeRabbit commit status SUCCESS.

### Verification

- `pnpm typecheck`: passing (zero errors).
- Web export: compiles (2.79 MB bundle).
- PR #8 merged to main.

### Integration Work Remaining

1. Wire `expo-notifications` for native permission request (Android 13+ POST_NOTIFICATIONS).
2. Connect Adapty for live pricing, trial eligibility, and purchases.
3. Connect Supabase Auth (email magic link / OTP).
4. Wire CreateStudioScreen to real edit-story and publish-story endpoints (currently mock mode).
5. Forward selected language to generation API.
6. Welcome flow: confetti animation + 10 credits + guided tutorial.
7. Text selection editing (word/sentence level) for draft editor.

### Primary Files

- `App.tsx`: 3-tab shell, Home, Library, Profile overlay, Reader with engagement.
- `src/screens/CreateStudioScreen.tsx`: full create studio with draft editor.
- `src/screens/KathaOnboarding.jsx`: intro with spacing fix.
- `src/screens/KathaOnboardingFlowV2.jsx`: paywall CRO redesign.
- `src/types/domain.ts`: TabKey (home|create|library), Screen (+profile).
- `backend/supabase/functions/feed/index.ts`: FYP endpoint.
- `backend/supabase/functions/edit-story/index.ts`: paragraph AI editing.
- `backend/supabase/functions/publish-story/index.ts`: publish endpoint.

## 2026-08-22: Intro and Paywall Motion Revisions

### Changed

- Rewrote the Create intro sample line so the `dream` to `warning` edit fits a scene where people are visibly observing the hidden door.
- Revised the Read intro marquee to three long rows of slimmer, taller cover cards with longer repeated strips, improving the continuous library motion.
- Removed the paywall trial toggle. Annual is selected by default and is the only plan with a 3-day free trial.
- Kept weekly as a secondary plan revealed through `See weekly option`; selecting it clears the trial state and shows weekly no-trial billing copy.
- Added a paywall close confirmation sheet before routing to the one-time offer.
- Rebuilt the one-time offer in the Katha warm neutral/orange system, removing the loud emoji/gift/blue countdown treatment and using calmer annual-offer copy.
- Routed paywall, weekly option, and one-time-offer pricing through product data objects so future Adapty/store values can replace the reference prices in one place.
- Added reduced-motion paths for intro timelines, cover marquees, loading, paywall entry, offer entry, and button pulse animations.
- Moved the paywall close confirmation into a modal and added explicit close accessibility labels for the paywall and one-time offer.
- Corrected the one-time-offer discount claim to derive from the annual comparison product and offer product prices.
- Updated `DESIGN.md` with the annual-trial and weekly-no-trial contract.

### Verification

- `pnpm typecheck`: passing.
- `pnpm exec expo-doctor`: 18/18 checks passed.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-export-check`: passing with 25 assets.
- Markdown lint passed for `expo/DESIGN.md` and `expo/BUILD_LOG.md`.
- Browser QA at 390 x 844 verified the revised Create line, three-row Read marquee, annual default trial paywall, weekly no-trial option, close confirmation sheet, and revised one-time offer before the review-accessibility patch.
- Code inspection confirmed all three persona branches still route to distinct paywall titles, subtitles, and benefits: read-first, write-first, and balanced read/write.
- Keyboard entry remains on real `TextInput` controls for name, email, OTP, and Other genre. A fresh automated keyboard/browser pass was blocked because Playwright could not install Chromium for this desktop runtime (`mac13` unsupported).
- Narrow-width browser QA beyond 390 x 844 and physical iOS/Android phone validation remain pending before native release.
- Release readiness: this revision is not ready for production release until the full post-patch web flow, keyboard behavior, narrow layouts, reduced-motion behavior, and native iOS/Android builds are validated on supported runners/devices.

## 2026-09-06: Create Flow Density Follow-Up

### Changed

- Kept Create as a single story-generation screen with the character editor in a full-screen native modal.
- Moved Kids Mode to the left of Genre using the platform `Switch`; the label now sits to the right of the toggle.
- Changed the Genre picker from an in-flow expanding block to an absolute overlay, with per-genre icons retained.
- Removed the large brief-strength panel and added compact `strength {percent}%` text below the `Create` CTA.
- Reworked More Options as one compact family: chip rows for chapters and chapter length, consistent field radius, Avoid before Visibility, a native Visibility switch, and icon-based spice chips with the unsupported explicit slot disabled.

### Verification

- `pnpm typecheck`: passing.
- `pnpm test -- src/__tests__/create-flow-contract.test.tsx src/__tests__/api-generation-contract.test.ts --runInBand`: passing, 32 tests.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-create-flow-export-check`: passing.
- `pnpm exec expo-doctor`: passing, 18/18 checks, with the local Node/npm bin path on `PATH`.
- Local dev server is running at `http://localhost:8081/?singleCreateFlow=4`.
## 2026-09-06: Editorial Home, and Explore as its own tab

### Changed

- Split discovery into two tabs. Home is now purely editorial -- named,
  horizontally scrolled rows and no filtering UI at all. Explore is the browse
  surface and absorbs the search field, the genre strip and the filters. Folding
  both jobs into one screen is what left the old Home carrying a search box, a
  chip row, rails AND a vertical list at once, with nothing telling a reader
  which of those was the point of the screen.
- Added `src/components/feed/StoryFeedCard.tsx`, the single card both surfaces
  are built from: cover flush to the leading edge, title, two-line synopsis,
  reads/likes stats, and a decorative circular read chevron. Two variants --
  `rail` (fixed 300px so the next card peeks past the screen edge) and `list`
  (full width). The cover bleeds rather than sitting inset: an inset cover puts
  two radii and a gap between the image and the page and reads as a thumbnail
  pasted onto a card.
- Added `src/components/feed/FeedRail.tsx`. A row's name is an uppercase
  eyebrow, not a title, so it labels the row without out-shouting the story
  titles inside it.
- Added `src/screens/HomeScreen.tsx`, extracted from `App.tsx` and rebuilt.
  Rows come from a pure `buildFeedRows()` helper (Katha Originals, Trending now,
  Most loved, then one row per onboarding genre) so a later swap to a
  server-driven section list never touches the JSX.
- Added `src/screens/ExploreScreen.tsx`: search, genre strip, an inline filter
  panel (sort + multi-select tags), a comfortable/compact density toggle, and a
  `FlatList` with an empty state.
- `TabKey` widened to `home | explore | create | library | profile`; the tab bar
  renders five slots with Create still raised at the centre. Profile was
  promoted from a pushed screen to a real tab and its `Screen` union variant
  removed rather than left dangling.
- Removed the 214-line in-file `HomeScreen` from `App.tsx` along with the
  imports and the 20 style keys the deletion orphaned. 34 other style keys in
  that file were already dead before this change and were deliberately left
  alone.

### Decisions

- Home borrows the reference's hierarchy and card anatomy only. The palette
  stays the existing light system: no new colour values, every colour from
  `colors.*` via the `@/theme` barrel.
- The author/timestamp line and the per-card overflow menu were dropped from the
  card by product decision.
- Explore's second filter axis is `tags`, derived from the passed stories at
  render time. A length/format axis was specified first and then cut: no seed
  story sets `chapterLength` and `storyMode` appears zero times, so Short/Long
  would have been permanently empty options.

### Verification

- `npx tsc --noEmit`: passing, zero errors project-wide.
- `npx eslint App.tsx src/screens/HomeScreen.tsx src/screens/ExploreScreen.tsx src/components/feed`: clean.
- `npx jest`: 18 suites, 219 tests passing, including `app-root.test.tsx`, which
  mounts the whole revised tab tree.
- New: `src/__tests__/feed-card-contract.test.tsx` (2 tests) pins the card
  anatomy and that the card is ONE pressable -- the read chevron is decorative
  and must not announce a second identical action to a screen reader.
- New: `src/__tests__/explore-screen.test.tsx` (4 tests) drives the real
  controls. The search test types one character at a time, because a
  `ListHeaderComponent` whose component type is rebuilt per render remounts the
  `TextInput` on every keystroke and the field silently drops focus after one
  character. The sort test asserts rendered ORDER, not presence -- every story
  is present regardless, so a presence assertion would pass against no sorting
  at all.
- Not yet done: no device or browser QA pass on either screen. Explore is also
  thin against 20 seed stories, and a genre filter cuts that to 1-3 rows; the
  structure is right but the density will not be until the `feed` edge function
  is serving real data.

## 2026-09-06: The story landing page, and Reddit-shaped comments

### Changed

- Added `src/screens/StoryDetailScreen.tsx`. Full-bleed 3:4 hero, floating
  back/overflow controls, title on a gradient scrim, a primary read CTA,
  reads/likes/saves, share, author card, chapter list, metadata, and the comment
  thread at the bottom. No top tab bar: the reference groups Details / Story
  Cards / Comments into tabs and we deliberately do not, because one scroll is
  cheaper to read than three tabs on a page this short.
- Routing now branches on series-ness. `storyMode === "series" ||
  chapters.length > 1` opens the landing page; anything else opens the prose
  directly. The landing page earns its extra tap only when there is something to
  land on - a chapter list, a premise worth reading before committing. For a
  single-chapter story it would be a wall between the reader and the one thing
  they tapped for.
- `ReaderScreen` gained `initialChapterIndex`, so a chapter row on the landing
  page opens that chapter rather than always chapter one.
- Added the comment thread (`src/components/comments/`): threading, tri-state
  voting, collapse, inline reply, per-comment report, Top/New sort. Indent caps
  at depth 3 and deeper chains get a "continue this thread" affordance, because
  past three levels the text column collapses on a 390px screen.
- Added `src/components/moderation/StoryActionsSheet.tsx`: report story and
  block author, both as in-sheet state machines. Deliberately NOT `Alert.alert`
  - this app renders on web in the dev server, where a native modal dialog
  blocks the page and the session stops responding.
- Cover crop unified. The feed card cover was a 116px SQUARE while the reader
  hero was 3:4, so the same file showed two different pictures. The source art is
  portrait (seed 360x480, generated 1024x1536), so the card is now 116x155 and
  Explore's compact row is 56x75. One cover, one crop.
- Added a dev-only `?tab=` deep link (`__DEV__` and web only) so the web dev
  server can open a tab directly. The app boots to `intro`, which put the tabs
  several screens away on every reload.

### Decisions

- The vote control derives its displayed score (`baseScore + voteDelta(state)`)
  rather than mutating a stored score. That makes an up -> down flip move by
  exactly 2 with no special-cased arithmetic, which is the case this control is
  usually written wrong.
- Blocking an author closes the sheet and leaves the story. There is no applied
  `user_blocks` table yet, so a block cannot survive a reload and the author's
  other stories cannot be filtered from the feed. Leaving the reader parked on
  the page of an author they just blocked was the worse of the two available
  lies. When the migration lands: persist it, and filter in
  `backend/supabase/functions/feed/index.ts`.

### Verification

- `npx tsc --noEmit`: passing, zero errors project-wide.
- `npx eslint`: clean on every file added or touched.
- `npx jest`: 20 suites, 238 tests passing.
- New: `story-detail.test.tsx` (4 tests). The load-bearing one asserts a chapter
  row calls `onRead` with the array INDEX, not the chapter number - an off-by-one
  there is invisible in a screenshot and only felt while reading.
- New: `comment-thread.test.tsx` (15 tests), including the up -> down flip
  moving the score by exactly 2 in both directions, and tree immutability.
- Served-bundle check against the running dev server confirmed the new code is
  actually being served, after the discovery that the dev server had been
  running from a different checkout entirely.
- NOT done: no visual QA on either screen. The Chrome extension was not
  connected, so nothing here was verified by looking at a rendered page. Layout
  and spacing at 390px are unconfirmed.
- Known gap: comments are local state only. Nothing survives a reload until
  migration `00043` is applied and an edge function is wired.

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

## 2026-09-06: Comments, blocks and reports actually persist

### Changed

- Added `src/lib/comments.ts`, the client half of persistent comments. The
  server returns a thread FLAT (one row per comment carrying its `parentId`)
  and the client assembles the tree. A nested payload would force the server to
  decide the shape of every thread before it knows how the client draws it, and
  would re-send whole subtrees on every poll; a flat list is cheap to page and
  lets the client re-sort Top/New without another round trip.
- `CommentThread` is server-backed when Supabase is configured and keeps its
  mock as the offline path. Writes are optimistic and then reconciled by
  refetching, because `comments.score` is maintained by a database trigger and
  is the only authority on a score.
- Block and report now persist. Blocking files the block, then leaves the
  story; the navigation happens whether or not the write succeeds, because a
  reader who has just blocked someone should not be held on that author's page
  while a request retries.
- Added `findNode` to the comment tree helpers.

### Decisions

- `baseScore = server.score - server.myVote`. The server's score ALREADY
  includes the viewer's own vote, and the UI adds it back at render time via
  `displayScore`. Without that subtraction every voter sees their own vote
  counted twice the instant they cast it.
- A vote sends the state the control LANDS ON, not the direction pressed. The
  control is tri-state, so pressing up on an already-upvoted comment means
  "remove my vote" and must send 0; sending +1 there leaves the row set while
  the UI shows it cleared, and nobody notices until a reload puts the vote back.
- Orphaned replies are PROMOTED to the root, never dropped. A reply whose
  parent falls outside the fetched page would otherwise vanish - a real
  person's words lost to a paging boundary. The worst case of promoting it is a
  comment that reads slightly out of context.
- A failed comment load is stated and made retryable, and the composer stays
  usable. The write path does not depend on the read path.

### Verification

- `npx tsc --noEmit` clean; `npx eslint` clean.
- `npx jest`: 24 suites, 264 tests passing.
- New: `comments-client.test.ts` (9 tests) covers the double-counted vote, the
  dropped orphan, a cycle, tombstones, sorting and relative time.
- New: `comment-thread-remote.test.tsx` (5 tests) covers the server-backed path
  end to end, including that the tri-state vote clears to 0.
- Browser pass at 390x844: 0 clipped nodes; the story page renders hero,
  chapters, metadata and the comment section.
- NOT done: the `comments` edge function is NOT deployed and migration 00043 is
  NOT applied, so a configured client currently shows "Comments could not load"
  and its retry. That is the honest state, not a bug - but comments will not
  work until both are shipped.
## 2026-09-07: Writer onboarding design-system cleanup and backend-status shaping

### Changed

- Reworked `WriterOnboarding` so onboarding shaping starts after the full writer brief is known, not from the idea screen. The request now carries typed characters, moments, writing style, avoid text, chapter length, and planned chapter count.
- Removed the fixed client crafting floor. The loader now stays up for the actual shape request and failed shaping lands on a retry screen that preserves the idea and details.
- Standardized writer onboarding top bars, primary CTAs, form fields, OTP cells, filter chips, and small plus CTAs on shared theme tokens.
- Tightened the preview: chapter plan renders as a teaser with single-line rows, the opening is shorter, and the ownership/benefit rows use named onboarding icons.
- Aligned the legacy onboarding/sign-in OTP and field/button recipes with the same visual geometry.
- Updated theme tests and writer onboarding interaction tests for the new backend-status flow and Hanken-based onboarding body typography.

### Verification

- `pnpm typecheck` clean with Node from the bundled Codex runtime in PATH.
- `pnpm test -- --runTestsByPath src/__tests__/theme.test.ts src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx src/__tests__/api-generation-contract.test.ts`: 4 suites, 144 tests passing. The Expo notifications SDK warning still appears from the existing test import.
- `pnpm exec expo-doctor`: 18/18 checks passing when run with `/Users/mac16/.nvm/versions/node/v22.23.0/bin` in PATH. The bundled Codex Node runtime lacks `npm`, which makes Expo Doctor's npm-spawning checks fail.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- Not pushed to GitHub per product-review instruction.

## 2026-09-07: Onboarding writer branch and filter-chip overlay polish

### Changed

- Reordered shared onboarding to ask name first, then genre interests, then the
  Reading/Writing/Both purpose question.
- Added the broader genre-interest picker with emoji chips and a stable mapping
  from the first selected create-compatible genre into the writer story flow's
  initial genre chip.
- Routed Writing users through the two writer setup screens before story
  creation: `What do you want to write?` and `What usually stops you?`.
- Changed writer chapter length/count filter menus to absolute overlays so
  opening a menu no longer stretches the section or moves nearby content.
- Updated the onboarding and design-system docs for the new branch contract and
  filter-chip behavior.
- Resolved CodeAnt PR feedback by preserving writer setup context past the
  shared onboarding branch, labelling the actual OTP text input, surfacing
  retryability from shape-story failures, and evicting failed warm shape
  requests so Retry performs a real new request.

### Verification

- `pnpm test -- --runTestsByPath src/__tests__/katha-onboarding-flow.test.jsx src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: 3 suites, 79 tests passing. The existing React Native `SafeAreaView` deprecation warning still appears in the new onboarding test.
- `pnpm typecheck` clean.
- `pnpm lint` exits with 0 errors and the existing warning set.
- `pnpm exec jest --runInBand`: 27 suites, 270 tests passing.
- `pnpm exec expo-doctor`: 18/18 checks passing with local Node 22 in PATH.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- `deno test --allow-env --allow-net supabase/functions/_shared/story-shape.test.ts`: 17 tests passing.
- `deno check supabase/functions/shape-story/index.ts` clean.
- Mandatory security scan completed before push: no new hardcoded secrets,
  injection sinks, auth regressions, or PII logging were found in the changed
  surfaces. `pnpm audit` reports 2 high vulnerabilities, both ignored by the
  existing patched advisory policy.
