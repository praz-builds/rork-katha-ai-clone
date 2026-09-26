# Story Generator — Prompt System (v6 Production Spec)

> Human-readable reference for the next production prompt system in
> `backend/supabase/functions/_shared/story-prompts.ts`.
>
> The TypeScript implementation is the runtime source of truth. This document is
> the product and engineering contract for the prompt architecture across
> Supabase, Expo, cover prompts, and tests.
>
> Last revised 2026-09-26.

## Product Goal

Katha should generate mobile-native fiction that feels written by a strong genre
writer, not by a generic assistant. The prompt system must optimize for:

- a complete story engine before surface prose
- reliable genre promise across 19 supported genres (12 shown in the creation UI)
- modular identity and spice layers
- safe adult-content handling with account-level gating
- A Kids mode that cannot inherit adult behavior
- standalone and series structures with different ending contracts
- structured output that can be parsed and filtered downstream

## Key v6 Decisions

- **19 primary genres (12 in the creation UI as of 2026-09-08).** LGBTQ+ is no
  longer a primary genre. Queer context may be inferred from the visible brief;
  it is not a creation toggle.
- **The v7 taxonomy change (2026-09-08) adds four genres and removes seven from
  the UI — none from the database.** New: `educational`, `fanfiction`,
  `folktale`, `sliceOfLife`. Removed from the creation surface but still valid,
  storable `PrimaryGenre` values, on the `cozyFantasy`/`paranormalRomance`
  precedent above: `romantasy`, `darkRomance`, `paranormalRomance`,
  `cozyFantasy`, `poetry`, `thriller`, `contemporary`. A story already written
  in a removed genre keeps reading, continuing and rendering in that genre's own
  voice module forever — only a NEW submission of a removed genre is redirected,
  by `GENRE_MIGRATION_MAP` in `_shared/types.ts`: `thriller` -> `mystery`,
  `contemporary` -> `sliceOfLife`, `poetry` -> `folktale`,
  `romantasy`/`darkRomance`/`paranormalRomance` -> `romance`, `cozyFantasy` ->
  `fantasy`. See **User-Facing Taxonomy** for the full picture and
  **Genre Modules** for the four new voice modules.
- **The three new genres with a truth or fidelity obligation (Educational,
  Fanfiction, Folktale) shipped with first-pass voice modules on 2026-09-08
  and were revised the same day against a dedicated research pass**
  (`docs/research/educational.md`, `docs/research/fanfiction.md`,
  `docs/research/folktale.md`). Folktale's revision also names, in its own
  module text, each global craft rule it deliberately suspends (Show Don't
  Tell for interiority, Sentence Rhythm for repetition, the anti-cliche
  instinct and the "don't resolve too neatly" pacing rule for formulaic
  open/close) rather than silently contradicting them. See **Genre Modules**
  and **Deferred Research Recommendations**.
- **Mystery absorbs Thriller's engine for new submissions; Slice of Life
  inherits Contemporary's module by reference, not by copy** (2026-09-08).
  Thriller and Contemporary are retired from the picker but a stored story in
  either genre keeps reading in its own, unmerged module forever — see
  **Mystery**, **Thriller**, **Contemporary**, and **Slice of Life** below.
- **Kids is an audience mode, not an adult genre peer.** Backend generation uses
  `adult | kids`; any future bedtime UX should map to kids-safe constraints
  unless a separate backend mode is introduced.
- **Bedtime stories is an Explore category, not a primary genre (2026-09-26).**
  Its chip filters `stories.audience_mode = 'kids'`, can compose with a genre,
  and never writes `bedtime` into `primary_genre` or the prompt contract. The
  existing Kids: bedtime register supplies the safety and tone promise.
- **Spice is a genre-aware layer with two tiers.** Backend enum values are
  `sweet` and `steamy`. The clamp is downward only: a genre may lower a
  requested tier, never raise it.
- **Spice leaves the product surface (2026-09-08).** There is no longer a
  user-facing spice picker; the product intent is to infer heat from the
  writer's own story idea rather than a UI meter. `spiceLevel` is unchanged in
  the request contract, the prompt system, and stored rows — `deriveContentRating`
  still reads it and Kids mode still forces `sweet` — but an ABSENT `spice_level`
  is now a first-class, always-safe path rather than merely tolerated:
  `validateGenerationRequest` defaults it per genre (`GENRE_DEFAULT_SPICE`, or
  `sweet` if a genre is somehow missing from that table) and never rejects a
  request for omitting it. Inferring spice from the idea's prose is a stated
  follow-up, not implemented by this change.
- **`explicit` is retired, not deferred.** It was removed from `SpiceLevel` on
  2026-09-07. Sexual content is out of the product: at every tier, sex acts
  happen off the page and crude anatomical vocabulary is never written. This is
  a product decision, not a feature flag, and reintroducing the tier means
  amending this document first.
- **Retirement does not orphan stored rows.** `stories.spice_level` and
  `stories.content_rating` still admit `'explicit'` in their CHECK constraints
  (migrations 00008 and 00014) and `feed`/`library` still exclude
  `content_rating = 'explicit'` from public surfaces. Any inbound or stored
  `explicit` normalizes down to `steamy` rather than erroring;
  `deriveContentRating` still reports a stored `explicit` rating so an old row
  is never silently relabelled into a public feed.
- **Restriction alone is not the deliverable.** A prohibition with no craft
  direction produces timid, flat intimacy, which is a worse product than the
  thing it prevents. Both remaining tiers carry positive technique — longing,
  restraint, charged specificity, the cut — in the Spice Modules section.
- **No auto-aging workaround for underage sexual content.** If the user's
  request clearly asks for sexual content involving a minor, reject at
  validation. If age is merely ambiguous in an adult romance, make adulthood
  clear in the story.
- **Author touchstones stay in docs only.** Runtime prompts should use craft
  traits, not living author names or instructions that could imitate a style.
- **Prompt-only JSON is not enough.** Use API-level structured output/schema
  enforcement where supported, with strict validation fallback.
- **A Create story is planned, not mode-selected.** The user chooses **1, 3, 7
  or 15** chapters from the Chapters dropdown. New Create stories begin as
  Chapter 1 and persist state, hooks, and chapter roles toward the planned
  finale. A plan of **1** is a series of one, not a standalone, and gets its own
  `## One-Chapter Contract` — the Series Opening Contract forbids resolving the
  central conflict, which is the opposite of what a single chapter has to do.
  A finished story can be **extended** one chapter at a time, so the STORED plan
  is any value from 1 to 15 even though only four are offered. `standalone`
  remains backend compatibility for legacy callers, not a creation control.
- **Every prompt change needs evals.** Genre quality, banned patterns, safety,
  schema validity, series state, and continuation behavior must be tested before
  deployment.

## Runtime Architecture

The runtime prompt builder should assemble layers in this order:

1. Base craft and safety rules
2. Story engine rules
3. Story mode module (`standalone`, `series`)
4. Primary genre module
5. Audience mode module (`adult`, `kids`)
6. Identity lens module (`queer`, optional)
7. Spice module (`sweet`, `steamy`)
8. Continuation/finale module, when applicable
9. Language module
10. Output schema reminder

The user prompt has its own optional brief layers. Grounding is a no-op layer
when empty: omitting it or passing an empty array must produce a byte-identical
prompt to the pre-layer path.

Recommended builder signatures:

```ts
type PrimaryGenre =
  | "romance"
  | "romantasy"
  | "darkRomance"
  | "cozyFantasy"
  | "paranormalRomance"
  | "fantasy"
  | "scifi"
  | "thriller"
  | "mystery"
  | "horror"
  | "contemporary"
  | "historical"
  | "adventure"
  | "comedy"
  | "poetry"
  | "educational"
  | "fanfiction"
  | "folktale"
  | "sliceOfLife";

type AudienceMode = "adult" | "kids";
type StoryMode = "standalone" | "series";
type ChapterRole = "standalone" | "series_opening" | "mid_series" | "finale";
type IdentityLens = "queer";
type SpiceLevel = "sweet" | "steamy";
buildStorySystemPrompt({
  primaryGenre,
  storyMode,
  chapterRole,
  audienceMode,
  identityLenses,
  spiceLevel,
  language,
  chapterLength,
  plannedChapterCount,
});

buildContinuationSystemPrompt({
  primaryGenre,
  audienceMode,
  identityLenses,
  spiceLevel,
  language,
  chapterLength,
  plannedChapterCount,
  mode, // "chapter" | "finale"
  seriesState,
});
```

## User-Facing Taxonomy

19 backend genres exist. 12 ship as creation cards in the app, in this exact
display order (product decision, 2026-09-08; Romance is deliberately last).
The other 7 are valid DB values, carried forward from v6, that are no longer
offered on the creation screen (see Key v6 Decisions).

