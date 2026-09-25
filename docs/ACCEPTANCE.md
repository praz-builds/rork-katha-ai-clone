# What to try in the morning

Local URL: **http://localhost:8090**

Run on 8090, not 8081. The deployed `ALLOWED_ORIGINS` only contains 8090, and a blocked preflight fails silently, so the app looks backend-less.

Two dev shortcuts, because onboarding is several screens deep:
- `http://localhost:8090/?tab=create` opens the story brief
- `http://localhost:8090/?tab=home` opens the feed
- `http://localhost:8090/?preview=narration-loader` shows all three loader animations

Guest credits are capped at 3 per network per day. If you see 0 credits, run `./scripts/grant-credits.sh all 500` from `backend/`, reload, and carry on.

---

# Round: the Play launch push (#138-#143, plus the generation fix)

Six lanes merged on 2026-09-25 and are deployed. The generation fix in A1 is a
seventh change and is **only checkable once it is deployed** — merged is not
deployed on this project, and A1 says so again where it matters.

Most of this round is Android and Play Console work, so it splits into what you
can eyeball on http://localhost:8090 and what genuinely needs a device or the
Console. Anything below marked **device** or **Console** cannot be judged in the
browser — that is a limit of the change, not a gap in the check.

## A1. Creating a story works again

This is the one to try first. Before this fix, every story you asked for failed
and refunded the credit.

> **Needs the deploy first.** This one is not live until `generate-story`,
> `generate-story-stream`, `continue-story`, `edit-story`, `reimagine-chapter`
> and `shape-story` have been deployed — they all import the file that changed.
> Run A1 before that and it will still answer "Story generation failed. Credit
> refunded.", and that is the old code, not a new bug.

- [ ] Open Create, write one sentence, press Create. A chapter arrives. It does
      **not** say "Story generation failed. Credit refunded."
- [ ] It arrives well under two minutes. A 1,504-word chapter was measured at
      38.7s from the model, but production chapters have run 55–76s and the
      grounding step and persistence sit on top of that, so treat anything under
      two minutes as healthy and anything over as worth reporting.
- [ ] Do it twice more. All three succeed; the failure this fixes was happening
      on every attempt, not occasionally.

## A2. "All-ages" replaced "Kids", everywhere

- [ ] The Create toggle says **All-ages**. The word "Kids" appears nowhere — not
      on the toggle, not on a story page, not in a filter, not in a rating badge.
- [ ] Turn it on and generate: the story page's rating badge reads All-ages.

## A3. Blocking an author, and the way back

- [ ] Open a story by someone else. Its three-dot menu offers **Block author**.
- [ ] Block them. Their stories leave the feed, Explore and search, and their
      comments disappear.
- [ ] You are not stranded: there is a visible way back to unblock, and
      unblocking restores their stories and comments.
- [ ] Block from a *comment's* menu too, not just from the story.

## A4. Reporting goes somewhere

- [ ] Report a comment with a written reason (a reason is required).
- [ ] The report lands in the report queue rather than vanishing — newest
      unresolved first. This is the queue that makes Play's UGC answer true.

## A5. Send feedback, and the music switch

- [ ] Profile (You) has **Send feedback**. Write something and send it. It
      confirms, and the sheet is **empty the next time you open it** rather than
      still holding what you already sent.
- [ ] Change the category mid-draft, send, reopen: nothing is carried over.
- [ ] Profile has a **Background music** switch, and it matches what the reader
      actually does. The reader itself is mute-only.

## A6. Codes, chips and the intro

- [ ] Paste a 6-digit sign-in code. It fills and **submits itself** — no extra
      tap.
- [ ] A long "moment" chip ends in an ellipsis instead of being cut mid-word.
- [ ] Resize the browser window narrow and wide during the intro animation. It
      fits at every width and never traps you mid-carousel.
- [ ] The intro stays smooth while the app is busy (it no longer runs on the JS
      thread).

## A7. English until it is all translated

- [ ] Switch your device or browser to Spanish or Portuguese. The app stays in
      **English throughout** rather than showing half-translated screens. This
      is deliberate for launch; say if you would rather ship the partial
      translations.

## A8. Subscriptions state their terms

- [ ] The paywall states price, period, renewal and how to cancel — the wording
      Play's Subscriptions policy requires.
- [ ] **device / Console:** a real Android purchase crediting the right account
      cannot be checked here. It needs the Play products created and the
      `goog_` key pasted; `backend/PLAY_BILLING_SETUP.md` is the order to do it
      in. The two money bugs this round fixed (every Android subscription
      webhook answering "Unknown product", and a new yearly subscriber getting
      up to 100 credits in month one) are covered by tests, not by anything you
      can see in the browser.

## A9. The store pack and the build

- [ ] **Console:** `store/android/` holds listing copy in English, Spanish and
      Portuguese, the Data Safety answers, the content-rating answers and the
      graphics. Read `store/android/README.md` first — it lists what is still
      waiting on you.
- [ ] **Decision you own:** `store/android/data-safety.md` item **D1**. Story
      ideas and generated prose currently go to OpenRouter's training tier,
      which is why Data Safety answers "shared with third parties". It is ~17x
      cheaper than the alternative. Turning training off at
      <https://openrouter.ai/settings/privacy> lets that answer become "not
      shared" and needs **no deploy** — the generation chain is correct either
      way as of this round. Your call, and it is a cost decision as much as a
      privacy one.
