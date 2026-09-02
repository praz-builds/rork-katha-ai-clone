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
> **This document is a specification, not a description of shipped behaviour.**
> Almost none of it exists in code yet. What ships today is a single AI-chosen
> short story of 500-1,500 words, continuable to 7 chapters, from the setup
> screen in `CreateStudioScreen.tsx`. Everything here — the three screens, the
> Craft character sheet, moments, chapter art, the planned length, the Continue
> loop — is the contract for the rebuild. Read a statement below as "this is what
> we are building", never as "this is what the app does".
>
> Last revised 2026-09-02. Sentences that are inference rather than shipped
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

1. **One required text field, not five.** Genre and where-and-when are *inferred*
   from the user's sentence and shown as editable chips. Correcting a guess is
   dramatically cheaper than composing an answer, and the corrected values reach
   the prompt identically.
2. **Inputs are plain questions.** "Premise", "plot", "topic", "setting", "trope"
   and "arc" never appear in the UI — they are craft jargon, and two of them
   collide with what Katha *produces*. See §1.
3. **Characters are the deepest surface in the product, not a text field.** A
   full-screen *Craft character* sheet with Description / Background /
   Appearance, a generated portrait, and Reimagine. Modeled directly on Okudu's,
   because it is the best thing in their app. See §4.
4. **Kids mode is a mode, not a chip.** Adult by default, one tap, per-draft. It
   re-authors labels, filters the genre row, adds Values, and **removes** spice
   rather than defaulting it.
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
   idea", not "Premise". "Who's in it", not "Dramatis personae".
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
| **Where and when** | World and era | Chip, inferred, editable, never a required field |
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

`Premise` · `Plot` · `Topic` · `Setting` · `Arc` · `Trope` · `Seed` · `Prompt`

All eight are craft jargon; three of them ship today (`seed`,
`Try a premise`, `ARC`). They may persist as internal identifiers — the `seed`
DB column is not worth a migration — but they must never reach a user's eyes.

### On tropes

**There is no trope control in adult mode.** The word is insider vocabulary that
sounds like homework to everyone who is not already deep in romance fandom, and
a chip row of them competes with the idea box for the same job.

The **mechanism** survives without the word: `story-prompts.ts` keeps its
`tropeModules` layer, and inference (§6) populates it silently from the idea
sentence. A user who writes *"she has to fake-date her brother's best friend"*
gets `fake-dating` and `forbidden` in the prompt and never sees either term. The
confusion was the vocabulary, not the capability.

*If we later want them visible, the honest surface is the **feed** — "more like
this" — not the create flow. Discovery is where a reader wants a taxonomy;
authoring is not.*

---

## 2. The create flow

### Screen order

```
Create  ──▶  1. Idea      ──▶  2. Shape      ──▶  3. Review and start
             (one box)        (correct the       (the spec + the cost)
                               guesses)
```

Screen 1 is deliberately almost empty. Screen 2 holds the density, and every
control on it arrives with a value already in it.

### Screen 1 — Idea

| | |
|---|---|
| **Header** | *What's your story about?* |
| **Sub** | *A sentence is enough. Katha takes it from there.* |
| **Input** | Multiline, `n / 1000` counter, no minimum-length gate |
| **Below** | **Try one** — horizontal starter chips |
| **Links** | **See an example** (§7) · **Continue a draft (n)** when drafts exist (§11) |
| **CTA** | *Continue*, enabled at ≥ 1 non-whitespace character |

**The 40-character gate is removed.** `getSeedHint()` nags at `< 40` and again at
`< 80`, keyed to character count. Character count teaches padding, not structure.
It is replaced by the brief-strength meter (§8) on screen 3, where it can be
acted on.

The starter chip heading changes from **TRY A PREMISE** to **TRY ONE**.
`GENRE_PREMISE_CHIPS` is a good asset; only its label was wrong.

### Screen 2 — Shape

