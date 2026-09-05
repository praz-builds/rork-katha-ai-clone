# Onboarding Flow: source of truth

<!-- markdownlint-disable MD013 -->

> **This file is canonical.** Every onboarding screen, string, interaction,
> state, transition, event, and pre-paywall generation contract is defined here.
> If implementation or a prototype disagrees, this file is right.
>
> [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) is canonical for prices,
> credits, trials, grants, and store products. [`STORY_GENERATION_FLOW.md`](STORY_GENERATION_FLOW.md)
> is canonical for Create vocabulary. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) is
> canonical for visual language: type, colour, elevation, radius, and the
> control recipes built from them. Pricing wins on any conflict, and
> `DESIGN_SYSTEM.md` is subordinate to this file on anything behavioural.
>
> Reference frame: 390 × 844 pt, light theme only. Last revised 2026-09-02.
> *Inference* marks a decision not yet shipped.

---

## Summary

**Onboarding earns its asks by making the person feel something first.** A reader
recognizes their taste, reads a real opening, then feels the interruption a plan
can honestly remove. A writer sees a story become specific, changes its lead and
opening, then wants to keep reading it. Only then do we ask them to save the
specific shelf or blueprint and show the relevant paywall.

Read and **A bit of both** start on the reader path. The R4 bridge is the only
invitation into writing. It self-selects Writer; skipping it reaches Reader.
There is no cold writer upsell.

Cost discipline is binding: **one structured model call per submitted idea**,
zero best case, and no image generation. Starter chips use a precomputed concept
library. A typed idea receives blueprint, lead, all opening variants, and preview
prose in one response. Neither path spends user credits.

The bound is per submitted idea rather than per flow, and that wording is load
bearing. The writer's shaping call is fired when the user leaves W1, not when
they reach the wait, so it warms while they fill in shape, email and code. The
request needs only the idea and the shelf, both final at that point, and the
measured call takes about 8 seconds against the current model, which is time the
user would otherwise spend watching a loader. Two consequences follow and both
are accepted. A user who returns to W1 and genuinely changes the idea or the
shelf spends a second call, because the first response no longer describes the
story they are asking for. And abandoning at W2 now costs one call where it
previously cost zero. At the current rate a shaping call is about $0.0002, so
the spend is bounded by how often a person reconsiders one sentence.

The three-screen animated intro in
[`expo/src/screens/KathaOnboarding.jsx`](../expo/src/screens/KathaOnboarding.jsx)
is unchanged: Create, then Publish and Community, then Read. This specification
begins at **Get started**.

---

## 0. Governing principles

1. **Experience before questionnaire.** Every choice changes what follows. R1
   changes R2 and R4; W1 Shape visibly changes W2.
2. **Taste is demonstrated, not claimed.** Opening lines reveal taste better than
   a cover grid because Katha can name it back.
3. **Infer, don't ask.** The writer supplies one idea. Katha infers Genre, Where
   and when, and a lead, then exposes useful corrections.
4. **Use Create vocabulary.** The writer rehearsal is Idea / Shape / Review. It
   says **Your idea**, **Where and when**, and **Try one**. It never says
   Premise, Plot, Setting, Arc, Seed, or Prompt.
5. **Auth saves an artifact.** A1 comes after the aha and before all purchases
   and grants. It is never permission to continue.
6. **One source-blind choreography.** Library, model, slow model, and fallback
   concepts receive the identical W2 sequence.
7. **Preview proves ownership first.** The fade hides only extra prose. It never
   hides an entitlement, control, or the chosen lead name.
8. **No false scarcity.** The sole timer is the real, server-enforced 2:00 offer.
9. **Reduced motion.** Use the completed W2 composition after availability, not
   a spinner or flashing replacement.
10. **No em dashes in product copy.**

---

## 1. Frame and shared system

All values resolve to `expo/src/theme/`. Use `colors.bg` for page, `colors.surface`
and `colors.surface2` for cards, `colors.border` and `colors.borderStrong` for
borders, `colors.ink`, `colors.muted`, and `colors.tertiary` for text,
`colors.accent`, `colors.accentPressed`, and `colors.accentSoft` for primary and
selected states, and `colors.success` for checks. Reader uses the `colors.sepia*`
tokens. Concept palette always derives from `genreGradients[primaryGenre]`.

Use `spacing.xxxl` horizontal gutter and only existing spacing tokens. Primary
button height is `spacing.huge + spacing.sm`; it uses `radius.lg`. Option cards
use `radius.lg`, panels `radius.xl`, chips `radius.pill`; use `shadows.card`,
`shadows.raised`, or `shadows.overlay` only. Use `motion.fast`, `motion.base`,
and `motion.slow`; the named W2 choreography is 900 ms. Typography uses `type`:
`largeTitle`, `title`, `headline`, `body`, `subhead`, `caption`, and `reader`.
`fonts.brand` is wordmark/accent only; `fonts.reader` is prose only.
`letterSpacing: 0` except uppercase eyebrows at `0.08em`.

Reserve safe area plus `spacing.lg` under fixed CTAs. Scroll content ends with
`spacing.huge + spacing.xxxl` inset. All targets have a `spacing.huge` high hit
area. The visible Back control begins at S1, is labelled **Back**, and restores
all state. Do not use progress percentages or numbered steps because path lengths
differ. Do not autofocus W1 or a chip.

