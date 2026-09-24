# Katha AI Build Log

<!-- markdownlint-disable MD013 -->

## 2026-09-21: The preview had been reviewing a branch, not main

Raised by the founder: *"can you check what I'm checking on my local is actually
the code we have in main"* -- asked because deploys had sometimes run ahead of
merges, and he wanted to know whether what he was signing off was real.

### What was actually wrong

Production was clean. All three layers matched `main` exactly: 90 migrations
applied of 90 in the repo, 37 edge functions deployed of 37 in the repo, and
#115's code was confirmed *inside* the live `continue-story` and
`generate-story-stream` bundles by downloading them and searching for a symbol
only #115 introduced. Nothing was deployed that was not merged, and nothing
merged was waiting to deploy.

The drift was on the desk, not the server. The preview on :8090 had been served
for ten hours out of `Katha-AI-wt-genre-music`, a lane worktree on
`codex/ci-cost-and-offline-gate`, which predated #121. So Reimagine was being
looked at in the design #121 replaced. The tree was clean and the page worked;
there was no symptom. A preview pinned to a lane worktree does not break when
main moves, it just quietly stops being the answer to the question being asked.

### The fix

`scripts/preview.sh`, and a rule in AGENTS.md: **the preview shows main, and
only main.** It owns `~/Katha-AI-preview` (branch `local-preview`, tracking
`origin/main`), hard-resets to `origin/main`, reinstalls when the lockfile
moved, frees the port from whatever else holds it, and prints the commit it is
serving so the state has a name. It refuses to start on a dirty tree rather
than serve something it cannot identify.

`expo/README.md` and `expo/DESIGN.md` said "run Expo web on 8090" and "start or
reuse the Expo web server on port 8090" -- the word *reuse* being precisely the
trap, since the thing reused was some other lane's branch. Both now send
pre-merge review to 8091 and note that edge calls fail CORS there, because 8091
is not in `ALLOWED_ORIGINS`.

### What review caught

CodeAnt raised five Major findings on the first cut, and all five were real:

- **`--no-sync` contradicted the guarantee.** A documented flag that serves
  "whatever is checked out" defeats the entire point of the script. It is now
  `--offline`, which skips the *fetch* and nothing else: dirty-tree refusal and
  the hard reset to the local `origin/main` still run, and it prints that the
  ref may be behind rather than implying it is current. There is deliberately
  no flag that serves an arbitrary checkout.
- **The `.env` line in the setup help was wrong.** It read
  `cd "$WORKTREE/expo" && ... && cp <src> expo/.env`, which resolves to
  `$WORKTREE/expo/expo/.env`. Reproduced (`cp: expo/.env: No such file or
  directory`) before fixing. AGENTS.md had it right; only the script's own
  help text was broken, which is the copy someone hits when the worktree is
  missing.
- **`KATHA_PREVIEW_PORT` was honoured by Expo but hardcoded as 8090 in the
  banner**, so the script sent you to a server it had not started.
- **No locking between concurrent runs**, so two agents could interleave a
  reset with an install, or kill the server the other had just started. A
  `mkdir` lock now covers the prepare phase, released before `exec` because
  `exec` replaces the shell and the EXIT trap would never fire.
- **Re-running rebooted a preview that was already correct.** The fix for that
  had a bug of its own: Expo holds the port with more than one process, and the
  pid `lsof` lists first reports a cwd of `/`, so testing only that pid never
  matched. It now checks every pid on the port. Found by testing the path
  rather than by reading it -- the first version looked right and silently
  never triggered.

### Note on the diagnosis

The first pass reported this backwards: `ReimagineSheet.tsx` was called the new
file and `RepromptSheet.tsx` the deleted one. It is the reverse -- #121 removed
`ReimagineSheet` and added `RepromptSheet` plus `reimagine-seed.ts`. The
conclusion held, but a two-dot `git diff` was read as though it ran the other
way. When a diff is the evidence, name which side is which before drawing from
it. A verification step also reported "0 occurrences" of #115's symbol in the
live bundle -- a broken shell pipeline, not a missing deploy, caught only by
checking that the bundle was readable at all before believing the number. A
check that can fail silently to zero needs a control that proves it can find
something.

## 2026-09-20: Music coverage was tested against 12 genres, not 17

PR #118, prompted by a challenge on whether #116 had actually been tested.

### The gap

A story reaches the reader carrying one of `GENRES` (17), not one of
`UI_GENRES` (12). The five Create does not offer -- `romantasy`,
`darkRomance`, `thriller`, `contemporary`, `poetry` -- live on older stories
and Katha Originals, and **there are `contemporary` stories in production
today**.

All 17 do resolve to a track; that was checked against the real catalogue
rather than assumed, and all 110 production stories use genres the catalogue
covers. So nothing was silent. But the test only walked `UI_GENRES`, so had one
of those five been missing, nothing would have failed -- that genre would have
opened in silence, no error anywhere, for a slice of stories nobody was
watching. The test walks `GENRES` now, which also makes it the guard for the
next genre added to the taxonomy.

### Both story paths were traced

A saved row goes through `mapStoryRecord`; a story still being generated goes
through `provisionalStory(session)`, which the reader uses before the story
exists server-side. Both set `genre` to a validated `Genre`, and both render the
same `ReaderScreen` -- there is one reading surface, not two.

The backend's `PrimaryGenre` union has **19** members to the client's 17
(`cozyFantasy`, `paranormalRomance`). `isGenre` in `api.ts` catches those and
falls back, which is what keeps an unknown genre playable.

### Known and not fixed

During creation the reader identifies the story by **session** id; afterwards by
the **server story** id. The default track is hashed from the story id, so a
brand-new story's first live read can use a different one of its genre's two
tracks than every later read. "The same story always opens on the same track"
holds per id, not across that handoff. Cosmetic -- nobody memorises which of two
ambient tracks played -- so it was left rather than widen the PR.

## 2026-09-20: A story opens with music for its genre, and the tracks are not in the app

PR #116.

### What a reader gets

Opening a story fades in one of its genre's two tracks over about two seconds,
at 0.45 rather than full volume. The same story always opens on the same track
(hashed from the story id), and two stories in a genre differ. **The track
loops** -- a chapter outlasts three minutes of music many times over, and music
that stopped partway would be worse than none. Narration ducks it to 0.1 and
restores it on stop.

Fantasy and romance have their own tracks now instead of borrowing folktale and
slice-of-life; they are the two most-picked genres on Create. Romantasy borrows
fantasy, which is nearer than folktale was.

### Choosing left the reader

The track picker is deleted. The Music control in the reader chrome only mutes,
drawn as the Music glyph with a rotated 1px strike (lucide has no music-off
glyph, and drawing the rule keeps the on and off states the same shape and
weight). Mute is global and immediate.