```
┌────────────────────────────────────────────┐
│  [ For me ] [ For kids ]        ← mode     │
├────────────────────────────────────────────┤
│  GENRE          Mystery ×  Gothic ×  + add │
│  WHERE AND WHEN A hill town, off-season  ✎ │
├────────────────────────────────────────────┤
│  WHO'S IN IT                               │
│   ┌────┬─────────────────────────────┐     │
│   │ 🖼 │ Elena Márquez               │     │
│   │    │ Historical restorer, 34     │     │
│   └────┴─────────────────────────────┘     │
│   + Add character              (max 3)     │
├────────────────────────────────────────────┤
│  ☐  Moments to include                     │
│     ⌜suggestion chips in the zero state⌟   │
├────────────────────────────────────────────┤
│  ▸ More options                            │
├────────────────────────────────────────────┤
│              Review  ›                     │
└────────────────────────────────────────────┘
```

**Where and when is a chip, not a field.** This is the resolution of the
Setting/Topic question. It is real and load-bearing — two words of world change
more of the output than twenty words of plot, and it feeds `cover-prompts.ts` as
well as the story prompt — but it does not deserve a blank text box, because the
user has almost always already implied it. Katha extracts it, shows it, the user
taps to edit. If extraction finds nothing the chip reads *+ Where and when?* and
stays optional.

**Genre is multi-select and inferred.** `primaryGenre` remains the first
selection for prompt routing and cover style; additional genres are secondary
tags.

**The `🧒 Kids` / `🏳️‍🌈 LGBTQ+` / `🧛 Vampire` chip row is dissolved.** Three
different kinds of thing at one visual weight is a category error: Kids is a
*mode*, queer was an *identity lens*, vampire was a *content flavor*. Kids
becomes the mode toggle, vampire folds into silent inference (§1), and the
identity lens is retired (§9).

### Screen 3 — Review and start

Retained as its own screen even though it costs a tap. It is not friction, it is
the conversion mechanic: the user sees the thing they assembled, *then* sees what
it costs.

- The full spec, read-only, each row tappable to jump back.
- The **brief-strength meter** (§8).
- Balance in the header, price on the button — cost stated twice, per
  `CREDITS_AND_PRICING.md` decision 33.
- Primary CTA: **Create · n ✦**, itemized on tap.

---

## 3. Kids mode

A **per-draft toggle** in the first position on screen 2. Adult is the default
for every new draft. No device lock and no PIN at launch — the mode describes the
story being written, not the person holding the phone. *(Inference: a family plan
with child profiles would make a lock worth revisiting. Not before.)*

| Surface | For me | For kids |
|---|---|---|
| Extra chip slot | *(none)* | **Values** — kindness, honesty, courage, patience, sharing |
| Genre row | All 15 | Filtered: no dark romance, paranormal romance, horror, thriller |
| Spice | In More options, flag-gated | **Absent from the DOM** |
| Character *Description* placeholder | *e.g. a tired detective, an ancient dragon* | *e.g. 9 year old boy, a talking dog* |
| Moments placeholder | *A rooftop confession in the rain* | *They build a treehouse* |
| Chapter length default | Standard | Short |
| Chapters default | 3 | 3 |
| Cover style | Genre-native | Warm, illustrative |

**Everything else is identical** — same screens, same order, same character
sheet, same moments builder, same More options, same review screen, same
component tree. Kids mode is a copy-and-filter layer over one flow. Anything
requiring a fork in the component tree is a signal the change is wrong.

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

```
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
│                                            │
│              ( Reimagine )                 │
│                                            │
│   ┌───────────┐                            │
│   │           │      ( Edit )              │
│   │  portrait │                            │
│   │           │       Delete               │
│   └───────────┘                            │
│                                            │
│              [   Save   ]                  │
└────────────────────────────────────────────┘
```

### The four fields, and why each exists