> **SHIPPED DEVIATION: the writer path draws a progress row.** The approved auth
> design has one, so the email and code screens carry it, and the preview screen
> does too because its own design does. It is drawn as short rounded bars, never
> as a number or a percentage: nothing on screen says "3 of 6". The count is
> **six** — idea, details, email, code, preview, paywall — and it is announced to
> assistive technology as "Step 3 of 6" because a progressbar role without a
> position is worse than no role at all.
>
> The rule above holds everywhere the length is genuinely variable, which is the
> reader path. The writer path after the removal of W2 is a fixed six, so the
> objection it was written against does not apply. If the reader path ever
> merges into this row, the rule wins and the row goes.
>
> The idea and details screens still draw no dots, so the row appears at step 3.
> That is a known inconsistency, left because adding a progress row to a
> signed-off screen is a decision about that screen.

*Inference:* retain anonymous state for 24 hours only. It includes IDs,
selections, idea, shape, concept ID, lead override, and opening choice. Never put
idea, prose, title, name, or email in analytics. After A1, persist the shelf or
blueprint as a free authenticated onboarding artifact.

---

## 2. Flow diagram

~~~text
INTRO ×3, unchanged
Create → Publish / Community → Read
                         │
                    Get started
                         │
S1 PURPOSE: Read / Write / A bit of both
   │                          │
   │                          └── A bit of both follows READ
   ├── READ → R1 Taste → R2 Read → R3 Break → R4 Shelf
   │                                                   │
   │                  Keep exploring ──────────────────┼── A1 Save → Reader paywall
   │                                                   │
   │                  And start one of your own ───────┘
   │                                                   │
   └── WRITE ───────────────────── W1 Idea → W2 Blueprint → W3 Preview
                                                             │
                                                   A1 Save → Writer paywall
                                                             │
                                                       decline
                                                             │
                                            One-time offer, once ever, 2:00
                                                             │
                        accept → app     decline / expiry → grant 10 credits
                                                             │
                                                       WELCOME → app
~~~

A main paywall purchase enters app. Only declined or expired offer grants the
authenticated welcome bonus. Reader and Writer paywalls merge only at OF.

---

## 3. S1: Purpose

| Item | Specification |
|---|---|
| Header | **What brings you to Katha?** |
| Sub | **We’ll start where you’ll feel it most.** |
| Control | Three full-width single-select cards |
| CTA | **Continue**, disabled until selected |

| ID | Icon | Title | Supporting copy |
|---|---|---|---|
| `read` | 📖 | **Read stories** | **Find your next world.** |
| `write` | ✍️ | **Write stories** | **Turn one idea into something you can shape.** |
| `both` | ✨ | **A bit of both** | **Read widely. Start something of your own.** |

Selected is `colors.accentSoft` with `colors.accent` border and trailing check.
Read goes to R1; Write goes to W1; Both goes to R1 with `bridge_eligible: true`.
Back restores selection.

**Instrumentation:** `onboarding_purpose_selected { purpose }`;
`onboarding_purpose_continued { purpose }`.

---

## 4. R1: Taste, not tick-boxes

| Item | Specification |
|---|---|
| Header | **Which of these makes you want to keep reading?** |
| Sub | **Pick three. Go with the pull, not the label.** |
| Control | Eight text-only multi-select cards. No cover, genre label, author, audio, or model call. |
| CTA | **Show me what you found**, enabled at exactly three |

| ID | Exact opening sentence | Hidden taste |
|---|---|---|
| `clock` | **At midnight, every clock in Bellwether House began counting backward.** | gothic mystery |
| `letter` | **The letter on Mara’s wedding day was signed by the man who had left her seven years ago.** | slow-burn romance |
| `orbit` | **By breakfast, the moon had moved close enough to cast a second shadow across the kitchen.** | science fiction |
| `well` | **The well behind the chapel answered only when someone asked it a question they already feared.** | folk horror |
| `map` | **I found the map inside a fish, folded between its silver bones.** | adventure fantasy |
| `train` | **On the train to Jaipur, my grandmother handed me a stranger’s photograph and said, “Don’t let him get off.”** | historical suspense |
| `comet` | **The day my ex became mayor, a comet landed in my laundromat.** | romantic comedy |
| `balcony` | **When the building across from mine caught fire, the woman on the balcony waved at me like we had an appointment.** | contemporary drama |

Cards are full-width `type.body`, `colors.surface`, `radius.lg`, and
`spacing.lg` padding. A fourth tap retains existing picks, uses `motion.fast`
nudge, and announces **Choose three to continue.**

The first chosen line is `strongest_taste_id`, except the following exact payoff
copy names the pair. An unlisted combination says
**You went for {first hidden taste} and {second hidden taste}.** with metadata
hyphen replaced by space.

| Combination | Exact R2 payoff |
|---|---|
| gothic mystery + slow-burn romance | **You went for gothic mystery and slow-burn romance.** |
| science fiction + adventure fantasy | **You went for strange worlds and high-stakes adventure.** |
| historical suspense + folk horror | **You went for old secrets and a dark turn.** |
| romantic comedy + contemporary drama | **You went for sharp feelings and people who complicate them.** |

CTA enters R2; Back retains all selections.

