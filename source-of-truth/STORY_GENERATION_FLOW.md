# Story Generation Flow — source of truth

<!-- markdownlint-disable MD013 -->

> **This file is canonical.** Every field, label, placeholder, ordering rule,
> mode behavior and post-generation step in Katha's story creation flow is
> defined here and nowhere else. If another file disagrees with this one, this
> one is right and the other is stale.
>
> Referenced from `AGENTS.md`. Governs `expo/src/screens/CreateStudioScreen.tsx`
> and the prompt-layer assembly in
> `backend/supabase/functions/_shared/story-prompts.ts`.
>
> **Pricing is not defined here.** Every credit figure quoted below is read from
> [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md), which is canonical for
> cost. §10.6 identifies where this document requires that file to be amended;
> until it is, that file wins.
>
> **This document is a specification, not a description of every shipped detail.**
> The main Create flow is one setup screen plus the full-screen Craft character
> modal. Onboarding may use its own two-step preview, but main Create does not
> have a separate Shape or Review screen.
>
> Last revised 2026-09-11. Sentences that are inference rather than shipped
> behavior say so.

---

## Summary

**The user writes one sentence. Katha fills in the rest and asks them to correct
it.** That is the whole flow. Everything below is the consequence.

The competitive read: Okudu AI splits its input into Setting / Topic / Characters
and it converts — but not because the taxonomy is clean. It converts because
several short boxes feel like *assembling* something, and because the cost is
revealed only after the user has already invested. We keep the investment
mechanic and throw away the taxonomy.

The six decisions that shape this document:

1. **One required text field, not five.** Genre, optional Premise, characters and
   moments are structured controls around the idea. Correcting a value is
   dramatically cheaper than composing a form, and the corrected values reach
   the prompt identically.
2. **Inputs are plain questions.** "Plot", "topic", "setting"
   and "arc" never appear in the UI — they are craft jargon, and two of them
   collide with what Katha *produces*. **Premise** is now the optional secondary
   context field, not the required story idea. See §1.
3. **Characters are the deepest surface in the product, not a text field.** A
   full-screen *Craft character* sheet with Description / Background /
   Appearance, a generated portrait, and Reimagine. Modeled directly on Okudu's,
   because it is the best thing in their app. See §4.
4. **Kids mode is a mode, not a chip.** Adult by default, one tap, per-draft. It
   re-authors labels, filters the genre row, adds Values, and **removes** spice
   rather than defaulting it. Its on-screen label is **All-ages** (§3); "kids"
   survives only as the internal value.
5. **There is one visual system: chapter art.** Chapter 1's art is compulsory
   and *becomes the story's cover*; chapters 2–N are an optional per-chapter
   toggle. Cover and illustration are not two features — they are the same
   feature, and only chapter 1's is mandatory. See §10.4.
6. **A draft that cost a credit lives on the server.** Local autosave is fine
   before the first spend and never after it. See §11.

---

## 0. Governing principles

These are the constitution. Every field question is decided by them, and no
future field should be added without passing all seven.

1. **One required text field. Everything else is a chip, a toggle, a structured
   sheet, or inferred.** A second required free-text box on the main path is the
   most reliable way to lose a creator.
2. **A field earns its own slot only if it changes a different part of the output
   than every other field.** Idea → plot. Where-and-when → texture and cover art.
   Characters → voice and portraits. Moments → pacing. Four slots, four prompt
   layers, zero overlap.
3. **Label fields by what the user does, never by what a writer calls it.** "Your
   idea", not "Prompt". "Who's in it", not "Dramatis personae".
4. **One word, one meaning, across the whole app.** A word that names a user input
   may never also name a Katha output.
5. **Never show an empty field with no way in.** Every input has either
   suggestion chips, an inferred value, an instructive placeholder, or a worked
   example one tap away.
6. **Infer first, ask second.** If Katha can guess a field from what the user has
   already written, it guesses and lets them correct.
7. **Kids mode removes, it does not default.** Anything unsuitable for a child is
   absent from the interface, not present-and-set-to-safe. A parent who sees a
   spice control has already stopped trusting us.

---

## 1. The vocabulary

> **Binding on all UI copy and i18n keys.**

The problem it solves: the same words currently name both what the user types and
what Katha returns. That is why "setting versus topic" felt unresolvable — it was
never a taxonomy problem, it was a naming collision.

### Inputs — what the user provides

| Label | Answers | Control |
|---|---|---|
| **Your idea** | What happens | Free text, required, the only one |
| **Genre** | Shelf | Chips, inferred, editable |
| **Values** *(kids only)* | What the story teaches | Chips |
| **Premise** | Optional extra context, including world and era | Inline field, editable, never required |
| **Who's in it** | Characters | Full-screen sheets — §4 |
| **Moments to include** | Beats to hit | Chip builder, opt-in — §5 |
| **More options** | Craft controls | Collapsed section — §9 |

### Outputs — what Katha returns

| Label | Is |
|---|---|
| **Title** | The story's title |
| *(unlabeled paragraph)* | The shaped description. **Not** headed "Premise" |
| **Chapters** | The ordered beats. **Not** headed "Arc" |

### Banned from the interface

`Plot` · `Topic` · `Setting` · `Arc` · `Seed` · `Prompt`

All seven are craft jargon; three of them ship today (`seed`,
`Try a premise`, `ARC`). They may persist as internal identifiers — the `seed`
DB column is not worth a migration — but they must never reach a user's eyes.

### No hidden flavour taxonomy

The idea, genre, world, characters and moments are the complete creative brief.
Katha does not infer a second, hidden category of plot labels. A request for a
specific relationship dynamic, creature or mystery structure belongs in the
idea or a moment, where the creator can see and correct it.

---

## 2. The create flow

### Screen order

```text
Create  ──▶  1. Idea      ──▶  2. Where does it begin?
             (one box)        (direction chips derived
                               from the idea just typed)
```

The main Create surface is one scrollable screen. Genre and the All-ages switch sit in one
parent row at the top, then the user's idea, starter prompts, optional Premise,
Values for kids, and Characters. **More options** sits last, above the Create
button, and holds everything else, including all **six dropdowns** (below). The only second
surface in main Create is the full-screen Craft character modal opened by **Add
a character**.

**The Review step is retired** (2026-09-11), along with the separate **Shape**
step retired before it. Neither survives: the user does not stop to approve a
shaped brief, and they do not stop to confirm a summary of what they typed.

What replaced Review is not nothing, and that distinction is the whole reason
this section was rewritten rather than deleted. A confirmation screen asks the
user to re-read their own input and press a button; it spends a screen to
produce no new decision. The **direction step** spends the same screen to hand
them a real one — the same `DirectionChoices` cards the reader gets between
chapters, derived here from the idea they just typed, so the writer chooses how
chapter one opens instead of approving a restatement of the brief.

The directions come from `shape-story`, the free shaping call the brief already
makes: `beats[n]` briefs chapter `n + 1`, so `beats[0]` is the opening. They run
through the same `toDirection` converter the reader's chips use, and a beat that
cannot be converted is dropped rather than padded with filler. A chosen
direction travels as beat zero with the rest of the plan intact; **Surprise me**
sends the plan untouched.

**Why the earlier warning here no longer applies.** This section used to argue
at length that Review must not be confused with Shape, because an ambiguous
sentence had once been read as retiring review and cost a rebuild. That warning
is obsolete: review is now genuinely retired, deliberately, and replaced by a
step that makes a decision rather than confirming one. Cost is still shown — it
sits on the direction step's own submit label.

### The six dropdowns

All six live inside **More options** (2026-09-18, product-owner call). Inside
the panel the order is: Moments to include, then Writing style and Avoid, then
the four story dropdowns (Story mode, Chapters, Chapter length, Chapter cover),
then Image style and Who can read it, then Language. The menus list plain
labels; what each option means is in the "?" card on Story mode, Chapter
length, Chapter cover, Image style and Who can read it (DESIGN_SYSTEM.md §6A.1).

| Dropdown | Values | Default |
|---|---|---|
| Story mode | Interactive · Auto-continue | Interactive |
| Chapters | 1 · 3 · 7 · 15 | 3 |
| Chapter length | Short · Standard · Long | Standard |
| Chapter cover | Cover art only · Auto-generated per chapter | Cover art only |
| Image style | Auto · Anime · Cinematic · Comic · Watercolor | Auto |
| Who can read it | Private · Public | Public |

**Story mode** is `stories.story_flow` (migration 00076). `interactive` is the
existing behaviour: direction chips at every chapter end, nothing written until
one is picked. `auto` picks the direction itself and continues.

**`auto` BUYS ITS WHOLE RUN UP FRONT** (2026-09-14). When chapter one of an auto
series lands, the server works out how many of the remaining planned chapters
the balance can afford, reserves all of them in one transaction, writes that
many, and stops. The writer made one decision — "write this without asking me" —
so they are charged once for what that decision buys, rather than watching a
balance tick down over eleven minutes.

Two consequences are deliberate and must not be softened without a product
decision:

- **The balance drops in one step, and it can drop to nearly nothing.** The run
  is `min(chapters left in the plan, what the balance affords)` — and the run
  starts at chapter TWO, because chapter one is already paid for by the start
  credit. So a fifteen-chapter auto story takes fourteen credits when the
  writer has them; with six it buys chapters two through seven and stops at
  chapter seven, not at chapter six. Do not
  write copy that quotes the plan's length as a price — the number is not
  knowable from the brief, because it depends on the balance at the moment the
  run starts. State the shape of the charge instead: all of it, up front, for as
  many chapters as the credits reach. A writer who did not expect that has been
  misled by us, not by the feature.
- **A run that stops early refunds the remainder.** Failing at chapter four of
  six returns three — the chapter that failed and the two never attempted. The
  refund is idempotent on an operation key, because a double refund is a free
  story and a missed one charges for chapters that do not exist.

The run is necessarily **sequential**, not simultaneous: each chapter's prompt
carries the previous chapter, which is what holds voice and continuity, so
chapter four cannot begin before chapter three exists. "At once" describes the
decision and the charge, never the generation.

Extension is still a deliberate tap. Auto never extends past the plan — see
`reserve_generation_operation.p_extend_to_chapter`.

It is **sent on the create request AND persisted as a column**, and the column
is the part that matters: the pick is honoured at every chapter end, which is a
different session from the brief and often a different day, so a value that
lived only in the request that wrote chapter one would be forgotten by the
moment it means anything. The request field is how it gets there; the column is
how it survives. An unrecognised value clamps to
`interactive`: the mode that asks before it spends.