| Field | Drives | Prompt destination |
|---|---|---|
| **Name** | Reference in prose and in moments | Story prompt, moments layer |
| **Description** | Who they are in one line — role, species, age | Story prompt, cover prompt |
| **Background** | Voice, motivation, relationships | Story prompt only |
| **Appearance** | The portrait, and physical detail in prose | **Character image prompt**, story prompt |

This is a clean four-way split with no overlap, which is exactly why it is worth
copying: **Appearance exists to drive the image**, Background exists to drive the
voice, and separating them is what stops the portrait from being generic and the
prose from being a physical description.

### The instructive placeholder

Okudu's smartest move here, and it is replicated: **the placeholder carries the
teaching, and there are no separate helper labels.** *"Personality,
relationships, backstory, traits, etc. e.g. …"* is both the instruction and the
example, occupying zero extra vertical space. Every long placeholder in this
sheet follows that shape — a category list, then `e.g.`, then a concrete example
in the app's own voice.

Placeholders are re-authored per mode (§3) and per genre where it helps.

### Portrait, Reimagine, Edit, Delete

- The portrait generates from **Appearance + Description** on first Save.
- **Reimagine** regenerates it from the current field values. Per
  `CREDITS_AND_PRICING.md` principle 4 and the editing table, the first
  regenerate is **free**; further ones are 1 credit.
- **Edit** re-opens the fields. **Delete** removes the character and its portrait.
- Aspect ratio is portrait, full-body, on a plain ground — matching the reference
  and matching what the reader UI needs for a character strip.
- **Portraits are generated once, at story creation, before chapter 1.** They must
  stay visually consistent across every chapter, and once the loop starts there is
  no later moment where the whole cast is known at once.

### Limits

Maximum **3** characters — *amended 2026-09-02, was 4; see §14 item 1.* Character
art is **1 credit for the cast**, not per character, matching the existing
"Generate its characters — 1" line, and portraits render at 1024×1024 low.

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

*For stories above 10 chapters the cap rises to 10, since there is room to
schedule them. (Inference — validate against output quality before shipping.)*

### Zero state

Header and genre-matched suggestion chips are **always visible**; the text input
appears on tapping a chip or **+ Add a moment**. A checkbox that reveals an empty
box asks for work before showing what the work is.

---

## 6. Infer, don't ask

On **Continue** from screen 1, one cheap, fast structured call returns:

```json
{
  "genres":       ["mystery", "gothic"],
  "tropeModules": ["haunted-house"],
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
- `tropeModules` is **never rendered** (§1). It goes straight to the prompt layer.
- The call is **free to the user.** It is scaffolding for the ask, not the ask —
  per `CREDITS_AND_PRICING.md` principle 2, a credit buys an AI action the user
  requested.
- **Failure is silent.** On timeout or malformed output, screen 2 renders with
  empty chips and suggestion sets. The user is never shown an error for a
  convenience they did not request.

**Why this beats a form.** The information reaching the prompt is identical. What
changes is the user's job: correcting guesses instead of composing answers.
Correction is faster, has no blank-page cost, and teaches the taxonomy by
demonstration — a user who sees *"A hill town, off-season"* in the where-and-when
chip has learned what that field is for, permanently, without reading a label.

Pre-filling the character sheet is the highest-leverage instance of this. A user
faced with four empty boxes labeled Description / Background / Appearance will
mostly write one line and leave. A user faced with four boxes Katha already
filled will fix the two that are wrong — and the resulting character is far
richer than the one they would have written from empty.

---

## 7. See an example

A text link below the idea box on screen 1 and below the moments builder on
screen 2. **It shows every slot filled at once, genre-matched.** Showing one
field's example in isolation does not help, because the confusion is
*relational* — users do not misunderstand what a setting is, they misunderstand
which of their sentences goes where.

```
Your idea         Elena inherits her grandmother's house
                  and finds a door that wasn't on the deed.

Genre             Mystery · Gothic
Where and when    A hill town, off-season, present day
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

Replaces `getSeedHint()`. Lives on screen 3. Keyed to **slots filled**, not
character count.