**Instrumentation:** `onboarding_taste_toggled { taste_id, selected,
selected_count }`; `onboarding_taste_completed { taste_ids, strongest_taste_id }`.
Never send sentence text.

---

## 5. R2: Start the story

| Item | Specification |
|---|---|
| Header band | Wordmark top-left, uppercase eyebrow **PICKED FOR YOU** |
| Payoff | Exact R1 payoff |
| Surface | Production reader, not a preview card |
| CTA | **Keep reading**, available when final paragraph is 70% visible |

R2 uses `colors.sepia`, `type.reader`, a 58 to 64-character measure, `spacing.xxl`
inset, and ordinary vertical scroll. Present: story title, chapter title, actual
scroll, unobtrusive **Aa**, bookmark, CTA. Absent: cover, comments, reactions,
author, audio upsell, price, account prompt, paywall copy, tabs.

The strongest signal selects a static, hand-curated, 230 to 270 word opening.
Every opening starts with its exact R1 sentence, has three to six paragraphs,
contains a genuine scene, and ends on a live hook. It is a bundled editorial
asset, not model output, and cannot be shortened into a four-sentence teaser.

| Strongest ID | Story | Chapter |
|---|---|---|
| `clock` | *Bellwether House* | **The Backward Hour** |
| `letter` | *The Day Before Always* | **The Envelope** |
| `orbit` | *Second Shadow* | **Low Moon** |
| `well` | *The Well at St. Orla’s* | **A Question for the Dark** |
| `map` | *The Cartographer’s Catch* | **The Silver Map** |
| `train` | *The Photograph at Platform Nine* | **The Man in White** |
| `comet` | *Laundromat Meteorology* | **A Small Public Disaster** |
| `balcony` | *The Woman Across the Street* | **Smoke Signal** |

The editorial asset contract is complete: eight records at 230 to 270 words,
mapped one-to-one above. This `clock` record defines exact density and finish:

> At midnight, every clock in Bellwether House began counting backward.
>
> The mantel clock gave the first small cough of its brass throat. Then the clock
> over the kitchen door answered, and the one in the upstairs nursery, and the
> watch on my wrist. Twelve hands shuddered, lifted, and began their slow retreat
> through the hour.
>
> I stood barefoot in the hall with Grandmother’s key cold in my palm. The house
> had been empty for six months, except for me and the rain worrying at its slate
> roof. I had come to list the silver, close the curtains, and prove that I did
> not believe the stories people told about Bellwether after dark.
>
> From behind the green door came three knocks. Not loud. Patient. The key was for
> that door. Grandmother had worn it around her neck all her life, then pressed it
> into my hand at the funeral. “If the house asks,” she whispered, “make it wait
> until morning.”
>
> The clocks ticked backward. Eleven fifty-nine. Eleven fifty-eight. A damp
> handprint appeared beside the door. I raised the key. On the other side,
> someone sighed my name in Grandmother’s voice.

Keep reading enters R3; Back returns R1. Returning from R3 restores opening and
scroll position.

**Instrumentation:** `onboarding_reader_opening_started { taste_id, opening_id,
source: static }`; `onboarding_reader_opening_scrolled { opening_id, depth:
50|90 }`; `onboarding_reader_opening_completed { opening_id }`.

---

## 6. R3: The break

| Item | Specification |
|---|---|
| Header | **A small pause between chapters.** |
| Body | **Free reading includes the occasional Katha break. A plan lets the story keep going.** |
| CTA | **Continue to your shelf** |
| Dismiss | **Dismiss** and upper-right close, both immediate |

R3 is a full-screen, Katha-owned interruption. It is never a third-party ad unit:
no advertiser, external logo, install action, product placement, targeting,
auction, pixel, or simulated ad disclosure.

Use `colors.canvas`, centered `colors.surface` paper panel, `radius.xl`,
`shadows.overlay`, wordmark, and abstract reader-paper silhouettes in selected
`genreGradients` palette. Shapes are not covers and use no generated image.
Dismiss sits top-right from frame one. The screen enters with `motion.base` and
is immediately dismissible. No forced viewing, countdown, auto-close, or
frequency claim. *Inference:* later frequency may adapt to reader behavior, but
every break remains immediate and house-styled.

Either control enters R4. Back restores R2 scroll.

**Instrumentation:** `onboarding_house_break_shown { placement:
onboarding_between_chapters, opening_id }`;
`onboarding_house_break_dismissed { method: cta|close, elapsed_bucket }`.

---

## 7. R4: The shelf, now earned

| Item | Specification |
|---|---|
| Header | **Where to next?** |
| Sub | **More of what pulled you in.** |
| Controls | Four recommended cards and full-width bridge card |
| CTA | **Keep exploring** |

This is recommendation after reading, not catalogue claim before it. Use existing
catalogue or seeded art, never generation. *Inference:* until a recommender owns
this contract, each taste maps deterministically to four content IDs; do not make
a model or recommendation call.

Bridge card: `colors.accentSoft`, `colors.accent`, `radius.xl`, selected palette
edge. Exact content:

> **And start one of your own**
>
> **You have the beginning. Katha can help you find the shape.**
>
> **Try writing**

Try writing enters W1 with `entry: reader_bridge`, no prefill, no selected chip,
no call. Keep exploring enters A1 with `paywall_kind: reader`. Bridge establishes
Writer only after W3. Back goes R3.