Picking background music is a setting, not something to do mid-chapter, and the
old per-story selection left a growing map of dead story ids behind. Per-genre
defaults are stored and read by the reader already (`katha.reader.music-genre.v1`);
**the Profile surface that writes them, beside the narration voice, is not built
yet.**

### 26 MB did not belong in the download

The tracks were bundled in `expo/assets/music/`. That put 26 MB on every
download for a feature a session may never hear, and made adding a track an
app-store release. They moved to the public `music` bucket; `src/lib/music-cache.ts`
fetches one on first play and caches it to the device, so a track is normally
fetched once per device and played from disk after that. Normally, not always:
the cache directory is the right home precisely because the OS may reclaim it
under storage pressure, and the only cost of that is one more download.

Two callers asking at once share one download, so nothing fetches a track twice
concurrently -- the case that motivates it, a Profile preview and a story
opening, cannot happen until Profile exists. A failed fetch falls back to
streaming and retries next time rather than caching the failure, and a
zero-byte file from a dead download is treated as a miss instead of being
served as audio forever. Nothing in that path throws into opening a story:
silence is the worst case.

### Two races CodeAnt caught

**A mute pressed before the saved preference loaded was undone.** The restore
applied the stored value unconditionally, so the music started a moment after
the reader silenced it. The comment above that code already claimed a choice
made by the person beats a value read from disk; nothing implemented it. See
AGENTS.md, "An async restore must never overwrite a choice already made".

**Clearing the cache while a track was downloading left the track behind.** The
download finished after the delete and wrote its file back. A generation counter
now makes a pre-clear download remove its own file, and the clear awaits the
in-flight set so it cannot resolve while a file is still landing.

The first test for the mute race **passed with the fix reverted** -- the mock
read storage after its gate, so it returned the value the press had just
written. See AGENTS.md, "A regression test is not done until it has failed".

## 2026-09-19: Create's dropdowns move under More options, and two bugs that stopped the app being usable at all

Three PRs: #109 (the Create flow), #111 (the paywall), and the client half of
#107 (visibility).

### The app could not boot, and nobody had noticed

`Font.loadAsync(...).then(setFontsReady)` in `App.tsx` had **no `.catch`**. The
promise rejects -- on web `expo-font` gives up after six seconds -- and the
rejection left `fontsReady` false forever. `LaunchScreen` IS the app until that
flag flips, so the splash screen was permanent: no error, no timeout, no way
out but a reload. It reproduced on every local web boot on 2026-09-19, which is
how it was found -- while trying to look at something else entirely.

A missing face now falls back to the system font and the app opens. The failure
goes to `captureError` (`client.app`, `font_load_failed`), because a boot that
silently lost the brand face is invisible to the reader and worth counting.

**This would have shipped in the first AAB.** A store build on a weak network
is an app that opens to an orange screen and stays there.

### The paywall's X did nothing

`leavePaywall` awaited `enableNotifications()` before `go("welcome")`, guarded
by a try/catch whose own comment said "a permissions module that throws must
not strand somebody on a paywall they have already dismissed". The guard named
the right danger and guarded the wrong shape: on web,
`Notification.requestPermission()` does not reject when the browser's
permission bubble goes unanswered -- it stays **pending**. A promise that never
settles is not a throw, so the catch never saw it.

The wait is bounded at 4s now (`PERMISSION_WAIT_MS`). A late answer is still
recorded if the flow is still mounted, so nothing is lost by not waiting. The
regression test hands it a promise that never settles and asserts the welcome
screen is reached anyway; it fails against the old code.

Worst on web, where the bubble is non-modal. On native the dialog is modal and
normally settles -- but "normally" was doing the same work the try/catch was.

### Every dropdown under More options, and the menu opens where you tapped

Story mode, Chapters, Chapter length, Chapter cover, Image style and Who can
read it moved inside More options; menus list plain labels and their
explanations moved to a "?" card. **Who can read it defaults to Public.**

The reported bug -- "I click Language and it opens somewhere else" -- had three
causes, and all three are fixed:

1. **The flip threshold was also the height floor.** `MENU_MIN_HEIGHT` says
   "less than three rows below is worth flipping for". Used as a floor on the
   height too, a short window or a raised keyboard meant `Math.max(room, 160)`
   drew a menu taller than the room, hanging off the edge into a region a
   ScrollView cannot scroll through -- re-creating the exact bug the placement
   logic was written to fix. The height is now whatever the chosen side has.
2. **An upward menu was pinned by its top**, at `trigger - maxHeight`, which is
   only correct when the menu is exactly that tall. Language has one option, so
   it floated 320px above its own trigger and read as a different dropdown
   opening. Pinned by its bottom edge now.
3. **The menu painted at its fallback position** for the frame before
   `measureInWindow` landed, and `Keyboard.dismiss()` moves the trigger *after*
   that measurement is taken. It is held invisible until placed, and when a
   keyboard is up the measurement waits for `keyboardDidHide`.

A stale `measureInWindow` callback from a previous opening could also overwrite
a later one's position -- `menuId` comes from `useId` and is stable for the
life of the component, so every opening matched it. Each opening carries a
sequence number now.

Deliberately NOT done: `pointerEvents: "none"` on an unplaced menu. An
invisible view is still hit-testable, but the window is one measurement, and
making it untouchable means any platform where that measurement is slow
swallows real taps. The reasoning is recorded next to the style.

### A guest asked for public while the screen said private

With Public as the new default, the guest branch only *displayed* private and
disabled the control -- it never wrote the draft back. So a guest's request
said `public`, and a guest whose idea named a real person was shown the "this
cannot be public" modal about a story the UI had just called private. The
server applied `account_required` either way, so nothing broke; the question
was simply wrong. `handleGenerate` derives what is actually being asked for,
and a test asserts the guest's payload rather than only the disabled trigger.

### Verified in a browser

The Create flow was walked end to end at localhost:8090 using the dev auth
bypass (`authBypassed()` -- `__DEV__ && APP_ENV === "local"` -- which accepts
any address and any code without creating an account). All six dropdowns anchor
to their own trigger; Image style scrolls internally so every option is
reachable; the "?" cards explain while the menus stay plain; console clean.
Language was screenshotted on the first frame and a second later: pixel
identical, no jump.

**Verified at desktop width only** -- the browser would not resize. The
placement maths is exactly the kind of thing that behaves differently at 390px
with a keyboard up, so a phone pass is still owed.

## 2026-09-16: Profile, Credits, the streak ladder, and an account the store reviewer can use

### Changed

- **The product has no guests past the email step, so Profile stopped asking.**
  The "Sign in to keep all of this" card is gone, and signing out lands on the
  sign-in screen rather than quietly minting a fresh anonymous identity on
  Home. The header is now the avatar and the handle on one row with a pencil at
  the right, which is the only control that opens the identity sheet.