| Filled | Reads |
|---|---|
| Idea only | **Sparse** — *Katha will invent most of this. That can be good.* |
| + genre | **Good** — *Enough to write from.* |
| + where-and-when, characters | **Strong** — *This will sound like yours.* |
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
| **Chapters** | 3 · 7 · 15 | 3 |
| **Chapter length** | Short · Standard · Long | Standard *(Short in kids)* |
| **Chapter art** | on / off for chapters 2–N — **1 ✦ each** | off |
| Writing style | Free text — *poetic, Shakespearean, hardboiled* | empty |
| Spice | Sweet · Steamy · Explicit — **adult only**, flag-gated | Sweet |
| Language | EN · ES · PT | device locale |
| Avoid | Free text — *exclude a topic* | empty |
| Visibility | Private · Public | Private |

**The cover image toggle is removed.** Chapter 1's art is compulsory and becomes
the cover — see §10.4. The toggle here governs chapters 2–N only.

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

| | Words per chapter *(target)* | 3 chapters ≈ |
|---|---|---|
| **Short** | 600 – 900 | 15 min read |
| **Standard** | 1,200 – 1,600 | 30 min read |
| **Long** | 2,000 – 2,600 | 50 min read |

The word figures are shown in the UI against each option — *Standard · ~1,400
words* — because "standard" alone means nothing to a first-time user, and the
length choice is the one that most changes what they get. *(Word targets are
proposed; validate against real generations and correct this table.)*

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
*themselves* rather than describe their story is the same disease as the trope
row: a taxonomy where a sentence would do.

**The capability stays** — `identityLenses` remains in the request type and the
prompt layer, populated by inference. Only the control is removed. If it ever
grows past one value, revisit this.

---

## 10. After Create — generation, editing, cover, publish

The flow does not end at the Create button. This section defines everything from
that tap to a published story.

### 10.1 The shape

```
Create ·  n ✦
   │
   ├── portraits generated  (1 ✦, once, whole cast)
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
                              read · edit by hand · redraft
                              regenerate or upload the cover
                                          │
                                       Publish
                                          │
                                        Live
```

### 10.2 Generation

> **Revised 2026-09-02 (§15).** This section previously described Auto-Write and
> Interactive as two flows the user chooses between. There is one flow.

- **Portraits first, always.** Before chapter 1, from the cast defined in §4.
  They must be consistent across every chapter, and there is no later moment when
  the whole cast is known at once.
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
- **Each chapter's text is 1 credit**, charged as it is generated, plus 1 for its
  art where the toggle is on. A story abandoned at chapter 2 of 10 costs what it
  wrote, not what it planned.
- **Failed generations auto-refund**, per `CREDITS_AND_PRICING.md` principle 4.

### 10.3 Editing

Unchanged from what ships, and free per the existing editing table:

| | Cost |
|---|---|
| Type, rewrite, restructure by hand | 0, unlimited |
| Ask Katha to rewrite a paragraph | 0 — 20 free per chapter |
| Ask Katha to redraft a chapter | 0 — 3 free per chapter |

Paragraph-level editing is the existing Create Studio draft editor and it stays
exactly as it is.

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

### 10.5 Publish

The publish sheet confirms title, cover, and visibility. Publishing is the only
step that changes visibility; Private stories can be published later from
Library.

### 10.6 What this requires of CREDITS_AND_PRICING.md