| UI card # | UI Genre      | Internal genre | Notes                                                                            |
| --------- | ------------- | --------------- | --------------------------------------------------------------------------------- |
| 1         | Adventure     | `adventure`     | Motion, environment, physical stakes                                              |
| 2         | Comedy        | `comedy`        | Observational or absurd, committed timing                                         |
| 3         | Educational   | `educational`   | New. A real story with load-bearing information, never a lesson wearing a plot    |
| 4         | Fanfiction    | `fanfiction`    | New. Transformative-work register: heightened, trope-committed, devoted           |
| 5         | Folktale      | `folktale`      | New. Oral-tradition cadence, archetypal roles, patterned repetition               |
| 6         | Historical    | `historical`    | Period consciousness and constraints                                              |
| 7         | Sci-Fi        | `scifi`         | One speculative idea with human consequence                                       |
| 8         | Fantasy       | `fantasy`       | Magic, world, cost, wonder                                                        |
| 9         | Mystery       | `mystery`       | Fair-play puzzle                                                                  |
| 10        | Horror        | `horror`        | Dread, wrongness, restraint                                                       |
| 11        | Slice of Life | `sliceOfLife`   | New. Quiet, observational, an ordinary day rather than a crisis                   |
| 12        | Romance       | `romance`       | Commercial relationship-forward stories; deliberately last on the shelf           |

Removed from the creation UI (2026-09-08), still valid DB values:

| Removed UI genre  | Internal genre      | Migrates new submissions to | Notes                                                                                          |
| ------------------ | -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Romantasy          | `romantasy`         | `romance`                    | Romance and fantasy arcs have equal weight                                                     |
| Dark Romance       | `darkRomance`       | `romance`                    | Adult only, steamy default; intensity comes from power and consequence, never from crude prose |
| Cozy Fantasy       | `cozyFantasy`       | `fantasy`                    | Low-stakes warmth, craft, community                                                             |
| Paranormal Romance | `paranormalRomance` | `romance`                    | Supernatural romance                                                                            |
| Thriller           | `thriller`          | `mystery`                    | Urgency, threat, ticking clock                                                                  |
| Contemporary       | `contemporary`      | `sliceOfLife`                | Absorbed Drama and Slice of Life registers before Slice of Life existed on its own              |
| Poetry             | `poetry`            | `folktale`                   | Prose poetry / lyrical narrative mode                                                           |

A story stored with a removed genre keeps generating chapters in that genre's
own voice module — the migration only redirects a NEW submission
(`validateGenerationRequest`), never a stored value. See Key v6 Decisions for
the exact `GENRE_MIGRATION_MAP` and the reasoning.

Separate UI controls:

- **Audience mode:** full-width segmented `For me | For kids`; Kids forces
  `spiceLevel: "sweet"`, filters unsuitable genres, and reveals Values.
- **Values:** Kids-only chips. They are written into the brief as themes to
  explore through character action, never as a moral lesson.
- **Spice selector: removed (2026-09-08).** There is no spice control on any
  surface, in either audience mode. This entry previously described an
  adult-only, genre-specific selector, which contradicted the retirement
  recorded above under "Spice leaves the product surface" — two sections of
  the same contract specifying opposite UI. The retirement is the current
  decision; this line is kept, rather than deleted, so a reader who remembers
  the selector finds out what happened to it instead of assuming the contract
  forgot to mention it.

  Nothing about the backend changed: `spiceLevel` is still part of the request
  contract, an absent `spice_level` is still defaulted per genre by
  `validateGenerationRequest` (`GENRE_DEFAULT_SPICE`), and Kids mode still
  forces `sweet`. What went away is the writer choosing a heat tier from a
  meter; heat is inferred from the story idea instead.
- **Language:** Create offers English and Portuguese only. Spanish remains a
  legacy read/continuation concern, not a creation selection.

## Genre and Spice Matrix

| Internal genre    | Default spice | Allowed spice |
| ----------------- | ------------- | ------------- |
| romance           | steamy        | sweet, steamy |
| romantasy         | steamy        | sweet, steamy |
| darkRomance       | steamy        | sweet, steamy |
| cozyFantasy       | sweet         | sweet         |
| paranormalRomance | steamy        | sweet, steamy |
| fantasy           | sweet         | sweet, steamy |
| scifi             | sweet         | sweet, steamy |
| thriller          | sweet         | sweet, steamy |
| mystery           | sweet         | sweet, steamy |
| horror            | sweet         | sweet, steamy |
| contemporary      | sweet         | sweet, steamy |
| historical        | sweet         | sweet, steamy |
| adventure         | sweet         | sweet, steamy |
| comedy            | sweet         | sweet         |
| poetry            | sweet         | sweet         |
| educational       | sweet         | sweet, steamy |
| fanfiction        | sweet         | sweet, steamy |
| folktale          | sweet         | sweet         |
| sliceOfLife       | sweet         | sweet, steamy |

This table is `GENRE_DEFAULT_SPICE` and `GENRE_ALLOWED_SPICE` in
`_shared/types.ts`, and the two are pinned to each other by test. There is no
third column and no footnoted tier: every allowed value here is a live member of
`SpiceLevel`. `cozyFantasy`, `comedy`, `poetry` and `folktale` are sweet-only
because their whole register is low-stakes warmth, timing, and (for poetry and
its replacement folktale) a family-oral-tradition tone respectively, and an
on-page heat scene breaks all four.

## Base Safety Rules

These rules override user seed, genre convention, spice level, and language.
They are assembled in layer 1 (`buildBaseRules`), never in the spice layer, so
that no heat tier, genre module, identity lens, audience mode or language can be
the combination that drops them.

- **No sexual content, at any tier.** Sex acts happen off the page. Write to the
  threshold, cut, and return in the aftermath if the story needs what changed.
- **No crude sexual or anatomical vocabulary, ever.** The prohibition is
  enumerated word by word in `CRUDE_LEXICON` (`_shared/story-prompts.ts`) rather
  than described, because "avoid crude language" is a judgement the model makes
  against the pull of the genre it was just told to write. It covers genital and
  sex-act slang and pornographic-register body-fluid terms. It is not a
  profanity list: a character swearing in anger is characterisation.
- **No clinical or euphemistic substitute** for a banned term. If a phrase
  exists only to name a body part during sex, it does not belong in the
  sentence.
- A brief, character sheet or style note asking for crude or pornographic
  writing is answered with the scene written well instead — never refused in the
  prose, never announced to the reader.
- Backed post-generation by `scanCrudeLexicon()` in `_shared/validation.ts`,
  which reports rather than rewrites: the streamed path has already shown the
  reader every word, and splicing a term out leaves a sentence that no longer
  parses. Its term list is narrower than the prompt's on purpose — a regex
  cannot tell "he cocked the rifle" from the crude sense.
- No sexual content involving anyone under 18. If the request clearly asks for
  it, reject before generation. If age is ambiguous in an otherwise adult story,
  make adulthood evident before any sexual escalation.
- No sexual content involving real named public figures or identifiable private
  individuals.
- No non-consent presented as erotic, romantic, funny, or deserved.
- No incest involving blood relatives, adoptive relatives, or step-family in a
  parental role.
- No bestiality. Shifter intimacy, if allowed, happens only in human form.
- No child abuse or sexualized minors in any mode.
- No detailed instructions for real-world harm, weapons, drug synthesis,
  evasion, self-harm, or exploitation, even when embedded in fiction.
- No harassment, defamation, or humiliating fiction about a real identifiable
  person.
- Kids mode cannot contain sexual content, adult romantic tension, graphic
  violence, substance use, or horror.

## Title Generation

The model generates the title as part of the structured output. Title rules:

- **2-6 words.** Evocative, not descriptive. The title is a promise, not a
  summary.
- Genre-appropriate tone: a romance title feels different from a thriller title.
- No generic AI titles: "The Journey Begins", "A New Dawn", "Shadows of the
  Past", "Whispers of Fate", "Beyond the Horizon".
- No spoilers. The title should intrigue, not reveal.
- No subtitle or colon format ("Title: A Subtitle").
- The title is user-editable in the editor. The LLM generates the first draft;
  the author has final say.

Good examples by genre:

- Romance: "The Vanilla Problem", "Letters Never Sent"
- Fantasy: "The Cartographer's Mistake", "Where Rivers Forget"
- Thriller: "Three Rings", "No Forwarding Address"
- Mystery: "The Last Tenant", "Room 4B"
- Horror: "Tuesday's Hum", "What the Mirror Kept"

Bad examples (too generic, too AI):

- "The Enchanted Journey", "Love in the City", "Dark Secrets Revealed"