**Chapters** is `stories.planned_chapter_count`. The picker offers four
lengths; the COLUMN holds any whole number from 1 to 15 (migration 00079),
because a reader who extends a finished story raises it one chapter at a time.
Nothing may treat the stored value as one of the offered four.

**1 chapter is a series of one, not a standalone.** Picking it sets
`isSeries`/`story_mode = 'series'` exactly as the other three do, and that is
the whole reason it can be offered: a series that has reached its plan ends on
the ordinary direction chips and can be grown, while a standalone has no
chapter two at all and ends on Reimagine. See §10.2a.

**Image style** is `stories.image_style` (migration 00075). It **replaces** the
genre's own style clause rather than being appended to it — two style
instructions in one prompt produce neither — while palette, composition and mood
stay the genre's. It reaches the cover and every cast portrait, survives every
rung of the content-filter retry ladder, and is carried on regenerations.

**Who can read it** is disabled for guests, with the reason in the option copy
rather than in a separate error.

A lightweight two-step preview also belongs to onboarding, where the product needs
a short first-run path before the user reaches the full Create surface.

### Create screen

| | |
|---|---|
| **Parent row** | Selected Genre chip with icon + compact **All-ages** switch |
| **Header** | *What's your story about?* |
| **Sub** | *A sentence is enough. Katha takes it from there.* |
| **Input** | Multiline, 40-character minimum, `n / 1000` cap |
| **Below** | **Try one** — horizontal starter chips |
| **Core controls** | Premise optional, Values for kids, Who's in it |
| **More options** | Inline disclosure. Moments, chapter plan, chapters, chapter length, chapter art, writing style, spice, language, visibility, avoid |
| **Links** | **See an example** (§7) · **Continue a draft (n)** when drafts exist (§11) |
| **CTA** | *Create · n ✦*, enabled at ≥ 40 characters, enough credits, and no pending character image |

**There is a 40-character minimum, and it is not a counter.**
*(Restored 2026-09-05; this section previously removed the gate outright.)*

The original argument was that `getSeedHint()` nagged at `< 40` and again at
`< 80`, teaching users to pad a sentence rather than to add structure. That
argument is correct about a **counter** and wrong about a **floor**. They are
different things:

- A counter is present at every length, ranks the user against a number, and
  invites them to optimise it. That is what was removed, and it stays removed.
- A floor is invisible above 40 characters and only ever fires in the one case
  where the flow cannot work at all. Below roughly forty characters the shaping
  story call has too little useful context, so it returns a generic opening -
  and the user reads that generic opening as the ceiling of what Katha can do,
  not as the consequence of six words.

**It is presented as a state, never as a countdown.** A single leading-aligned
line under the field, in `colors.tertiary`:

> **Add a little more so Katha has something to build on.**

which becomes, at 40 characters, in `colors.success`:

> **Enough to write from.**

No number, no "24 more characters", and no error colour at any point. A short
idea is unfinished, not wrong. The brief-strength meter (§8) still does the
teaching lower on the same screen; this only stops the case that cannot succeed.

`MIN_IDEA_LENGTH` is exported from
`expo/src/components/create/CreateBriefFlow.tsx` and shared with onboarding, so
the two flows cannot drift.

The starter chip heading changes from **TRY A PREMISE** to **TRY ONE**.
`GENRE_PREMISE_CHIPS` is a good asset; only its label was wrong.

```text
┌────────────────────────────────────────────┐
│ [ 🔍 Mystery       ▾ ]         All-ages  ○ │
│   compact vertical picker                   │
├────────────────────────────────────────────┤
│  WHAT IS YOUR STORY ABOUT?                 │
│  [ Your idea text area                    ]│
│  TRY ONE  [starter chip] [starter chip]    │
├────────────────────────────────────────────┤
│  PREMISE                         optional  │
│  A hill town, off-season                ✎  │
├────────────────────────────────────────────┤
│  WHO'S IN IT                               │
│   ┌────┬─────────────────────────────┐     │
│   │ 🖼 │ Elena Márquez               │     │
│   │    │ Historical restorer, 34     │     │
│   └────┴─────────────────────────────┘     │
│   ┌────────────────────────────────────┐   │
│   │  +  Add a character          max 3 │   │
│   └────────────────────────────────────┘   │
├────────────────────────────────────────────┤
│  More options                           ▾  │
│    Moments, chapters, length, style, art   │
├────────────────────────────────────────────┤
│              Create · n ✦                  │
└────────────────────────────────────────────┘
```

**This single screen is setup, shaping, and review.** There is no separate
"Shape" screen and no separate read-only review screen in main Create. The user
types the idea, corrects fields, adds or edits characters, expands More options
if they care, then taps Create from the same surface.

**Premise is optional.** This is the resolution of the Setting/Topic question.
It absorbs extra context such as world, era, constraint, or mood without asking
the user to classify it. Internally it can continue to feed the same prompt and
cover-art context as `whereAndWhen`; externally it reads as optional support for
the required idea, not as another required form step.

**Genre is multi-select and inferred.** `primaryGenre` remains the first
selection for prompt routing and cover style; additional genres are secondary
tags.

**Add a character is a full-width action, never an inline text link.** It stays
visible below the cast cards in both its empty and populated states, with a
person-add icon and the remaining character limit. The character sheet is the
highest-investment surface in Create; the entry point must look like a primary
next step, not a hidden form affordance.

**The `🧒 Kids` / `🏳️‍🌈 LGBTQ+` / `🧛 Vampire` chip row is dissolved.** Three
different kinds of thing at one visual weight is a category error: Kids is a
*mode*, queer was an *identity lens*, vampire was a *content flavor*. Kids
becomes the mode toggle, vampire folds into silent inference (§1), and the
identity lens is retired (§9).

The **brief-strength meter** (§8) lives above the Create button on this same
screen. Balance stays in the header, and the button carries the price per
`CREDITS_AND_PRICING.md` decision 33.

---

## 3. Kids mode (labelled "All-ages")

**The label is "All-ages", on screen and in its accessibility name.** The
Create switch is English today (`CreateBriefFlow.tsx`), like the rest of Create,
because no Create component reads the locale files yet. The locale files already
carry the three strings (`All-ages` / `Todas las edades` / `Todas as idades`, key
`genres.kids`) for when i18n is wired. It was "Kids Mode" until 2026-09-25. Katha's Play listing targets 18+ only, and a control named "Kids"
invites a Families-policy review of the whole app; the mode describes a story
suitable for every age, not an audience of children holding the phone. The
rename is copy only: `audienceMode: "kids"`, `audience_mode = 'kids'`,
`content_rating = 'kids'` and every identifier keep their names, so no stored
story or client contract changes. There is no PIN gate and no "parental
controls" surface; the locale strings that advertised one were deleted.

A compact **All-ages** switch sits in the parent row beside Genre. It is a mode
selector, not a chip row. Adult mode is the default for every new draft and does
not need its own label on the surface. No device lock and no PIN at launch — the
mode describes the story being written, not the person holding the phone.
*(Inference: a family plan with child profiles would make a lock worth revisiting.
Not before.)*

| Surface | Adult default | All-ages |
|---|---|---|
| Extra chip slot | *(none)* | **Values** — kindness, honesty, courage, patience, sharing |
| Genre row | All 15 | Filtered: no dark romance, paranormal romance, horror, thriller |
| Spice | In More options, flag-gated | **Absent from the DOM** |
| Character *Description* placeholder | *e.g. a tired detective, an ancient dragon* | *e.g. 9-year-old boy, a talking dog* |
| Moments placeholder | *A rooftop confession in the rain* | *They build a treehouse* |
| Chapter length default | Standard | Short |
| Chapters default | 3 | 3 |
| Cover style | Genre-native | Warm, illustrative |

**Everything else is identical** — same screen, same order, same character
modal, same More options, same component tree. Kids mode is a copy-and-filter
layer over one flow. Anything requiring a fork in the component tree is a signal
the change is wrong.

**Why removal, not defaulting.** Principle 7. A parent who opens More options and
finds a spice selector set to "sweet" has learned that the adult product is one
tap from the story they are writing for their six-year-old. That is an App Store
review exposure and a trust loss in the same moment, avoided entirely by not
rendering the control. It is additionally enforced server-side in
`validation.ts`, which already forces sweet + safe content for
`audienceMode === "kids"`.

---

## 4. Characters — the Craft character sheet

Modeled directly on Okudu's *Craft character* screen, which is the strongest
thing in their product. Tapping **+ Add character** or an existing character card
opens a full screen, not an inline row.

### Layout

```text
┌────────────────────────────────────────────┐
│  ‹     Craft character                     │
├────────────────────────────────────────────┤
│  Name                                      │
│  ┌──────────────────────────────────────┐  │
│  │ Elena Márquez                        │  │
│  └──────────────────────────────────────┘  │
│  Description                               │
│  ┌──────────────────────────────────────┐  │
│  │ e.g. a tired detective, an ancient   │  │
│  │ dragon                               │  │
│  └──────────────────────────────────────┘  │
│  Background                                │
│  ┌──────────────────────────────────────┐  │
│  │ Personality, relationships,          │  │
│  │ backstory, traits. e.g. Restores old │  │
│  │ houses. Hasn't spoken to her mother  │  │
│  │ in six years. Believes wood          │  │
│  │ remembers what people forget.        │  │
│  └──────────────────────────────────────┘  │
│  Appearance                                │
│  ┌──────────────────────────────────────┐  │
│  │ Face, build, clothing, accessories.  │  │
│  │ e.g. Dark hair pinned up, paint on   │  │
│  │ her hands, her grandmother's coat.   │  │
│  └──────────────────────────────────────┘  │
│  Lead character                         ◉   │
│                                            │
│                                            │
│              [   Save   ]                  │
└────────────────────────────────────────────┘
```

### The five fields, and why each exists

| Field | Drives | Prompt destination |
|---|---|---|
| **Name** | Reference in prose and in moments | Story prompt, moments layer |
| **Description** | Who they are in one line — role, species, age | Story prompt, cover prompt |
| **Background** | Voice, motivation, relationships | Story prompt only |
| **Appearance** | The portrait, and physical detail in prose | **Character image prompt**, story prompt |
| **Lead character** | Whose want and point of view anchor the story | Story-engine and chapter-planning layer |

This is a clean split with no overlap: **Appearance exists to drive the image**,
Background exists to drive the voice, and **Lead character** makes the narrative
anchor explicit rather than asking the model to guess from display order.