**Instrumentation:** `onboarding_shelf_shown { taste_id, content_ids }`;
`onboarding_shelf_card_opened { content_id }`;
`onboarding_writer_bridge_tapped { purpose, taste_id }`;
`onboarding_shelf_completed { taste_id }`.

---

## 8. W1: Idea

| Item | Specification |
|---|---|
| Header | **What’s your story about?** |
| Sub | **A sentence is enough. Katha takes it from there.** |
| Label | **Your idea** |
| Placeholder | **A woman inherits a boarded-up house and finds letters that arrive before they are written.** |
| Input | Multiline `n / 1000`, no minimum-length gate |
| Starter heading | **TRY ONE** |
| Control | **Shape** segmented control |
| CTA | **Find the shape** |

One box only. No byline, genre, Where and when, characters, goal, obstacle,
friction, or reading-preference field. Field is `colors.surface`,
`colors.borderStrong` on focus, `radius.lg`, `spacing.lg`, `type.body`, minimum
height `spacing.huge + spacing.huge + spacing.xl`. It does not autofocus or
shrink around chips. Counter starts `0 / 1000`; at limit announce **Your idea can
be up to 1000 characters.**

Try one rail is flush-left at gutter and bleeds right only with right
`spacing.xxxl` inset. It shows a partial next chip. It remains peer to the field.

| `starter_id` | Exact chip |
|---|---|
| `house_letters` | **A house with letters from tomorrow** |
| `rival_bakery` | **Two rivals save a failing bakery** |
| `moon_city` | **A city beneath a broken moon** |
| `missing_violin` | **A missing violin in a small town** |
| `last_train` | **The last train knows your name** |
| `ocean_poem` | **A poem from the sea to someone who left** |

A chip fills field and sets `idea_source: starter`. Any edit becomes `typed`; it
is starter-backed only when normalized field text exactly matches canonical chip.
Never preselect a chip.

| ID | Label | Visible W2 consequence |
|---|---|---|
| `chapter` | **Chapter** | Four beats under **Chapters** |
| `short_story` | **Short story** | One beat under **Chapters** |
| `poem` | **Poem** | No **Chapters** section |

Chapter is default. Shape is selected `colors.accentSoft` and `colors.accent`;
inactive is `colors.surface2` and `colors.border`. CTA enters W2 intentional
waiting. Back restores R4 for bridge entry or S1 direct Write.

**Instrumentation:** `onboarding_idea_started { entry }`;
`onboarding_idea_changed { length_bucket }`;
`onboarding_starter_selected { starter_id }`;
`onboarding_shape_selected { shape }`;
`onboarding_idea_submitted { idea_source, length_bucket, shape }`.

---

## 9. W2: Blueprint and two acts of authorship

> **SHIPPED DEVIATION, 2026-09-06: W2 no longer exists as a screen.** Its
> content was merged into W3 and the standalone blueprint screen was deleted.
>
> W2 was a toll gate. It showed a summary of a story the reader had not been
> allowed to read yet, asked them to approve it, and put the payoff they had
> just waited through the crafting loader for one press further away — behind a
> button reading "See the preview". The one question it really asked, *is this
> right?*, cannot be answered before you have read a sentence of the thing.
>
> What survived the merge, and where it went: the title, the shelf, the world
> and the lead are the concept block at the top of W3; the chapter plan is a
> numbered read-only list under them; the **CONCEPT** eyebrow is on the cover
> placeholder. What did not survive: **beat editing**, and the **Try another**
> control described below. Both are a deliberate loss, not an oversight. Beats
> are rewritten in the studio, which is what W3's first entitlement line
> promises; Try another had no home once the screen it lived on was gone, and
> §16's one-call budget means its supply was always finite anyway.
>
> This section is left standing because its vocabulary rules (Chapters, never
> Arc or Premise), its instrumentation and its variant semantics are still
> canonical wherever those facts are rendered. Read it as the specification of
> the *blueprint content*, not of a screen. §10 is where that content is shown.

W2 is **Shape**. Use only **Title**, unlabeled shaped description, **Who’s in it**,
**Where and when**, and **Chapters**. Never use Premise, Plot, Setting, Arc,
Seed, or Prompt.

| Item | Specification |
|---|---|
| Waiting heading | **A story can begin anywhere.** |
| Waiting sub | **Hold on to the part that feels like yours.** |
| Revealed heading | **Your idea just became a story.** |
| Revealed sub | **Change the parts that make it yours.** |
| Primary CTA | **See the preview** |
| Secondary | **Try another** |

> **Amended 2026-09-06, then overtaken the same day.** The revealed heading was
> **Here's the shape of it.** It was corrected here to **Your idea just became
> a story.** to match what had shipped, on the reasoning that this was the
> payoff moment of the writer path and "the shape of it" described a diagram
> rather than the thing the reader had just made.
>
> That reasoning was right and it is what removed the screen. If this is the
> payoff moment, it should not be a summary with a button to go and see the
> payoff. The heading, the sub and the **See the preview** CTA in the table
> above no longer render anywhere; the waiting copy still does, on the crafting
> loader. §10 carries the reveal now, and the story's own title is its heading.
> The table is kept because the copy is worth knowing was tried.

### 9.1 Waiting and choreography