> **Resolved 2026-09-02.** `CREDITS_AND_PRICING.md` has been amended — decision
> 10 now prices chapter art, the unit is a story rather than a chapter, and the
> three render tiers are fixed as constraints. The analysis below is retained as
> the reasoning that produced that amendment; its *numbers* are superseded by
> that file, which used a text cost of $0.031 that has since been replaced by
> $0.004 on `gpt-5.6-luna`. See §14 item 1 and
> [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §2.
>
> **This document still does not have the authority to change prices.**

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

Three items for the pricing owner:

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

**In the create flow.** Screen 1 shows a link under the idea box whenever drafts
exist: **Continue a draft (2)**. It opens a sheet listing them, newest first,
each row tappable straight back to where the user stopped. This is the second
entry point — a user who opens Create intending to resume should not have to go
to Library to find their way back.

**Nowhere else.** Drafts never appear in the feed, in search, or on a profile.

### Resume behavior

Tapping a draft returns the user to **exactly the screen they left**: screen 1, 2
or 3 for an `idea`, the story view at the next unwritten chapter for a
`drafting`, the publish sheet for a `complete`. Never to the top of the flow.

### Deletion

A draft can be deleted from Library and from the drafts sheet, with confirmation.
Deleting a `drafting` story warns that generated chapters are lost and that
credits are **not** refunded — they bought a generation that was delivered.

---

## 12. What changes in code

No schema migration is required. `whereAndWhen`, `moments`, character
`background` / `appearance`, `writingMode` and the draft state machine extend
existing types; the draft state table may want a column but can start as a
derived value.

### `expo/src/screens/CreateStudioScreen.tsx`

| Change | Detail |
|---|---|
| Split setup into two screens | Idea, then Shape |
| Remove the 40-char gate | `getSeedHint` deleted; `canGenerate` requires ≥ 1 char |
| Rename chip heading | `Try a premise` → `Try one` |
| Dissolve the toggle-chip row | Kids → mode toggle; queer and vampire → silent inference |
| Add the where-and-when chip | New optional field on `StudioDraft` |
| **Replace inline characters with the Craft character sheet** | Full screen, 4 fields, portrait, Reimagine / Edit / Delete / Save |
| Add the moments builder | New `moments: string[]`, capped, below characters |
| Add character-name tokens | Derived from `draft.characters` |
| Add the inference call | On Continue from screen 1, non-blocking, silent failure |
| Add See-an-example | Static, one per genre, with **Use this** |
| Replace the hint with the meter | Slot-based, on screen 3 |
| Add `Continue a draft (n)` | Screen 1, when drafts exist |
| More options | Chapters 3/7/15, chapter length, chapter art for 2–N. **No writing mode** — §15 |

### `backend/supabase/functions/_shared/`

| File | Change |
|---|---|
| `types.ts` | `whereAndWhen?`, `moments?`, `writingMode`, character `background` / `appearance` |
| `story-prompts.ts` | Two new layers — world (`whereAndWhen`) and beats (`moments`); character layer consumes background separately from appearance |
| `cover-prompts.ts` | Consume `whereAndWhen`. This is what stops covers reading as genre stock art |
| `image.ts` | Character portrait prompt from `appearance` + `description`; separate from the cover path |
| `validation.ts` | Clamp `moments`; enforce kids-mode spice removal; clamp chapters to the three allowed values (3 · 7 · 15); cap the cast at 3 |

### `expo/src/i18n/`

Every label in §1, §4 and §9 is a new key in EN, ES and PT. **`premise`, `plot`,
`topic`, `setting`, `arc`, `trope` and `seed` must not appear as values in any
locale file.** A lint rule enforcing that is cheap and worth adding.

### Library

Draft cards, the Draft badge, chapter progress, sort-by-last-edited.

---

## 13. Metrics

| Metric | Why it is here |
|---|---|
| Screen-1 → screen-2 continue rate | The one required field's real cost |
| Inference acceptance rate, per chip type | A chip corrected >50% of the time is a bad guess, not a bad field |
| Craft-character completion — fields filled per character | Tests whether Background and Appearance earn their boxes |
| Reimagine rate per character | High means the portrait prompt is wrong, not that users are fussy |
| Moments attach rate, adult vs kids | Decides whether moments graduate onto screen 1 |
| **Continue-tap drop-off by chapter**, and *Write the rest* usage | Says whether the per-chapter loop is engagement or friction, and at which chapter people stop steering |
| Share of Continues with an empty *What happens next?* box | If it dominates, steering is friction wearing a hat and the box should shrink |
| **Chapter-art attach rate** | The most important unresolved figure in the business model — §10.6 |
| Cover: generate vs regenerate vs upload vs keep-concept | Tells us whether cover generation is worth its credit |
| Chapters-selected distribution | Whether 15 and 30 are real or decorative |
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
   removed — see §9 — and 30 chapters is not offered. The lengths are 3 · 7 · 15.

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
| §9 **Chapters: 3 · 7 · 10 · 15 · 30** | **3 · 7 · 15**, default 3. A *planned length* that drives pacing and the finale, not a batch size. `planned_chapter_count` replaces `MAX_SERIES_CHAPTERS`, and `chapter_role: finale` is derived from position in the arc rather than from `chapter == 7`. |
| §4 **Maximum 4 characters** | **Maximum 3.** See item 1(b). |
| §6 **Inference** and its relationship to onboarding | Onboarding's W1→W2→W3 blueprint is the same surface under other names, and unifying them is **deferred**. The debt is accepted deliberately: the shared `StoryBrief` type is defined once now, consumed only by Create, so later unification is a mapping job rather than a rewrite of a live surface in three locales. |

---

## Decisions

### Vocabulary

1. **Inputs are labeled as second-person questions** — *Your idea · Where and
   when · Who's in it · Moments to include.*
2. **`Premise`, `Plot`, `Topic`, `Setting`, `Arc`, `Trope`, `Seed` and `Prompt`
   are banned from the interface** in all three locales. They may survive as
   internal identifiers.
3. **Katha's outputs are `Title`, an unlabeled paragraph, and `Chapters`.**
4. **One word, one meaning.** No word names both an input and an output.
5. **There is no trope control in adult mode.** The `tropeModules` prompt layer
   stays and is populated silently by inference. The confusion was the
   vocabulary, not the capability. If tropes ever become visible, the honest
   surface is the feed, not the create flow.

### Flow

6. **Three screens: Idea → Shape → Review and start.**
7. **One required free-text field, ever.**
8. **Review and start is retained** as its own screen; never collapsed into a
   single generate tap.
9. **Cost is shown twice** — balance in the header, price on the button.
10. **The 40-character gate is removed**, replaced by the slot-based
    brief-strength meter in which **Sparse is a legitimate choice.**
11. **Where and when is a chip, not a field** — real and load-bearing, feeding
    both the story prompt and the cover prompt, but never a blank box.
12. **The `🧒 Kids` / `🏳️‍🌈 LGBTQ+` / `🧛 Vampire` row is dissolved.**

### Inference

13. **Genre, where-and-when, characters, moments and the hidden trope layer are
    inferred** from the idea sentence and presented as editable values.
14. **The inference call is free.** It is scaffolding, not a generation.
15. **Inference failure is silent.**
16. **The character sheet arrives pre-filled.** This is inference's
    highest-leverage instance: four empty boxes get one lazy line, four
    pre-filled boxes get corrected into a real character.

### Characters

17. **Characters get a full-screen `Craft character` sheet**, modeled on Okudu's:
    Name · Description · Background · Appearance, a portrait, Reimagine, Edit,
    Delete, Save.
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
30. **Capped at five** (ten above 10 chapters), visibly.
31. **Zero state shows suggestion chips**, not an empty box behind a checkbox.
32. **Moments apply to both modes** — different suggestions, same field.

### Options

33. **Chapters: 3 · 7 · 15**, default 3 *(amended 2026-09-02; 10 and 30 dropped
    until the drop-off-by-chapter metric earns them)*. This is a planned length
    that drives pacing and the finale, not a batch size.
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
    trope row. Revisit if it grows past one value.

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
47. **Screen 1 carries a `Continue a draft (n)` link** — the second entry point,
    so resuming does not require a trip to Library.
48. **Resume returns to the exact screen the user left**, never the top of the
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