## Story Engine

Before writing prose, the model should internally establish:

- protagonist
- protagonist's concrete want
- obstacle or pressure
- stakes if the protagonist fails
- irreversible choice or action
- emotional turn
- genre-specific payoff
- final image or final line

The model must not expose this plan. It writes only the JSON/story output.

Standalone structure:

- **Setup, about 15%.** Specific place, ordinary pressure, disruption. Do not
  open with weather, waking up, a mirror, or biography.
- **Middle, about 65%.** Scenes, not summary. Each scene changes knowledge,
  pressure, relationship, or risk.
- **Climax and landing, about 20%.** Highest tension or decisive choice, then a
  brief landing. The story must feel complete.

## Chapter Length Enforcement

Word count is a hard rule, not a suggestion.

| Selected length | Target words per chapter | Enforced by                |
| --------------- | ------------------------ | -------------------------- |
| Short           | 600 - 900                | Prompt + server validation |
| Standard        | 1,200 - 1,600            | Prompt + server validation |
| Long            | 2,000 - 2,600            | Prompt + server validation |

The selected band applies to every chapter regardless of audience mode. The
server owns the acceptance tolerance and refunds unusable output; the model's
reported `word_count` is never trusted as the count.

## Series Chapter Structure

Every story created through the current Create flow starts as Chapter 1 of a 3-,
7-, or 15-chapter planned series. The user does not choose a global writing
mode: they can steer an individual continuation with _What happens next?_ or
leave it empty for Katha to decide. `standalone` is retained for backward
compatibility and is not shown in Create.

The request contract is `story_mode: "standalone" | "series"`, which
`validateGenerationRequest` maps to the internal `storyMode`. The boolean
`is_series: true` is a **legacy compatibility field** that maps to
`story_mode: "series"`; new callers should send `story_mode`. Chapter intent is
carried by `chapter_role` (`standalone`, `series_opening`, `mid_series`,
`finale`), which the server derives rather than accepting from the client.

`continue-story` derives `chapter_role: "finale"` when the request sets
`is_finale: true`, or when the next chapter number reaches that story's
`planned_chapter_count`. `is_finale` is therefore a `continue-story` request
hint, not a stored field: the persisted value is always `chapter_role`.

When `story_mode` is `"series"`:

- **Chapter 1:** Establish world, protagonist, central want, and the first
  complication. End on an unresolved moment (a question, revelation, or choice).
  Do NOT resolve the central conflict.
- **Mid-series chapters:** Each chapter advances the plot with at least one
  irreversible change. End on a cliffhanger or hook. Shift relationships or
  power dynamics. Introduce new tension or deepen existing threads.
- **`chapter_role: "finale"` (the planned final chapter, or an earlier chapter
  requested with `is_finale: true`):** Resolve the central conflict. Callback to
  a specific detail from Chapter 1. Land every major character arc. Loose
  threads are acceptable if the main story is complete.

Every series stores a planned length of 3, 7 or 15 chapters. Its final planned
chapter is automatically a finale. Each chapter uses the selected Short,
Standard or Long word band, regardless of audience mode.

Continuation structure:

- Match prior POV, tense, voice, relationship dynamics, and spice level.
- Do not recap previous chapters in prose.
- Do not reintroduce characters the reader already knows.
- Advance at least one irreversible plot or relationship change.
- Mid-series chapters end on a hook.
- Finale resolves the central tension and calls back to earlier details.
- The planned final chapter is automatically a finale.

## Brief Layers

The user prompt is assembled from the brief the writer approved, in this order:
idea, setting, kids values, writing direction, reader direction, planned length,
plan beats, series state, characters, grounded facts, moments, exclusion, language, schema reminder. Every free-text value is fenced
as untrusted data (`<katha:...>`), and the fence delimiter is stripped from the
value so it cannot be closed early.

Two of those layers carry rules of their own.

### Story world (the reader's cultural preference, 2026-09-25)

A reader can set a standing **Story world** on You -- one of ten regions, or
*Anywhere* (the default). It reaches the prompt as one fixed sentence placed
directly after the setting layer (`buildStoryWorldBlock` in
`_shared/story-prompts.ts`):

- **It is a closed list, never free text.** The request carries an id
  (`cultural_setting`); the server maps it to a phrase in `CULTURAL_SETTINGS`
  (`_shared/types.ts`). An unknown id, a prototype key or a non-string is
  dropped, never refused -- the story is written as if no preference were set.
  *Anywhere* is never sent.
- **The brief always wins.** The block tells the model to ground names, places,
  food, customs, idiom and everyday objects in the region only where the idea,
  the setting and the cast's names leave culture open, and to follow the brief
  wherever it points elsewhere.
- **Shaping receives it too.** `shape-story` is where *Where and when* and the
  cast's names are first inferred, and generation then treats them as the
  brief. So the shaper gets the same id and one fixed sentence
  (`buildStoryShapePrompt` in `_shared/story-shape.ts`): where the idea names
  no place, culture or people, infer the setting and names from the region;
  creator-supplied names are never changed. Without this, the shaper's guess
  would become the "brief" that overrides the preference it never saw.
- **Chapter one only; not stored.** Later chapters, continuations and
  reimagines inherit the world the opening established through the story bible
  and the text itself, so the preference needs no column. Covers are unchanged:
  the cover prompt reads the setting and never this preference.

This amends the older rule (AGENTS.md *Cultural Context*) that there is no
explicit culture field. There is still no ethnicity field and no per-character
culture: inference from names, traits and setting remains the design, and the
preference is only the default for what the brief leaves open.

### Reader context (languages and home, 2026-09-25)

A reader can also set **Languages and home** on You (*Global preferences*):
up to three languages they speak, from a closed list of 30 ISO 639 ids, and
optionally the city they live in. It reaches the first chapter's prompt as the
**Reader context** block, placed directly after Story world
(`buildReaderContextBlock` in `_shared/story-prompts.ts`).

- **It is not an output language.** The prose is written in the brief's
  `language` and nothing else. A reader who speaks Hindi and reads in English
  gets English prose; the block says the languages are cultural context, and
  allows at most a single word where a character would naturally say it.
- **The brief always wins**, exactly as for Story world: names,
  neighbourhoods, food, idiom and everyday texture lean toward the reader only
  where the idea, the setting and the cast's names leave it open.
- **Read from the account, never from the request.** It is stored in
  `reader_preferences` (migration 00100) and the generation functions load it
  as service role keyed on the verified user id (`loadReaderContext` in
  `_shared/reader-preferences.ts`). No generation request field carries it, so
  a client cannot inject another account's context or text of its own here.
- **Languages are fixed labels; the city is fenced.** Language ids map to
  names in `SPOKEN_LANGUAGES`; an id this build does not know is dropped. The
  city is the one piece of reader text: validated on write (letters and marks
  in any script, digits, spaces and `. , ' ( ) -`, at most 60 characters,
  whitespace collapsed) and backstopped by the table's CHECKs, and it still
  reaches the prompt inside `userField("home-place", ...)` as untrusted text.