Show intentional editorial holding: waiting copy, `colors.surface` concept-card
silhouette with three static rules, `colors.surface2` chip stack. No spinner,
percentage, progress bar, elapsed time, generation claim, or source-specific copy.
It must look intentional at 200 ms and 3 seconds.

Submit typed call or library lookup on W1 CTA. Do not reveal until valid concept.
Timeout, failure, and invalid response silently select fallback. No error,
apology, retry, or explanation.

After concept availability and at least `motion.base` on W2, always run this exact
900 ms sequence, including a 0 ms library result:

| Time | Reveal |
|---|---|
| 0–150 ms | Chips settle with opacity and 4 pt rise |
| 150–300 ms | Title |
| 300–450 ms | Unlabeled description |
| 450–600 ms | Who’s in it, lead row, Where and when |
| 600–750 ms | Four, one, or zero Chapters beats from W1 Shape |
| 750–900 ms | Opening choices, Try another, and CTA enabled |

Staged choreography claims nothing and is allowed. Spinners, progress, percentages,
and fake generation language are forbidden because they would lie on precomputed
path. In reduced motion, show final composition at same availability gate.

### 9.2 Recast the lead

Concept card has uppercase **CONCEPT**, title, description, and palette from
`genreGradients[primaryGenre]`, never constant orange. Who’s in it has a tappable
lead name initial `lead.default_name`, role, edit affordance, name input, and
**Save name**. Accept one to 40 visible trimmed characters; collapse repeated
whitespace. Empty save keeps default.

Save substitutes `{{lead_name}}` locally in description, Where and when, role,
beats, every opening variant, and W3 prose. `{{lead_name_possessive}}` renders
`Name’s`, including a name ending in s. It is string substitution only: no model,
credit, or two-second generation; completes in `motion.base`. Unchanged uses
default exactly.

Where and when is inferred and read-only here. Do not add a third authorship task.

Shape is exact: Chapter four numbered beats; Short story one; Poem no Chapters
heading, empty state, or placeholder.

### 9.3 Choose opening and Try another

Under **OPENING**, show radio rows in exact order:

1. **The moment they arrive**
2. **The night before**
3. **Twenty years earlier**

First is default. Tapping substitutes precomputed `opening_variants[id]` into W3
with `motion.base` cross-fade, no model, no cost. Announce **Opening changed to
{label}.**

Try another is quiet `colors.muted` text with `spacing.huge` hit area. It advances
through ordered variants, never shuffles, never returns rejected concept during
session, has **no counter and no cost**, and replays full choreography. Back from
W3, or back to W1 without idea or Shape change, returns the exact concept, name,
and opening. Quiet reshuffle is forbidden.

**Exhaustion.** The variants are finite — a bundled starter has at least two, and
the typed path returns one concept per call — so the control *does* run out, and
the three prohibitions above decide what happens when it does. It may not repeat
a rejected concept, it may not shuffle, and §16 forbids a second model call. The
only remaining behaviour is therefore forced rather than chosen: **when the last
variant is shown, Try another disappears.** No disabled state, no counter, no
"that's all" toast — the control is simply not rendered, exactly as it is not
rendered when a starter has one variant.

The way back to new concepts is the idea box, which is where the user has the
most control anyway: editing the idea or changing Shape re-enters W2 with a new
ordered set and restores the control. *(This resolves the contract's "no limit"
wording, which was true of counters and cost but never of the supply.)*

**Instrumentation:** `onboarding_blueprint_wait_shown { idea_source, shape }`;
`onboarding_blueprint_ready { concept_source: library|model|fallback,
ready_latency_bucket, shape, primary_genre }`;
`onboarding_lead_name_saved { changed, length_bucket }`;
`onboarding_opening_selected { opening_id }`;
`onboarding_blueprint_try_another { from_variant, to_variant }`;
`onboarding_blueprint_preview_started { concept_id, lead_name_changed }`.

---

## 10. W3: Preview

W3 is now the **only** screen between the crafting wait and the paywall, and it
carries what §9's screen used to carry. Order down the page: the story title,
then a row of the concept cover beside the shelf/world/lead byline and the
chapter plan, then the opening prose in a card tagged **PREVIEW**, then the
entitlements under **YOU CAN ALWAYS**, then the CTA.

**Why the title is above the cover rather than beside it.** The design draws
them side by side, which is the book-listing convention, and it was built that
way first. It does not survive measurement: a 94pt cover and a `spacing.lg` gap
leave 216pt of the 326pt column, and `onboardingType.title` at 28 sets about
fifteen characters to the line there, so a four-word title breaks into four
ragged lines. The alternative was a smaller title, which is a fifth size and the
exact move [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §3.0 was just corrected for.
Arrangement moved so type could stay.

| Item | Specification |
|---|---|
| Header | *None.* The story's own title is the screen's one heading, on `onboardingType.title`. |
| Byline | Shelf · Where and when · Lead, middot-joined, `onboardingType.helper`, empty parts dropped |
| Plan | Chapters as `01`, `02`, … in `colors.accent` beside each beat. Read-only. |
| Prose | Active `preview_body` in real reader surface, `type.reader` |
| Entitlement head | **YOU CAN ALWAYS** |
| CTA | **Save my story** |
| Concept eyebrow | **CONCEPT**, on the cover placeholder |

**Why there is no header.** "This is the beginning." sat above a screen whose
subject already names itself. Setting both would make this the only screen in
the flow with two sentence-case headings, against the one-title rule in
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) §3. The story's title is the heading.

