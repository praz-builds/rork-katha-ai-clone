# Story Generator — Prompt System (v6 Production Spec)

> Human-readable reference for the next production prompt system in
> `backend/supabase/functions/_shared/story-prompts.ts`.
>
> The TypeScript implementation is the runtime source of truth. This document is
> the product and engineering contract for the prompt architecture across
> Supabase, Expo, cover prompts, and tests.
>
> Last revised 2026-09-04.

## Product Goal

Katha should generate mobile-native fiction that feels written by a strong genre
writer, not by a generic assistant. The prompt system must optimize for:

- a complete story engine before surface prose
- reliable genre promise across 15 supported genres
- modular identity and spice layers
- safe adult-content handling with account-level gating
- A Kids mode that cannot inherit adult behavior
- standalone and series structures with different ending contracts
- structured output that can be parsed and filtered downstream

## Key v6 Decisions

- **15 primary genres (13 in the creation UI).** LGBTQ+ is no longer a primary
  genre. Queer context may be inferred from the visible brief; it is not a
  creation toggle. cozyFantasy and paranormalRomance exist in the DB constraint
  but are hidden from the UI.
- **Kids is an audience mode, not an adult genre peer.** Backend generation uses
  `adult | kids`; any future bedtime UX should map to kids-safe constraints
  unless a separate backend mode is introduced.
- **Spice is a genre-aware layer with two tiers.** Backend enum values are
  `sweet` and `steamy`. The clamp is downward only: a genre may lower a
  requested tier, never raise it.
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
- **No auto-aging workaround for underage sexual content.** If the user's request
  clearly asks for sexual content involving a minor, reject at validation. If age
  is merely ambiguous in an adult romance, make adulthood clear in the story.
- **Author touchstones stay in docs only.** Runtime prompts should use craft
  traits, not living author names or instructions that could imitate a style.
- **Prompt-only JSON is not enough.** Use API-level structured output/schema
  enforcement where supported, with strict validation fallback.
- **A Create story is planned, not mode-selected.** The user chooses 3, 7, or 15
  chapters in More options. New Create stories begin as Chapter 1 and persist
  state, hooks, and chapter roles toward the planned finale. `standalone` remains
  backend compatibility for legacy callers, not a creation control.
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
  | "poetry";

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

These are the 15 backend genres. 13 ship as creation cards in the app; `cozyFantasy` and `paranormalRomance` are valid DB values but are not rendered as creation cards (see Key v6 Decisions).

| UI card # | UI Genre | Internal genre | Notes |
|---|----------|----------------|-------|
| 1 | Romance | `romance` | Commercial relationship-forward stories |
| 2 | Romantasy | `romantasy` | Romance and fantasy arcs have equal weight |
| 3 | Dark Romance | `darkRomance` | Adult only, steamy default; intensity comes from power and consequence, never from crude prose |
| - | Cozy Fantasy | `cozyFantasy` | **Backend only, hidden from UI.** Low-stakes warmth, craft, community |
| - | Paranormal Romance | `paranormalRomance` | **Backend only, hidden from UI.** Supernatural romance |
| 4 | Fantasy | `fantasy` | Magic, world, cost, wonder |
| 5 | Sci-Fi | `scifi` | One speculative idea with human consequence |
| 6 | Thriller | `thriller` | Urgency, threat, ticking clock |
| 7 | Mystery | `mystery` | Fair-play puzzle |
| 8 | Horror | `horror` | Dread, wrongness, restraint |
| 9 | Contemporary | `contemporary` | Absorbs Drama and Slice of Life registers |
| 10 | Historical | `historical` | Period consciousness and constraints |
| 11 | Adventure | `adventure` | Motion, environment, physical stakes |
| 12 | Comedy | `comedy` | Observational or absurd, committed timing |
| 13 | Poetry | `poetry` | Prose poetry / lyrical narrative mode |

Separate UI controls:

- **Audience mode:** full-width segmented `For me | For kids`; Kids forces
  `spiceLevel: "sweet"`, filters unsuitable genres, and reveals Values.