- **Everyone gets a name and a face before they pick one.** `ensure_identity`
  assigns a handle (`adjective_noun_NN`, checked against the reserved list) and
  one of 36 creature avatars at bootstrap, so a new account is never a grey
  circle called "Your profile". The creatures are 256px WebP, 99 KB for the
  whole set, and the identity sheet offers all 36 plus the existing photo
  upload. A photo clears the creature and a creature clears the photo: the two
  cannot both be the answer to "what does this person look like".
- **The streak ladder is five rungs and it rises.** Day 2/5/10/15/21 pay
  2/4/6/8/10 credits — 30 once, then nothing, ever. The old 2/7/5 shape peaked
  in the middle and its last rung was its smallest, which reads as a mistake to
  anyone meeting it cold. `streak_ladder()` is the record; the client carries
  the same five as a fallback for a deploy that has not answered yet.
- **A milestone is achieved when it has a date, not when it has a row.** The
  server returns a row for every rung, reached or not. Reading the row's
  presence lit up all five the moment a brand-new account opened Your journey —
  caught in the browser, not by a test, and now pinned by one.
- **The activity grid is one dot per day in the brand orange, or a muted one.**
  The shading levels are gone. They invented a second, louder definition of a
  good day, and told somebody who read one chapter that their day counted less.
- **Home greets once.** The line and the name are two Text elements now, and no
  phrase in the rotation addresses the reader, because the name sits directly
  beneath it. "Morning, storyteller" shipped for exactly one browser pass and
  greeted the same person twice.
- **Credits became the screen everything about credits lives on**: the balance
  in the corner, Plus and the packs above the fold, how credits work lifted
  verbatim from the pricing doc, then the three free sources — the streak, a
  claim against a comment you left, and an invite code — and the real ledger
  underneath, which had been seed data.
- **The report sheet is the one Play asks for.** Copyright, story content,
  cover image, other, with details optional, reachable from the story page and
  from the reader's overflow menu.
- **`Get more` is a View, not a button.** It sat inside the row's own Pressable,
  which react-native-web renders as a button inside a button: invalid HTML, a
  hydration error on every web load, and a row that stops responding.

### Verification

- `pnpm typecheck` clean. `pnpm lint`: 0 errors, 29 pre-existing warnings.
- `pnpm exec jest`: 126 suites, 1240 tests passing.
- `pnpm exec expo-doctor`: 18/18. `expo export --platform web` compiled, all 36
  creature assets present in the bundle.
- Browser pass at 390x844 against the deployed backend, signed in as
  `reviewer@thetractionlabs.com` with the fixed code: the ladder, the member
  state, the packs sheet, the invite code and the ledger all rendered from the
  server rather than from seed.
- **Not verified on web, and it cannot be:** RevenueCat is disabled there, so
  the packs sheet shows its prices and a disabled Purchase. Price strings,
  purchase, restore and Customer Center need an Android dev build.
- **`expo/.env` now sets `EXPO_PUBLIC_APP_ENV=development`.** At `local`,
  `authBypassed()` makes `verifyEmailCode` return success without verifying
  anything, so every sign-in silently stayed on the guest identity and the
  reviewer path never ran. That scaffold is pre-existing and `__DEV__`-only;
  the env file is gitignored.

## 2026-09-10: Search moves to Explore, and Home's corner tells the reader about themselves

### Changed

- **Home has no search box, and no magnifier either.** Tapping the magnifier
  used to bounce the reader over to Explore, which meant Home advertised a
  feature it did not have and Explore inherited a search the reader had
  already started somewhere else. Search now exists in exactly one place. What
  took the corner instead is the reader's own standing: their **streak**,
  their **credits**, and a **notification bell** — the three facts about
  *them* that change between one morning and the next. Each is a real 44x44
  target with its own spoken label ("Reading streak: 6 days", "42 credits",
  "Notifications"), rather than the old 40pt avatar with a credit number
  stuck to its corner as a badge. The avatar is gone; the "You" tab is already
  a permanent door to the profile and the header does not need a second one.
- **The streak is real or it is not there.** There is a `streaks` table, and
  until now nothing in the app had ever read it — the only other place a
  streak appeared was a hardcoded "3-day streak" on the profile. The number in
  the header comes from that row, written by `touch_streak` when a read is
  recorded. Every other case — no session, no row yet, a lapsed streak, a
  failed request — draws **nothing at all**. A flame that invents a day count
  is a claim about the reader they have no way to check, shown to them every
  single morning, and a gap is the honest version of not knowing.
- **The bell is honestly quiet.** There is no notifications table and no
  inbox, only push tokens and follows, so there is nothing that could be
  unread. The unread dot is wired to a count the header already accepts and
  simply never fires today, rather than being faked or hardcoded off.

### Added

- **Explore is a real discovery surface.** It opens on a browsable page rather
  than a blank one: with nothing typed and no genre chosen it shows the
  catalogue's most loved, and a line above the list says what the reader is
  looking at ("Most loved", or a genre name, or "12 results"). That is the
  right default because a reader who arrives without a question has not failed
  to use the screen, and the honest answer to "show me anything" is what other
  readers liked most.
- **A search field that queries the live catalogue** — title, story summary
  and author handle, in one query. There is no search endpoint, so the query
  goes straight to PostgREST from `src/lib/search.ts` and mirrors the `feed`
  function's visibility rules clause for clause: complete stories only, public
  or curated only, never explicit, never an author the reader has blocked. A
  row the feed would hide is a row search cannot return. Author handles resolve
  through `profiles` first and join the same `or` as title and summary, so
  "search by author" is part of one result list rather than a second one
  stapled on.
- **Searching feels instant, and it cannot go backwards.** A word typed at
  speed is one request, not one per keystroke; the request being replaced is
  aborted; and — the part the first two do not fix — every run carries a
  sequence number so an older answer arriving last is discarded rather than
  painted over the newer one. Without that guard, typing "wolf" then "wolves"
  on a slow connection can leave the reader looking at results for a word that
  is no longer in the box, with nothing to retry and no way to tell.
- **Every genre, as one horizontal strip**, in the create brief's own emoji
  chip language — the 🐉 Fantasy a reader picked to write with is the 🐉
  Fantasy they meet when they go looking to read. One genre at a time, and
  tapping the selected chip clears it. Multi-select was the alternative and it
  narrows nothing: a multi-genre choice has to mean *or*, and an *or* across
  most of a twelve-genre list returns the whole catalogue while looking like a
  filter. There is no "All" chip, because no selection already means every
  genre.