**The cover is a placeholder, and must read as one.** A real cover is a paid,
generated image that does not exist at this point in the flow. The placeholder
is a dark portrait card at the library's own 1:1.48 proportion, carrying the
word CONCEPT and an echo of the title. It is hidden from assistive technology,
because everything on it is stated in full beside it.

W3 is **Review**. It is not a locked screen: no lock, curtain, price, paywall
button, or interruption in prose.

Render 120 to 180 words full contrast before `fade_after_paragraph`. Active lead
name must occur in first two paragraphs before boundary. At boundary use
`motion.slow` vertical transparent-to-`colors.bg` gradient at least
`spacing.huge + spacing.huge + spacing.xxl` high. Next paragraph starts inside
gradient on a live scene hook. Never fade after four sentences, mid-unremarkable
paragraph, or a summary. Gradient ends in concept card with own palette, title,
unlabeled description, Where and when, active lead, selected opening, and
**CONCEPT**. It updates locally after W2 changes.

Below fade, always show full-contrast `colors.surface` entitlement card using
`type.subhead`, `colors.ink`, `colors.success` checks:

- **Edit every word by hand, as much as you like**
- **3 free AI redrafts for every chapter**
- **20 free paragraph edits for every chapter**
- **1 free cover retry after a paid cover**
- **Your stories are yours to save, publish, unpublish, or delete**

Rows never fade, dim, hide, or move behind paywall. They are the answer to *am I
stuck with this*, and holding them behind the ask is what turns a preview into a
trap. Save my story enters A1 with `artifact_kind: blueprint`,
`paywall_kind: writer`. **Back now returns to W1b (the details screen), not to
W2**, which no longer exists; the brief, the plan and the verified session all
survive the round trip, and going forward again re-uses the warm request rather
than buying a second model call.

**Instrumentation:** `onboarding_preview_shown { shape, opening_id,
lead_name_changed, visible_word_bucket }`;
`onboarding_preview_fade_reached { concept_id }`;
`onboarding_preview_entitlements_seen { concept_id }`;
`onboarding_preview_save_tapped { concept_id }`.

---

## 11. A1: Save your progress

A1 follows aha and precedes all purchase/grant. It saves the artifact, not an
administrative profile.

| Artifact | Header | Sub | Background art |
|---|---|---|---|
| Shelf | **Save your shelf** | **Keep these next reads waiting for you on every device.** | Four actual shelf-card silhouettes softened behind `colors.bg`; no generic stars, quill, or books. |
| Blueprint | **Save “{title}”** | **Keep the shape you made, including {lead name}.** | Current concept card enlarged behind panel with own palette and active name; no portrait or cover. |

`colors.surface`, `radius.xl`, `shadows.overlay` auth panel order:

1. **Continue with Apple**
2. **Continue with Google**
3. **or**
4. Email input: **you@example.com**
5. **Continue with email**
6. **Already have an account? Sign in**

Email code screen: **Check your inbox**, **Enter the 6-digit code we sent to
{email}.**, **Verify and continue**, **Resend code**, **Use a different email**.
Provider errors are safe/actionable inside panel and retain state. Existing-account
sign-in keeps artifact. Never advance unauthenticated.

Success saves artifact then routes Reader/Writer only by route state. Back restores
R4 or W3.

**Instrumentation:** `onboarding_auth_shown { artifact_kind, paywall_kind }`;
`onboarding_auth_provider_tapped { provider }`;
`onboarding_auth_completed { provider, artifact_kind }`;
`onboarding_auth_failed { provider, error_code }`. Never send email or content.

---

## 12. Reader paywall

Reader is an experience bundle, not an audio plan. It does not volunteer that
reading is free and never implies payment is required to read.

| Item | Exact copy |
|---|---|
| Eyebrow | **KATHA READER** |
| Header | **Stay with the story.** |
| Sub | **Read without interruptions, take stories offline, unlock audio, and keep credits ready for what you make next.** |
| Annual badge | **3-DAY FREE TRIAL** |
| Annual | **Reader yearly** / **$29.99 per year** / **20 credits every month** |
| Weekly | **Reader weekly** / **$4.99 per week** / **5 credits** |
| Monthly | **Prefer monthly? Reader monthly is $8.99 per month with 20 credits every month.** |
| Annual CTA | **Start my 3-day free trial** |
| Weekly CTA | **Choose Reader weekly** |
| Dismiss | **Not now** and large close, both from frame one |

Annual is selected/default. Weekly is visible immediately and has no trial.
Monthly is disclosed below, not led. RevenueCat supplies actual display price,
renewal, and eligibility. Feature rows exactly:

- **Read without interruptions**
- **Take stories offline**
- **Unlock chapter audio and keep it**
- **Credits for creating and listening**

Never say unlimited creation, included audio, premium voices, priority generation,
ad-free, or catalogue count. Close target is `spacing.huge`; no confirm-close
sheet. Purchase enters app; decline enters OF. Paywall presentation never grants.

**Instrumentation:** `onboarding_paywall_shown { kind: reader, entry, product_id,
trial_eligible }`; `onboarding_paywall_product_selected`;
`onboarding_paywall_purchase_tapped`; `onboarding_paywall_purchase_result`;
`onboarding_paywall_declined`.