- **Values:** Kids-only chips. They are written into the brief as themes to
  explore through character action, never as a moral lesson.
- **Spice selector:** adult-only, genre-specific availability. It is absent,
  rather than set safe, in Kids mode.
- **Language:** Create offers English and Portuguese only. Spanish remains a
  legacy read/continuation concern, not a creation selection.

## Genre and Spice Matrix

| Internal genre | Default spice | Allowed spice |
|----------------|---------------|---------------|
| romance | steamy | sweet, steamy |
| romantasy | steamy | sweet, steamy |
| darkRomance | steamy | sweet, steamy |
| cozyFantasy | sweet | sweet |
| paranormalRomance | steamy | sweet, steamy |
| fantasy | sweet | sweet, steamy |
| scifi | sweet | sweet, steamy |
| thriller | sweet | sweet, steamy |
| mystery | sweet | sweet, steamy |
| horror | sweet | sweet, steamy |
| contemporary | sweet | sweet, steamy |
| historical | sweet | sweet, steamy |
| adventure | sweet | sweet, steamy |
| comedy | sweet | sweet |
| poetry | sweet | sweet |

This table is `GENRE_DEFAULT_SPICE` and `GENRE_ALLOWED_SPICE` in
`_shared/types.ts`, and the two are pinned to each other by test. There is no
third column and no footnoted tier: every allowed value here is a live member of
`SpiceLevel`. `cozyFantasy` and `comedy` are sweet-only because their whole
register is low-stakes warmth and timing respectively, and an on-page heat scene
breaks both.

## Base Safety Rules

These rules override user seed, genre convention, spice level, and
language. They are assembled in layer 1 (`buildBaseRules`), never in the spice
layer, so that no heat tier, genre module, identity lens, audience mode or
language can be the combination that drops them.

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
- No detailed instructions for real-world harm, weapons, drug synthesis, evasion,
  self-harm, or exploitation, even when embedded in fiction.
- No harassment, defamation, or humiliating fiction about a real identifiable
  person.
- Kids mode cannot contain sexual content, adult romantic tension,
  graphic violence, substance use, or horror.

## Title Generation

The model generates the title as part of the structured output. Title rules:

- **2-6 words.** Evocative, not descriptive. The title is a promise, not a summary.
- Genre-appropriate tone: a romance title feels different from a thriller title.
- No generic AI titles: "The Journey Begins", "A New Dawn", "Shadows of the Past",
  "Whispers of Fate", "Beyond the Horizon".
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

| Selected length | Target words per chapter | Enforced by |
|-----------------|--------------------------|-------------|
| Short | 600 - 900 | Prompt + server validation |
| Standard | 1,200 - 1,600 | Prompt + server validation |
| Long | 2,000 - 2,600 | Prompt + server validation |

The selected band applies to every chapter regardless of audience mode. The
server owns the acceptance tolerance and refunds unusable output; the model's
reported `word_count` is never trusted as the count.

## Series Chapter Structure

Every story created through the current Create flow starts as Chapter 1 of a
3-, 7-, or 15-chapter planned series. The user does not choose a global writing
mode: they can steer an individual continuation with *What happens next?* or
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
  requested with `is_finale: true`):** Resolve the central conflict.
  Callback to a specific detail from Chapter 1. Land every major character arc.
  Loose threads are acceptable if the main story is complete.

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
plan beats, series state, characters, moments, exclusion, language, schema
reminder. Every free-text value is fenced as untrusted data (`<katha:...>`), and
the fence delimiter is stripped from the value so it cannot be closed early.

Two of those layers carry rules of their own.

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
the handler read the row's state, gave it to the *system* prompt, and left it
out of the brief — so `delivered_moments` was empty on every chapter of every
story, the "already delivered" heading never rendered, and the runway line
always claimed the entire brief was still owed.