- **Four states, each saying something different.** While a query is in flight
  the screen says it is looking rather than claiming nothing matched. A search
  that found nothing names the term and offers three genres as a way out, one
  tap each. A genre with nothing published in it says so — a catalogue gap,
  not a failed search — and offers the whole catalogue back. And when the live
  catalogue cannot be reached at all, the bundled stories are filtered
  instead and the eyebrow says "offline catalogue" rather than passing a
  handful of seed stories off as the library.
- **Results use `StoryFeedCard`**, the same card Home's rails are built from,
  so a story looks like itself wherever the reader meets it. A live result is
  not in the bundled catalogue, so opening one fetches that single story's
  chapters first and hands the whole story to the navigator — search itself
  carries metadata only, because paying for twenty-four chapter bodies to draw
  twenty-four covers would make the fast surface the expensive one.
## 2026-09-10: Library stops making things up, and Notes gives the phrases a home

### Changed

- **Library had four tabs and three of them were fiction.** "Saved" was
  `stories.filter(s => s.bookmarks > 100)` — a popularity filter wearing the
  reader's own label, so it listed stories they had never opened and hid every
  one they had actually starred. "History" was `slice(0, 5)` of whatever the
  feed array happened to hold, presented as what they had read. "Comments" was
  a permanent empty state with nothing behind it at all. Three of four tabs
  were telling a reader things about themselves that were not true, which is
  worse than a shorter Library, so this is a shorter Library: **Created**,
  **Starred**, **Notes**. History comes back the day something actually
  records a read.
- **Created is the writer's own rows.** `fetchCreatedShelf` in `lib/api.ts`
  reads `stories` filtered to `author_id`, private ones included, and the
  stories written in this session are merged in ahead of it so a story made a
  minute ago is in Library before the fetch lands. The session copy wins on a
  collision: it carries the beats and series state the shelf query does not
  select. Empty invites them to write.
- **Starred is the `bookmarks` table.** `fetchStarredShelf` reads the reader's
  own bookmark rows newest first, hydrates the stories behind them and keeps
  that order. Empty explains what starring does and offers Explore.
- **Every shelf can now say "we could not load this".** `StoryShelf` has three
  states, not one. Collapsing a failed fetch into an empty state is how an
  interface tells a writer their work is gone when it is only unreachable; a
  failed shelf says so, keeps whatever it already had on screen, and offers a
  retry.

### Added

- **Notes: language learning reinforcement.** A header row with the switch and
  an info affordance, an explanation of what saving a phrase actually buys
  (repetition without drilling, the same phrase in a new context each time, a
  memory attached to a story rather than a flashcard), an **Add phrases**
  button, and the reader's saved phrases below it with a remove on each.