---

## 13. Writer paywall

Writer is strict Reader superset, using saved concept as proof.

| Item | Exact copy |
|---|---|
| Eyebrow | **KATHA WRITER** |
| Header | **“{title}” is ready to become yours.** |
| Sub | **Keep shaping {lead name}’s story, with every Reader benefit included.** |
| Annual badge | **3-DAY FREE TRIAL** |
| Annual | **Writer yearly** / **$49.99 per year** / **50 credits every month** |
| Weekly | **Writer weekly** / **$6.99 per week** / **10 credits** |
| Monthly | **Prefer monthly? Writer monthly is $12.99 per month with 50 credits every month.** |
| Annual CTA | **Start my 3-day free trial** |
| Weekly CTA | **Choose Writer weekly** |
| Dismiss | **Not now** and large close, both from frame one |

Concept card below hero retains its palette and **CONCEPT**. Feature rows:

- **Everything in Reader**
- **Read without interruptions**
- **Take stories offline**
- **Unlock chapter audio and keep it**
- **50 credits every month on yearly or monthly**

Annual default/trial; weekly visible/no trial; monthly below. Never call Writer
unlimited generation and do not create text, cover, character, audio, or credit
reservation on arrival. Purchase enters app, decline OF, blueprint remains saved.

**Instrumentation:** Reader event family with `kind: writer`, `concept_id`,
`shape`, `opening_id`, `lead_name_changed`; never title/name.

---

## 14. OF: One-time offer

A single Reader yearly offer follows decline of either main paywall. It is never
Home, push, recovery, or a later marketing surface.

| Item | Exact copy |
|---|---|
| Eyebrow | **ONE-TIME OFFER** |
| Header | **One more way to stay with the story.** |
| Plan | **Reader yearly** |
| Price | **$19.99 for your first year** |
| Renewal | **Then $29.99 per year.** |
| Deadline | **You’ll never see this again.** |
| Timer | **2:00**, `m:ss` |
| CTA | **Choose this offer** |
| Dismiss | **No thanks** and large close, from frame one |

Card uses `colors.surface`, `radius.xl`, `shadows.raised`, quiet book-stack
geometry in theme colors. No pulsing CTA, “save today,” percentage, stock, or
scarcity except true deadline.

Server owns `offer_seen`, `offer_claimed`, `offer_expires_at`, eligibility, and
SKU disable. Client timer is presentation. If unavailable/ineligible/expired,
skip directly to decline. At zero: disable CTA, **Offer expired**, server-disable,
then advance after `motion.base`. Dismiss permanently disables identically.
Purchase uses `ai.katha.sub.reader.yearly.offer` then app. Decline/expiry runs
the idempotent 10-credit welcome grant, then WELCOME. No reshow.

**Instrumentation:** `onboarding_offer_shown { eligibility, expiry_bucket }`;
`onboarding_offer_purchase_tapped`; `onboarding_offer_purchase_result`;
`onboarding_offer_declined { method }`; `onboarding_offer_expired`.

---

## 15. WELCOME

| Item | Exact copy |
|---|---|
| Header | **Welcome to Katha.** |
| Sub | **Your next chapter starts here.** |
| CTA | **Open Katha** |

Shared quiet greeting after offer decline/expiry. Uses wordmark, `colors.bg`, small
`colors.accentSoft` celebration mark. No number, balance, price, plan comparison,
grant explanation, disclaimer, or “reading is free.” In-app messaging announces
balance after landing.

Backend grants before this screen with `welcome:{user_id}`. WELCOME does not wait
on or claim balance. Reader enters Home with shelf saved; Writer enters Create
with blueprint saved.

**Instrumentation:** `onboarding_welcome_shown { grant_path:
offer_declined|offer_expired }`; `onboarding_completed { purpose, terminal_route,
paywall_kind, subscription_outcome }`.

---

## 16. Pre-paywall concept contract

This interface contract, not prompt prescription, makes W2/W3 deterministic.

Starter lookup accepts `starter_id`, `shape`, `variant_index`, returns full
`OnboardingConcept`, and is bundled/cached. Each starter has ordered at least two
concepts. Try another increments; never randomizes.

Typed request accepts only `idea`, `shape`, `locale`, and makes one structured
call. Server owns provider, timeout, validation, fallback. No separate title,
lead, opening, preview, image, or rewrite call. Client gets:

~~~json
{
  "concept_id": "opaque-id",
  "primary_genre": "mystery",
  "title": "string",
  "description_template": "string with {{lead_name}}",
  "where_and_when_template": "string with {{lead_name}}",
  "lead": { "default_name": "string", "role_template": "string with {{lead_name}}" },
  "beats_by_shape": {
    "chapter": ["string", "string", "string", "string"],
    "short_story": ["string"],
    "poem": []
  },
  "opening_variants": [
    { "id": "arrival", "label": "The moment they arrive", "preview_body_template": "paragraph-delimited {{lead_name}} text", "fade_after_paragraph": 2 },
    { "id": "night_before", "label": "The night before", "preview_body_template": "paragraph-delimited {{lead_name}} text", "fade_after_paragraph": 2 },
    { "id": "twenty_years_earlier", "label": "Twenty years earlier", "preview_body_template": "paragraph-delimited {{lead_name}} text", "fade_after_paragraph": 2 }
  ]
}
~~~