- [ ] **device:** version 1.0.0, no Firebase, background audio and the blocked
      permissions are in the release config; a release AAB compiled locally.
      Installing it on a phone is the check that is left.

---

# Still expected to hold from the previous round

## 1. Writing a story

- [ ] Open Create. The starter ideas are behind a single **View ideas** button, and the list changes with the genre chip.
- [ ] Every toggle looks the same. The All-ages toggle no longer has a green thumb.
- [ ] Write one sentence and press Create.
- [ ] The crafting screen holds, then **page one appears while the chapter is still being written**. Expect roughly 30 seconds. The counter says "Page 1 of 5 · writing" and grows.
- [ ] No letter-by-letter typing anywhere. Pages appear whole.
- [ ] The page you are reading never changes under you.
- [ ] Page one shows the story title and the chapter title.

## 2. Reading it

- [ ] Tap the page. Controls appear: Music, Edit, Reimagine, a page slider with **arrows at both ends**, Listen, Chapters, Preferences. No History.
- [ ] The slider row has no "Pages" label and the icons are bigger.
- [ ] Swipe between pages horizontally.
- [ ] Long-press the text. The phone's own selection appears (Copy, Share, Look Up); on web the browser's selection works. There is no word-picker and no Save phrase anywhere.
- [ ] Tap Edit. Plain notepad, no orange frame. Change a word and save: it returns **instantly**, not after several seconds.
- [ ] Tap Reimagine. Characters are listed for replacement, with a prompt box and an apply-to-all-chapters option.

## 3. The end of a chapter

- [ ] Direction chips are **instructions**, not questions: "Find out who is writing the notes", not "Who is writing the notes".
- [ ] A third chip offers **Write your own or get a surprise**, and opens a composer in place.
- [ ] The price says one credit. Tapping twice quickly must not buy two chapters.

## 4. Listening

- [ ] Tap Listen. A full screen opens: cover on top, the **Halo** animation, and a line that changes with the real pipeline stage.
- [ ] No message promises a number of seconds.
- [ ] When it is ready, the transcript scrolls with the audio and the current line is highlighted.
- [ ] Controls: scrubber, speed, back ten, forward thirty, chapter list.
- [ ] Narration is live and was verified on production. English only; Spanish needs a worker that does not exist yet.

## 5. Home

- [ ] Top right: streak, credits, notifications. **No search bar.**
- [ ] The streak is real, read from the database. If you have none, no flame is drawn rather than a zero.
- [ ] Order: Your stories, Continue reading, Katha Originals, then a rail per genre you chose.
- [ ] "Continue reading" is empty and hidden until a real read position exists. It used to repeat Katha Originals and claim you had started them.
- [ ] The Write another story card is the new one. Two variants exist; say which you prefer.
- [ ] A cover appears on its own once painted, with no spinner and no "painting" text.

## 6. Explore

- [ ] A search bar, which Home does not have.
- [ ] Every genre in a horizontal strip, tap to filter, tap again to clear.
- [ ] Type quickly: results never flicker backwards to an older query.
- [ ] Search shows nothing the feed would hide.

## 7. Library

- [ ] Three tabs: **Created**, **Starred**, **Characters**.
- [ ] Created shows your own stories including private ones.
- [ ] Starred shows only what you starred. It used to show strangers' popular stories.
- [ ] Characters lists your saved characters with their portraits. The person-plus button at the top creates a new one on the Craft character screen; tapping a character opens it for editing.

## 8. The story page

- [ ] Light, not dark. The cover dissolves into the page with no edge.
- [ ] Only genres as tags. No themes, no spice level.
- [ ] No stat icons under Read and Listen, no "About this story", no prompt block.
- [ ] Comments open from an icon at the top.
- [ ] A comment has a three-dot menu with Report, and reporting **requires** a written reason.
- [ ] Upvote only. No downvote anywhere.
- [ ] Commenter names are tappable.

## 9. Profiles

- [ ] Your own leads with the streak and shows Followers and Following. There is no stat grid: reads, likes, chapter and story counts are gone.
- [ ] You can change your handle and upload a picture.
- [ ] No parental controls.
- [ ] Another author's profile has follow, their public stories, and public counts. A private story never appears there.

## 10. Signing in

- [ ] As a guest you can read everything.
- [ ] Liking, saving, following or commenting asks you to sign in, rather than pretending to work.

---

## Known gaps, stated rather than hidden

- **Spanish narration** needs an edge-tts worker to be hosted. Microsoft refuses direct connections, so this needs infrastructure. English works.
- **The audio sweeper** is not written. Deleted narrations record their storage path for cleanup but nothing removes the files yet.
- **Transcript sync is an approximation.** Nothing in the pipeline returns word timings, so lines are apportioned by length across the measured duration. Expect about a line of drift over a long chapter.
- **Haptics and animation timing are unverified on hardware.** A laptop browser cannot judge a 600ms loop.
- **PDF export keeps a temporary filename** rather than the story title, which needs a native module and a device to verify.