- **A published story can reflect the city.** That is the point of the
  block, and it is also a disclosure: a public story may hint at where its
  author lives. The sheet says so under the city field ("Stories you publish
  may reflect it"), and it asks for a city or region, never a street address.
- **The sheet cannot save from a stand-in.** Save replaces both fields, so
  the form on You is shown only once the saved value has loaded; a failed read
  shows Try again rather than an empty form that would erase it.
- **Never blocks a story.** A failed read is no block; a reader with nothing
  set gets a prompt byte-identical to one from before the preference.
- **Chapter one only**, like Story world, via both `generate-story` and
  `generate-story-stream`. Later chapters inherit the opening. **Known gap:**
  `shape-story`, which pre-fills *Where and when* and the cast's names, does
  not receive it, so when the shaper runs, the names it infers are already the
  "brief" and the block shapes only what is left (texture, food, idiom).
  Passing it to the shaper is a follow-up.

Reader phrase seeds were removed on 2026-09-24 with the reader's Save phrase
feature: generation no longer reads a reader's saved phrases, and the layer and
`_shared/phrases.ts` are deleted. The `saved_phrases`, `phrase_corpus` and
practice tables are kept, unread, until they are dropped after launch.

### Moments and Their Delivery

A moment is unordered: the model schedules it wherever the pacing allows, which
is the difference between a moment and a plan beat, and the reason the
instruction says "somewhere" rather than naming a chapter. Up to five may be
pinned.

Across a series the list is **partitioned, not repeated**. `series_state`
carries `delivered_moments`, the moments earlier chapters reported delivering,
and the moments layer splits the supplied list against it:

- Moments already delivered are listed under their own heading and the model is
  told they have happened and must not be written again.
- Moments still owed keep the "each must happen somewhere in the story, in
  whatever order serves the pacing" instruction.
- When nothing is owed, the prompt says so plainly rather than emitting an empty
  list — "no moments in the brief" and "every moment already landed" are
  different stories.
- Matching is on trimmed text. A story created before delivery tracking existed
  has no `delivered_moments` key; a missing or non-list value reads as empty and
  briefs exactly as it always did.

**Runway pressure.** When the chapters remaining
(`planned_chapter_count - chapter_number + 1`, clamped at one) are no more than
the moments still owed, the prompt states both counts and instructs the model to
start landing them in this chapter. Without it a series defers every moment and
arrives at its finale owing the whole brief. A missing or nonsensical chapter
number reads as chapter one, the same defensive reading the plan layer uses.

The moments block sits directly beneath the cast, and carries one line saying
that where a moment names a character from the cast above, it refers to that
character. This is what links the two without making `moments` a structured
column.

Both halves of that partition have to be wired for either to work. The
continuation prompt is assembled by `buildContinuationUserPrompt`
(`story-prompts.ts`), which takes `series_state` as a **required** argument and
passes it into the brief itself. It is a single function rather than four
template literals in `continue-story/index.ts` because when it was the latter,
the handler read the row's state, gave it to the _system_ prompt, and left it
out of the brief — so `delivered_moments` was empty on every chapter of every
story, the "already delivered" heading never rendered, and the runway line
always claimed the entire brief was still owed.

`delivered_moments` is part of the emitted `series_state`, so the model reports
what it delivered. Every entry must be **copied verbatim** from the supplied
moments; the merge is append-only and drops anything the brief did not contain,
so a partial, malformed or inventive response can neither shrink the delivered
set nor write arbitrary text into stored state. Chapter 1 is verified the same
way, since it is where the set starts.

### The Previous-Chapters Window

A continuation is written from the four most recent chapters (`.limit(4)` in
`continue-story`). **Only the newest of them travels as prose, and only its ends
do.**

Time-to-first-token scales with prompt size at roughly **0.21 s per KB** against
the pinned model (measured 2026-09-11): chapter 1's prompt is 14.7 KB and starts
in 4.0 s; chapter 2's is 30.5 KB and starts in 7.0-7.9 s. The entire difference
is the previous chapter travelling verbatim. When all four travelled in full the
cost was not a fixed penalty on chapter 2 — it grew with the series, reaching
roughly 66 KB by chapter 5, which extrapolates to about 15 s before a reader
sees a word.

So the window is bounded rather than proportional:

- **The chapter immediately before this one** keeps its opening (~600
  characters) and its ending (~5,000 characters) verbatim. The end is what a
  continuation is written from — the scene it closed on, the line still
  hanging, the voice as it actually sounds — and the opening is where the
  chapter's register is set, which a model handed only an ending will drift
  away from. The elision between them is **stated out loud** rather than the
  halves being silently joined: a model given a paragraph that ends mid-scene
  and resumes elsewhere treats the join as a jump cut it must explain.
- **Every older chapter** travels as its stored `previously_summary` — the
  field the model itself wrote for this purpose, and which the finale's
  chapter-1 callback already trusted. This is not a downgrade to a summary; it
  is the summary being used where it was always meant to be used.
- **`series_state` travels separately** and carries the open hooks, promised
  payoffs, world facts and character changes — which is the continuity older
  prose was being re-read for.

A chapter already shorter than the head-plus-tail budget is sent untouched, so
nothing changes for the stories where nothing needed to.

`buildPreviousChapterWindow` and `trimToEnds` in
`_shared/continuation-window.ts` own this. Changing the budgets is a story-quality decision, not a tuning knob:
verify against output quality, not against a stopwatch.

### Prompt Caching

The prompt is assembled as a stable half and a variable half, and the split is
already clean. The **system prompt** — base + engine + genre + audience +
identity + spice + language + titling + schema — is byte-identical for every
chapter of every story sharing those settings; everything about *this* chapter
lives in the **user message**. That is a ~10 KB prefix, and before
`systemMessage` in `llm.ts` it was re-sent, re-billed and re-processed on every
call including every rung of a retry ladder.

The system message therefore carries a cache breakpoint
(`cache_control: { type: "ephemeral" }`) on the OpenRouter paths, streamed and
buffered. Providers that price a cache read want the explicit breakpoint;
providers that cache automatically ignore the annotation and hit anyway, because
the prefix was already stable. **Nothing about the prompt's content changes** —
a provider that ignores the field receives the request it always received.

The consequence for anyone editing the prompt: **do not move per-story or
per-chapter content into the system prompt.** A single variable byte in the
prefix costs every subsequent call its cache hit.

### The Exclusion Layer (`avoid`)

`avoid` is the **last** content layer, after the moments and before the language
line. It is stated as a bound, not a preference: the text must not appear, it
must not be alluded to, and it must not be substituted by a renamed version.
Negative constraints need recency, and a hedge invites the model to trade the
constraint away against everything asked of it further down the prompt.

"Last" is measured against the whole message, not against the brief. On a
continuation the brief is only the opening of the user turn: the
previous-chapters window follows it, and by chapter seven that window is the
largest block in the request. So `buildUserPrompt` takes `deferExclusion` and
`buildContinuationUserPrompt` emits `buildExclusionBlock` **after** the window,
immediately before the single closing instruction — which is also the only
closing instruction now, rather than the brief's plus the handler's. A first
chapter is unchanged: nothing follows its brief, so the exclusion stays where
the builder puts it.

`avoid` also reaches the **cover**. It is threaded from the generation functions
through `generateStoryMedia` and `generateCoverImage` into `buildCoverPrompt`,
where it renders as an explicit `Do not depict: ...` clause. The exclusion is
carried at **every rung of the safety-level fallback ladder**, including the
genre-and-title-only rung: that ladder exists to get past a content filter, so
the rung most likely to be reached is the one where an unconstrained cover would
be worst. The value is sanitized before it leaves for the image provider —
newlines collapsed, sentence terminators collapsed to commas, quoting and
bracket characters removed, length capped — because it is user free text
travelling to a third party in the same string as our own instructions. That
sanitizer is applied to the two free-text fields that reach a cover prompt,
`avoid` and the regeneration steer; `title` and `where_and_when` are
interpolated as written, deliberately, because collapsing punctuation in them
would turn "Dr. Smith's Door" into "Dr, Smiths Door".

## Anti-Slop Rules

### Banned Words

delve, tapestry, testament, pivotal, underscore, landscape, foster, beacon,
undeniably, multifaceted, nuanced, intricate, commendable, meticulous, endeavor,
realm, paradigm, synergy, ecosystem, framework, robust, streamline, leverage,
harness, utilize, embark, unravel, comprehensive, holistic, unprecedented,
transformative, groundbreaking, innovative, enhance, crucial, furthermore,
moreover, consequently, bustling, labyrinth, crucible, ministrations, myriad,
palpable

### Banned Phrases and Patterns

- "it's not X, it's Y"
- "it is important to note"
- "it is worth mentioning"
- "in today's world"
- "at the end of the day"
- "one of the most"
- "when it comes to"
- "at its core"
- "little did they know"
- "stands as a testament"
- "plays a vital role"
- "rich cultural heritage"
- "enduring legacy"
- "a shiver ran down"
- "a wave of emotion washed over"
- "the weight of"
- "time seemed to stand still"
- "their eyes locked"
- "heart pounding"
- "heart hammered"
- "breath caught"
- "let out a breath they didn't know they were holding"
- "couldn't help but"
- "voice barely above a whisper"
- "etched with"
- "gaze softened"
- "sent a chill through"
- "furrowed brow"
- "jaw tightened"
- "steeled themselves"
- "squared their shoulders"
- "eyes widened"
- "eyes sparkling"
- "knot in stomach"
- "pit in stomach"
- "air was thick with"

### Structural Tells

These are strong defaults, not universal hard bans. Genre modules may override
them when the device is genre-native.

- Avoid accumulative parallelism: "same X, same Y, same Z."
- Avoid rule-of-three narration except in Comedy.
- Avoid vague participial tails: "She walked out, leaving him speechless."
- Avoid negative parallelism: "Not only was he X, but he was also Y."
- Avoid rhetorical questions in narration.
- Avoid "as" sentences that stack simultaneous action.
- Avoid semicolons in dialogue or interior monologue.

### Banned Default Names

Elara, Seraphina, Lysander, Thorne, Elowen, Rowan, Zephyr, Isolde, Caelum,
Evren.

## Universal Craft Rules

- Show subtext through behavior. Do not explain it.
- Name fewer emotions. Make the body, object, action, or setting carry the turn.
- Specific over general.
- Dialogue does work: every line changes belief, status, tension, or plot.
- Use "said" for most dialogue tags and "asked" occasionally. Avoid decorative
  tags.
- Each character's voice should be identifiable without tags.
- Include interruption, deflection, silence, or non-answer in dialogue scenes.
- Use sensory grounding, but do not force a checklist into every paragraph.
- No em dashes in story text.
- No bullet lists in story text.
- No meta-commentary.
- No moral lecture at the end.
- The brief is private guidance: moments, plan beats and every character's
  background and appearance are never quoted or paraphrased into narration or
  dialogue. No references to chapters or the book ("from Chapter 1"), no
  address to the reader, no notes to self (word counts, checklists, remarks
  about banned phrases). Brand names include the everyday ones (clubs, cars,
  supermarkets, drinks, banks, money transfer, magazines).

**Enforced after generation, not only asked for** (2026-09-18).
`_shared/prose-integrity.ts` runs on every chapter body immediately before it
is persisted, on every path that writes model prose (`generate-story`,
`generate-story-stream`, `continue-story` on both transports,
`reimagine-chapter`, and `edit-story`'s AI paragraph rewrite; never the
notepad save, which is the writer's own text). It removes trailing JSON and
markup residue, a final paragraph duplicating an earlier one, model-note lines,
sentences sharing a run of nine or more normalised words with a moment, beat or
cast sheet sentence, and cross-references like "from Chapter 1" (lifting the
phrase out when the rest is still a sentence). It is deliberately conservative:
in-world books ("chapter three of the manual") are left alone, the echo rule
stands down if it would take more than 15% of a chapter's sentences, and a pass
that would remove over 40% of the words reverts to the residue cleanup. Every
removal is logged to `error_events` (`prose_integrity_removed`, low, kinds and
counts only). Brand names from the editors' list are logged
(`brand_name_leaked`), never rewritten.

## Read-Aloud Rules

Adult modes:

- Sentences usually under 30 words, with genre exceptions for Vampire,
  Historical, Poetry, and some Contemporary.
- Paragraphs usually under 120 words.
- Simple punctuation by default.

Kids Bedtime:

- Maximum 12 words per sentence.
- Most words 1-2 syllables.
- Final three sentences 3-8 words each.
- Repetition is structural.
- Ending returns to safety, warmth, and sleep.

## Identity Lens: Queer

Applies when the user enables the LGBTQ+ / queer lens, or when character details
make queer identity clear.

- Queer identity is integrated, not explained.
- Characters do not deliver identity lectures to the reader.
- Coming out is not the default climax unless the seed explicitly asks.
- Chosen family, community, dating context, family dynamics, and regional
  texture matter when relevant.
- Avoid stock archetypes: sassy best friend, tragic queer, wise older gay
  mentor, tortured artist.
- Avoid bury-your-gays endings.
- Avoid making queer identity a replaceable label with no effect on scene,
  social context, desire, or pressure.

## Spice Modules

Two tiers, both written as craft direction. Each names the technique that
replaces anatomy, because a model handed only a prohibition writes around the
missing thing and returns the vague soft-focus paragraph every reader recognises
as an author avoiding something.

### Sweet

- Longing, not consummation. Protect the distance the characters have not closed
  yet; end the scene that would resolve it one beat early.
- Want is written as attention: what a character cannot stop noticing about
  another one.
- Touch is rationed and therefore enormous. Spend it on something small and
  specific, and register the cost.
- Put the feeling in the wrong sentence. Subtext over declaration.
- Kissing is allowed and should be rare. Write what changes afterward, not the
  choreography.
- Nothing sexual on the page or implied in the room. Cut to morning and let the
  aftermath do the work.
- Default for non-romance genres and all Kids generation.

### Steamy

- Desire is on the page; the act is not. This is the register of the moment
  before and the moment after.
- Charge lives in proximity and delay. Slow the prose where the characters slow
  down.
- The specific detail beats the general one. Specificity reads as intimate;
  anatomy reads as clinical.
- Keep the interior channel open — what a character is afraid of while wanting
  this. Heat without stakes is choreography.
- Consent is legible in the writing, not stated as policy. A pause that gets
  honoured is more erotic than one that gets ignored.
- Undressing, hands, mouths, the weight of one body against another are allowed,
  without naming genitals or describing mechanics. At the act itself, cut.
- The cut is the craft, not the censorship: the reader finishes the scene, and
  what they build is better than what the model would have written.

## Genre Modules

### Romance

Reader promise: yearning, tension, and an earned emotional payoff.

- Slow burn by default.
- One credible obstacle keeps the leads apart.
- Physical awareness accumulates through specific details.
- Climactic emotional or romantic choice lands before the final paragraph.
- No early love declarations unless they are a mistake.
- No attraction checklists or perfect love interests.

### Romantasy

Reader promise: magic and love entangled.

- Romance and fantasy arcs escalate together.
- The fantasy plot should break if the romance is removed, and the romance
  should lose force if the world is removed.
- Worldbuilding appears through use, conflict, cost, and power.
- Political or magical stakes matter.
- Avoid fake-archaic dialogue, prophecy dumps, and mate-bond shortcuts.

### Dark Romance

Reader promise: dangerous intensity within clear fiction and consent boundaries.

- Adult-only, steamy default.
- The love interest is genuinely dangerous, not merely rude.
- The protagonist has agency and resistance.
- Power imbalance is interrogated, not erased.
- Obsession is shown through protection, sacrifice, fixation, or risk, never
  abuse framed as love.
- No coercion presented as sexy.

### Cozy Fantasy

Reader promise: low-stakes warmth in a magical world.

- Conflict is small but meaningful.
- Craft, trade, home, community, or repair is central.
- Found family matters.
- Ending lands in small victory and rightness.
- No epic villains, chosen-one plots, ancient evil, tragedy, or high-stakes
  world-ending threat.

### Paranormal Romance

Reader promise: supernatural desire, belonging, and transformation.

- Supernatural rules should be consistent but not overexplained.
- The romance is central.
- Bodily awareness, scent, hunger, danger, secrecy, and belonging can carry
  tension.
- No supernatural bond as an excuse for one-sided consent.

### Fantasy

Reader promise: a world that feels real enough to visit.

- Introduce magic through one character using it for a specific reason.
- Magic has cost or consequence.
- World through detail, not explanation.
- Avoid generic medieval defaults and exposition disguised as dialogue.

### Sci-Fi

Reader promise: a speculative idea handled with human care.

- One central speculative element.
- Technology appears through use.
- Ask what the idea does to a person, relationship, memory, body, job, or home.
- Avoid hardware worship, tidy time-travel logic, and generic AI apocalypse.

### Thriller (retired from the picker, 2026-09-08; kept for existing stories)

Reader promise: urgency.

- Open with immediate pressure or threat.
- Establish a ticking clock early and return to it.
- Antagonist or force has real capability.
- Each scene worsens the problem.
- Avoid villain monologues, convenient skills, dream red herrings, and pauses
  that kill momentum.

This text is unchanged and still generates for any story that already carries
`primaryGenre: "thriller"` — `story-prompts.ts`'s own genre lookup resolves a
stored value directly, unmigrated, before it ever consults the migration map.
A NEW thriller submission no longer reaches this module: `GENRE_MIGRATION_MAP`
redirects it to Mystery, whose module below now carries thriller's engine
too. See **Mystery** for the merge rationale.

### Mystery (absorbs Thriller's engine for new submissions, 2026-09-08)

Reader promise: a fair puzzle **and** the dread of something closing in. New
thriller submissions migrate here (`GENRE_MIGRATION_MAP.thriller`), and
mystery and thriller run on genuinely different engines, puzzle-and-revelation
versus dread-and-momentum, so this module was rewritten to carry both rather
than leaving a migrated thriller idea with puzzle-only craft it wasn't
written for.

- Plant genuine clues early and let a clock, literal or felt, run underneath
  them; alternate the reveal that sends the reader back to reread a scene
  with a burst of pure momentum (a chase, a countdown, a forced decision).
- A detective, witness, or target with one specific, unusual method of
  observation, and a competent antagonist.
- The reveal explains how and why; a smart decision can still go wrong.
- Avoid characters conveniently overhearing key information or failing to
  call for help, a monologue explaining the whole plan, evidence or danger
  that appears only when the plot needs it, and a reader with no real chance
  to solve the puzzle or no reason to feel the clock running.

The full merged module lives in `GENRE_VOICES.mystery` in `story-prompts.ts`.
`GENRE_VOICES.thriller` is untouched, on purpose: it is dead code for new
submissions but still the only text an existing thriller story reads.

### Horror

Reader promise: dread that lasts.

- Ordinary things wrong are stronger than generic monsters.
- Suggestion over gore.
- The supernatural may have rules even if unstated.
- End on ambiguity, escalation, or revelation.
- Avoid jump-scare prose, gore inventories, and characters dismissing obvious
  danger for pages.

### Contemporary (retired from the picker, 2026-09-08; kept for existing stories)

Reader promise: recognizably real life with emotional precision.

- Absorbs Drama and Slice of Life registers.
- Stakes are relational, professional, family, social, or existential.
- Subtext carries weight.
- Ending is recognition or shift, not a lesson.
- Avoid brand-name clutter, think-piece narration, manufactured stakes, and tidy
  therapy monologues.

**Shared module, not a duplicate (product decision, 2026-09-08):** this was
already slice-of-life craft ("the tension of normality cracking is the
drama," the specific over the abstract) before Slice of Life existed as its
own genre. `story-prompts.ts` defines it once, as `CONTEMPORARY_VOICE`, and
`GENRE_VOICES.contemporary` and `GENRE_VOICES.sliceOfLife` both point at that
same object, so an edit to one cannot silently diverge from the other. See
**Slice of Life** below.

### Historical

Reader promise: time travel with period consciousness.

- Characters believe things people of their time, class, and place might
  believe.
- Period constraints create tension.
- Use concrete period detail every scene.
- Avoid modern slang, name-dropping historical figures for no reason, and modern
  values without consequence.

### Adventure

Reader promise: motion, stakes, and a world that punishes hesitation.

- Open in motion or with a physical problem.
- Environment acts as antagonist.
- Recovery beats reveal character.
- Competence should be set up before it matters.
- No fight or escape without cost.

### Comedy

Reader promise: precision, timing, and surprise.

- Pick deadpan, warm observational, or absurd and commit.
- Comedy may use rule of three.
- Characters take absurdity seriously.
- Punchlines land in short sentences.
- Avoid explaining jokes, random references, and sarcasm as the only humor.

### Poetry

Reader promise: compressed, musical narrative.

- Prose poetry is allowed: paragraphs and sentences with poetic density.
- Recurring images gather meaning.
- Nonlinear movement is allowed if emotional logic is clear.
- Avoid abstract declarations, adjective stacking, rhyme-for-rhyme's-sake, and
  obscurity as a substitute for depth.

### Educational (researched revision, 2026-09-08; docs/research/educational.md)

Reader promise: a real story where the information is load-bearing, not a
lesson wearing a plot. The researched module adds the one thing the original,
first-pass module was silent on: what the model should do when it is not
certain of a fact. Craft research (Fazio, Marsh et al. on the "transportation
effect") found that a confident, specific claim inside a well-told story is
*more* likely to be believed than the same claim stated plainly, which means
this product's base-layer "always more specific" instinct is actively
dangerous here.

- The protagonist needs the fact or skill to solve the actual problem; delete
  it and the plot should break.
- **State a mechanism only when you are certain of it.** When unsure, choose
  the truer, plainer version over the more impressive, more specific one — a
  vague sentence that holds up beats a vivid one that doesn't. This overrides
  the base layer's general specificity push for this genre only.
- Learning happens through a mistake and its consequence, or through a
  character who has an actual reason to say something out loud right now,
  never through a narrator stopping to explain.
- Break a large idea into the two or three moments the plot already needs
  ("incluing"), rather than one scene carrying the whole concept.
- Avoid a narrator who stops to explain, a quiz disguised as dialogue, a
  moral or "lesson" paragraph at the end, and textbook diction. If it reads
  like a worksheet with a plot bolted on, it has failed.

**Not implemented, flagged for a future decision:** the memo's strongest
recommendation is a Magic-School-Bus-style closing disclosure, a short note
in a separate, plain register stating what in the story is real and what was
invented or dramatized. That is a schema and product change (a new field
rendered outside the reading experience), not a prompt change, and prompt
craft alone cannot fully close the truth gap the memo documents. See
**Deferred Research Recommendations** below.

### Fanfiction (researched revision, 2026-09-08; docs/research/fanfiction.md)

Reader promise: the known pleasures of a beloved dynamic, delivered faster and
closer than original fiction would. The research verdict: fandom's quality
bar (fifty years of evidence, from 1970s zine culture to AO3) is fidelity to
a specific character's voice and canon, and a shared voice module — one
paragraph reused for every fanfiction story — cannot supply that. The
revised module stops promising it. The old text claimed "voice and mannerism
consistency for an established dynamic"; the grounding pipeline explicitly
excludes `fictional_character` from grounding today
(`selectGroundingCandidates`), so that promise had no mechanism behind it.

- Heightened, compressed register for a reader who already loves this cast;
  skip introductions a debut story would need.
- **This voice module cannot tell you how a specific character talks, what
  they call each other, or what already happened between them.** That has to
  come from the grounding layer or from what the user wrote. Without it,
  name the characters and write a strong original scene rather than guessing
  at a voice the model does not actually have.
- Commit fully to the chosen trope (enemies to lovers, found family, one bed,
  canon divergence) and deliver its known pleasure with one fresh, specific
  detail, rather than winking at the reader.
- No real named public figures or identifiable private individuals, in any
  pairing or scenario (unchanged; the research confirms this is the one line
  fandom itself has never resolved, so it is the right line to hold rather
  than adjudicate).

**Not implemented, owned by a separate workstream:** the memo's grounding
extension (a new `fandom_canon_character` `EntityClass`, a fourth
`needs_grounding` test tuned to OOC risk rather than obscurity, and new
`GroundingCard` fields for speech pattern, canon-versus-fanon, and
relationship state) is real, scoped work that would let this genre honor the
fidelity promise it currently disclaims. It is being implemented separately;
this revision does not touch `grounding-types.ts`, `entity-classify.ts`,
`grounding-card.ts`, or `grounding-pipeline.ts`. See **Deferred Research
Recommendations** below.

### Folktale (researched revision, 2026-09-08; docs/research/folktale.md)

Reader promise: an oral-cadenced tale told as if aloud, with a consequence
that demonstrates its own lesson. Folklore scholarship (Propp's *Morphology
of the Folktale*, Luthi's *The European Folktale*, Parry and Lord's
oral-formulaic theory) documents that flat archetypes, structural repetition,
and formulaic openings are the form working as designed, not a craft failure
— which puts folktale in genuine, citable collision with several of this
product's global craft rules. Rather than let the model silently choose a
side, the module **names each rule it suspends, in its own text**, so a
reader of the assembled prompt can see the exception being made:

- **Suspends the base layer's Show, Don't Tell rule** where it demands
  character interiority. Archetypes get one distinctive trait, played out
  through action, not a psychology to explore.
- **Suspends the base layer's Sentence Rhythm rule** against repeated
  structure, inside a deliberate rule-of-three or refrain. A phrase returning
  almost word for word is the tale doing its job, not a slip to smooth over.
- **Suspends the general anti-cliche instinct, and the base Pacing rule
  against resolving too neatly**, for a stock opening/closing formula and a
  hard-closed ending. The formula is the doorway here, not a tell to
  freshen up.
- Dialogue stays role-consistent rather than fully individuated (the
  trickster boasts the same way every time; the fool always answers
  literally) — a softened, not suspended, version of the base voice-
  individuation rule.
- Avoid stating the moral outright, modern anachronisms breaking the
  timeless setting, and a trickster who wins by force instead of wit.

No other genre gets these carve-outs, and the base rules above are unchanged
for everyone else; only folktale's own module text suspends them, and only
for the specific case named.

### Slice of Life (researched revision, 2026-09-08; inherits Contemporary)

Reader promise: the story in a single ordinary day, found through noticing
rather than crisis.

**This genre shares its module with Contemporary rather than duplicating
it** (product decision, 2026-09-08): Contemporary's craft ("the tension of
normality cracking is the drama," small domestic details, the specific over
the abstract) already was slice-of-life writing, before Slice of Life existed
as its own `PrimaryGenre`. `story-prompts.ts` defines the text once
(`CONTEMPORARY_VOICE`) and both `GENRE_VOICES.contemporary` and
`GENRE_VOICES.sliceOfLife` reference that same object, so a future edit to
one cannot silently drift from the other. See **Contemporary** above for the
actual module text.

## Deferred Research Recommendations

Two recommendations from the 2026-09-08 research pass (docs/research/) are
real, load-bearing findings that are **not implemented by this revision**, so
they are recorded here rather than lost:

1. **Educational's fact/fiction closing disclosure** (docs/research/educational.md,
   §3 Position 4, §4 Decision 4). No amount of prompt craft makes a language
   model's factual prose infallible; the Magic School Bus books' answer is
   structural, a short, separately labeled closing note distinguishing real,
   checkable fact from what was invented or dramatized. This is a schema and
   product change (a new field, rendered outside the reading experience), not
   a prompt change, and is the single highest-leverage recommendation in that
   memo.
2. **Fanfiction's grounding extension** (docs/research/fanfiction.md, §3,
   §6 Decisions 3-5). A new `fandom_canon_character` `EntityClass`, a
   classifier test tuned to OOC risk rather than obscurity, and new
   `GroundingCard` fields (speech pattern, canon-versus-fanon, relationship
   state) would let fanfiction's grounding pipeline actually deliver
   characterisation fidelity. This is being implemented as a separate
   workstream and deliberately was not touched here.

### Kids: day register

> **Style guidance, not a contract.** The backend exposes a single `kids`
> audience mode. The two registers below are tonal guidance a caller can steer
> toward through the seed; they are not separate modes, and the prompt builder
> does not read them. The enforced Kids constraints are in
> `buildAudienceModeRules()`: 500-1200 words for a standalone story, 600-900 for
> a series chapter, plus the language, content, tone, ending, and hook rules.

Reader promise: active, warm, concrete, child-centered story.

- Age target: roughly 4-10.
- One clear protagonist, one clear want, one clear problem.
- The child protagonist solves the problem through effort, curiosity, kindness,
  courage, or cleverness.
- Mild peril and funny beats are allowed.
- No adult romance, spice, graphic violence, horror, or moral lecture.

### Kids: bedtime register

Reader promise: the child feels safe and ready for sleep.

- Age target: 3-6.
- Maximum 12 words per sentence.
- Prefer concrete, familiar words.
- Small conflict, quickly resolved.
- No suspense, real danger, cliffhanger, high-energy language, or exclamation
  points after the first paragraph.
- Soft senses: warmth, blanket weight, low light, quiet sound, familiar smells.
- Final paragraph explicitly returns to safety, warmth, and sleep.

Bedtime substitutions:

- eventually -> soon
- particular -> special
- arrangement -> way
- situation -> time/place
- reluctant -> shy
- mysterious -> strange/funny
- experience -> time
- discover -> find
- remember -> know
- understand -> know/see
- immediately -> right away
- suddenly -> then/all at once
- continued -> kept
- decided -> chose
- imagined -> thought
- interesting -> fun
- wonderful -> good/lovely
- important -> big/real
- different -> new
- however/although -> but
- perhaps/probably -> maybe

## Titles

**Three different calls name a chapter, and they share their rules.** The shape
constraints and the banned-phrase list live in `story-prompts.ts` as
`CHAPTER_TITLE_SHAPE`, `STORY_TITLE_RULES` and `BANNED_TITLE_PHRASES`, and are
composed into all three:

| Call | Where | What it can see |
|---|---|---|
| `buildOutputSchema` | `story-prompts.ts` | The chapter it just wrote (buffered JSON transports) |
| `CHAPTER_METADATA_SYSTEM_PROMPT` | `story-stream.ts` | The finished prose |
| `CHAPTER_NAMING_SYSTEM_PROMPT` | `story-stream.ts` | Only the brief — it runs *before* any prose exists |

The last of these **wins at persist time**, because its whole purpose is to give
the reader a chapter name immediately rather than 40 s in. Weak guidance there
is not a second-best title; it is the title.

**The rule is a sourcing rule, not an instruction to be creative.** Asking a
model to be creative produces *Whispers of the Forgotten*. Asking it to name one
concrete thing that occurs in the material it was given cannot produce a generic
title, because the material was not generic. The three calls differ only in
where they read that thing from — the written chapter, or the beat that briefs
it.

The banned list is **explicit and named**. A model told to "avoid clichés" does
not know which ones we mean; these are the specific strings that came back over
and over. A chapter title is one to four words, never numbered, never a colon
subtitle, and never a spoiler for the chapter's own ending.

**Every continuation is told the titles already used** (2026-09-18).
`CHAPTER_TITLE_SHAPE` always said a chapter title must differ from every title
already in the story, but no call was ever given that list, and auto-run series
came back with "The Spare Keys" twice and three chapters called "The Urdu
Newspaper". `buildUsedChapterTitlesBlock` now puts the full list into both the
continuation user prompt and the naming call. Behind it,
`_shared/chapter-titles.ts` guards persistence: a title that normalises (case,
punctuation, leading article, plural) to an existing one, or to the story
title, is refused; the next candidate is tried (the streamed path offers the
metadata name after the early one), then a title derived deterministically from
the chapter's hook, first line or opening sentence, then `Chapter N` as the
last resort -- itself checked, becoming `Chapter Na`, `Chapter Nb`, ... if a
writer already used that exact title, so no path can persist a duplicate. A
duplicate early name is not painted.

An earlier revision put all of this inside `buildOutputSchema` alone and claimed
it reached every path. It did not: the streamed transport takes the prose
contract, so the rules governed only the handlers kept for retries while the
call that actually named the chapter had one sentence of guidance.

## Output Schema

Use API-level structured output where supported. The prompt should still remind
the model of the schema, but backend code must validate it.

Standalone:

```json
{
  "title": "string",
  "chapter_title": "string",
  "chapter_body": "string",
  "word_count": 1200,
  "themes": ["lowercase tag"],
  "first_line": "string",
  "previously_summary": "string",
  "series_state": {
    "central_conflict": "",
    "protagonist_want": "",
    "relationship_state": "",
    "open_hooks": [],
    "resolved_hooks": [],
    "promised_payoffs": [],
    "world_facts": [],
    "character_changes": [],
    "next_chapter_pressure": "",
    "delivered_moments": []
  },
  "hook_type": "none",
  "hook_text": ""
}
```

Continuation:

```json
{
  "chapter_title": "string",
  "chapter_body": "string",
  "word_count": 900,
  "themes": ["lowercase tag"],
  "first_line": "string",
  "previously_summary": "string",
  "series_state": {
    "central_conflict": "string",
    "protagonist_want": "string",
    "relationship_state": "string",
    "open_hooks": ["string"],
    "resolved_hooks": ["string"],
    "promised_payoffs": ["string"],
    "world_facts": ["string"],
    "character_changes": ["string"],
    "next_chapter_pressure": "string",
    "delivered_moments": ["string"]
  },
  "hook_type": "none|revelation|reversal|decision|arrival|betrayal|danger|unanswered_question|emotional_rupture",
  "hook_text": "string"
}
```

Field rules:

- `chapter_body`: plain text with `\n\n` between paragraphs, no markdown.
- `themes`: 2-4 lowercase tags, 1-3 words each.
- `previously_summary`: 2-4 sentences summarizing this chapter for future
  continuation context.
- `series_state`: empty strings/arrays for standalone; complete continuity state
  for every series chapter.
- `series_state.delivered_moments`: the promised moments this chapter actually
  delivered, each copied verbatim from the supplied list. Never invented, never
  reworded, and a moment only set up does not belong here. The server merges it
  append-only and discards any entry the brief did not contain.
- `hook_type` and `hook_text`: `none`/empty for standalone and finale; required
  for series opening and mid-series chapters.
- Taxonomy, audience, ratings and chapter roles are server-derived metadata and
  are not model-output fields.

## Backend Contract

Required request fields:

- `request_id`: client-stable idempotency key
- `primary_genre`: single supported genre
- `story_mode`: optional, `standalone | series`; legacy `is_series: true` maps
  to `series`
- `seed`: one non-whitespace character minimum, 1,000-character maximum
- `characters`: optional, maximum three. Each character carries `name`,
  `description`, `background`, `appearance`, and `isHero`; when a cast is
  present, exactly one character is the lead. Appearance feeds the character
  portrait prompt, Background feeds voice and motivation, and the lead anchors
  the story engine.
- `language`: optional; Create **offers English only** (2026-09-11). Do not
  accept Spanish or Portuguese from new Create submissions. Existing Spanish and
  Portuguese stories retain their stored language for reading and continuation
  compatibility — the withdrawal is from the offer, not from the stored value.
- `title`: optional, trimmed, whitespace-collapsed, at most 120 characters
  (longer is refused, never clipped; blank is absent). When present it is the
  story's title on both transports: it overrides whatever the model or the
  early naming call produces, is what the streamed `title` event paints, and is
  what the cover prompt and the `done` payload carry. Absent means the model
  names the story, as before (2026-09-18).
- `image_style`: optional `auto | anime | cinematic | comic | watercolor`,
  defaulting to `auto`. Normalised, never rejected: it decides only what the art
  looks like, and refusing a paid generation over art direction is the wrong
  trade. Persisted as `stories.image_style` (migration 00075).
- `story_flow`: optional `interactive | auto`, defaulting to `interactive`.
  Normalised the same way but with the opposite bias — `auto` writes the next
  chapter and spends a credit without asking, so anything unrecognised must
  resolve to the mode that asks first. Persisted as `stories.story_flow`
  (migration 00076).
- `audience_mode`: defaults to `adult`
- `identity_lenses`: optional, currently only `queer`
- `spice_level`: optional, defaults by genre and account permissions
- `where_and_when`, `moments`, `writing_style` and `avoid`: optional bounded
  brief fields; every free-text value is fenced as untrusted data. `moments` is
  capped at five and tracked for delivery across a series; `avoid` is a hard
  constraint on the prose and is also routed to the cover prompt, so the art is
  bound by the same exclusion as the text. See **Brief Layers**.
- `story_values`: optional and meaningful only in Kids mode; the model explores
  them through action rather than delivering a lesson
- `chapter_length`: `short | standard | long`, selecting 600-900, 1,200-1,600 or
  2,000-2,600 words respectively
- `planned_chapter_count`: **1..15**. The picker offers 1, 3, 7 and 15; every
  other value in range is reached by a reader extending a finished story one
  chapter at a time (`reserve_generation_operation.p_extend_to_chapter`, 00079,
  bounded to exactly `plan + 1` by 00081). It drives continuation pacing and the
  automatic finale — and an extension is deliberately NOT a finale, except the
  one that reaches 15, which must be or the story never gets an ending
- `illustrate_chapters`: optional boolean for chapter art after Chapter 1;
  Chapter 1 art remains compulsory and is the cover
- `visibility`: `private | public`, default `private`; publication handling uses
  it, but it is not a prose instruction

The creation UI is exactly three screens: **Idea -> Shape -> Review and start**.
The only required free-text value is the idea. Shape holds the full-width
audience segmented control, inferred/editable genre and world, a dedicated
full-screen Craft character editor, moments, and collapsed More options. Review
shows the assembled brief and the price before the first paid action. There is
no global `writing_mode` request field: steering is per continuation chapter.

Validation should reject:

- unsupported genre/language/spice/audience values
- adult spice in Kids or Bedtime
- Dark Romance in Kids mode
- clear requests for minor sexual content

Validation must **normalize, not reject**, a retired `explicit` spice value: a
stale client build or a replayed request body would otherwise fail a generation
the user is waiting on. It maps down to `steamy`, then clamps against the genre
row like any other value.

Validation must likewise **normalize, not reject**, any of the seven genres
removed from the UI in the 2026-09-08 taxonomy change — the same "old client, a
retry, a stored draft" reasoning applies. See **User-Facing Taxonomy** for the
mapping. A genre already stored on an existing row is a different case and is
never touched: `story-prompts.ts` resolves it directly against its own voice
module rather than through this migration.

`spice_level` is optional and its absence must never be rejected: it defaults
per genre (`GENRE_DEFAULT_SPICE`, with `sweet` as the final backstop), because
spice is no longer a user-facing control (see Key v6 Decisions) and every
caller that omits it — which, after 2026-09-08, is every caller — needs a safe,
first-class result rather than an edge case that happens to work.

## App Store and Feed Compliance

- `sweet` and `steamy` are the only tiers. There is no adult-content unlock to
  gate, no region gate to build, and no explicit tier to keep out of the feed —
  the tier does not exist.
- `content_rating = 'explicit'` survives only on rows written before the
  retirement. `feed` and `library` continue to exclude it, and that exclusion
  must not be removed on the grounds that nothing can produce the value any
  more.
- Public feeds, share cards, app-store screenshots, notifications, and previews
  must never expose crude vocabulary.
- Kids mode hides adult controls and forces safe content filtering.

## Implementation Dependency Checklist

The VS Code agent should inspect and update these areas together:

- `backend/supabase/functions/_shared/story-prompts.ts`
- `backend/supabase/functions/generate-story/index.ts`
- `backend/supabase/functions/continue-story/index.ts`
- `backend/supabase/functions/_shared/llm.ts`
- `backend/supabase/functions/_shared/story_text.ts`
- `backend/supabase/functions/_shared/cover-prompts.ts`
- `backend/supabase/functions/_shared/image.ts`
- `backend/supabase/functions/library/index.ts`
- `backend/supabase/functions/feed/index.ts`
- `backend/supabase/migrations/`
- `expo/src/types/domain.ts`
- `expo/src/screens/CreateStudioScreen.tsx`
- `expo/src/lib/api.ts`
- `expo/src/theme/theme.ts`
- `expo/src/data/seed.ts`
- onboarding preference capture in `expo/src/screens/KathaOnboardingFlowV2.jsx`
- analytics events in `expo/src/lib/analytics.ts`
- cover image docs in `backend/COVER_IMAGES.md`
- strategic decision docs if taxonomy or adult gating changes

## Current Implementation Boundary

- `stories.primary_genre` is the routing genre. `stories.genre` retains the
  reviewed primary-first list for shelf tags and compatibility.
- `generate-story` accepts the primary genre plus up to two reviewed secondary
  genres, while every prompt module routes from the primary value.
- Expo exposes the 12 creation genres (2026-09-08 taxonomy) and models Kids as
  an audience mode.
- Strict provider schemas are the primary output contract. Plain-text parsing is
  retained only as a defensive compatibility fallback.
- `shape-story` is free scaffolding, authenticated and rate-limited. Its failure
  is silent in Create and never blocks manual completion of Shape.
- **A shaping response is a new submission, so it migrates.** `story-shape.ts`
  normalises the model's `genres` with migration checked before recognition,
  at both precisions — the same order `validation.ts` uses, and unlike
  `story-prompts.ts`, which recognises first on purpose so a stored series
  written in a retired genre keeps its own voice module. Prompting for the
  twelve UI genres is guidance; this is the enforcement.

### Educational: unverified by design, and disclosed

The `educational` module instructs the model to state a mechanism only when it
is certain and to prefer the plainer true version over the impressive specific
one. That is guidance to a generator, not a fact check. **Nothing in the
pipeline verifies a single claim**, and a confident wrong date or mechanism
reaches a reader through the ordinary publication path looking exactly like a
correct one.

Prompt guidance cannot close that gap. So the story page carries a disclosure
on every educational story — "fiction written by AI, facts are not verified" —
placed where the reader decides whether to read it. That is the honest limit of
what the product can promise today. Closing it properly needs a retrieval or
verification pass against a source of truth, which does not exist here yet; the
disclosure is not a substitute for one and is not described as if it were.

### Fanfiction: original cast, by rule

Fanfiction is the one genre whose premise collides with a Safety Rule ("No real
brand names or copyrighted characters"). The collision used to be unresolved:
the model was told both to serve a fandom request and to refuse the cast it
names, with nothing stating which wins or what the writer should get instead.

The precedence is now explicit in both places the model reads — the base Safety
Rules and the genre module. If the idea names a cast from an existing work, the
story is written with an **original cast** in the same situation and dynamic:
the trope, the relationship, the premise and the tone are all delivered as
asked, the names and trademarked specifics are changed, and the substitution is
never announced inside the prose.

What that makes the genre, plainly: fanfiction *craft* — the tropes, the
compression, the assumption of shared history with the reader — not
reproduction of a protected cast. Allowing named canon casts is a legal and
product decision rather than a prompt-engineering one. If it is ever made, this
rule is the first thing to change.

## QA and Evals

Before deploying:

- Run typecheck and existing backend tests.
- Add prompt unit tests for normalization, genre defaults, spice availability,
  Kids locks, queer lens layering, and continuation prompt assembly.
- Add golden generation evals per genre:
  - 5 normal seeds
  - 3 adversarial/safety seeds
  - 2 continuation seeds
  - 2 multilingual seeds where supported
- Score outputs for:
  - genre promise
  - story completeness
  - prose freshness
  - banned word/phrase violations
  - schema validity
  - content rating correctness
  - safety boundary handling
- Run cheap-model QA first because fallback models must obey the architecture.

## Sources Checked for v6 Direction

- Apple App Review Guidelines and November 2025 creator-content update: creator
  apps must let users identify content exceeding age rating and restrict access
  using verified or declared age.
- Google Play Developer Program policy: stricter language around sexual content,
  profanity, sexually gratifying services, non-consensual content, and child
  protection.
- OpenAI API prompt engineering docs: structured outputs should be enforced by
  the API rather than prompt wording alone.
- Microsoft prompt engineering guidance: prompts need validation/evaluation
  because behavior that works in one case may not generalize.
- Current market signals: mobile web-fiction growth, romantasy growth, and the
  commercial strength of romance-adjacent subgenres support separating
  Romantasy, Dark Romance, Cozy Fantasy, and Paranormal Romance.