Exactly one saved character is the lead. The first character is selected by
default. Choosing another lead immediately clears the previous selection; it is
not a second role or a portrait setting. The lead designation is free and does
not change the cast limit or portrait-generation rules.

### The instructive placeholder

Okudu's smartest move here, and it is replicated: **the placeholder carries the
teaching, and there are no separate helper labels.** *"Personality,
relationships, backstory, traits, etc. e.g. …"* is both the instruction and the
example, occupying zero extra vertical space. Every long placeholder in this
sheet follows that shape — a category list, then `e.g.`, then a concrete example
in the app's own voice.

Placeholders are re-authored per mode (§3) and per genre where it helps. The
**Lead character** control uses a labelled binary toggle, not a text field.

### Portrait, Regenerate, Edit, Delete

- **Create image generates the portrait from the current fields before the
  story call.** The Craft character sheet is a two-state flow: first the fields,
  then the portrait review. The user can save the character without an image,
  but if they tap Create image, that image request is its own backend call and
  the paid story generation call does not start from inside the sheet.
- **Regenerate** draws it again from the current field values, and it costs
  exactly what a first generation costs: an image drawn from changed fields is a
  fresh paid provider call, so it draws on the same allowance. The button reads
  **Create image** on an empty card and **Regenerate** once a picture exists
  *(2026-09-24; it read "Reimagine", which is the reader's word for rewriting a
  chapter)*.
- **A reference photo** may be attached to steer the look (never the likeness).
  Once attached, the photo's **file name** is shown under the portrait actions
  on one truncated line with its own Remove — "IMG_2231.jpg · Remove" — so the
  writer can see which photo is in play *(2026-09-24)*.
- **Three character images per account, for the life of the account, then 1
  credit each** *(2026-09-14 at six, migration 00088; three since 2026-09-24,
  migration 00096)* — for every user, free tier and paid plan alike. `CREDITS_AND_PRICING.md` §3 (*Character images*) is canonical.
  **The sheet must quote the price before the button is pressed** and must not
  offer a priced image the balance cannot buy; the count comes from the server
  (`bootstrap-user`, and every image response), never from the client counting
  its own taps.
- **Edit** re-opens the fields. **Delete** removes the character and its portrait.
- Aspect ratio is portrait, full-body, on a plain ground — matching the reference
  and matching what the reader UI needs for a character strip.
- **Story generation waits for the character-image step the user started.** A
  user who never asks for a character image may still create the story; a user
  who taps Create image sees that call finish or fail before the final story
  call begins.

### Limits

Maximum **3** characters — *amended 2026-09-02, was 4; see §14 item 1.* A story
start's cast is **bundled into the 1-credit start**, not priced per character,
and it does **not** draw on the three free standalone character images above —
that allowance is for the Craft sheet and the saved-character library. Images
render at 1024×1024.

---

## 5. Moments to include

**Placed directly below Characters, above More options.** Not inside More
options. The reason is a dependency: a moment routinely names characters —
*"Elena finds the letters"* — so the cast must already exist on screen above it.

### Form

A **chip builder**, never a paragraph box. Type, press return, it becomes a chip.

1. **Each chip is one prompt slot the model can schedule as a beat.** A paragraph
   is one blob it must parse and will partially ignore.
2. **Chips are countable.** "3 moments added" reads as investment.
3. **Add-one-at-a-time has near-zero perceived cost per unit**, so users
   overshoot. A paragraph box reads as homework and gets skipped.

### Character tokens

Once characters exist, their names render as insertable tokens above the input.
Tapping **Elena** inserts the name. This hands the prompt explicit character
references instead of pronouns for the model to resolve — the UI affordance and
the generation quality improve from the same change.

### The cap

**Five, hard**, shown as `2 / 5`. Past roughly five, moments compete for space in
a chapter, the model produces a checklist instead of a story, and the user
attributes the failure to generation quality rather than to their own input.

*For a 15-chapter story the cap rises to 10, since there is room to schedule
them. (Inference — validate against output quality before shipping.)*

### Zero state

Header and genre-matched suggestion chips are **always visible**; the text input
appears on tapping a chip or **+ Add a moment**. A checkbox that reveals an empty
box asks for work before showing what the work is.

---

## 6. Infer, don't ask

Inference is optional scaffolding, not a navigation step. Main Create must not
depend on a **Continue** button or a pre-story backend call. If we add inference
inside Create later, it must be silent, cancellable, and must only prefill
editable fields on the same screen; the paid story request remains the single
story-generation call.

The optional inference shape is:

```json
{
  "genres":       ["mystery", "horror"],
  "whereAndWhen": "A hill town, off-season, present day",
  "characters": [
    { "name": "Elena Márquez",
      "description": "Historical restorer, 34",
      "background":  "Hasn't spoken to her mother in six years.",
      "appearance":  "Dark hair pinned up, paint on her hands." }
  ],
  "suggestedMoments": [
    "She hears her own name through the wall",
    "The door is warm to the touch"
  ]
}
```

- Every value lands as an **editable chip or a pre-filled character sheet**, never
  as committed state.
- The call is **free to the user.** It is scaffolding for the ask, not the ask —
  per `CREDITS_AND_PRICING.md` principle 2, a credit buys an AI action the user
  requested.
- **Failure is silent.** On timeout or malformed output, the same Create screen
  remains usable with empty chips and suggestion sets. The user is never shown
  an error for a convenience they did not request.

**Why this beats a form.** The information reaching the prompt is identical. What
changes is the user's job: correcting guesses instead of composing answers.
Correction is faster, has no blank-page cost, and teaches the taxonomy by
demonstration — a user who sees *"A hill town, off-season"* in optional Premise
has learned what that field can carry, permanently, without reading a paragraph.

Pre-filling the character sheet is the highest-leverage instance of this. A user
faced with four empty boxes labeled Description / Background / Appearance will
mostly write one line and leave. A user faced with four boxes Katha already
filled will fix the two that are wrong — and the resulting character is far
richer than the one they would have written from empty.

**Story world is a standing preference, not a Create field (2026-09-25).** The
reader sets it once on You (*Story world*: Anywhere or one of ten regions) and
every new story's request -- and the shaping call that pre-fills *Where and
when* and the cast -- carries it as `cultural_setting`, omitted for
Anywhere. Create does not ask it and shows no chip for it: it is the default
for what the brief leaves open, and the brief -- idea, *Where and when*, the
cast's names -- always overrides it. Contract and prompt wording:
`STORY_PROMPT_SYSTEM.md` *Story world*.

---

## 7. See an example

A text link below the idea box on the Create screen. **It shows every slot filled
at once, genre-matched.** Showing one
field's example in isolation does not help, because the confusion is
*relational* — users do not misunderstand what a setting is, they misunderstand
which of their sentences goes where.

```text
Your idea         Elena inherits her grandmother's house
                  and finds a door that wasn't on the deed.

Genre             Mystery · Gothic
Premise           A hill town, off-season, present day
Who's in it       Elena Márquez — historical restorer, 34
Moments           She hears her own name through the wall
                  The door is warm to the touch

                      [ Use this ]
```

**Use this** fills the form; the user edits from there. Shortest path from empty
to a first generation that is actually good — which is the retention moment, not
the create moment. One static example per genre. Never generated.

---

## 8. The brief-strength meter

Replaces `getSeedHint()`. Lives on the Create screen. Keyed to **slots filled**, not
character count.

| Filled | Reads |
|---|---|
| Idea only | **Sparse** — *Katha will invent most of this. That can be good.* |
| + genre | **Good** — *Enough to write from.* |
| + premise, characters | **Strong** — *This will sound like yours.* |
| + moments | **Rich** — *Katha has plenty to work with.* |

Two properties the character counter lacked: it teaches structure rather than
padding, and **Sparse is framed as a legitimate choice**, not a failure. A user
who wants to type one sentence and hit Create must never be scolded for it.

It is also the instrumentation point that matters: brief strength → generation
rating is the loop that tells us which fields actually earn their slot.

---

## 9. More options

Collapsed by default. Identical in both modes except where §3 says otherwise.

| Control | Values | Default |
|---|---|---|
| ~~Writing mode~~ | *Removed — see §15* | — |
| ~~Chapters~~ | *Promoted out of More options — see §2* | — |
| ~~Chapter length~~ | *Promoted out of More options — see §2* | — |
| ~~Chapter cover~~ | *Promoted out of More options — see §2* | — |
| ~~Visibility~~ | *Promoted out of More options — see §2* | — |
| Writing style | Free text — *poetic, Shakespearean, hardboiled* | empty |
| Spice | Sweet · Steamy · Explicit — **adult only**, flag-gated | Sweet |
| Moments to include | Chip builder, capped at 5 | empty |
| Language | English | English |
| Avoid | Free text — *exclude a topic* | empty |

**The six dropdowns are back inside More options** (2026-09-18). They left it on
2026-09-11 and returned on the product owner's call; the live list, with values,
defaults and the order inside the panel, is in §2 and is the one to read.
**Moments** now opens the panel. Its cast tags come from the story's characters,
so a saved character added to the story, or a new one, shows up as a tag as
soon as it has a name. **Language** stays last.