Every preview has 120 to 180 words before boundary, lead token before boundary,
and a following live-hook paragraph. Chapter has exactly four beats, short story
one, poem none. Invalid/unavailable output silently returns same-shape fallback
with internal `concept_source: fallback`, never visible.

The rehearsal creates no `stories`, `chapters`, `characters`, `covers`, audio,
generation operation, or ledger row. Auth saves editable blueprint. Turning the saved blueprint into a real story follows the standard flow and
is priced there: **3 credits to start** — the cast, chapter 1's words and
chapter 1's art, which becomes the cover — then **1 credit per further
chapter**, or 2 when chapters are illustrated. See
[`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §1.

---

## 17. Prohibitions

Never ship: genre picker/count; read/listen/mix; separate writer-goal cards;
“What usually stops you?”; author byline; model call on reader path, starter,
name recast, opening choice, shelf ranking, or visual; image generation;
W2 spinner/progress/fake work/source tell; random returned concept/counter/cost;
W3 lock/curtain/early or generic-name fade/faded entitlements; generic A1 art;
audio-only Reader; Writer without Reader-superset claim; unlimited generation;
reading-paywall implication; hidden/delayed/confirmation-gated dismiss; any timer
but OF; anonymous purchase; any anonymous grant outside the rate-limited guest
bootstrap defined in `CREDITS_AND_PRICING.md` §9; raw text in telemetry; or a
parallel design system.

---

## 18. Analytics event table

| Event group | Required safe properties |
|---|---|
| Purpose | `purpose` |
| Taste | `taste_id`, `selected`, `selected_count`, `taste_ids`, `strongest_taste_id` |
| Reader | `opening_id`, `taste_id`, `depth`, `method`, `elapsed_bucket` |
| Shelf | `taste_id`, `content_ids`, `content_id`, `purpose` |
| Idea | `entry`, `length_bucket`, `starter_id`, `shape`, `idea_source` |
| Blueprint | `concept_source`, `ready_latency_bucket`, `concept_id`, `opening_id`, `changed`, variant IDs |
| Preview | `shape`, `opening_id`, `lead_name_changed`, `visible_word_bucket`, `concept_id` |
| Auth | `artifact_kind`, `paywall_kind`, `provider`, `error_code` |
| Paywall | `kind`, `entry`, `product_id`, `trial_eligible`, `result_code` |
| Offer | `eligibility`, `expiry_bucket`, `method`, `product_id`, `result_code` |
| Completion | `grant_path`, `purpose`, `terminal_route`, `paywall_kind`, `subscription_outcome` |

Events use the exact `onboarding_*` names stated in each screen section. Use only
enums, IDs, and coarse duration/length buckets. Production failures follow the
error logging contract and contain identifiers/enums only.

---

## 19. Conflicts with canonical

1. **Story Generation Flow §10.6 proposes different multi-chapter pricing.**
   Pricing wins: a full chapter is 3 credits. Onboarding shows no competing
   price, creates no paid asset, and does not create a full chapter.
2. **KathaOnboardingFlowV2 is stale implementation, not authority.** Its prices,
   product IDs, claims, flow order, genre picker, mode/goal questions, and
   author-name screen do not govern. Its warm visual language and auth pattern are
   reference only.
3. **Pricing §6's old prose diagram predates decisions 29–29f.** Those decisions
   govern the break, Both reader-first path, A1 placement, paywalls, offer, and
   entitlement visibility described here.

---

## Decisions

1. **Intro remains unchanged.**
2. **Purpose is the sole branch; Both starts reader-first.**
3. **Every retained question changes a downstream surface.**
4. **R1 uses eight static lines and exactly three picks.**
5. **R2 is real reader UI with about 250 static words matched to strongest taste.**
6. **R3 is an immediately dismissible, house-styled free-tier break.**
7. **R4 earns its shelf and holds the only writer bridge.**
8. **W1 is one Idea field, Try one, and Shape, with no minimum gate/autofocus.**
9. **Chips are flush-left, right-bleeding, and never displace the field.**
10. **Shape visibly changes blueprint beats.**
11. **W2 always runs one 900 ms source-blind choreography.**
12. **Fallback is silent.**
13. **Lead recast is local string substitution with no credit or call.**
14. **Opening options are precomputed and steer the preview in place.**
15. **Try another is ordered, free, unlimited, and never returns rejection.**
16. **Back returns the identical concept.**
17. **W3 shows 120 to 180 readable words and chosen name before fade.**
18. **Entitlements never fade.**
19. **A1 saves artifact before paywall and authenticates with Apple/Google/email.**
20. **Reader sells no interruptions, offline, audio, credits, not audio alone.**
21. **Writer explicitly includes every Reader benefit.**
22. **Yearly default/trial; weekly visible/no trial; monthly below; dismiss obvious.**
23. **OF is Reader yearly $19.99 first year, then $29.99, one real 2:00 showing.**
24. **10 credits follow only authenticated offer decline/expiry.** The separate
    guest bootstrap grant stays at 3 under its own operation key; see
    `CREDITS_AND_PRICING.md` §6.
25. **WELCOME has no number or disclaimer.**
26. **Onboarding costs at most one model call and no image calls.**