`delivered_moments` is part of the emitted `series_state`, so the model reports
what it delivered. Every entry must be **copied verbatim** from the supplied
moments; the merge is append-only and drops anything the brief did not contain,
so a partial, malformed or inventive response can neither shrink the delivered
set nor write arbitrary text into stored state. Chapter 1 is verified the same
way, since it is where the set starts.

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
- Chosen family, community, dating context, family dynamics, and regional texture
  matter when relevant.
- Avoid stock archetypes: sassy best friend, tragic queer, wise older gay mentor,
  tortured artist.
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

### Thriller

Reader promise: urgency.

- Open with immediate pressure or threat.
- Establish a ticking clock early and return to it.
- Antagonist or force has real capability.
- Each scene worsens the problem.
- Avoid villain monologues, convenient skills, dream red herrings, and pauses
  that kill momentum.

### Mystery

Reader promise: a fair puzzle.

- Plant at least three real clues, one red herring, and one detail that only
  pays off on reread.
- The detective is wrong before being right.
- The reveal explains how and why.
- Avoid murderer-from-nowhere, long detective monologues, and withheld facts the
  reader could not know.

### Horror

Reader promise: dread that lasts.

- Ordinary things wrong are stronger than generic monsters.
- Suggestion over gore.
- The supernatural may have rules even if unstated.
- End on ambiguity, escalation, or revelation.
- Avoid jump-scare prose, gore inventories, and characters dismissing obvious
  danger for pages.

### Contemporary

Reader promise: recognizably real life with emotional precision.

- Absorbs Drama and Slice of Life registers.
- Stakes are relational, professional, family, social, or existential.
- Subtext carries weight.
- Ending is recognition or shift, not a lesson.
- Avoid brand-name clutter, think-piece narration, manufactured stakes, and tidy
  therapy monologues.

### Historical

Reader promise: time travel with period consciousness.

- Characters believe things people of their time, class, and place might believe.
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
- `language`: optional `English | Portuguese`; Create defaults to `English`. Do not accept Spanish
  from new Create submissions. Existing Spanish stories retain their stored
  language for reading and continuation compatibility.
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
- `chapter_length`: `short | standard | long`, selecting 600-900,
  1,200-1,600 or 2,000-2,600 words respectively
- `planned_chapter_count`: `3 | 7 | 15`; it drives continuation pacing and the
  automatic finale
- `illustrate_chapters`: optional boolean for chapter art after Chapter 1;
  Chapter 1 art remains compulsory and is the cover
- `visibility`: `private | public`, default `private`; publication handling uses
  it, but it is not a prose instruction

The creation UI is exactly three screens: **Idea -> Shape -> Review and start**.
The only required free-text value is the idea. Shape holds the full-width
audience segmented control, inferred/editable genre and world, a dedicated
full-screen Craft character editor, moments, and collapsed More options. Review
shows the assembled brief and the price before the first paid action. There is no
global `writing_mode` request field: steering is per continuation chapter.

Validation should reject:

- unsupported genre/language/spice/audience values
- adult spice in Kids or Bedtime
- Dark Romance in Kids mode
- clear requests for minor sexual content

Validation must **normalize, not reject**, a retired `explicit` spice value: a
stale client build or a replayed request body would otherwise fail a generation
the user is waiting on. It maps down to `steamy`, then clamps against the genre
row like any other value.

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
- analytics events in `expo/src/lib/analytics.ts` and
  `expo/src/lib/firebase-analytics.ts`
- cover image docs in `backend/COVER_IMAGES.md`
- strategic decision docs if taxonomy or adult gating changes

## Current Implementation Boundary

- `stories.primary_genre` is the routing genre. `stories.genre` retains the
  reviewed primary-first list for shelf tags and compatibility.
- `generate-story` accepts the primary genre plus up to two reviewed secondary
  genres, while every prompt module routes from the primary value.
- Expo exposes the 13 creation genres and models Kids as an audience mode.
- Strict provider schemas are the primary output contract. Plain-text parsing is
  retained only as a defensive compatibility fallback.
- `shape-story` is free scaffolding, authenticated and rate-limited. Its failure
  is silent in Create and never blocks manual completion of Shape.

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