- **The Add phrases sheet** takes a language, then one field for the whole
  list. `parsePhraseInput` splits on commas, newlines and semicolons, trims,
  drops blanks, drops anything over the 160-character column limit, and dedupes
  case-insensitively against what is already saved — so pasting the same list
  twice adds only what is new. A live counter runs against a 1000-character
  limit, and the sheet says what it made of the paste ("3 phrases ready · 1
  already saved") before anything is written. A save that did not happen leaves
  the sheet open saying so rather than closing on a lie.

### Known gaps

- **The reinforcement switch reaches the device and nothing else, and that is
  deliberate rather than finished.** Weaving happens in `generate-story`,
  which calls `fetchPhraseSeeds` on `saved_phrases` for the requesting user and
  consults no preference at all. There is no column to write and no request
  field the function would read. The preference is persisted under
  `katha.phrases.reinforcement.v1` and read back on launch; sending a flag into
  a void and calling the feature done was the alternative. **To make it real:**
  a `phrase_reinforcement_enabled boolean not null default true` on
  `profiles`, a read of it in `fetchPhraseSeeds` (return `[]` when off), and a
  client write on toggle.
- **A phrase typed into Notes stays on the device.** `save-phrase` requires a
  `storyId` and `chapterId` that resolve to real rows, and `save_phrase`
  (00047) re-checks that the chapter belongs to the story, so there is no
  request a manually typed phrase could send that the endpoint would accept.
  Those records are marked `manual` and left unsynced, which
  `mergeSavedPhrases` already reads as the reader's unsent work, so a server
  refresh lists them beside the captured ones instead of deleting them. **To
  make it real:** `saved_phrases.story_id` and `chapter_id` become nullable,
  `save-phrase` accepts a body with neither plus an optional `language`, and
  the manual path in `lib/phrases.ts` syncs like the captured one.
## 2026-09-10: A profile you can actually edit, a streak that is real, and somebody else's page

Branch `fable/profiles`. Nothing deployed; nothing run against
`iafeuxgoiknncgyjmugd`.

### Two surfaces, and they are different products

**Your own profile** (`ProfileScreen`) now leads with the streak instead of a
settings list, because the streak is the only thing on that screen that changes
between two visits and the only thing with a deadline. Under it: best streak,
stories, chapters, reads, likes, phrases saved, followers, following — every one
a count of rows returned by `profile_overview`, and every one absent rather than
zeroed when the request fails. A writer with forty published chapters must never
be told they have written nothing because a request timed out.

**Somebody else's profile** (`AuthorScreen`) is reachable from a byline and a
comment author, as before, and now shows a real person: handle, picture, bio,
how long they have been writing, a Follow button, their public stories, and four
counts taken over exactly those stories. It no longer renders anything from the
client's own story array — a private draft, or a story the entity gate kept
private, could previously have been listed there by author id.

### Changed

- **Editable handle.** `IdentityEditor` sheet: pick or change `@handle`,
  validated on every keystroke against the same rule the database enforces
  (lowercase, letters/digits/underscore, 3–20, no edge underscores, a reserved
  list). "Taken" comes back from a caught unique violation on the server, not
  from an availability check, so two people typing the same handle at the same
  instant get one winner and one honest refusal — with their text still in the
  field.
- **Avatar upload.** `expo-image-picker` (already a dependency) plus
  `expo-image-manipulator` (added, `~14.0.8`). Square crop, downscaled 512 →
  256 → 160 until the encoded image fits under the endpoint's body limit, JPEG.
  A refused photo permission returns immediately with one explanatory line and
  no picker, no alert and no retry loop; the rest of the profile keeps working.
- **The streak is real.** `streakState()` reads the server's UTC day and reports
  one of four things: no streak, counted today (calm), ends tonight (the only
  state allowed to use the accent), or broken (says so, and shows the best
  instead of dressing a zero up as a streak). A milestone is named only within
  three days of one, and nothing is promised for reaching it, because nothing is
  awarded for reaching it.
- **Follow/unfollow** is optimistic with a true rollback: the previous flag and
  count are captured and restored on failure, never decremented a second time.
  A guest is stopped before the optimistic flip, so the button never turns
  "Following" and springs back.
- **Guests** get one clear card explaining what an account keeps, instead of a
  profile full of honest and useless zeros.
- **Parental controls row removed.** It opened a "coming soon" alert and the
  owner's decision is that the product does not need them for now.

### Verification

- `pnpm typecheck` clean.
- `pnpm lint`: 0 errors, the existing warning set unchanged.
- `pnpm exec jest`: 92 suites, 871 tests passing (from 90 / 840).
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-profile`
  compiled the web bundle.

## 2026-09-10: The cover finally arrives, and Home is put in the reader's order

### Fixed

- **A freshly written story kept its placeholder forever.** The art was being
  painted, the file was in the bucket and the row said `ready` — the app was
  simply never told. `CreateStudioScreen` used to poll for it; when generation
  moved into the module-level session store the poll was not moved with it, so
  a story written this session showed its genre gradient in the feed, on the
  story page and in the library until the app was fully reloaded and the row
  refetched. `generation-session.ts` asks again now, from the moment the
  chapter is persisted, and writes the answer onto the session's story — which
  is what every screen is already subscribed to, so the Home rail, the story
  page and Library repaint together. Nothing new appears on screen while it
  runs: the placeholder rule is unchanged (genre gradient, no spinner, no
  copy), and the art fades in over `motion.base` when the URL lands. The poll
  backs off from 4 seconds, caps at 12 asks — a little over two minutes — and
  then stops politely; a cover that has not landed by then is picked up from
  the database on the next launch. It stops the instant the cover settles
  either way, and it leaves no timer behind when the session is retried,
  dismissed or forgotten.

### Changed

- **Home is in the order the reader would put it in.** Your stories, then
  Continue reading, then Katha Originals, then one shelf per genre they chose
  in onboarding. What used to lead the page was a big black "Continue reading"
  hero card that picked a featured story and printed "40% read — Chapter 2
  waits" beside it: a claim about the reader that nothing had ever measured.
  The hero card is gone. Continue reading is a named rail like every other
  shelf, with the same cards, making no claim it cannot back — and it is the
  single place a real read-progress signal drops in when there is one.
- **Popularity is answered inside a genre the reader actually asked for.**
  Each chosen-genre rail is ordered by reads, so "what everyone is reading" is
  now something they see in Romance or Thriller rather than as a global chart
  they have no stake in. The generic "Trending now" and "Most loved" rails
  survive only for a reader who chose no genres at all — without a signal
  there is no personal shelf to build, and a page that ends at Originals is
  shorter than the scroll deserves. A chosen genre nothing has been written in
  yet is skipped rather than rendered as an empty shelf.
- **"Write another story" is an invitation now, not a settings row.** It was a
  flat pale-peach band with a plus and a chevron. It is a full card with an
  eyebrow, a title and a supporting line ("A genre, a name, one idea. Katha
  writes the rest."), which rises and fades in on mount and settles under the
  finger on press — both `useReducedMotion`-aware, both transform and opacity
  only. It sits directly under the greeting, above the first rail, because the
  top of the scroll is the only place an offer reads as an offer rather than
  as the footer of the section above it; it also holds the visual weight the
  removed hero card used to carry. Still one tap target, still one accessible
  name.
- **Two CTA treatments ship behind one constant** while the product owner
  picks: `WRITE_CTA_VARIANT` in
  `src/components/feed/WriteAnotherCTA.tsx` is `"gradient"` (an orange field
  with white type) or `"editorial"` (a white card with an accent rail on its
  leading edge). Flipping that one line switches the screenshot; nothing else
  changes, and the copy, anatomy, tap target and motion are identical in both
  so the comparison is only ever about how it looks.

### Verified

- `pnpm typecheck` clean, `pnpm lint` 0 errors,
  `pnpm exec jest` 76 suites / 653 tests green (from 74 / 632),
  `pnpm exec expo export --platform web` compiles.
## 2026-09-10: The starters move behind one control, and the app gets one switch

### Changed

- **"TRY ONE" and its three cards are now a single "View ideas" pill.** The
  brief printed the three genre starters inline under the story-idea box.
  Each one is two sentences of prose on purpose — that is what teaches a
  writer what a usable idea looks like — so three of them plus a heading ate
  most of the first screen, and Premise, Who's in it and the length controls
  started below the fold on the one screen where a writer decides what to
  write. Owner feedback on the running screen: "reducing the spacing and
  keeping this more neat". Nothing was deleted: the same starters open in a
  bottom sheet from one 44pt pill, and the fold now falls below the cast.
- **The ideas open in a bottom sheet, keyed to the genre chip.**
  `src/components/create/IdeasSheet.tsx`. A sheet rather than a popover
  because a starter is prose and the `Dropdown` is built for one-line options
  at a 320pt cap; a sheet rather than a pushed screen because this is a detour
  off the idea box, not a step of the brief — the box stays visible behind the
  scrim and there are three ways back to it (close button, scrim, hardware
  back), none of which choose anything. The list is derived from the `genre`
  prop at render rather than copied into state on open, so changing the genre
  chip and reopening gives the new genre's ideas. Tapping one fills the idea
  box and closes on the tap; there is no confirm step to give.
- **Every genre has three starters and always will.** `GENRE_STARTERS` is a
  `Record<Genre, string[]>`, so a genre added to the union does not compile
  until someone writes them, and a test asserts three apiece across `GENRES`.
- **There is one switch in the app now: `src/components/Toggle.tsx`.** The
  brief's four toggles were React Native's `Switch` under a spread of colour
  props. That control paints its thumb and its off-state fill from the
  *platform* palette, so a prop a caller forgets is not a missing colour, it
  is iOS green — which is what Kids Mode shipped: an orange track under a
  green thumb, and green appears in no token file in this repository. `Toggle`
  draws every pixel itself out of `@/theme` and has no platform fallback left
  to fall back to. It is the onboarding selection treatment (accent when on,
  warm neutral when off, white knob), ported through tokens rather than copied
  out of `KathaOnboardingFlowV2`'s private `C` palette.
- **All four toggles converted**: Kids Mode, Chapter art, Make it public, and
  Lead character in Craft character. A grep for `Switch`, `SWITCH_COLORS` and
  `accessibilityRole="switch"` finds nothing else in `src/` — the reader's
  voice and theme controls are segmented pickers, and the create flow's value
  and character chips are checkboxes.
- **A disabled toggle reads as disabled, not as off.** "Make it public" is
  disabled for a signed-out writer; drawn in the off colours it told them the
  story was private by their own choice, which is a lie they cannot act on. A
  disabled toggle keeps its position and a tint of its state — `accentSoft`
  when on, `border` when off — and drops the thumb shadow, so it reads flat
  and inert.
- **Geometry is a token, not a component constant.** `controls.toggleTrackWidth`
  52, `toggleTrackHeight` 32, `toggleThumb` 26, `toggleInset` 3,
  `toggleHitTarget` 44. The control is 52 x 32 and the *target* it answers to
  is 44 x 44 plus 6pt of `hitSlop`, which is why those are two numbers.
- **Motion is one shared value.** It cross-fades the accent fill and slides the
  thumb over `motion.fast`; `useReducedMotion` makes the state arrive rather
  than travel, and never suppresses the change. No colour interpolation runs
  on the UI thread.
- **`DESIGN.md` carries the Toggle recipe** and a drift-prevention line: a new
  `Switch` import, or a second hand-rolled track-and-thumb, is drift.

### Known gaps

- **Onboarding's own "Try one" rail is untouched.** `WriterOnboarding` still
  stacks the starter cards inline. That screen has one job and nothing below
  the fold to protect, and the owner's note was about the create brief, so it
  was left as it is rather than changed on inference. If it should match, it
  is the same sheet and a one-line trigger.
- **`DESIGN.md`'s Core Tokens table has drifted from `theme.ts`** — several
  hexes there (`bg`, `surface2`, `border`, `borderStrong`) predate the ramp
  retune documented in `theme.ts`. Not touched here; the Toggle recipe names
  tokens rather than hexes for that reason.

### Verification

- `pnpm typecheck` clean, `pnpm lint` 0 errors,
  `pnpm exec expo export --platform web` compiles.
- Two new suites: `toggle.test.tsx` (5) and `ideas-sheet.test.tsx` (10).
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
## 2026-09-10: The story page comes back into the light, and a comment that was lost stops being lost

The design handoff made the story page the one dark surface in the app so the
cover would have nothing to dissolve against. The owner overruled that on the
screenshot. What follows is his feedback, built.

### Changed

- **The page is light again, and the cover still has no edge.** The dark
  ground was the wrong half of the idea. What the dissolve needs is for the
  fade and the page to be the *same* colour, and that is as true of
  `colors.bg` as it was of `#1C1A17` — so the cover still runs full-bleed for
  62% of the window with no card, no border and no radius, and its bottom now
  ends on exactly the warm ground every other screen uses. One dark page in a
  light app read as a different product the moment you arrived at it.
- **The floating controls are proven, not eyeballed.** Close, comments, save,
  share and more sit on white discs at 92% over whatever the cover happens to
  be. `story-page-light.test.tsx` composites the disc over a blown-out white
  cover, a black night cover and a mid-brown one and asserts the glyph clears
  WCAG AA on all three. It also found something: the saved star at
  `colors.accent` measures **2.85:1** on that disc — under the 3:1 floor for a
  graphical object, which meant the *saved* state was the state hardest to
  see. It is `colors.accentPressed` now, which clears it over every cover.
- **Three stat icons gone.** Reads / likes / saves sat under the CTAs as three
  big numbers. Two of them duplicated the star at the top of the page, and a
  read count on a product with no readers yet can only ever argue against
  opening the story.
- **"About this story" gone, the prompt block gone, the inline comment thread
  gone.** The first two restated the chips and the summary as a two-column
  table; the third put a whole thread at the bottom of a page whose only job is
  to get someone into the story. The AI-fiction disclosure on an Educational
  story survived the strip-down, because it is the one line here a reader needs
  *before* they decide to read.
- **The chips are genres and nothing else.** A romance was shelving itself as
  `Romance · premonition · duty · compassion · fear · sweet`. Four of those are
  notes the generator left about the plot and the fifth is a content setting.
  A tag now has to name a real genre to appear at all.
- **Comments moved to the top, behind an icon.** A speech bubble sits beside
  the star in the floating cluster with the count on it, and opens the same
  sheet, restyled light. The count comes from a new `fetchCommentCount` that
  reads the exact total the GET already returns, so the page can label the door
  without mounting the thread behind it.

### The comment that was not saved

The owner wrote a comment and it did not save. It was two failures stacked.

1. **The session was anonymous, and the `comments` function requires auth.** So
   the write was always going to 401.
2. **The client kept the comment on screen anyway.** The optimistic row was
   added and never taken back; the failure notice was a small line *above* the
   list, and the comment underneath it was the thing he was looking at. He
   closed the app believing it had gone somewhere.

Both are fixed, and the second matters more than the first: it is the one that
turned a refused write into a silent one.

- **Engagement is gated for anonymous sessions.** Saving, following, voting,
  replying and commenting now show a sign-in wall that names the thing you were
  trying to do. Nothing is optimistically updated first. **Reading stays open to
  everyone** — the wall is on writes, never on the story.
- **A failed write takes the comment back and returns the text to the box.** Not
  a toast over a comment that is still sitting there looking posted: the row is
  removed, the words go back into the composer, and the message says so. Same
  for a reply, and a failed vote is rolled back rather than left claiming a vote
  the server never recorded.

### Reporting

- **Report is no longer a button on the row.** It was one tap away from a
  stranger's opinion, and that is what it was used for. It lives behind a
  three-dot menu per comment now.
- **A report needs a description.** Reason-only reports are a bucket name a
  moderator cannot act on. The reporter has to say what happened (10 characters
  minimum — the floor under "x", not a quality bar), the submit button stays
  disabled until they do, and `reportContent` itself rejects a blank
  description so the rule cannot be routed around by a future caller. The
  backend enforces it too.
- **The confirmation is evidence now.** The sheet used to show "thanks, we'll
  look at it" whether or not the write succeeded. It shows the failure instead,
  with the description still in the field.
- **Comment reports actually reach the server.** The old sheet set a `submitted`
  flag and filed nothing at all. Nobody would have noticed until someone asked
  where the reports were.

### Removed

- **The downvote.** Not disabled, not hidden — absent. The vote API still takes
  `-1` for rows written before today, but there is no branch in this UI that can
  produce one, and `onVote` no longer takes a direction argument to get wrong.

### Also

- **A commenter's name and avatar are tappable** and route to that person, via
  the `author_id` the `comments` function was already returning and the client
  was dropping. The profile screen itself is later work; this fires the existing
  author navigation.
- `chapter_number` per comment still works — the `Chapter n` tag keeps its own
  test in `comment-thread-tone.test.tsx`.

### Verification

`pnpm typecheck` clean. `pnpm lint` 0 errors. `pnpm exec expo export --platform
web` compiles. Backend: `deno test` 714 passed / 0 failed, `deno fmt --check`
and `deno check` clean.
## 2026-09-10: Listen becomes a screen — the wait is owned, and the words follow the voice

### Changed

- **Listen opens a full screen, not a sheet with a dead button.** Tapping
  Listen used to raise a small panel over the reader with Play and a voice
  toggle on it; pressing Play on a chapter nobody had listened to did nothing
  visible, because narration is generated on first play and the panel had no
  way to say so. Listen now opens `ListenScreen`, and that screen's first job
  is to own the wait.
- **The preparing screen says what is actually happening, and changes when it
  changes.** Cover art fills the top; below it, on a solid ground, an
  illustration, a status line and one honest line under it. The status walks
  *Finding your narrator* → *Asking for the narration* → *Reading the chapter
  aloud*, and each step advances only when the previous one really finished:
  narration found on the chapter row, `generate-audio` answering, the job being
  accepted. Nothing on the screen is a progress timer pretending to be work.
- **When it takes too long, it says so.** Past the stated expectation the line
  becomes *Still reading* — "This is taking longer than it usually does. It is
  still running." Much further past it, *This is taking much longer than it
  should*, with a way out. Polling continues underneath, so a job that lands at
  three minutes still plays for whoever waited.
- **The playing screen is the transcript.** Cover art stays at the top; under
  it the chapter's own words scroll with the audio, the line being read
  highlighted on a soft accent ground and the lines already read dimmed. Tapping
  a line plays from it. Scrolling by hand stops the auto-follow rather than
  fighting the reader, and a "Back to the line" pill hands it back.
- **A real transport.** Story title and chapter title, a 68pt play/pause,
  elapsed against total, a draggable scrubber, and a row with Chapters, Speed
  (0.75x–2x), skip back 10, skip forward 30 and Next chapter. Every control is
  at least 44x44 and labelled; the scrubber is an `adjustable` with a stepper
  path, because a drag is not a gesture VoiceOver can make.
- **Both doors lead to the same screen.** The reader chrome's Listen control
  opens it on the chapter being read and Close returns to that chapter; the
  story page's Listen button opens it at chapter 1 and Close returns to the
  story page. The story page no longer refuses to open Listen for a story with
  no narration — that story is exactly the one the preparing screen exists for.
- **Every real state has a screen.** No narration yet, generation in flight,
  generation failed, the entitlement gate refusing, playback failing, and
  offline. The refusal never grows a Try again: `canGenerateNarration` answers
  the same way every time, so it is offered "Read it instead" instead of a
  button that cannot succeed.

### Notes

- **The transcript timings are an approximation, and are documented as one.**
  Nothing in the narration pipeline returns per-line alignment — `generate-audio`
  and `audio-status` answer with a status and a URL, and `chapter_audio` stores
  one `duration_seconds` for the whole file. `lib/transcript-sync.ts` therefore
  spreads the *measured* file duration across the lines in proportion to their
  length. Expect a line of drift over a long chapter, worst right after a pause.
  `buildCues` already takes real timings as an optional argument, so the day the
  pipeline produces them the change is to pass them in.
- **The loading animation is a seam, not a decision.**
  `components/listen/NarrationLoader.tsx` takes the animation as `art` and the
  rotating copy as `messages`; today it renders the looping Katha mark and two
  placeholder lines. The designed variant drops into those two props at the one
  call site in `ListenScreen`. The rotating messages are deliberately kept apart
  from the status line: they are decorative and say nothing about progress, which
  is why a message list can be chosen on taste without anyone auditing it for
  truth.
- **Closing the screen stops the audio.** There is no background audio mode in
  `app.json`, no lock-screen transport and no mini-player anywhere in the app, so
  narration the listener cannot see or stop would be worse than narration that
  ends. When a persistent mini-player exists, `ListenScreen`'s unmount cleanup is
  the one place to change.
- **`NARRATION_EXPECTED_MS` is an expectation band, not a measurement.** Nothing
  in the repository records how long `minimax-speech-02-hd` takes on a real
  chapter, so the copy says "usually" rather than naming seconds — and the same
  constant is both what the screen promises and the moment it admits the promise
  was wrong, so the two cannot drift.
- The four touched files outside the new ones are deliberately tiny: an
  `onListen` prop on `ReaderScreen` (forwarded through `PhraseCaptureReader`), an
  `onListen` prop on `StoryDetailScreen`, one `listen` variant on the `Screen`
  union, and the route plus two openers in `App.tsx`.

### Known gaps

- **One voice, no picker.** The screen narrates in the story language's female
  default (`aria`/`elvira`), which is what the old sheet defaulted to. Everything
  underneath is keyed by voice id, so a picker is a control plus one piece of
  state.
- **Generation is still gated closed in production.** `NARRATION_GENERATION_ENABLED`
  is unset, so the honest production path today ends on the "Narration is not
  available yet" screen. That is the correct answer for a closed gate, and the
  whole preparing flow is live the moment the flag is turned on.
## 2026-09-10: The reader's controls, a selection you can feel, and chips that tell the story what to do

### Changed

- **The reader's control sheet lost a word and found a button.** A "Pages"
  caption used to take a whole row's width to name the slider under it, beside
  a readout that already said "Page 7 of 15". The caption is gone; the readout
  stays, centred; and the height it was using went into the six controls, whose
  glyphs are 26px on 64px-tall targets instead of 19px on 44. The sheet's top
  corners came down from `radius.xl` (24) to `radius.md` (14) — at 24, on a
  390-wide sheet, the curve runs for most of the height of the first control
  row and the whole thing reads as a lozenge rather than a panel sliding up
  from the bottom edge.
- **The forward page control exists.** There was a back chevron at the left of
  the slider and empty space at the right. The forward one had been written as
  a `ChevronLeft` rotated 180 degrees through a `style` prop — a transform
  lucide hands to the SVG root, and one that does not survive every renderer.
  Both ends are now one `PageStepButton` with a real `ChevronRight`, so they
  cannot drift apart again: same size, same 48px plate, same hit slop. Each is
  disabled at its own end of the chapter and stays on screen while disabled,
  because a control that vanishes at the last page is the defect that was
  reported in the first place.
- **Long-press and drag selects text, and you can feel it.** Long-pressing a
  word used to save the sentence around it outright: one gesture, one guess at
  how much the reader meant, no way to see it first and no way to take a word
  off the end. It now anchors a SELECTION on that sentence — a light impact
  fires as the wash appears — and dragging grows or shrinks it word by word
  with a selection tick per word crossed. Nothing is written until the reader
  chooses. Tapping a single word still saves that word, unchanged.
- **A selection offers three things and no more.** **Save phrase** (the
  existing `phrases` backend, first because it is the default intent), **Copy**
  (its absence reads as a bug, not a decision) and **Share quote**, which sends
  the line with the story's name attached — readers already screenshot lines
  they like, and a screenshot carries no way back. "Look up" was rejected:
  there is no dictionary on React Native without a native module, and a control
  that silently does nothing on Android is worse than no control.
- **Saving a chapter edit is instant.** Save used to `await` the round trip
  with every control disabled and then hold a 1.2-second "Saved" state before
  closing — three to four seconds of a frozen notepad to persist text the
  writer was looking at. The edit is now accepted locally and the reader comes
  straight back with the new words on the page; the request runs in
  `lib/chapter-save-queue.ts`, outside the component tree, where unmounting the
  editor cannot cancel it. The header no longer says "Saving" or "Saved",
  because by the time either could be true the screen is gone.
- **A refused save is still told, in the reader.** The queue holds the exact
  text. If the write is refused, a banner appears over the page with the
  server's own reason, a **Retry** that re-sends what the writer typed, and a
  **Not now** for an edit they have decided to live with. Nothing anywhere
  reports success for a write that failed.
- **The edit field is quiet.** The chapter text area is `colors.surface` inside
  a hairline `colors.border` on a `colors.bg` ground — the same paper the rest
  of the app uses — and focus is one step of border weight (`borderStrong`),
  not a colour change. `outlineWidth: 0` stops the web build drawing the
  browser's own focus ring on top of it.
- **Chapter-end chips are directions now, not questions.** The source data was
  never the problem — the beats, open hooks, promised payoffs and pressure
  lines are real and specific — but hooks arrive phrased as questions, because
  a hook is a question. Rendered straight they read as a comprehension quiz:
  "Who is writing the predictive linen notes". `lib/directions.ts` puts a fixed
  English frame in front of the story's own words to point it the other way:
  "Find out who is writing the predictive linen notes." "What will happen if
  Anjali unfolds every sheet tomorrow" becomes "Show what happens if Anjali
  unfolds every sheet tomorrow." A yes/no question is un-inverted around its
  auxiliary: "Is the casualty girl Divya lying about having no brother" becomes
  "Find out whether the casualty girl Divya is lying about having no brother."
  Nothing is invented, and a sentence that cannot be converted grammatically is
  DROPPED rather than replaced.
- **"Write your own" is a third card.** It was a small muted text link under
  the cards, beside a second one called "Let Katha decide" — two lightweight
  controls competing for the same decision, both of them arguing visually that
  they were afterthoughts. It is now a card of the same width and weight as the
  two derived directions, reading "Write your own — or get a surprise", with a
  dashed edge as the one signal that this one is the reader's to fill in.
  Tapping it replaces the card IN PLACE with the composer, so the field lands
  where the finger already is: a title row with a close button, one line of
  register-teaching ("An instruction, not a question — 'Take Meera to the fort
  path.'"), an auto-focused field placeheld "Tell Katha what happens next.", a
  counter that appears only in the last 20% of the limit, and a footer holding
  **Surprise me** and **Continue · 1 credit**. "Surprise me" is the old "Let
  Katha decide" folded in where it belongs: it sends no instruction at all, so
  the model uses the plan and series state it already holds. Two derived cards
  plus this one is three, which is what Okudu shows and what fits a thumb.
- **The reader's comments are the story's own.** `ReaderScreen` carried three
  hardcoded comments in a module constant — "Mira R.", "Dev S." and "Aanya K."
  discussing a lighthouse metaphor — and rendered them under EVERY story. A
  brand-new story about a nurse in Kochi ended with three strangers admiring a
  lighthouse that is not in it, while the story detail page for the same story
  correctly reported zero. The thread comes from `lib/comments.ts` now, the
  same source the detail page reads, and a story with none says "No comments
  yet. Be the first to say something."
- **Engagement needs an account.** Like, Save, Follow and the comment box are
  gated for a guest through a new `onRequireSignIn` prop on `ReaderScreen` (and
  forwarded by `PhraseCaptureReader`), wired in `App.tsx` to the existing
  sign-in entry. The control stays visible and enabled — a hidden Like is a
  feature the guest never learns exists and a disabled one is a dead end — and
  a tap opens sign-in instead of writing to local state nothing will persist.
  Reading, page turning, search, preferences, narration and phrase capture stay
  open to everyone.

### Fixed

- **A tap with the keyboard up was spent dismissing the keyboard.** The reader's
  per-page scroller now sets `keyboardShouldPersistTaps="handled"`, so the
  chapter-end composer's Continue button takes the first tap rather than making
  the reader press a paid button twice.
- **Gesture Handler had no Jest setup.** The moment the reader wrapped itself in
  a `GestureHandlerRootView`, every suite that mounts the reader died on
  `RNGestureHandlerModule.install is not a function` — nowhere near the thing it
  was testing. `jest.config.js` now loads the library's own `jestSetup.js`
  before the project's.

### Added

- `expo/src/lib/directions.ts` — question-to-direction conversion, high
  precision and low recall by design, with a drop path instead of a filler
  pool.
- `expo/src/lib/text-selection.ts` — the arithmetic of the drag selection,
  pure and worklet-safe, so which words end up selected is testable without a
  device.
- `expo/src/lib/chapter-save-queue.ts` — the background save, its subscribers
  and its retry.
- `expo/src/lib/clipboard.ts` — `expo-clipboard` on native through a guarded
  dynamic require, `navigator.clipboard` on web, and an honest `false` when
  neither is available.
- `expo/src/components/reader/SelectionToolbar.tsx` — the three-action menu a
  selection raises.
- **New dependency: `expo-clipboard` (~8.0.8).** Copy needs it, RN core's
  `Clipboard` is deprecated, and the module is loaded lazily so a web bundle and
  a Jest run that cannot link it still work.

### Known gaps

- **The drag is read as travel, not as a hit test.** Prose is drawn as nested
  `<Text>` inside a flowing paragraph — which is what keeps pagination and line
  wrap correct — and a nested `Text` reports an unusable frame on some
  platforms and none at all on react-native-web. So the drag moves the
  selection through the text in reading order (sideways by the word, downward by
  the line) rather than resolving the finger's position against measured word
  frames. The reader steers by the highlight, which moves under their finger,
  and can release and drag again from the same anchor. A pixel-accurate version
  needs either a Fabric-only measurement pass or a different way of drawing the
  page, and would want a device to tune.
- **Feel is unverified on hardware.** Haptic timing, the 650ms drag activation
  threshold and the word/line step distances are code-correct and unit-tested
  but have not been judged on a release build. They are the first things to
  re-tune on device.
- **The orange border on the edit field could not be reproduced in source.** No
  version of `EditStoryScreen.tsx` in this repository's history draws an accent
  frame around the text area; the most likely culprit is the browser's own focus
  ring on the web build. The field has been given an explicit quiet treatment
  and the platform outline has been suppressed, which covers both possibilities,
  but it is worth a second look at the running app.

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
  - *Removed 2026-09-25 (#138): both `@react-native-firebase` packages and `firebase-analytics.ts` are gone; they were never configured and added the AD_ID permission.*
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
