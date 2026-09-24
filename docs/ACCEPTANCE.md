# What to try in the morning

Local URL: **http://localhost:8090**

Run on 8090, not 8081. The deployed `ALLOWED_ORIGINS` only contains 8090, and a blocked preflight fails silently, so the app looks backend-less.

Two dev shortcuts, because onboarding is several screens deep:
- `http://localhost:8090/?tab=create` opens the story brief
- `http://localhost:8090/?tab=home` opens the feed
- `http://localhost:8090/?preview=narration-loader` shows all three loader animations

Guest credits are capped at 3 per network per day. If you see 0 credits, run `./scripts/grant-credits.sh all 500` from `backend/`, reload, and carry on.

---

## 1. Writing a story

- [ ] Open Create. The starter ideas are behind a single **View ideas** button, and the list changes with the genre chip.
- [ ] Every toggle looks the same. The Kids Mode toggle no longer has a green thumb.
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