**Who can read it defaults to Public** (2026-09-18). Everyone who reaches Create
has signed in with email during onboarding. **The entity gate is gone**
(2026-09-19, PR #107): naming a real person no longer forces a story private.
Migration 00091 drops both of the 00050 constraints, `entity-visibility-gate.ts`
and the two warning modals are deleted, and `applyRequestedVisibility` refuses
exactly one thing -- a guest.

Guests see Public as locked and stay Private, and a guest's request now SAYS
private rather than saying public and being overruled (PR #109). Public
publishing unlocks only after a real account is linked; the backend enforces
the same rule independently of the client, and a visibility write that fails
leaves the story private with `reason: "publish_failed"` rather than costing
the writer their chapter.

**The cover image toggle is removed.** Chapter 1's art is compulsory and becomes
the cover — see §10.4. The toggle here governs chapters 2–N only.

**Language is a compact menu-style control, not a chip row.** Create offers
**English only** (2026-09-11). Portuguese was withdrawn from the offer along
with Spanish before it, and for the same reason: neither had a narration voice,
neither had been quality-checked for prose, and offering a language the product
cannot actually deliver well is worse than offering one.

`CreationLanguage` still ADMITS Portuguese and `normalizeCreationLanguage`
still resolves it, and that is deliberate rather than leftover: stories written
in Portuguese exist, and they must stay readable and continuable in the language
they were written in. The withdrawal is from the OFFER, not from the type — a
distinction that also governs Spanish, which was withdrawn the same way earlier.
Neither may be reintroduced to the creation UI as a side effect of touching the
stored-value path.

### Writing mode — removed

> **Superseded 2026-09-02 (§15).** There is no mode to choose. Every chapter ends
> in a **Continue** with its price on it; a *What happens next?* box above it is
> optional, and leaving it blank means Katha decides. From chapter 3 a **Write
> the rest** action runs the same loop under program control, with an itemised
> confirm, a Stop that keeps what it wrote, and resume after a kill.
>
> The table below is retained because it still describes the two *behaviours*
> the single flow offers, **chosen per chapter rather than once for the story**.
> There is no `writingMode` field, nothing to switch mid-story, and no escape
> hatch to provide — the choice is simply whether this chapter's *What happens
> next?* box has anything in it.

| | Steering a chapter | Letting Katha decide |
|---|---|---|
| Per chapter | User types what happens next, then Katha writes it | Katha writes straight through |
| Best for | Writers who want to steer | Readers who want a finished story |
| Between chapters | A short *What happens next?* box with suggested continuations, plus **Let Katha decide** | — |

**Nothing is committed to and nothing needs switching.** Committing to type a
prompt thirty times is a promise most users would break at chapter four — which
is why the choice is per chapter rather than per story. A user steers chapter 2,
leaves the box empty for chapters 3 and 4, and steers again at 5, without ever
changing a setting. That is what removes the need for a mode, a switch, and an
escape hatch alike.

### Chapter length

| | Words per chapter *(target)* | Per chapter | 3 chapters ≈ |
|---|---|---|---|
| **Short** | 600 – 900 | **3 min** | 9 min |
| **Standard** | 1,200 – 1,600 | **5 min** | 15 min |
| **Long** | 2,000 – 2,600 | **9 min** | 27 min |

**The options ship labelled with minutes, and never with words.**
*(Revised 2026-09-05; they previously shipped unlabelled.)*

Minutes are derived from the word bands at **260 words per minute**, the
measured mean silent reading rate for adult English fiction across 190 studies
and 18,573 participants ([Brysbaert 2019](https://biblio.ugent.be/publication/8647789)).
Non-fiction is slower at 238 wpm because its words are longer. Most adults
reading fiction fall between 200 and 320 wpm, which is why every figure in the
interface is hedged with *about*, and why the total is stated as a range the
user can feel rather than a promise: **About 15 minutes to read, across 3
chapters.**

Two things follow from §14 item 2, which is still open:

1. **The word bands are now shown, hedged, against the reasoning below.**
   Reversed on the product owner's instruction after testing the running app:
   chapter length reads as an abstraction without a size beside it. The original
   objection stands and is not dismissed, so the numbers are prefixed with a
   tilde and paired with the minute estimate rather than printed as a bare
   figure.

   **The risk this accepts, stated plainly:** `AGENTS.md` records a measured
   overshoot of 2,056 to 2,331 words against a 1,200-1,600 band. So the Standard
   option currently advertises a size the generator does not hit. The hedge
   makes it a target rather than a promise; it does not make it accurate. When
   B11 measures the bands, these figures are corrected -- and if the overshoot
   holds, the honest fix is to move the bands to what the model actually writes
   rather than to keep advertising what it does not.
2. **Minutes are safe to show now, and words are not**, because the minute
   figure is an estimate of the *reader's* experience carrying a hedge, while a
   word target printed beside a control reads as a contract the generator has
   never been checked against. When B11 measures the bands, this table is
   corrected and the minutes are recomputed from it at the same rate.

"Standard" alone means nothing to a first-time user, and length is the choice
that most changes what they receive. That was always the argument for labelling;
reading time is the label that carries it without making a promise about output
we cannot yet keep.

### Point of view — removed

A POV selector was proposed and is cut. It duplicates the *Writing style* box
(*"first person, present tense"* is exactly what that field is for), and it is a
craft control on a screen whose job is to stay out of the way.

### Identity lens — retired

**Argued and cut, though this is the closest call in the document.**

*Keep:* queer romance is a large, underserved, high-intent audience; the lens
materially changes output; it already exists in `types.ts` and migration 00008;
and a visible control signals recognition, which is a genuine positioning asset
for a romance-heavy app.

*Cut, and why it wins:* it holds exactly **one** value, so it is a one-off toggle
dressed as a system. The idea sentence already carries it more naturally and more
specifically — *"two women fall in love at a wedding they are both catering"*
tells the model far more than a checkbox does, and inference sets
`identityLenses` from it for free. And a toggle that asks the user to classify
*themselves* rather than describe their story is a taxonomy where a sentence
would do.

**The capability stays** — `identityLenses` remains in the request type and the
prompt layer, populated by inference. Only the control is removed. If it ever
grows past one value, revisit this.

---

## 10. After Create — generation, editing, cover, publish

The flow does not end at the Create button. This section defines everything from
that tap to a published story.

### 10.1 The shape

```text
Create ·  n ✦
   │
   ├── any requested character portraits complete first
   │
   ├── chapter 1 text (1 ✦)  +  chapter 1 art (1 ✦) ── becomes the cover
   │
   │
   ├── THE LOOP, per chapter, to the planned length ──┐
   │     read the chapter                    (free)   │
   │     "What happens next?"  — optional    (free)   │
   │     Continue          1 ✦, or 2 illustrated      │
   │                                                  │
   │     from ch 3: "Write the rest"  — the same      │
   │     loop under program control, itemised         │
   │     confirm, Stop keeps what it wrote            │
   │                                                  ▼
   └────────────────────────────────▶  THE STORY  ◀───┘
                                          │
                              read · edit by hand · reimagine
                              regenerate or upload the cover
                                          │
                                       Publish
                                          │
                                        Live
```

### 10.2 Generation

> **Revised 2026-09-02 (§15).** This section previously described Auto-Write and
> Interactive as two flows the user chooses between. There is one flow.

- **Character images first when requested.** The main Create button never fires
  the paid story call while a Craft character image request is still running.
  Character images are their own backend call, prompted from Appearance first
  and Description second. The resulting portrait URL rides along with the draft
  and is attached to the character when the story is persisted.
- **One chapter at a time.** Each chapter ends in the story view with a
  **Continue** button carrying its own price. Above it sits an optional *What
  happens next?* box with suggested continuations inferred from what just
  happened; leaving it blank means Katha decides. **No credit is charged for the
  suggestions.**
- **Write the rest** appears from chapter 3 onward and runs the same loop under
  program control: an itemised confirm stating text and art separately, a **Stop**
  that keeps every chapter already written, and a resume prompt if the app is
  killed mid-run. It is not a second mode — each chapter is still its own
  request, its own reservation and its own credit.

  > **Implemented 2026-09-07.** It is a client-side loop over the existing
  > `continue-story`, with **no new endpoint** — the sentence above requires each
  > chapter to be its own request, and a server-side runner would have had to
  > break that to exist. `CreateStudioScreen` therefore calls one `continueOnce`
  > function that the single Continue button also calls, so the chapter-count
  > guard, the credit guard, the per-chapter request id, the finale flag, the
  > refund path and the partial-stream rule are inherited rather than
  > reimplemented. Five details this section left open, settled here because the
  > answers are user-visible:
  >
  > 1. **The run does not use "What happens next?", and does not consume it.**
  >    That box is per-chapter steering. Reusing one typed direction for six
  >    chapters would steer chapters the reader never aimed it at — the exact
  >    defect the box's own clear-on-success rule exists to prevent — and
  >    spending it on only the run's first chapter would make one chapter of a
  >    program-driven run behave differently from the rest with nothing on
  >    screen to say which. So a run ignores it, leaves the text where it is for
  >    the next single Continue, and says both things in the confirm sheet and
  >    beside the button.
  > 2. **Stop lets the chapter in flight finish, and keeps it.** Aborting it
  >    would abandon a reservation the server is already writing against, which
  >    is a reader paying for prose nobody ever sees. So Stop halts the run
  >    *after* the current chapter has persisted and charged; the control says
  >    so. The worst case is one more chapter than expected, never half of one.
  > 3. **A failure ends the run and is not retried.** The single-chapter path
  >    already refunds a failed chapter; a retry inside the loop would turn one
  >    failure into two charges. Everything written before it stays written.
  > 4. **A short balance is quoted, not sprung.** The confirm itemises chapters,
  >    text credits and art credits before anything is spent. If the balance
  >    cannot cover the whole run, the sheet says so and the button offers
  >    exactly the number of chapters the balance reaches — which is what
  >    `CREDITS_AND_PRICING.md`'s "you pay as each chapter is written" already
  >    implies, made explicit rather than discovered halfway through.
  > 5. **Resume is NOT implemented. This is the one part of the sentence above
  >    that is still outstanding.** A first attempt persisted the run's intent to
  >    AsyncStorage and offered it again on the way back into the studio. It was
  >    removed on 2026-09-07 because it could never fire: the studio's `story` is
  >    only ever set by a generation inside the current mount, there is no way to
  >    **open an existing story**, and leaving the Create tab unmounts the screen
  >    — so the writer always comes back at the brief with `story === null` and
  >    every condition the offer was gated on false forever. Shipping a code path
  >    that cannot run, and a document claiming it works, is worse than recording
  >    the gap. Resuming a run therefore needs a fetch-by-id and the navigation to
  >    reach it, which is not generation and is not owned here; until that exists,
  >    an interrupted run is simply not offered again.
  >
  >    What the unmount *does* do is request the same Stop the button does, so a
  >    tab switch stops buying chapters after the one in flight. And what survives
  >    regardless is the part that costs money: every chapter the run wrote is on
  >    the server, paid for, and nothing further is charged without another
  >    confirm.
  > 6. **The confirm quotes text only, because nothing charges for chapter art.**
  >    The bullet below prices "1 for its art where the toggle is on", and no code
  >    implements it: `chapter_art` exists only as an enum value on
  >    `generation_operations.kind`, nothing reserves it,
  >    `reserve_generation_operation` deducts exactly one credit for every kind,
  >    and `continue-story` never reads `illustrate_chapters`. An itemised art
  >    line would therefore have quoted money that is never taken — and worse,
  >    would have *refused work the balance covers*, since the affordable-chapter
  >    count divides the balance by the per-chapter price. So the sheet itemises
  >    one line, at 1 credit per chapter, matching what is charged. **No price has
  >    changed** — `CREDITS_AND_PRICING.md` remains canonical and still lists
  >    chapter art at 1 each; the art line and its price return to this sheet when
  >    per-chapter art is actually built.
- **Each chapter's text is 1 credit**, charged as it is generated, plus 1 for its
  art where the toggle is on. A story abandoned at chapter 2 of 7 costs what it
  wrote, not what it planned.

  > **Per-chapter art is unimplemented as of 2026-09-07.** Nothing reserves or
  > charges for it, so a run with the toggle on costs exactly what a run with it
  > off costs, and the client quotes accordingly. See note 6 above. The price
  > stated here is the intended one and is not being changed.
- **What generates it, as of 2026-09-05.** Every generation path — this loop,
  continuation, and reimagine — onboarding stopped making a shaping call on
  2026-09-11 — leads with OpenRouter `meta/muse-spark-1.3-contributor`, falls back to
  `meta/muse-spark-1.3`, then Gemini 3.1 Pro Preview, then the three OpenAI
  models, then the free tier. The contributor tier is the configured default and
  is **17x cheaper**. As of 2026-09-05 it **serves**: the account's OpenRouter
  privacy setting has been changed, and live calls succeed. That makes the data
  decision live rather than pending, and it belongs to the product owner: the
  tier is cheap because users' story ideas and generated prose are retained by
  the provider for training. Cost basis and both figures:
  [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §2.
- **Chapter text streams.** `generate-story-stream` delivers prose as it is
  written, so the reader sees the first sentence at ~5.6s instead of waiting
  ~49s for the whole chapter. Nothing else about the contract changes: the same
  credit is reserved before the first byte, the same row is persisted from the
  server's own buffer, and the same payload is returned at the end. The reader
  is never shown text that was not saved, and never charged for a chapter that
  was not delivered. `generate-story` remains for retries, replays and any
  client that cannot stream.

  Two consequences worth stating in this document rather than only in code.
  **A failure after the first token cannot fall back to another provider**, so
  the reader keeps the partial chapter on screen and the credit is refunded --
  erasing text somebody has already read is the worse outcome. And **the word
  band is now a prompt instruction that is reported on, not enforced**: it could
  only be enforced by truncating mid-sentence, which produces a chapter with no
  ending. See the open item in §10.6.
- **Failed paid actions auto-refund**, per `CREDITS_AND_PRICING.md` principle 4.
  A failed cast or cover refunds its own credit even when chapter text succeeded;
  each component refund is durable and idempotent.

### 10.2a Extending a finished story

*(Added 2026-09-11.)*

A series that has reached `planned_chapter_count` used to end on **"The story
is complete"**. It now ends on the ordinary direction chips — the same surface
every other chapter end shows — when all three of these hold:

1. It is a **series** (a standalone has no chapter two; it ends on Reimagine).
2. Its plan is **below 15**, the ceiling the column's check constraint
   enforces. At 15 the story is complete for good.
3. The viewer is its **author**. Someone else's finished story still says it is
   complete; extending spends the viewer's credits.

Picking a chip sends `extend: true` on the continuation request. `continue-story`
refuses an over-plan chapter without that flag — the refusal is the protection —
and with it raises `planned_chapter_count` to the new chapter number **inside
`reserve_generation_operation`**, in the same transaction and behind the same
advisory lock as the credit debit. The plan and the charge commit together or
not at all.

**It costs the ordinary chapter price**: 1 credit, or 2 if the story
illustrates its chapters. Not discounted for being unplanned and not
surcharged for it.

**An extension is not a finale**, even though it is the last planned chapter by
construction. A chapter written as a finale closes its threads, and the chips
offered at the next chapter end are derived from exactly those — so a story
extendable once would be extendable never again.

**AUTO-CONTINUE NEVER EXTENDS.** `story_flow = 'auto'` writes ahead with nobody
watching; a story that could extend itself would spend a reader's whole balance
on chapters past the plan they actually chose. An auto story stops at its plan
and is extended by hand, one deliberate tap at a time, like any other.

### 10.3 Editing

> **Corrected 2026-09-11.** This section used to price *20 free paragraph edits*
> and *3 free AI redrafts* per chapter. **Neither action exists.** There is no
> "rewrite this paragraph" control and no "redraft this chapter" control anywhere
> in the shipped product, and pricing a feature that was never built is worse than
> leaving it unpriced: `CREDITS_AND_PRICING.md` §10 had scheduled counter columns
> to enforce those caps and §11 had a p95 metric to tune one of them. Both are
> cancelled there (§1a of that file).

> **Revised 2026-09-20. The rewrite control is now TWO actions, and which one
> a viewer gets depends on whether they wrote the story.** Character
> replacement is gone from both. It was a find-and-replace across the prose
> (`_shared/character-substitution.ts`), which by its own documentation can
> never touch a pronoun, and cannot touch anything a chapter states about who
> somebody is -- so the one thing it could not do was replace a character. A
> story "reimagined" with new people also kept the old people's cover and
> chapter art, because a fork copies both.

**The author's control is Re-prompt.**
[`expo/src/components/reader/RepromptSheet.tsx`](../expo/src/components/reader/RepromptSheet.tsx)
over the `reimagine-chapter` edge function: one box, what should change, and
the chapter is written again in place. No roster, because offering the person
who invented the cast a find-and-replace over their own characters was never
the thing they wanted; a writer who wants somebody else in the story says so in
the prompt and gets prose actually written for them.

**A reader's control is Reimagine, and it does not touch the story they are
reading at all.** It opens Create with that story's premise already in the box
-- verbatim, off `stories.topic` (which the client carries as `Story.synopsis`;
`mapStoryRow`, `mapSearchRow` and `mapGeneratedStory` all map the one onto the
other), so they can read exactly what produced the story they liked and edit any
word of it -- and they write their own, with
their own characters, through the ordinary create flow
([`expo/src/lib/reimagine-seed.ts`](../expo/src/lib/reimagine-seed.ts)).
**Nothing is forked, and the original is never written to.**

What travels into that brief is the story's shape: premise, genre, audience
mode, spice, language, and standalone-versus-series with its chapter count. What
deliberately does not: the original's cast (the reader brings their own), its
`beats` and `grounding` (they belong to a premise that is about to be edited),
and its visibility (a reader does not inherit a stranger's choice to be public).

| | Cost |
|---|---|
| Type, rewrite, restructure by hand | **0, unlimited, forever** |
| **Re-prompt a chapter** (author) | Free tier: 1 free per chapter, then the plan. **Any paid plan: unlimited** |
| **Reimagine** (reader) | **It is a story start, priced as one.** Nothing new: the reader generates a story they own |

Hand editing is the existing Create Studio draft editor and the reader's chapter
editor, and both stay exactly as they are. They call nothing, so under principle
2 they are free and there is nothing to cap.

The prices above are read from
[`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §3, *Reimagining a chapter*,
which is canonical for them. **⚠ The shipped `reimagine-chapter` charges 1 credit
from the first call for every user on every tier** — it has no subscriber check
and no counter. The subscriber exemption and the free counter are follow-ups.
**⚠ The sheet still quotes "1 free" on every open**, because the per-chapter
count is never passed to it; the quote is optimistic and the server is the thing
that charges.

### 10.4 Chapter art, and the cover

**Cover and illustration are one feature, not two.** Every chapter can have a
piece of art. Chapter 1's is compulsory, and *that image is the story's cover*.
Chapters 2–N are optional, one credit each, toggled in More options.

| Chapter | Art | Cost |
|---|---|---|
| **1** | Compulsory. Becomes the cover | **1 ✦** |
| **2–N** | Optional, per chapter | 1 ✦ each |

This is the framing that makes the whole visual model legible, and it is a
correction to an earlier draft of this document which treated the cover and
chapter illustrations as separate systems and consequently double-counted
chapter 1. A story is not a thing with a cover *plus* pictures. It is a sequence
of chapters, each of which may be illustrated, and the first illustration is the
one you see on the shelf.

It also settles the ordering problem. The cover is not awkwardly last — chapter
1's art is generated when chapter 1 exists, which is the second thing that
happens.

**Before that, the story has a concept cover:** a typographic card — the title
set on a genre-tinted ground, marked `CONCEPT`. It costs nothing, renders
instantly, and it is the same treatment already used in onboarding. A draft has a
face from the first second.

After chapter 1's art is generated the user gets:

| Action | Cost |
|---|---|
| Regenerate | 1 free retry, then 1 ✦ |
| Upload your own | **Free** |
| Keep the concept card | Free — a legitimate published look |

Uploading is free and must be prominent. It costs us nothing, it is the escape
hatch when generations miss, and for a writer with existing art it is the reason
they can bring a real book here.

> **Implemented 2026-09-07, with three details this section did not settle.**
> Regenerate and the concept card ship; **upload does not yet** — it needs a
> storage and signed-URL surface that is tracked separately, and until it lands
> the *Upload your own* row above describes an intent rather than a control.
>
> 1. **"1 free retry" is counted on delivery, not on attempt.** A regeneration
>    that exhausted every image provider costs nothing *and* does not spend the
>    free retry, because the writer has not been given a cover. `stories.cover_regen_count`
>    is incremented only by the statement that records the new image.
> 2. **A failed regeneration restores the cover it was replacing.** The row goes
>    back to the status it held, not to `failed`. `failed` is the honest answer
>    for a *first* cover, where the concept card is the fallback; here it would
>    report a cover the reader can see as missing.
> 3. **Regeneration is bounded by attempts, not by deliveries.** Point 1 is the
>    right pricing rule and, on its own, an unmetered image budget: the caller
>    supplies `prompt_note`, so "make it fail" is a request anyone can send, and
>    each failure leaves the next attempt free. `stories.cover_attempt_count`
>    counts every regeneration *started* and the claim is refused past **12 per
>    story** with a 429 — separate from `cover_regen_count`, which still counts
>    deliveries and still decides the price. Twelve is roughly an order of
>    magnitude above plausible use (§13 treats a regeneration rate over 40% as a
>    prompt problem rather than demand), and past it a caller must buy another
>    story at 3 ✦ to get another twelve. The attempt is counted by the claim,
>    before any provider call, so an evicted isolate or a hung caller stays
>    counted — and `release_cover_claim` gives it back on the paths that
>    provably reached no provider (no credits, a reservation already held, a
>    spent request id, a reservation RPC that threw). Those cost nothing to
>    refuse, and charging them against a ceiling that never resets would leave a
>    writer with an empty balance permanently 429'd on a story they later bought
>    credits for.
> 4. **There is no cover step in Create.** This section's model made one
>    unnecessary: chapter 1's art is revealed in the editor as it lands and
>    confirmed at review. The step that existed showed a gradient card it called
>    a preview, said the cover would be made at publish, and carried a disabled
>    Regenerate button beside a prompt box that was never sent — every claim on
>    it contradicted this section.

### 10.5 Publish

The publish sheet confirms title, cover, and visibility. Publishing is the only
step that changes visibility; Private stories can be published later from
Library.

**Private is the default, everywhere, including on the wire.** A story is
written for its author first; going public is a later, deliberate act. So:

- `stories.is_public` defaults to false in the schema (00001).
- `publish-story` reads an **absent** `visibility` field as `private`. It used
  to read it as `public`, which made the public feed the destination of any
  caller that merely forgot the field — an older client build, a retry
  reconstructed from a story id, a future integration. Publishing has to be
  something a caller *said*, not something that happens when it says nothing.
- A `private` publish is a save: hand edits are persisted, the story stays out
  of every feed, and the chapters stay unpublished. Nothing about it is
  discarded, so choosing it later costs the writer nothing.
- **There is no second route to public.** Only `publish-story`, running as the
  service role, may set `is_public`. Migration 00034 revoked `insert, update`
  on `public.stories` from `authenticated` and dropped the matching RLS
  policies, so a client cannot publish over PostgREST and skip the account gate
  in §9, the `complete`-status gate, or the chapter publication that must
  happen in the same operation. The invariant is pinned by the
  "clients cannot bypass the service-owned story publication path" test in
  `00034_story_shape_and_genres_test.ts` — any later migration that re-grants
  `INSERT` or `UPDATE` on this table fails that test, which is exactly what it
  is for.

### 10.6 What this requires of CREDITS_AND_PRICING.md

> **Amended 2026-09-11: the editing asks are withdrawn.** Everything this section
> and §10.3 ever asked that file to price for *editing* rested on two actions
> that were never built — the paragraph rewrite and the chapter redraft. They are
> retired in both documents (§10.3 here, §1a there), along with the counter
> columns and the p95 metric that existed to enforce them. **Reimagine is the one
> AI edit**, and it is priced in `CREDITS_AND_PRICING.md` §3, not here: unlimited
> and never charged on any paid plan, 1 free per chapter of your own story on the
> free tier, 1 credit from the first when it forks somebody else's. Character
> portraits moved the same way — unlimited on a plan, 4 per account free.
>
> Item 3 below, the character-art unit-cost hole, is **closed**: a cast of three
> costs $0.117 at the flat Gemini rate, it stays bundled into the story start,
> and a standalone portrait is free four times per account and then 1 credit.
> The remaining items are the chapter-art attach rate and the word-band overshoot.

> **Resolved 2026-09-02.** `CREDITS_AND_PRICING.md` has been amended — decision
> 10 now prices chapter art, the unit is a story rather than a chapter, and the
> three render tiers are fixed as constraints. The analysis below is retained as
> the reasoning that produced that amendment; its *numbers* are superseded by
> that file, which used a text cost of $0.031. That was replaced by $0.004 on
> `gpt-5.6-luna`, and on 2026-09-05 by **$0.0160** on `meta/muse-spark-1.3` —
> the first figure in this file's lineage to include reasoning tokens, which are
> billed at the completion rate and are the majority of the completion bill.
> $0.031 and $0.004 are both superseded. See §14 item 1 and
> [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §2.
>
> **This document still does not have the authority to change prices.**
>
> **Every number below is historical.** The analysis was written against 3-to-30
> chapters, a cast of four and a text cost of $0.031. The shipped contract is
> **3 · 7 · 15 chapters, a cast of 3, and $0.0160 text** — see §14 and §15. The
> reasoning is kept because it is what produced the amendment; the figures are
> superseded by `CREDITS_AND_PRICING.md` §2 and must not be quoted.

**The root cause is a word.** That file prices a *chapter* at 3 credits — text +
cover + characters — and it was written when a story was assumed to be roughly
one chapter long, so *story* and *chapter* were interchangeable. They are not.
A story is a container of 3 to 30 chapters. Once that is true, "regenerate the
cover and the entire cast on every chapter" is not a price, it is a bug: nobody
re-casts their characters at chapter 7.

So this is not a price cut. It is the first model that is coherent for a
multi-chapter story:

| | Priced per | Mandatory |
|---|---|---|
| Chapter text | chapter | yes |
| Chapter art | chapter | **chapter 1 only** |
| Characters | **story** | yes, at creation |

| Story | Old model | New, minimum | New, fully illustrated |
|---|---|---|---|
| 3 chapters | 9 ✦ | **5 ✦** | **7 ✦** |
| 10 chapters | 30 ✦ | **12 ✦** | **21 ✦** |
| 30 chapters | 90 ✦ | **32 ✦** | **61 ✦** |

The old column is not lost revenue — it is revenue that was never collectable,
because a 30-chapter story at 90 credits exceeds a Writer monthly grant twice
over and would simply never be made. The realistic comparison is against what
users will actually buy, and the number that decides it is the **chapter-art
attach rate**, which is now the most important unresolved figure in the business
model. At 100% attach a 30-chapter story is 61 credits; at 0% it is 32.

Three items for the pricing owner, plus two added 2026-09-05:

4. **Streaming adds a second text call per chapter**, so text is ~45% more
   expensive on the contributor tier and ~36% on the standard one. The §4 margin
   rows have not been re-run against it. See
   [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §2.
5. **The model overshoots the word band, and the streamed path cannot retry.**
   Measured across three production runs against a 1,200-1,600 band with the
   band stated in two separate prompt sections: 2,056, 2,114 and 2,331 words.
   The tolerated ceiling is 2,000. This matters here rather than only in code
   because narration is priced per word and reading-time estimates are built on
   the band, so a chapter 40% over budget is 40% more expensive to narrate than
   this file assumes. Either the bands move to match the model or the model
   moves to match the bands; both are decisions, and both land in that file.

1. **Re-run the Writer yearly row** — the binding 40%-margin constraint — against
   this model at a range of assumed attach rates. *(Inference: break-even attach
   rate is the number to publish, so the illustration toggle's copy and default
   can be tuned against it.)*
2. **The 30-chapter option is now reachable** on a Writer monthly grant of 50
   — 32 credits unillustrated. That is either the flagship use case or a margin
   hole, depending on (1).
3. **Character art is a genuine unit-cost hole, and it is not this document's to
   fix.** That file prices "generate its characters" at 1 credit, which was
   costed as *one image of the cast*. The Craft character sheet in §4 generates
   **one portrait per character**, up to four. At the file's own $0.063 per image
   that is **$0.25 of cost against $0.0708 of net revenue** on the Writer yearly
   row — a loss of roughly $0.18 per cast, on every story, on the tier that is
   already the constraint. Either portraits are 1 ✦ **each**, or the cast is one
   composite image, or the character count is capped below four. **This must be
   resolved before §4 ships.**

## 10.7 A long story's facts are held by the server, not the model (2026-09-19)

Added by PR #112, and it belongs here because it is a property of what the
reader receives, not an implementation detail.

Everything in this document describes how a story is *started*. What it did not
describe is how chapter nine knows what chapter one settled. Until 2026-09-19
the answer was: it did not. 83 stories were written through this flow on
2026-09-18 and read end to end, and **not one passed as written**. Readers met
a woman whose three cows became eight, a man who was 79 and then "thirty", a
midpoint reveal staged a second time as if it were news, and a rescue that
arrived after the deadline it was racing.

`stories.story_bible` (migration 00092) now holds a story's settled facts, its
clock, its fixed truth, and the scenes the reader has already been shown. The
distinction that makes it work:

| | `series_state` | `story_bible` |
|---|---|---|
| Owner | the model | the server |
| Lifetime | rewritten every chapter | append-only for the story's life |
| Holds | what is open, wanted, pressing | names, ages, counts, dates, the clock, the truth, what was shown |
| A conflict means | the story moved on | a contradiction was written, and is reported |

`series_state` is a field the model re-emits in full every chapter, which is
right for narrative momentum and is exactly the drift channel for fact: a model
asked to restate `world_facts` twelve times paraphrases them twelve times, and
a paraphrase of a number is a different number. So the bible is **never written
by the model** -- it proposes, `mergeStoryBible` decides, and a proposal that
conflicts is refused rather than applied. The bible is never retroactively
wrong; the chapter is.

**Nothing about this is reader-visible in the UI, and that is deliberate.** The
check runs under `waitUntil` after `done` has already fired, so it adds **0
seconds** to the wait for a chapter, and the bible is server-only, adding
**0 KB** to what a phone downloads.

**What it does not do.** Measured on the six stories that previously had to be
regenerated: major issues per chapter fell 0.40 -> 0.28, and fact drift -- the
class it exists for -- fell 45%. Replayed reveals halved in majors. Clock and
fairness moved within noise. This reduces drift; it does not end it, and a
15-chapter story can still contradict itself.

## 11. Drafts

### States

| State | Means | Stored |
|---|---|---|
| `idea` | Started, nothing generated, no credit spent | **Local** — AsyncStorage |
| `drafting` | ≥ 1 chapter generated | **Server** |
| `complete` | All chapters generated, not published | **Server** |
| `published` | Live | Server |

**The rule: anything the user paid for lives on the server.** Local autosave is
correct before the first credit is spent and never after it. Losing a phone must
not lose a story someone bought.

**`complete` is the resting state, not a waiting room.** A finished story that
was saved privately is durable, fully edited, readable by its author, and
public to nobody — see §10.5. `published` is a separate, deliberate step a
writer takes afterwards, and never a state a story arrives in by default.

> **Bug risk to close:** the current draft system is AsyncStorage with a **7-day
> expiry**. That expiry must never apply to a `drafting` or `complete` story.
> Deleting something a user paid credits for, silently, after a week, is the
> worst failure in this document.

### Where drafts appear

**In Library.** Alongside published stories, as cards that are visibly drafts:

- The **concept cover** (§10.4), so drafts look different at a glance.
- A **Draft** badge.
- Progress — *2 of 3 chapters* — which is the resume affordance and the nudge in
  one line.
- Sorted by last-edited, above published stories.

**In the create flow.** The Create screen shows a link under the idea box
whenever drafts exist: **Continue a draft (2)**. It opens a sheet listing them,
newest first,
each row tappable straight back to where the user stopped. This is the second
entry point — a user who opens Create intending to resume should not have to go
to Library to find their way back.

**Nowhere else.** Drafts never appear in the feed, in search, or on a profile.

### Resume behavior

Tapping a draft returns the user to **exactly the state they left**: the Create
screen and its modal/options state for an `idea`, the story view at the next
unwritten chapter for a `drafting`, the publish sheet for a `complete`. Never to
the top of the flow.

### Deletion

A draft can be deleted from Library and from the drafts sheet, with confirmation.
Deleting a `drafting` story warns that generated chapters are lost and that
credits are **not** refunded — they bought a generation that was delivered.

---

## 12. What changes in code

**Migration 00027 is required** *(corrected 2026-09-02; this section previously
said none was — see Decision 51)*. There is nowhere to store chapter art
(`chapters.image_url`), character portraits (`characters.portrait_url`), the
brief fields, or the planned length, and `generation_operations.kind` is
constrained to `('story','continuation')` — so a cover, a chapter illustration
and a cast cannot reserve an operation, and every paid image would be charged
outside the idempotency and auto-refund path.

`whereAndWhen`, `moments` and character `background` / `appearance` do extend
existing request types without ceremony. The draft state machine can start as a
derived value.

### `expo/src/screens/CreateStudioScreen.tsx`

| Change | Detail |
|---|---|
| Main setup has one screen | Genre, All-ages, Your idea, optional Premise, characters, More options, brief strength, and Create all live on one scrollable surface. Onboarding owns any separate two-step preview flow. |
| Keep the 40-character floor without a counter | `canGenerate` requires enough idea text to infer from, but no visible countdown appears |
| Rename chip heading | `Try a premise` → `Try one` |
| Shrink starter chips | The card shows a clipped three-line preview, and tapping still inserts the full starter text into Your idea |
| Dissolve the toggle-chip row | Kids → mode toggle; queer and vampire → silent inference |
| Add optional Premise | New visible label for the optional `whereAndWhen` context in `StudioDraft` |
| **Replace inline characters with the Craft character sheet** | Full screen: Name, Description, Background, Appearance, Create image/Reimagine/Edit/Delete, and a single Lead character toggle; Save. The image action is separate from the story call. |
| Add the moments builder | New `moments: string[]`, capped, inside More options |
| Add character-name tokens | Derived from `draft.characters` |
| Keep pre-story inference optional | No main-flow Continue call. Any later inference must silently prefill editable fields on the same screen |
| Add See-an-example | Static, one per genre, with **Use this** |
| Replace the hint with the meter | Slot-based, on the same Create screen |
| Add `Continue a draft (n)` | Create screen, when drafts exist |
| More options | Chapters 1/3/7/15, chapter length, chapter art for 2–N. **No writing mode** — §15 |

### `backend/supabase/functions/_shared/`

| File | Change |
|---|---|
| `types.ts` | `whereAndWhen?`, `moments?`, `chapterLength`, `plannedChapterCount`, character `background` / `appearance` / `isHero`. **No `writingMode`** — there is no mode to store |
| `story-prompts.ts` | Two new layers — world (`whereAndWhen`) and beats (`moments`); character layer consumes background separately from appearance |
| `cover-prompts.ts` | Consume `whereAndWhen`. This is what stops covers reading as genre stock art |
| `image.ts` | Character portrait prompt from `appearance` + `description`; separate from the cover path |
| `generate-character-image` | Client-callable portrait endpoint wrapping the character image path. It must not start story generation. |
| `cover-regeneration.ts` | The claim / price / generate / settle transaction behind Regenerate, kept out of the handler so the paths that cost a credit can be tested. **Migration 00044 is required.** `stories.cover_regen_count` is what makes "1 free retry, then 1 ✦" expressible at all; `stories.cover_attempt_count` is what bounds provider spend when the free retry keeps failing; `stories.cover_last_request_id` is what makes the *free* path idempotent, which `reserve_generation_operation` only does for the paid one — written **only** by `finish_cover_regeneration`, so it records the request that delivered the cover on the row rather than the last one to claim it, and a retry after a failed regeneration re-attempts instead of being handed the old cover as a success; and `stories.cover_prompt` — which §10.4 assumed existed and did not — is what lets a regeneration vary from the cover it replaces instead of re-sending the request that produced it. It is written by the original cover too (`media.ts`), not only by a regeneration: the *first* regeneration is the free one and therefore the common case, and it is the one that reads a column no regeneration has yet written. All four are server-derived and deliberately outside the owner-update grant of 00015, like `cover_status`. The price, the ceiling, the replay check and the claim all happen inside `claim_cover_regeneration`, under one advisory lock and one `for update`: reading any of them in one round trip and acting in the next is what makes two fast taps two free covers. |
| `regenerate-cover` | Client-callable cover endpoint. **POST** re-rolls the cover — reserving `kind = 'cover'` on chapter 1 when a credit is due, refunding it when the image does not arrive. **GET** reports the current cover state, which is how the client learns chapter 1's art landed: it is generated on a background task after the response is flushed, so without a read there is no second moment at which the client could find out. Same shape as `audio-status`. |
| `cover-prompts.ts` / `image.ts` | A regeneration steer, carried beside the *Avoid* exclusion — but **dropped at the last safety rung**, which the exclusion is not. Level 2 exists to be the prompt that cannot be refused; the steer is the only per-request caller-supplied text in a cover prompt, so leaving it there lets a note written to trip a content filter trip every rung of every provider, and one request becomes nine image calls. The two free-text fields a cover prompt carries — the *Avoid* exclusion and the steer — are each collapsed to a single clause, every `.` `!` `?` `;` `:` becoming a comma, because the value is emitted inside `Do not depict: X.` and a terminator inside X ends our sentence and starts the caller's. That is a promise about those two fields and not about the whole prompt: `title` and `where_and_when` are interpolated as written, because collapsing punctuation in them would turn "Dr. Smith's Door" into "Dr, Smiths Door". The steer's two halves — the writer's note and a description of the cover being replaced — are budgeted separately rather than sharing one cap, or a maximum-length note truncates the "make it clearly different" half away and the regeneration is free to reproduce the cover it was asked to replace. Plus a per-attempt storage key. The cover URL carries no version, so overwriting the object would leave every CDN edge serving the picture the writer just paid to replace. |
| `validation.ts` | Clamp `moments`; enforce kids-mode spice removal; clamp chapters to the range 1–15 (the picker offers 1 · 3 · 7 · 15; every other value in range is reached by extension); cap the cast at 3; normalize a non-empty cast to exactly one `isHero` character; reject any creation language but English (`validation.ts`), while a continuation reads `stories.language` off the row and never passes it through the validator -- so an existing Portuguese or Spanish story keeps being written in its own language; normalize `image_style` and `story_flow`, falling back to `auto` and `interactive` respectively; accept an optional writer `title` (trimmed, ≤ 120 characters) that the server keeps over any model-generated name. The Create flow has no title input; the field is plumbed through `CreateDraft.title` for callers that title a story before it is written |

### `expo/src/i18n/`

Every label in §1, §4 and §9 is a new key in EN and PT. **`premise`, `plot`,
`topic`, `setting`, `arc` and `seed` must not appear as values in any
locale file.** A lint rule enforcing that is cheap and worth adding.

### Library

Draft cards, the Draft badge, chapter progress, sort-by-last-edited.

---

## 13. Metrics

| Metric | Why it is here |
|---|---|
| Create readiness rate | The one required field's real cost |
| Inference acceptance rate, per chip type | A chip corrected >50% of the time is a bad guess, not a bad field |
| Craft-character completion — fields filled per character | Tests whether Background and Appearance earn their boxes |
| Reimagine rate per character | High means the portrait prompt is wrong, not that users are fussy |
| Moments attach rate, adult vs kids | Decides whether moments should leave More options |
| **Continue-tap drop-off by chapter**, and *Write the rest* usage | Says whether the per-chapter loop is engagement or friction, and at which chapter people stop steering |
| Share of Continues with an empty *What happens next?* box | If it dominates, steering is friction wearing a hat and the box should shrink |
| **Chapter-art attach rate** | The most important unresolved figure in the business model — §10.6 |
| Cover: generate vs regenerate vs upload vs keep-concept | Tells us whether cover generation is worth its credit |
| `planned_chapter_count` distribution across the offer (1 / 3 / 7 / 15), and how far extension moves it | Whether 7 and 15 are real or decorative, and whether 3 is a default nobody moves off |
| Draft resume rate, by entry point | Library vs the create-flow link |
| Brief strength → generation rating | **The load-bearing one.** Any field that does not move it gets cut |
| Kids-mode share of drafts | Decides whether kids justifies its own App Store listing |

---

## 14. Open items — all closed 2026-09-02

Every item below was open when this document was written. None is open now. The
resolutions are load-bearing on the rest of the file, so where one supersedes an
earlier section, that section carries a pointer back here.

1. **§10.6 — closed, and it was never two blockers.**
   (a) The chapter-art attach rate is **not a launch dependency**. At the render
   tiers now fixed in `CREDITS_AND_PRICING.md` §2, 100% attach clears the 40%
   floor at 3, 7 and 15 chapters, so the figure this document called "the most
   important unresolved figure in the business model" is a product metric rather
   than a gate.
   (b) **Per-character portraits never lost money.** The −$0.18 figure priced
   portraits at $0.063, the *cover* tier; they render at 1024×1024 low, $0.011.
   The claim also tested a single action against a floor that
   `CREDITS_AND_PRICING.md` defines on a blended basis. There is no loss at any
   cast size up to five.
   The cast cap is nonetheless **3, not 4** (§4 amended) — a product bound, not a
   margin one. Derivation: [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §2.

2. **Chapter-length word targets — closed as a contract, open as a measurement.**
   The bands are now defined in code rather than in this table:
   `wordBandFor()` in `_shared/types.ts` is the single source of truth, read by
   the prompt builder *and* by `requireUsableStoryOutput()`, with a 0.75×/1.25×
   tolerance before a generation is rejected and re-routed. Short / Standard /
   Long extend that one function.
   The **numbers themselves remain unmeasured**, and this document must not quote
   them in UI copy until B11's evals have run. Until then the length control
   ships with its options unlabelled by word count.

3. **Inference re-runs only on a non-trivial diff.** The rule: re-run when the
   idea text has changed by more than 25% of its characters *or* when a sentence
   has been added or removed. A typo fix, a re-word, or trimming a clause does
   not re-run and does not disturb chips the user has already corrected.
   **User-edited values are never overwritten by a re-run** — inference fills
   empty slots and replaces only untouched inferred ones.

4. **Moot.** There is no Interactive mode to cap. §9's writing-mode control is
   removed — see §9 — and 30 chapters is not offered. The lengths are 1 · 3 · 7 · 15.

5. **Character portraits in the reader: the cast strip, opened from the title.**
   Portraits do **not** appear inline in the prose, where they would interrupt
   reading and compete with chapter art. They appear in a horizontally scrolling
   cast strip on the story's title screen, and nowhere else at launch. This is
   the cheapest placement that justifies generating them and the only one that
   cannot damage the reading experience.

6. **Kids mode does not filter the feed at launch.** Kids is a property of a
   *story being written*, not of the person holding the phone — §3 — so it cannot
   drive what an account sees. Feed filtering requires a device- or
   profile-level setting, which §3 explicitly defers along with the PIN. A
   separate App Store listing therefore stays out of scope, and nothing in this
   document depends on it.

7. **`draft.seed` keeps its column name.** The rename to `idea` is correct and
   is not worth a migration. The interface ban in §1 is what matters and is
   enforced by the i18n lint rule in B10.

---

## 15. What this document no longer says

Four decisions taken after this file was written supersede sections above. They
are listed here so a reader who lands mid-document is not misled.

| Section | Superseded by |
|---|---|
| §9 **Writing mode** — Interactive vs Auto-Write | **Removed.** One flow: read the chapter, optionally steer, tap Continue. A *Write the rest* action appears from chapter 3 with an itemised confirm, a Stop that keeps what it wrote, and resume after a kill. There is no mode to choose and none to switch. |
| §9 **Chapters: 3 · 7 · 10 · 15 · 30** | **1 · 3 · 7 · 15**, default 3. A *planned length* that drives pacing and the finale; `chapter_role: finale` is derived from position in the arc. The plan is no longer fixed once chosen — see §Extending a finished story. |
| §4 **Maximum 4 characters** | **Maximum 3.** See item 1(b). |
| §6 **Inference** and its relationship to onboarding | Onboarding's W1→W2→W3 blueprint is the same surface under other names, and unifying them is **deferred**. The debt is accepted deliberately: the shared `StoryBrief` type is defined once now, consumed only by Create, so later unification is a mapping job rather than a rewrite of a live surface in three locales. |

---

<!-- markdownlint-disable MD029 -->
<!-- Scoped to this block only. The list below is one continuous 1-57 sequence
     split by sub-headings, so each sub-list starts at 6, 13, 17, 33, 51 and so
     on. Those numbers are cited from AGENTS.md, the build logs and this file's
     own sections, so they must not be renumbered to satisfy the linter. -->

## Decisions

### Vocabulary

1. **Inputs are labeled as plain user-facing controls** — *Your idea · Premise ·
   Who's in it · Moments to include.*
2. **`Plot`, `Topic`, `Setting`, `Arc`, `Seed` and `Prompt`
   are banned from the interface** in all three locales. They may survive as
   internal identifiers. `Premise` is allowed only as the optional secondary
   context field, not as the required idea field.
3. **Katha's outputs are `Title`, an unlabeled paragraph, and `Chapters`.**
4. **One word, one meaning.** No word names both an input and an output.
5. **There is no hidden flavour taxonomy.** The visible brief is the whole
   brief. Specific relationship dynamics, creatures and structures belong in
   the idea or in Moments to include.

### Flow

6. **One Create screen plus the Craft character modal.** Onboarding may have its
   own two-step preview, but main Create does not.
7. **One required free-text field, ever.**
8. **There is one story generation CTA** on the Create screen.
9. **Cost is shown twice** — balance in the header, price on the button.
10. **The 40-character *counter* is removed; a 40-character *floor* stands.**
    *(Revised 2026-09-05.)* The counter ranked the user against a number at
    every length and taught padding. The floor is invisible above 40 characters
    and fires only where the shaping call cannot work at all. It reads as a
    state, not a countdown — see §2. The slot-based brief-strength meter still
    does the teaching, and **Sparse remains a legitimate choice** everywhere
    above the floor.
10a. **Chapter length is labelled in minutes, never in words** — 3 · 5 · 9 per
    chapter, derived at 260 wpm from the bands in §9. See §9's length table.
11. **Premise is optional** — real and load-bearing, feeding both the story
    prompt and the cover prompt, but never required.
12. **The `🧒 Kids` / `🏳️‍🌈 LGBTQ+` / `🧛 Vampire` row is dissolved.**

### Inference

13. **Any future inference stays on the same Create screen** and presents values
    as editable state.
14. **The inference call, if enabled, is free.** It is scaffolding, not a
    generation.
15. **Inference failure is silent.**
16. **The character sheet arrives pre-filled.** This is inference's
    highest-leverage instance: four empty boxes get one lazy line, four
    pre-filled boxes get corrected into a real character.

### Characters

17. **Characters get a full-screen `Craft character` sheet**, modeled on Okudu's:
    Name · Description · Background · Appearance · Lead character, then Save.
    Portrait actions appear after the whole cast has been generated at story
    creation; they are not an on-save image-generation flow.
18. **The placeholder carries the teaching.** Category list, then `e.g.`, then a
    concrete example, in our voice. No separate helper labels.
19. **Appearance drives the image; Background drives the voice.** Separating them
    is the point of the four-field split.
20. **Portraits are generated once, at story creation, before chapter 1** — for
    cross-chapter consistency, and because the per-chapter loop has no later
    moment when the whole cast is known.
21. **Reimagine is free once**, then 1 ✦. **Max 3 characters** *(amended
    2026-09-02, was 4)*. Character art is 1 ✦ for the cast, rendered at
    1024×1024 low.

### Kids mode

22. **Kids is a per-draft mode toggle**, adult by default. No device lock at
    launch.
23. **Kids mode removes rather than defaults.** Spice absent from the DOM; dark
    romance, paranormal romance, horror and thriller absent from the genre row.
24. **The flow is otherwise identical** — a change requiring a fork in the
    component tree is the wrong change.
25. **Values is the kids-only chip slot.** Adult mode has no equivalent.
26. **Kids constraints are enforced server-side** as well as in the UI.

### Moments

27. **Moments sit below Characters**, because moments reference characters.
28. **Chip builder, not a paragraph box.** One chip is one schedulable beat.
29. **Character names render as insertable tokens.**
30. **Capped at five** (ten for a 15-chapter story), visibly.
31. **Zero state shows suggestion chips**, not an empty box behind a checkbox.
32. **Moments apply to both modes** — different suggestions, same field.

### Options

33. **Chapters: 1 · 3 · 7 · 15**, default 3 *(amended 2026-09-02: 10 and 30
    dropped until the drop-off-by-chapter metric earns them; amended
    2026-09-11: 1 added)*. This is a planned length that drives pacing and the
    finale, not a batch size — and since 2026-09-11 it is a **starting** length
    rather than a fixed one. **1 is a series of one, not a standalone**: it is
    stored with `story_mode = 'series'`, so it ends on the ordinary direction
    chips and can be grown. See §Extending a finished story.
34. **Chapter length shows its word count** — *Standard · ~1,400 words* — **but
    only once B11 has measured the bands.** Until then the options ship
    unlabelled, because the UI states these as fact and they are unmeasured
    (§14 item 2).
35. **There is no writing mode** *(amended 2026-09-02)*. One flow: read,
    optionally steer, **Continue** with its price on it. **Write the rest**
    appears from chapter 3 with an itemised confirm, a Stop that keeps what it
    wrote, and resume after a kill.
36. **Point of view is cut.** It duplicates the Writing style box.
37. **The identity lens control is retired, the capability kept.** One value is a
    toggle, not a system; the idea sentence carries it better; and asking a user
    to classify themselves rather than their story is the same disease as the
    identity row. Revisit if it grows past one value.

### After Create

38. **Cover and illustration are one feature: chapter art.** Chapter 1's art is
    compulsory and *is* the story's cover; chapters 2–N are optional at 1 ✦ each.
    A story is not a thing with a cover plus pictures — it is a sequence of
    chapters, the first of which you see on the shelf.
39. **A typographic concept cover exists from the first moment**, free, so a
    draft has a face immediately.
40. **Chapter 1's art is generated with chapter 1**, not at publish. That is early
    the second thing that happens, which is what removes the ordering problem.
41. **Uploading your own cover is free and prominent.** It costs us nothing and
    it is the escape hatch when generation misses.
42. **Each chapter is charged as it is generated**, so an abandoned interactive
    story costs only what it wrote.
43. **Editing stays free** at the existing per-chapter allowances.

### Drafts

44. **Anything the user paid for lives on the server.** Local autosave before the
    first credit is spent, never after.
45. **The 7-day local expiry must never apply to a paid draft.** Silently deleting
    a story someone bought is the worst failure in this document.
46. **Drafts appear in Library** with a concept cover, a Draft badge and chapter
    progress, sorted by last-edited above published stories.
47. **The Create screen carries a `Continue a draft (n)` link** — the second entry point,
    so resuming does not require a trip to Library.
48. **Resume returns to the exact state the user left**, never the top of the
    flow.
49. **Drafts never appear in the feed, in search, or on a profile.**
50. **Deleting a paid draft warns that credits are not refunded.**

### Engineering

51. **A schema migration *is* required** *(corrected 2026-09-02; this decision
    previously said none was)*. Migration 00027 adds `chapters.image_url`,
    `characters.portrait_url`, the brief columns and the planned length, and
    widens `generation_operations.kind` so a cover, a chapter illustration and a
    cast can each reserve an operation. Without that last change every paid
    image is charged outside the idempotency and auto-refund path.
52. **Two new prompt layers** — world and beats — join the ten in
    `story-prompts.ts`.
53. **`cover-prompts.ts` consumes `whereAndWhen`.** This is what stops generated
    covers reading as genre stock art.
54. **Character portraits use a separate image path** from covers, prompted from
    `appearance` + `description`.
55. **An i18n lint rule** rejects the banned words as values in any locale file.
56. **§10.6 is resolved and blocks nothing** *(2026-09-02)*.
    `CREDITS_AND_PRICING.md` is amended: a story rather than a chapter is the
    priced unit, chapter art is a priced action again, and three render tiers are
    fixed as constraints. Portraits never lost money — the −$0.18 was computed at
    the cover tier and tested a single action against a blended floor.
57. **Brief strength → generation rating is the one launch-critical metric.**
    Chapter-art attach rate is no longer launch-critical: 100% attach clears the
    margin floor at every length. It stays instrumented as a product metric.

<!-- markdownlint-enable MD029 -->
