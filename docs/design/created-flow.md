# Design handoff: the "created" story flow

Status: handoff spec, 2026-09-09. Product decisions it relies on are listed at the end. Three build agents can implement sections 1–8 in parallel; each section names the files it owns.

Tokens referenced below come from `expo/src/theme/` (`colors`, `spacing`, `radius`, `type`, `fonts`, `motion`, `shadows`) and `expo/src/lib/reading-themes.ts` (`READER_THEMES`). The app stays light and warm (`colors.bg` #F3F2EF ground, `colors.accent` orange). The reader page keeps its Sepia / Paper / Night themes. The reader chrome and the story detail page use the dark overlay palette already defined as `CHROME` in `ReaderChrome.tsx` (`#1C1A17` surface, `#F4F1EC` text, `#B5ADA2` muted, `#332F2A` border); promote that object to `expo/src/theme/theme.ts` as `colors.chrome*` so the detail page can share it.

Reference geometry is 390 × 844. Every tap target is at least 44 × 44. Every animation honours `useReducedMotion`.

---

## 1. Live paged reader (generation lands here)

**Purpose.** Generation opens the reader itself, not a streaming panel and not the draft editor. The writer reads finished pages while the rest of the chapter is still being written behind them.

**Files.** `ReaderScreen.tsx` (modified: accepts a `live` prop), `CreateStudioScreen.tsx` (modified: the `generating` step renders `ReaderScreen` in live mode once the first page exists; the `editor` and `review` steps are removed from the first-chapter and add-chapter paths), `StreamingProse.tsx` (deleted), `GeneratingOverlay.tsx` / `CraftingLoader.tsx` (reused unchanged for the window before page 1 exists).

**States.**

| State | What is on screen |
|---|---|
| `writing-no-pages` | `GeneratingOverlay` exactly as today. Back returns to the brief with the draft intact (it is already persisted by `draft-storage.ts`). |
| `writing-pages` | The reader, page 1 visible, pages appended as prose settles (the existing settle rule in `CreateStudioScreen.tsx`: whole paragraphs, whole pages, prefix-stable). Chrome cannot be opened. The last available page carries the writing indicator (below). |
| `complete` | Normal reader. Chrome toggles on tap. Chapter end renders on the last page. |
| `error` | If no page was ever shown: `GeneratingOverlay` is replaced by the existing error card copy ("Start over" / "Back to editor" becomes "Back to brief"). If pages were shown: prose stays, the writing indicator becomes a one-line inline notice in `theme.muted`: "Katha stopped early. Your credit is back." with a `Retry` text button in `colors.accent`. |
| `gated-private` | Not a reader state. The pre-generation warning (section 6) prevents this from surfacing here; if the server still gates, `StoryGatedPrivateModal` shows once, on completion, over the reader. |

**Page 1 opener (top to bottom, inside the existing `shell`).** Drop the 94-px cover thumbnail, genre eyebrow and author line from page 1 while `live` is true and for the author's own story; keep them for reading someone else's story (the reference image shows a bare title page).

1. `spacing.huge` top padding.
2. Story title: `fonts.display`, 30 / 36, weight 700, centred, `theme.text`. Wraps to three lines max.
3. `spacing.md`.
4. Chapter title: `fonts.display`, 22 / 28, weight 400, centred, `theme.text`. **Omitted entirely for a standalone story** (one title only). Chapter eyebrow ("Chapter 1") is removed; the chapter number lives in the chrome and the Chapters sheet.
5. `spacing.xxxl`.
6. Prose in `type.reader` at the reader's stored size (default 18 / 30), `theme.text`.
7. Page footer "Page 1 of 19" stays bottom-right as today, `theme.muted`, `type.caption`. While writing, the count reads "Page 1 of 4 · writing" and grows; after completion it is the final count.

**Writing indicator (last available page only, while `writing-pages`).** Under the last settled paragraph: three dots in `theme.muted` using the existing `CraftingLoader` pulse timing (`motion.slow`), then the caption "Still writing…" in `type.caption`, `theme.muted`. Swiping right past the last page is blocked (`scrollEnabled` stays true, but the pager has no further page to snap to). No spinner, no progress bar, no percentage.

**Chrome gating.** `chromeVisible` cannot become true until `complete`. A tap during `writing-pages` does nothing. Hardware back / swipe back during `writing-pages` leaves the reader; the generation continues in `CreateStudioScreen` state and the story is in Library → Your stories the moment the first page existed (the row exists server-side from the first persisted paragraph).

**Tap-to-toggle.** Unchanged mechanism (`Pressable` ancestor of the pager). Word taps (`TappableWord`) still win over the background tap.

**Page transitions.** `pagingEnabled` horizontal `ScrollView` as today, snap per page, `motion.base`.

---

## 2. Reader chrome

**Files.** `ReaderChrome.tsx` (modified), `ReaderScreen.tsx` (wiring).

**Top bar** (dark `chrome.surface`, `spacing.lg` horizontal padding, 56 px + safe area).

| Control | Icon (lucide) | Label / a11y | Opens |
|---|---|---|---|
| Back | `ChevronLeft` 22 | "Back" | Leaves the reader. |
| Title block | — | Story title `type.headline` `chrome.text` one line, ellipsised; under it chapter title `type.caption` `chrome.muted` (hidden for standalone) | — |
| Search | `Search` 20 / `X` 20 when open | "Search chapter" / "Close search" | Inline find bar exactly as today (query, "n of m", prev/next). |

**Bottom sheet** (dark, `radius.xl` top corners, `spacing.xl` padding, safe-area bottom).

Row 1, three equal columns, each an icon (19) over a `type.caption` label in `chrome.text`:

| Position | Label | Icon | Enabled when | Opens |
|---|---|---|---|---|
| left | Music | `Music` | always | `MusicPicker` sheet (existing; empty state "No music yet" until tracks land). |
| centre | Edit | `Pencil` | author only, chapter `complete` | Notepad editor (section 3). Hidden (not disabled) for non-authors. |
| right | Reimagine | `Sparkles` | chapter `complete` | Reimagine sheet (section 4). Visible to everyone. |

Row 2: the page slider exactly as today ("Pages" caption under it, `chrome.track` rail, `chrome.text` thumb).

Row 3, three equal columns:

| Label | Icon | Opens |
|---|---|---|
| Listen | `Play` (`Pause` while playing) | `ListenSheet` (existing). |
| Chapters | `List` | `ChaptersSheet` (existing). Also shows "Chapter n of N" for series. |
| Preferences | `SlidersHorizontal` | `PreferencesSheet` (existing: size, line height, Sepia/Paper/Night). |

**Removed.** History button and `onHistory` prop. Delete the prop and the test that asserts it.

**Disabled look.** Edit/Reimagine are never rendered disabled: they are absent until `complete`, then present. This avoids a greyed control the writer cannot understand mid-generation.

---

## 3. Edit = notepad

**Files.** `EditStoryScreen.tsx` (modified: strip the wand bar, the search bar, the paragraph-regenerate path and the revert icon), `useChapterEditor.ts` (keep only text state + save), `edit-story` request for a whole-chapter save (already supported: agent confirms the "save full text" action exists; if not, this is a one-field request `chapter_body`).

**Layout** (light app palette, since this is "the app" not "the book").

1. Header 56 px: `ChevronLeft` "Back" left; title "Edit chapter" `type.headline` `colors.ink` centred; right: text button **Save** in `colors.accent`, `type.headline`, disabled (`colors.tertiary`) when no changes.
2. Story title `type.caption` `colors.muted`, then chapter title `type.subhead` `colors.ink` (chapter title is itself editable: a single-line `TextInput` styled like the heading; standalone stories show only the story title, read-only here).
3. One multiline `TextInput` for the whole chapter, `fonts.reader` 18 / 30, `colors.ink` on `colors.surface`, `spacing.xl` horizontal padding, `textAlignVertical: top`, `scrollEnabled`, `autoCorrect` on, `keyboardShouldPersistTaps="handled"`. Vertical, like a notepad. No toolbar, no paragraph chips, no AI.
4. Bottom: a `KeyboardAvoidingView`; no bottom bar.

**Behaviours.**

- Save: persists, shows "Saved" in `colors.success` for `motion.slow` × 3 in the header where the button was, then returns to the reader on the same page index (re-paginated).
- Back with unsaved changes: native `Alert` "Discard changes?" with **Keep editing** (cancel) and **Discard** (destructive). Reduced motion: same.
- Save error: existing `saveBanner` pattern (message + Retry), text stays in the field.
- Available only when the chapter is `complete` (the chrome does not show it before).

---

## 4. Reimagine sheet

**Files.** New `expo/src/components/reader/ReimagineSheet.tsx`, new `expo/src/components/create/SavedCharactersPicker.tsx` (shared with section 6), `ReaderScreen.tsx` wiring, `api.ts` (`reimagineChapterStreaming`, `listSavedCharacters`). Backend contract owned by the backend agent: `reimagine-chapter` (streaming; `story_id`, `chapter_number`, `prompt`, `replacements[]` of `{ from_name, to: saved_character_id | new_character }`, `apply_to_all_chapters` per replacement) and, for a non-author, the same call with `fork: true` returning the new private story id.

**Presentation.** Bottom sheet (`SheetFrame` pattern, light palette, `radius.xl`), 88 % height, scrollable body, keyboard-avoiding. Header: title "Reimagine this chapter" `type.title`; close `X`. Subtitle `type.subhead` `colors.muted`: "Chapter 3 · rewrites this chapter only". For a standalone: "Rewrites the whole story".

**Body, top to bottom.**

1. Section label "Characters in this chapter" (`type.caption`, `colors.muted`, uppercase).
2. One row per detected character (names come from `story.characters` intersected with names present in the chapter body; if none are detected, the section shows one line "No named characters found" and nothing else). Row layout, 64 px:
   - Portrait 40 px circle (`portraitUrl` or initial on `colors.surface2`).
   - Name `type.headline` `colors.ink`; under it, when replaced, "→ NewName" in `colors.accent` `type.subhead`; otherwise the character's one-line description `colors.muted`.
   - Right: pill button **Replace** (`Repeat` 16 icon, `colors.accentSoft` fill, `colors.accent` text) → opens `SavedCharactersPicker` (below). Once replaced the pill reads **Change** and a small `X` clears it.
   - Under a replaced row only: a checkbox row 44 px: `Square` / `CheckSquare` 20 in `colors.accent`, label "Apply to all chapters" `type.subhead`, hint `type.caption` `colors.muted`: "Renames them everywhere in this story and in every chapter after this one." Hidden for standalone stories.
3. `spacing.betweenGroups`.
4. Section label "What should change?"
5. Multiline `TextInput`, min 96 px, placeholder "Tell Katha how to rewrite this chapter. Leave it blank to keep the plot and just swap characters.", `maxLength` 500, counter bottom-right `type.caption` at ≥ 400.
6. Sticky footer (`colors.surface`, top hairline `colors.border`): price line `type.caption` `colors.muted` "Reimagine · 1 credit" (the same constant as a chapter, `CHAPTER_TEXT_CREDITS`); primary pill button **Reimagine chapter** (`colors.accent`, `radius.pill`, 52 px). Disabled when there is neither a prompt nor a replacement.

**Non-author variant.** Same sheet. Subtitle becomes "Makes a private copy in your library". Footer button reads **Reimagine in my copy**. On success the reader switches to the new private story (same chapter index) and a toast `colors.ink` on `colors.surface` reads "Saved to Your stories". The original story is untouched.

**Progress.** On submit the sheet closes and the reader re-enters `writing-pages` for that chapter (section 1) with the previous text cleared. Error: the previous chapter text is restored and the sheet's error banner reopens the sheet with the prompt intact.

**`SavedCharactersPicker`.** Bottom sheet, list of the user's saved characters: 48 px portrait, name `type.headline`, description `type.subhead` `colors.muted`, tap selects and closes. Top row: **New character** (`Plus` icon) opens the existing "Craft character" stage from `CreateBriefFlow` as a modal; saving it adds it to the saved library and selects it. Empty state: illustration-free, "No saved characters yet" `type.headline`, body "Characters you create in a story are saved here automatically." and the New character button.

---

## 5. Chapter end

**Files.** `ChapterEnd.tsx` (modified: streaming continue, chip styling), `App.tsx` `renderChapterEnd` (wiring), `api.ts` (`continueStoryStreaming` already exists; use it).

**Series story, last page of the latest chapter, below the prose (existing `wrap`).**

1. Rule `theme.divider`, `spacing.xxl` above.
2. Heading "What happens next?" `fonts.display` 22 `theme.text`.
3. Price line `type.caption` `theme.muted`: "Any of these writes chapter 4 · 1 credit".
4. Direction chips: up to three, derived exactly as `deriveContinuationOptions` does today (planned beat, open hooks, promised payoffs, pressure, closing hook). Render as full-width cards (existing `optionCard`) with `Sparkles` 16 `colors.accent`, text `type.body` `theme.text`, `radius.md`, 1 px `theme.divider`, fill = theme background lightened (use `highlight` at 35 % alpha). Tapping fires the continuation immediately.
5. Row of two text CTAs as today: **Write your own** (`PenLine`) toggles the composer; **Let Katha decide** (`Shuffle`).
6. Composer (when open): multiline input, placeholder "Type what happens next.", 300 chars; primary pill **Continue · 1 credit**.
7. Loading: `ActivityIndicator` + "Finding directions for this story…". Unavailable: the existing reason sentence, composer open by default.

**On continue.** No inline "Writing what happens next…" panel. The reader jumps to a new page 1 for the next chapter (opener with the story title and the new chapter title, which arrives with the stream's first metadata event; until then the opener shows "Chapter 4" as the title placeholder in `theme.muted`) and enters `writing-pages`. Error: return to the previous chapter's last page with the existing error row + **Try again**.

**Planned ending reached.** The existing "This story has reached its planned ending." copy, then the engagement row.

**Standalone story end.** No direction module. Rule, then the existing engagement row (like, save, share), author card, comments preview. Below it one secondary pill: **Reimagine this story** (`Sparkles`) opening section 4.

**Engagement row and comments** on the last page: unchanged.

---

## 6. Create brief additions

**Files.** `CreateBriefFlow.tsx` (modified), `SavedCharactersPicker.tsx` (shared, section 4), `CreateStudioScreen.tsx` (pre-generation warning), `api.ts` (`shapeStory` already returns `grounding_entities`), new `expo/src/components/create/PublicEntityWarningModal.tsx`.

**Characters section: two tabs** above the character list, segmented control 36 px (`colors.surface2` track, `colors.surface` thumb with `shadows.card`, `type.subhead` weight 600):

- **Saved** (default when the library is non-empty): horizontal list of saved-character chips: 32 px portrait + name, `radius.pill`, `colors.surface`, 1 px `colors.border`; tap adds to the story (chip gains `colors.accentSoft` fill, `Check` 14 icon, and appears in the story's character list below with the existing lead-character logic). Tapping an added chip removes it. Max 3 characters rule unchanged; at the cap, remaining chips are `colors.tertiary` with a hint line "Up to three characters per story."
- **New**: the existing "Craft character" flow, unchanged. Every character saved from here is also written to the saved library (dedupe by trimmed name per user; a second save with the same name updates the saved entry).

**Visibility toggle.** Stays where it is in "More options" (`Switch`, `SWITCH_COLORS`). Copy: label "Make it public"; hint off: "Only you can see this story."; hint on: "Anyone on Katha can read it once it's written." Anonymous: unchanged ("Public unlocks when sign-in is available.", disabled).

**Pre-generation warning** (only when the toggle is on). `CreateStudioScreen` reads the latest shape result's `grounding_entities`; if any entity is `living_public_figure` or `private_individual`, tapping **Generate** shows `PublicEntityWarningModal` instead of starting. Same visual shell as `StoryGatedPrivateModal` (centred card, `radius.lg`, `colors.surface`, `shadows.overlay`, `accessibilityRole="alert"`):

- Title: **"This one can't be public"**
- Body, living public figure: "Your idea names a real person who's still alive. Katha can write it, but it will stay private in your library — it can't be shared or made public."
- Body, private individual: "Your idea names someone from your own life. Katha can write it, but it will stay private in your library — it can't be shared or made public."
- Buttons, stacked, 48 px: primary **Keep it private** (`colors.accent` pill) → sets `visibility: "private"` and generates; secondary **Change my idea** (text button, `colors.ink`) → closes the modal and focuses the idea field.
- No "policy", "violation" or "sorry".

If shaping has not finished when Generate is tapped, generate anyway; the server gate remains the backstop and `StoryGatedPrivateModal` shows on completion (section 1).

**Publish.** With the toggle on and no gate, the story is public from the moment generation completes; the "Review" step and its Publish button are gone. A public story shows a `Globe` 14 icon + "Public" `type.caption` chip in the reader's Chapters sheet header and on the story detail meta line.

---

## 7. Story detail page

**Files.** `StoryDetailScreen.tsx` (modified), `StoryActionsSheet.tsx` (modified: adds Download to PDF), `CommentThread.tsx` (modified: chapter tag per comment), new `expo/src/lib/story-pdf.ts` (`expo-print` on native, `window.print` on web).

**Ground.** The whole screen is `chrome.surface` (#1C1A17), status bar light. This is the one dark page in the app; it exists so the cover has no edge.

**Layout, top to bottom, single `ScrollView`.**

1. **Hero**: full-width, height = 62 % of the window height, cover 3:4 with `FocalImage` as today; genre gradient fallback (from `genreGradients`) while the cover is generating or absent, no spinner and no text over it. Over the bottom 45 % of the hero a `LinearGradient` from `transparent` → `chrome.surface` at 100 % (locations 0, 1) so the image dissolves into the ground; there is no border, no card and no radius.
2. **Floating controls** at safe-area top + `spacing.lg`: left `X` 20 "Close story"; right cluster of three 40 px circles (`rgba(28,26,23,0.55)` fill, `chrome.text` icons, `spacing.sm` gap): `Star` (filled `#F5B324` when saved, a11y "Save story" / "Remove saved story"), `Share` "Share story", `Ellipsis` "More options".
3. **Content** with `spacing.xl` horizontal padding starting `spacing.xxl` above the hero's end (overlapping the gradient):
   - Title `fonts.display` 30 / 34 `chrome.text`, up to three lines.
   - Meta line `type.subhead` `chrome.muted`, one paragraph, wrapped: `@username` (underlined, `chrome.text`, tap → author) · `Aug 16, 2026` · `232 likes` · `187 comments` (underlined, tap → comments sheet) · `Novel (53/60)` where the last item is `Standalone` or `{written}/{planned}` chapters. Add `· Public` for a public story you own.
   - Genre chips row, wrapping: `radius.pill`, 1 px `chrome.border`, `chrome.text` `type.subhead`, 32 px; primary genre first then tags.
   - Summary `type.body` 16 / 24 `chrome.text`, full text, no line clamp (the existing `storyHook`).
   - `spacing.xxl`.
   - Two equal pill buttons 56 px, `spacing.md` gap: **Read** (`BookOpen`) and **Listen** (`Headphones`), both `colors.accent` fill and `#FFFFFF` text `type.headline`. Listen shows the existing "Narration is not ready for this story yet." notice in `chrome.muted` under the row when audio is absent.
   - Stats row, author card and the inline comments preview as today, restyled onto the dark ground (`chrome.text` / `chrome.muted`, hairlines `chrome.border`).
4. **3-dot menu** (`StoryActionsSheet`, existing bottom sheet): items **Report story** (`Flag`), **Block author** (`Ban`, non-authors only), **Download as PDF** (`Download`). PDF: title page (title, author, date), then each chapter with its title; `fonts.reader` equivalent serif in the HTML; a toast "Saved as PDF" / share sheet on native.

**Comments sheet.** Bottom sheet over the detail page, 80 % height, `#2A3547`-style dark surface → use `chrome.surface` lightened one step (`#26231F`), `radius.xl` top corners, drag handle 36 × 4 `chrome.border`. Header "Comments (187)" `fonts.display` 24 `chrome.text`. Rows: 40 px avatar; `@name` `type.headline` underlined `chrome.text`; `40m · Chapter 1` `type.caption` `chrome.muted` on the same line; body `type.body` `chrome.text`; actions **Reply** / **Report** `type.subhead` `chrome.muted`. Composer pinned at the bottom (existing `CommentThread` reply composer). `CommentThread` gets a `chapterNumber` per comment (from the backend row) and a `tone: "dark"` prop; light tone stays the default for the reader's last page.

---

## 8. Home: Your stories

**Files.** `HomeScreen.tsx` (`buildFeedRows`), `App.tsx` (passes the user's stories), `StoryFeedCard.tsx` (cover placeholder rule only), `FeedRail.tsx` unchanged.

- When the signed-in or guest user owns at least one story with at least one persisted chapter, `buildFeedRows` prepends `{ key: "yours", title: "Your stories", stories }` ordered by last updated. Cards are the existing `StoryFeedCard` rail variant, untouched. A story whose chapter is still being written is included the moment its first page exists.
- Cover placeholder while `coverStatus` is `pending` / `generating` / `failed`: the genre gradient (`genreGradients[genre]`) fills the cover square. No spinner, no "Painting…" text, no retry affordance here. When the URL arrives the image fades in over `motion.base`.
- The "Continue reading" card and "Write another story" band keep their current position above the rails.
- Empty state (no stories yet) is unchanged.

---

## Decisions assumed

1. Generation opens the paged reader; the draft editor and the Review/Publish steps leave the create path (user, 2026-09-09).
2. Page 1 shows the story title and the chapter title; one title for a standalone.
3. Chrome opens on tap only after the chapter is complete; History is dropped.
4. Edit is a plain notepad over the whole chapter, author-only, complete-only.
5. Reimagine re-prompts one whole chapter; character replacement with a per-row "apply to all chapters"; available to readers as a private copy.
6. Publishing is the "Make it public" toggle (default private); no separate publish action.
7. A living public figure / private individual in the idea forces private and is explained before generation.
8. Saved characters are a per-user library, auto-populated from every character crafted in a brief.
9. Chapter-end directions are derived from the chapter just written; continuation streams.
10. "Your stories" is the first Home rail once the user has a chapter; feed card style unchanged.
11. No cover loading state anywhere; the cover appears when ready.
12. Theme stays light; the reader keeps Sepia/Paper/Night; the detail page is the single dark surface.

## Open for the build agents

- Chapter-end chips show only the current chapter's derived directions; if the backend agent adds an explicit `suggested_directions` field to the stream's `done` event, prefer it and fall back to derivation.
- "Apply to all chapters" is a whole-word, case-preserving name substitution (plus obvious possessive forms) in existing chapters and a roster + series-state update for future chapters; pronouns are never rewritten, not a regeneration of every chapter (a credit decision the user has not been asked to make).
- Detected characters for the Reimagine sheet are `story.characters` filtered to names appearing in the chapter body; unnamed or new characters the model invented are not detectable and are not listed.
- PDF uses `expo-print` on native and the browser print dialog on web; the share sheet is the native "save" path.
- The hero gradient dissolves at exactly 100 % opacity of `chrome.surface`; if the cover is very light the top-left controls keep their 55 % dark discs for contrast.
- Standalone stories expose Reimagine at the end of the story as a secondary pill in addition to the chrome.

## Orchestrator notes (added at review, 2026-09-09)

- **Generation must survive leaving the screen.** The live reader is rendered by `CreateStudioScreen`, but the writer may press back, switch tabs, or open the same story from Library while it is still being written. The stream and its settled pages therefore live in a module-level generation session (e.g. `expo/src/lib/generation-session.ts`: one active session keyed by story id, subscribable), not in component state. `CreateStudioScreen`, `ReaderScreen` (live mode) and Library all read from it.
- **Reimagine wiring contract.** `ReaderScreen` exposes `onReimagine` (already on `ReaderChrome`); the Reimagine agent renders `ReimagineSheet` from `ReaderScreen` with the smallest possible edit (one state flag, one render block) so the live-reader agent's changes merge cleanly.
- **Client API additions** for reimagine and saved characters go in `expo/src/lib/reimagine-client.ts` and `expo/src/lib/saved-characters.ts` (not `api.ts`, which the backend agent is editing); the orchestrator reconciles duplicates at merge.

## Terminology (added 2026-09-09 after a misread cost a round of rework)

The word "streaming" means two different things and they must never be conflated again:

- **Incremental delivery — the transport. KEEP IT.** Prose arrives from the server in chunks as it is written. It is the only reason page 1 can appear roughly 20 seconds in rather than after the whole 55-76 second generation. Measured on production 2026-09-09: first token at 5.3-7.2s, chapter complete at 55.5-76.4s.
- **Typewriter reveal — the presentation. NEVER SHIP IT.** Text painting on screen letter by letter, word by word, mid-sentence. This is what the product owner means when they say they do not want "streaming", and it is what the settle rule exists to prevent.

The settle rule is the boundary between the two, and it is the feature: whole paragraphs only, whole finished pages only, prefix-stable. A page the reader is looking at can never grow underneath them; the pages behind it can.

"All chapters are generated the same way" means uniform *behaviour* — first chapter, continuation and reimagine all use incremental delivery with page-by-page reveal. It does not mean making them uniformly blocking. Removing the transport would both make the reader wait out the full generation for page 1 and reintroduce Supabase's 150-second request idle timeout, which a blocking response trips with no refund payload reaching the client.
