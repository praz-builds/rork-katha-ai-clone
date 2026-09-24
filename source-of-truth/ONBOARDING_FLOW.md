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
> Reference frame: 390 × 844 pt, light theme only. Last revised 2026-09-14.
> *Inference* marks a decision not yet shipped.

---

## Summary

**Onboarding earns its asks by making one character exist.** The person is shown
three portraits fanning open, types a name and writes a line about
how someone looks, gives an email so the portrait has somewhere to live, and then
watches that portrait being drawn and meets it. That is the aha, and every purpose reaches it:
Read, Write and A bit of both take the same character screens with reader- or
writer-voiced copy.

The shared questionnaire before it: name, genre interests, then Reading /
Writing / A bit of both. **Amended 2026-09-14: a reader then answers three
questions of their own** (how they like their stories, what they are in the mood
for tonight, when they usually read — §3C); writers keep the two setup questions
(§3A) and "both" keeps its two. The first selected genre interest still maps to
the create-genre chip in the writer story-generation flow.

**The email comes before the drawing, not after it.** **W5 Save** asks for it
while the portrait is still a dashed placeholder. **Amended 2026-09-12 (third
round): the drawing starts one screen earlier still.** Pressing **W4**'s CTA
saves the character row and fires the image call on the anonymous session; W5's
CTA only validates the address and sends the code. The email screen and the
six-digit code screen both cover the wait, which is the whole reason W4 is where
the call belongs. **W6 Meet** opens in its ready state if the portrait landed
while the code was being typed and in its loading state if it has not. Auth never
gates the aha; it runs beside it.

Cost discipline changed shape rather than loosening. Onboarding makes **one image
call per portrait request, at most two per person** — the first attempt plus one
reimagine — and **no story text call at all**. It spends no user credits and
writes no ledger row. Behind the flow's own limit, an anonymous identity is
capped server-side at three character images for the life of that identity (migration 00096; it was six under 00088, and four while the cap was anonymous-only)
(migration 00084, §16). The 150-word preview this replaced cost one structured
model call; this costs one or two flat-rate images, and it produces an artifact
the person keeps rather than a truncated sample of one they cannot finish.

The three-screen animated intro in
[`expo/src/screens/KathaOnboarding.jsx`](../expo/src/screens/KathaOnboarding.jsx)
is unchanged: Create, then Publish and Community, then Read. This specification
begins at **Get started**.

---

## 0. Governing principles

1. **Experience before questionnaire.** Every choice changes what follows. The
   genre interests seed the first create-genre chip; the two fields the person
   fills in on **W4 Craft** are the whole of what W6 draws.
2. **The artifact is whole, not a sample.** A portrait is finished at the moment
   it appears. Nothing about it is truncated, faded, watermarked or held back for
   a plan, which is the difference between an aha and a tease.
3. **Infer, don't ask.** **Two answers** — a name and an appearance. Genre, art
   style and framing are inferred from what is already known. A gender row was
   added on 2026-09-12 and removed the same day (§9): the portrait had been
   resolving gender from the name, but the appearance line sitting right after
   the name is a better place to fix that than a fourth control. **W4 carries no
   attachments and no suggestion chips**, and
   the **KATHA WILL DRAW** card is not helper text under this rule: it names
   what each answer becomes, rather than explaining how to fill a box in.
4. **Use Create vocabulary.** W4 says **NAME** and **APPEARANCE**. It never says
   Premise, Plot, Setting, Arc, Seed, or Prompt.
5. **Auth saves an artifact, and it runs beside the aha rather than in front of
   it.** W5 asks for an email so the portrait has an owner before it exists. It is
   never permission to continue, and nothing about it is a gate on seeing the
   character.
6. **One flow for every purpose.** Read, Write and A bit of both run the same
   character screens. Only the copy voice differs, and it differs in exactly the
   places §8-§10B and §12-13 name.
7. **The wait tells the truth.** W6's loading state says what is being done in
   four plain lines and gives **one honest range, from one constant, set from a
   measurement**: `PORTRAIT_WAIT_CAPTION` (§10B), whose wording follows the
   measured p50 from the W4 press to the portrait on screen. No percentage, no
   progress bar, no elapsed time, no spinner. It must look intentional at 200 ms
   and at 30 s, because both are real.
8. **No false scarcity.** There are no timers anywhere. The one-time offer that
   carried the single exception was removed 2026-09-10.
9. **Reduced motion.** Show the completed composition at the same availability
   gate: W3's cards render in place, W6's scan band, dots and pulse hold still
   while the status text still rotates, cross-fades become instant, W6's inline
   edit block opens and closes without its height animation, **W7's testimonial
   rail becomes a plain horizontal `ScrollView` with no auto-scroll**, and
   WELCOME shows a number instead of flying coins. Never a spinner and never a
   flashing replacement.
10. **No em dashes in product copy.**

---

## 1. Frame and shared system

The frame is still **390 × 844 pt**, light theme only, with a **30 pt screen
gutter** on every character screen.

All values resolve to `expo/src/theme/`. The questionnaire screens keep the
general palette (`colors.bg`, `colors.surface`, `colors.border`, `colors.ink`,
`colors.muted`, `colors.tertiary`, `colors.accent`, `colors.accentSoft`,
`colors.success`). **The character screens W3-W7 use the onboarding palette
tokens**, which exist so this path can carry the warmer paper ground of the
signed-off design without a second design system:

| Token | Used for |
|---|---|
| `colors.onboardingBg` | The page ground on W3-W7 |
| `colors.onboardingBorder` | Hairlines, benefit-row dividers, upcoming progress pills |
| `colors.onboardingBorderStrong` | Field borders at rest, the W6 row divider, completed progress pills |
| `colors.onboardingPlate` | The back and close button plates, and the W7 benefit-row rules |
| `colors.onboardingSuccess` | The **✓** on **Cancel anytime, no commitments** |
| `colors.onboardingStone` | Portrait-card ground behind an image that has not decoded |
| `colors.accentSoft` | The radial wash, the yearly card's tint, the W5 emoji disc |
| `colors.premium` | The **SAVE 80%** badge and the **YEARLY** label |

Elevation on this path uses `shadows.primaryCta` (the primary CTA, since the
button converged on the app's one recipe — see the 2026-09-20 amendment below;
`shadows.onboardingCta` is deliberately kept in the theme but is no longer
drawn by anything), `shadows.onboardingCard` (the W3 side cards), `shadows.onboardingHeroCard` (the
W3 hero card), `shadows.onboardingPortrait` (the W6 card and the W7 hero
portrait), `shadows.onboardingChip` (the W5 identity chip and small floating
cards), and `shadows.onboardingFieldFocus` (a focused field). No other elevation
values appear on W3-W7.

Type: `fonts.display` (Bricolage Grotesque 700) for headings, `fonts.ui` (Hanken
Grotesk 400-800) for everything else, and `fonts.reader` / `fonts.readerItalic`
(Literata) for the person's own words inside fields and inside W6's glass chip.
Headings are 30 pt at line-height 1.12, and **34 pt at 1.08 on W6**. Uppercase
eyebrows carry `0.14em` tracking, or `0.16em` on W6; `letterSpacing: 0`
everywhere else.

**The shared chrome on every character screen, in order:**

| Element | Specification |
|---|---|
| Status-bar spacer | Safe-area inset, then the top row |
| Back control | **44 × 44**, `radius.lg` (14), `colors.onboardingPlate` plate, chevron in `colors.muted`. Labelled **Back**, restores all state |
| Progress row | **Seven pills, 22 × 5 pt, radius 3, gap 5**, centred between the back control and a 44 pt spacer that balances it |
| Primary CTA | **52 pt tall** (`controls.primaryCtaHeight`), fully rounded pill, `colors.accent`, white 17 pt / 700, full width inside the gutter. Drawn by `Button`; see the amendment below |
| CTA block | 8 pt above the button and **40 pt below it**, on top of the safe-area inset. Pinned to the bottom on every character screen **except W3**, where it belongs to the centred group (§8) |

**Amended 2026-09-12 (third round): that CTA recipe is the whole journey's, not
just W3-W7's.** Every primary button from the intro's **Get started**, through
the questionnaire's **Continue** on each step, W3-W7, the email and code screens
and W6's **Redraw**, is one recipe, drawn by one component.

**Amended 2026-09-20: that recipe is now the APP's, and there is only one.**
The journey's button is `controls.primaryCtaHeight` (**52**) at `radius.pill`
in `colors.accent` with a white 17 / 700 `fonts.ui` label — the same control
the story page, the reader and the Create brief press. `Primary` in
[`expo/src/components/onboarding/primitives.tsx`](../expo/src/components/onboarding/primitives.tsx)
still exists and every onboarding screen still composes it, but it is now a
thin wrapper over [`expo/src/components/Button.tsx`](../expo/src/components/Button.tsx)
that adds the gap above the button and nothing else.
`controls.onboardingCtaHeight` is kept as an alias of `primaryCtaHeight` so
these call sites converge rather than drift.

**Disabled is a grey plate, not a faded accent.** A blocked primary CTA on this
path — W6 while the portrait is drawing, every questionnaire **Continue**
before its step is answered, W6's **Redraw** with an empty field — fills
`colors.borderStrong` with a `colors.tertiary` label and drops its shadow. It
is announced through `accessibilityState` as disabled, and as busy as well
whenever the block is work already in flight rather than an unanswered form.
This replaces the **40% opacity on the accent** the path used to draw. It
changed for the same reason the two recipes became one: a disabled state that
differs per screen is exactly the drift the button unification removed, and one
button can only have one disabled state. The faded orange was also the weaker
of the two — an accent at 40% still reads as the accent, so the control looked
pressable and did nothing, where a grey plate says plainly that it is not ready
yet.

The path had shipped three different button sizes across consecutive screens,
so the same act looked like a different control each time it appeared. Fixing
that with a second recipe fixed the sequence and left the seam at its edge:
somebody who finished onboarding and opened a story pressed a different button.
The full recipe, and what the two-recipe argument got right, are
`DESIGN_SYSTEM.md` §6.1.

Fields are `colors.surface` with a **1.5 pt `colors.onboardingBorderStrong`**
border at radius 14 (16 on the multiline Appearance field), and focus to **2 pt
`colors.accent` plus `shadows.onboardingFieldFocus`**. OTP code entry is six
individual cells using `controls.otpCellHeight` and `controls.otpCellRadius`
over one invisible numeric `TextInput`. Do not autofocus a field.

**Amended 2026-09-12: there is one field component, and every field on this path
is it.** `Field`
([`expo/src/components/onboarding/Field.tsx`](../expo/src/components/onboarding/Field.tsx))
carries the box above, its eyebrow label, its optional trailing counter and its
focus ring, and it sets the value and the placeholder in `onboardingType.field`,
**16 / 22 in `fonts.ui` at regular weight**. That face is the rule, not a
default: **a field never uses `fonts.display` or `fonts.reader`.** The flow
shipped with three fields instead of one — the S1 name input in Bricolage at
headline size, W4's appearance in Literata, a third box on W5 — and the
distinction that settles it is that text being typed is a control, while
`fonts.display` is the screen's one heading and `fonts.reader` is prose already
written. W6's glass chip still sets the appearance line in `fonts.readerItalic`
(§10B), and that is consistent: there it is being read back, not typed. The full
recipe and its measurements are `DESIGN_SYSTEM.md` §6.

**Layout is relative, not absolute.** The frame numbers above are the reference.
Implementations use `useWindowDimensions`, flex and `aspectRatio`, and scale the
fixed stage sizes (W3's 300 × 290 stage, its 150 × 210 cards, W5's 220 × 230
stage, W6's 270 × 338 card) by `min(1, (width - 60) / 330)` so a 360 pt phone
fits without clipping.

> **SHIPPED DEVIATION: the character path draws a progress row.** The approved
> auth design has one, so the email and code screens carry it, and the rest of
> the path does too rather than have the row appear from nowhere partway
> through. It is drawn as short rounded bars, never as a number or a percentage:
> nothing on screen says "4 of 7". It is announced to assistive technology as
> **"Step n of 7"**, because a progressbar role without a position is worse than
> no role at all. The top bar has no border and the back glyph sits on a plate.
>
> **Amended 2026-09-14: one row from the first question, one pill per step,
> counted per purpose.** The questionnaire used to draw its own filled track
> labelled `n/5`, and the pills started on W3 already four in. Both screens now
> draw the same `OnboardingTopBar` (plate, pills, three colours) and read the
> count from `expo/src/lib/onboarding-progress.ts`:
>
> | Purpose | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
> |---|---|---|---|---|---|---|---|---|
> | read | `name` | `genres` | `purpose` | how | mood | when | **W3** | **W4, W5, code, W6** |
> | write | `name` | `genres` | `purpose` | format | blocker | **W3** | **W4, W5, code, W6** | |
> | both | `name` | `genres` | `purpose` | refine | moment | **W3** | **W4, W5, code, W6** | |
>
> Done pills are `colors.onboardingBorderStrong`, the current pill is
> `colors.accent`, upcoming pills are `colors.onboardingBorder`. The 22 × 5
> hand-off pill holds at 390 pt; eight of them are 211 pt against the 200 pt a
> 360 pt phone leaves between the icon slots, so the bars are shrinkable and
> scale down together there rather than spilling right of centre.
>
> **Every question is a step, and the making of the character is one step.**
> W4, W5, the code screen and W6 share one pill: they are one ask answered
> across four screens, and a row that ticked through them would be measuring
> our email latency and our image provider. W3 is its own pill because it has
> its own back and its own CTA. **Before purpose is answered the row draws the
> longest count (eight)**, so it can only ever shorten, and only once, at the
> moment the person has just said something that changed the length. **W7
> draws no progress row at all**, only the close ×, because a paywall is not a
> step towards anything the person asked for.
>
> This supersedes the 2026-09-11 table (seven for everyone, W0a and W0b inside
> step 3, W4/W5/W6 on three pills).
>
> **The pixel reference disagrees here and this file wins.** `W4-Craft.dc.html`
> draws eight pills and `W6-Meet.dc.html` fills six of seven; both are reference
> drift. The table above is the contract.

*Inference:* retain anonymous state for 24 hours only. It includes IDs,
selections, the typed name and appearance, the portrait URL, and the reimagine
count. Never put the name, the appearance text, the portrait, or an email in
analytics. From W5 onward the character is a `user_characters` row.

---

## 2. Flow diagram

~~~text
INTRO ×3, unchanged
Create → Publish / Community → Read
                         │
                    Get started
                         │
S1-S3  name → genre interests → purpose        steps 1, 2, 3
                         │
        purpose = write ──┼── W0a format → W0b blocker             steps 4, 5 of 7
        purpose = both  ──┼── refine → moment                      steps 4, 5 of 7
        purpose = read  ──┴── R-how → R-mood → R-when (skippable)  steps 4, 5, 6 of 8
                         │
              W3 CHARACTER CTA   three cards fan open              last pill but one
                         │
              W4 CRAFT           NAME + APPEARANCE                 last pill
                         │       CTA → save the row + start the draw
                         │
              W5 SAVE            email → send the code only        last pill
                         │
              CODE               6 digits, the draw runs behind it last pill
                         │
              W6 MEET            usually ready on entry            last pill
                         │       🔄 Reimagine ──→ inline edit block
                         │                          └─ Redraw ×1 → loading
                         │
              W7 PAYWALL         weekly · yearly, no trial         no row, × only
                         │
          subscribe ─────┴───── decline → grant 3 credits
                         │
            OS notification prompt on close or purchase
                         │
                  WELCOME  coins settle, then it advances itself
                         │
     purpose = write → Create studio, {Name} pre-filled as lead
     purpose = read or both → Home
~~~

**Amended 2026-09-12 (third round), two moves in the diagram.** The draw and the
library save leave W5's CTA and fire on **W4's** (§9, §16), so the wait is
covered by the email screen *and* the code screen rather than the code screen
alone; W5's CTA now does one thing, which is send the code. And **WELCOME has no
button**: the coins settle and it advances on its own (§15).

A paywall purchase skips the grant and enters the app. Only a decline grants the
authenticated welcome bonus, now **3** credits (`CREDITS_AND_PRICING.md` §6).
There is one paywall and there is no offer after it.

---

## 3. S1-S3: Name, genre interests, purpose

| Step | Header | Control | CTA |
|---|---|---|---|
| `name` | **First, what should we call you?** | First-name text input | **Continue**, disabled until non-empty |
| `genres` | **Nice to meet you, {name}. What worlds pull you in?** | Multi-select genre chips, text only | **Continue**, enabled at 3+ |
| `purpose` | **What brings you to Katha?** | Three full-width single-select cards | **Continue**, disabled until selected |

### S1, the name field

**Amended 2026-09-12.** The input is the shared `Field` (§1), so a name typed
here is set in the same 16 pt UI face as the name typed on W4 two steps later. It
was its own recipe in `fonts.display` at title size, which is precisely why those
two screens did not look like one flow.

Sub: **Katha writes with you, so every story feels personal. Let's start with
your name.** The gap between that sentence and the field is **`spacing.lg`**, not
`spacing.betweenGroups`. This is a deliberate reading of `DESIGN_SYSTEM.md` §8.1:
the headline asks a question and the field answers it, so the two are one group
with the sub as the second line of the title, and 24 pt put enough air between
the ask and the box to read as two separate things on a screen that contains
nothing else.

**No eyebrow above the field.** The placeholder is **Your first name** and the
headline already asks for it; a label would be the third copy of one instruction.
Cap 40 characters, matching W4's NAME.

### S2, the genre chips

**Rewritten 2026-09-12.** The list is **`UI_GENRES`, the same constant the
Create studio's picker reads** (`CreateBriefFlow.tsx`), rendered in its own
order as real `Genre` ids labelled by `genreLabels`: adventure, comedy,
educational, fanfiction, folktale, historical, scifi, fantasy, mystery, horror,
sliceOfLife, romance. Twelve today; onboarding imports the constant rather than
copying it, so the two pickers cannot drift apart again. `GENRES` carries five
more (romantasy, darkRomance, thriller, contemporary, poetry) that exist so older
stories keep a label; they are not offered to somebody starting out until
`UI_GENRES` says so.

**Cozy Fantasy, Paranormal Romance and Other are removed.** The first two were
display strings that existed nowhere else in the app and quietly resolved to
plain fantasy and plain romance, so a person who picked them met a shelf and a
create flow that had never heard of them. **Other** collected a free label with
nothing downstream to be: it could not key a shelf, could not seed a create chip,
and could not be filtered on. A pick here is now the same value Explore filters
on and Create writes with.

**The chip recipe is Explore's**, from
[`expo/src/components/explore/GenreStrip.tsx`](../expo/src/components/explore/GenreStrip.tsx):
pill, `colors.surface`, **1 pt `colors.border`**, bold label in
`colors.muted`, `radius.pill`; selected is a **`colors.ink` fill with
`colors.surface` text**. Chips wrap into rows rather than scrolling
horizontally, because every option has to be reachable before a person can pick
three.

**Amended 2026-09-12 (second round): the chips carry Explore's emoji, and they
are bigger.** The label is **`genreChipLabel(genre)`**, exported from
`GenreStrip.tsx` and composed there from its own `GENRE_EMOJI` map plus
`genreLabels`, so the emoji is not copied into onboarding and the two surfaces
cannot drift. Geometry: min-height **44**, `paddingHorizontal spacing.xl`, label
**15 pt**, row gap `spacing.md`, chip gap `spacing.sm + spacing.xs`. Selection is
unchanged.

> **This reverses "no emoji", and the argument it reverses was about a smaller
> chip.** The ban read twelve emoji in a wrapping grid as a second alphabet to
> scan; what it actually described was twelve emoji crammed into a 40 pt pill
> sized for a word. At 44 pt with `spacing.xl` gutters and a 15 pt label the
> emoji is a mark the eye lands on before it reads, which is how a person finds
> *horror* in a grid of twelve without reading eleven other words first — and it
> is the same mark Explore uses for the same genre, so the two screens teach
> each other. **The tick mark stays banned**: the fill already says which chips
> are selected.

**Pick at least three.** The CTA reads **Continue** when three are selected and
**Pick at least 3** while it is disabled, so the button states the rule rather
than sitting dimmed with no reason given.

The first selected genre populates the first genre chip in the writer
story-generation flow.

The first-name answer is also the **reader path's character name**: W3's reader
headline greets the person by it and W4 pre-fills NAME with it, because the
reader character is the person themselves (§9).

Purpose is no longer a branch between two flows. **Since 2026-09-11 it selects a
copy voice, not a path**: Read and Both go straight to W3 with reader-voiced
copy, Write answers W0a and W0b first and then goes to W3 with writer-voiced
copy. It still decides the exit (§15).

**Instrumentation:** `onboarding_name_continued { length_bucket }`;
`onboarding_genres_completed { genre_ids, selected_count, first_create_genre }`;
`onboarding_purpose_selected { purpose }`;
`onboarding_purpose_continued { purpose }`.

---

## 3A. W0a-W0b: Writer intent

| Step | Header | Control | CTA |
|---|---|---|---|
| `writer_format` | **What do you want to write?** | Four full-width single-select cards | **Continue** |
| `writer_blocker` | **What usually stops you?** | Four full-width single-select cards | **Continue** into W3 |

`writer_format` options: A full novel, Short stories, Fan fiction, Poetry and
verse.

`writer_blocker` options: Turn an idea into a draft, Rewrite in my voice, Plan
chapters, Publish and find readers.

These two answers are setup and routing inputs; they must not trigger a model
call, generation operation, ledger row, or cover request.

---

## 3C. R-how, R-mood, R-when: the reader's questions

**Added 2026-09-14**, from the owner's design frames. Three single-select
screens after **Reading**, drawn with the same option row as S3 (§3B's selected
look: `colors.accentSoft` fill, `colors.accent` border, filled accent check
disc; unselected rows draw no ring). The row's border is always present, in
`colors.surface` when unselected, so selecting never moves the list.

| Step | Header | Sub | Options | CTA |
|---|---|---|---|---|
| R-how (`refine`) | **How do you like your stories?** | none | 📖 **Reading them myself** · Words on the page, at my own pace / 🎧 **Listening to audio** · Narrated stories for commutes and nights / 🔀 **A mix of both** · Read sometimes, listen sometimes | **Continue** |
| R-mood (`mood`) | **{name}, what are you in the mood for?** | **Tonight only. It sets the story, and who you'll be in it.** | 🌊 **Something to escape into** · Immersive worlds, long journeys. / 🔍 **Something that keeps me guessing** · Mystery, tension, twists. / 💔 **Something emotional** · Ache, catharsis, connection. / ⚡ **Something quick** · Under 20 minutes. / 🕯️ **Something comforting** · Warm, low-stakes, safe. / 🎲 **Surprise me** · Katha picks based on your genres. | **Continue** |
| R-when (`moment`) | **When do you usually read?** | **So the right length arrives at the right time.** | 🌙 **Before bed** / 🚇 **During commutes** / ☕ **Short breaks** / 🌞 **Weekends** / 🕒 **Whenever I get time** (one line each) | **Continue**, and a **Skip** text link under it |

**R-when carries the UP NEXT card** under its options: the W3 side-card
portrait at 80 × 112, eyebrow **UP NEXT**, **Be the lead in these stories**,
**Describe yourself once. Katha writes you in.** On `colors.accentSoft`, not
tappable. It exists so W3's three portraits are expected rather than a detour.

**Skip is the only optional answer in the flow**, because R-when is about
routine, not taste, and a person who does not know yet should not invent one.
Skip leaves with `moment` empty; a tapped-then-skipped row is not sent.

**What the answers feed.** `mood` is the key of Home's **Tonight** rail
(`expo/src/lib/home-tonight.ts`): the first shelf under the reader's own
stories, titled **Tonight · {mood label}**, built from the mood's genres
(escape → fantasy, adventure, sci-fi, romantasy; guessing → mystery, thriller,
horror; emotional → romance, contemporary, dark romance; comforting → slice of
life, folktale, comedy), from standalones for **quick**, and from the reader's
own genre picks for **surprise**. It is session state and is not persisted:
"tonight" means tonight. `refine` and `moment` are stored with the session like
the writer's answers and feed nothing yet.

**The last question's CTA is Continue on every path.** It read **Build my
profile** for readers and "both", a label for a progress ring that no longer
exists.

---

## 3B. Legacy S1: Purpose vocabulary

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
**Amended 2026-09-11:** all three go to W3. Write passes through W0a and W0b on
the way; Read and Both do not. Back restores selection.

**Instrumentation:** `onboarding_purpose_selected { purpose }`;
`onboarding_purpose_continued { purpose }`.

---

## 4. R1: Taste, not tick-boxes

> **RETIRED 2026-09-11: the reader path R1-R4 no longer renders.** Read and Both
> now take the same character flow as Write (§8-§10B), in reader-voiced copy.
> Sections 4, 5, 6 and 7 are kept as a record of what was built and why it was
> replaced; nothing in them is implemented, and their instrumentation is deleted
> from §18.
>
> **Why one flow instead of two.** Three reasons, in order of weight.
>
> 1. **One flow is one flow to maintain.** Two paths meant two sets of screens,
>    two sets of events, two back-stacks and two paywall entries, for a single
>    question the person answers in one tap on S3. Every fix landed twice or, in
>    practice, once.
> 2. **The artifact is whole, not a truncated preview.** R2 handed the reader
>    about 250 words of a story they could never finish, and R3 then interrupted
>    it on purpose to demonstrate what a plan removes. A portrait is finished
>    when it appears and the person keeps it. Principle 2 is the general form of
>    this, and the reader path is what it was written against.
> 3. **A saved character is worth more to a reader than a shelf was.** Saved
>    characters are cross-story since migration 00057, and
>    [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) states the consequence
>    plainly: **"Saved characters make the story start cheaper"** — an all-saved
>    cast takes a 3-chapter story from $0.221 to $0.104. A reader who leaves
>    onboarding with one character has made their first story cheaper for us to
>    serve before they have written it. A reader who left with four recommended
>    content IDs had made nothing.
>
> R3's house break is retired with the rest of it, and that is a separate small
> win: the free tier now has no deliberate interruption in it at all, which is
> the position `CREDITS_AND_PRICING.md` §12 item 7 already argued for.

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

*Retired 2026-09-11. See the note under §4.*

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

*Retired 2026-09-11. See the note under §4.*

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

*Retired 2026-09-11. See the note under §4.*

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

Try writing enters the writer path with `entry: reader_bridge`, no prefill, no
selected chip, no call. Keep exploring enters the paywall. Back goes R3.

**Instrumentation:** `onboarding_shelf_shown { taste_id, content_ids }`;
`onboarding_shelf_card_opened { content_id }`;
`onboarding_writer_bridge_tapped { purpose, taste_id }`;
`onboarding_shelf_completed { taste_id }`.

---

## 8. W3: Character CTA

> **Replaces C0 Bridge and C1 Who, and with §§9-10B the whole C0-C4 sequence,
> 2026-09-11 — the same day C0-C4 was specified.** §19 item 6 records why.

Step 4 of 7. W3 is a picture and a sentence. It exists because W4 asks for two
fields before anything has said what they are for, and a person who does not know
why they are being asked writes less. The picture does the saying: three
portraits fan open, so the promise is demonstrated rather than described.

| Item | Writer copy (`purpose = write`) | Reader copy (`purpose = read` or `both`) |
|---|---|---|
| Header | **Every story needs a lead.** | **{name}, what if you were in the story?** |
| Sub | **Describe them in a line. Katha draws them and builds the story around them.** | **Katha can write you into anything on your shelf. Describe yourself once, and every story gets a lead you recognize.** |
| CTA | **Create my character** | **Put me in the story** |

`{name}` in the reader headline is the first name from S1, not a character name.

**Composition.** `colors.onboardingBg` ground with a radial `colors.accentSoft`
wash, 80% × 50% at 50% / 30%, fading to transparent at 70%. Below the progress
row, **36 pt**, then a centred **300 × 290** stage holding three cards, each
**150 × 210** at radius 20 on `colors.onboardingStone`:

| Card | Position | Final transform | Elevation |
|---|---|---|---|
| Hero | left 75, top 10 | none, `z-index` above both | 3 pt `colors.onboardingBg` border, `shadows.onboardingHeroCard` |
| Left | left 0, top 34 | rotate **-8°** | `shadows.onboardingCard` |
| Right | right 0, top 34 | rotate **+8°** | `shadows.onboardingCard` |

The right card is the exact mirror of the left. Assets are
`expo/assets/onboarding/portrait-aarav.png` (hero, focal centre 18%) and
`portrait-priya.png` (both sides).

**Amended 2026-09-12 (third round): W3 does not pin its CTA, and it is the only
screen on the path that does not.** The progress row stays at the top, and
everything under it — the stage, the copy, and the button — is **one vertically
centred group** with **equal free space above and below it**, held by a flex
spacer at each end. Inside the group: `spacing.xxl` between the stage and the
copy block, and `spacing.xl` between the copy and the CTA. The stage's own
composition, its two-phase entrance and its scaling rule are unchanged.

Header on `fonts.display` 30 / 1.12, sub 12 pt under it at 15 / 1.5 in
`colors.muted`.

**W3 holds less than any other screen on the path, and pinning punished it for
that.** Every other character screen carries fields or a card that fills the
frame down to the button, so a CTA on the bottom edge is the end of a column of
content. W3 has a picture and a sentence, so pinning left a band of empty paper
between the sub and the button that grew with the phone: on a tall device the
three things a person is meant to read as one thought — look at this, here is
what it is, press this — were spread across the screen with nothing between them.
Centring the group makes the empty space symmetrical, which reads as composition
rather than as a gap where something failed to load. The CTA keeps the §1 recipe
exactly; only its position changes.

**Motion: a two-phase entrance, on mount, once. It does not loop and it does not
settle back.**

| Phase | Timing | Values | Easing |
|---|---|---|---|
| 1. Hero | 0 → **2000 ms** | opacity 0 → 1, scale **0.72 → 1.08** | `Easing.bezier(0.3, 0.7, 0.2, 1)` |
| 2. Sides, both at once | delay **2100 ms**, duration **800 ms** | see below | `Easing.bezier(0.22, 0.9, 0.3, 1)` |

Left card: translateX 75 → 0, translateY -24 → 0, rotate 0 → -8deg, scale 0.86 →
1, opacity 0 → 1. Right card: translateX -75 → 0, and otherwise identical with
rotate 0 → +8deg.

**The hero holds at 1.08. There is no settle-back to 1.0**, no spring, no
overshoot correction. The slow two-second swell is the screen's whole idea: it
reads as a portrait being looked at rather than a card being animated in, and a
bounce back to rest would turn it into a UI flourish.

**Reduced motion:** all three cards render in their final position, rotation,
scale and opacity, with no entrance.

**Back** returns to S3, or to W0b for writers, with every selection restored.

**Instrumentation:** `onboarding_character_cta_shown { purpose }`;
`onboarding_character_cta_tapped { purpose }`.

---

## 9. W4: Craft

Step 5 of 7. **Amended 2026-09-12 (second round): two answers, and nothing
else.** A name and an appearance, in that order, then the KATHA WILL DRAW card.

| Item | Writer copy | Reader copy |
|---|---|---|
| Header | **Craft your lead** | **Craft your character** |
| Sub | **Two details. Katha fills in the rest.** | **This is you in the story. One line is enough.** |
| Field 1 label | **NAME** | **NAME** |
| Field 2 label | **APPEARANCE** | **APPEARANCE** |
| Field 2 placeholder | **A tall, broad-shouldered man in his thirties. Denim shirt, sleeves rolled, tired eyes that miss nothing.** | **Curly hair, round glasses, a green jacket I never take off.** |
| Counter | **{n} / 300** | **{n} / 300** |
| KATHA WILL DRAW rows 2 and 3 | **What they carry into every chapter** · **How every story speaks to them** | **What you carry into every chapter** · **How every story speaks to you** (amended 2026-09-14) |
| CTA | **Bring {name} to life** | **Show me** |
| CTA, name empty | **Bring them to life**, disabled | **Show me**, disabled |

On the reader path **NAME is pre-filled with the first name from S1**, because
the character is the person. It stays editable.

**Layout.** Heading block 26 pt below the progress row; header 30 / 1.12, sub 10
pt under it at 14.5 / 1.5 in `colors.muted`. The NAME block is 26 pt below the
sub: an 11 pt / 800 uppercase label in `colors.tertiary` at `0.14em`, 8 pt above
a single-line field at radius 14 with 15 × 18 pt padding, the value set in
`fonts.reader` at 17 pt. The APPEARANCE block is 18 pt below it, its label row
carrying the live **{n} / 300** counter at 11.5 pt in `colors.tertiary` on the
right, above a multiline field at radius 16, 16 × 18 pt padding, **min-height
150 pt**, value in `fonts.reader` at 16 / 1.5.

### The gender row is removed

**Added and removed on 2026-09-12.** It lived for one round between NAME and
APPEARANCE as a required four-option single-select — Woman, Man, Non-binary,
Prefer not to say — and it is now gone from **W4, from W6's edit block (§10B),
from the request (§16), and from the endpoint and its tests**. There is no
dead contract left behind: `gender` is not a parameter the client can send, not
a field `generate-character-image` reads, and not a clause
`backend/supabase/functions/_shared/image.ts` composes.

**Two reasons, and the first one is about the screen.** With the KATHA WILL DRAW
card below it, W4's bottom already fills a 390 × 844 frame; a segmented row of
four between the two fields pushed the card under the fold on a 360 pt phone and
made a two-question screen read as a form. The card is the thing that earns W4 —
it says what each answer becomes — and a row that costs it its place on screen
is paying too much.

**The second is that the prompt did not need it.** The clause it added was one of
"a woman", "a man", "a non-binary person", placed in front of an appearance line
the person had already written in their own words. Where that line says who
somebody is, the clause is redundant; where it deliberately does not, the clause
overrides a description with a checkbox. The round-one argument was that the
model was otherwise resolving gender from the **name**, which is true and is a
worse guess than a tap — but it is also a worse guess than the sentence directly
after it, and the fix for a prompt reading the wrong field is the prompt, not a
fourth control.

**Nothing downstream referred to it**, which is why removing it costs nothing: it
was never written to `user_characters`, never reached the Create flow's character
sheet, and was already banned from telemetry (§17, §18).

### The KATHA WILL DRAW card

Below the appearance field, the informational card recipe: `colors.surface`, 1 pt
`colors.onboardingBorder`, `radius.onboardingCard`, rows divided by 1 pt
`colors.onboardingPlate`, a title in `onboardingType.body` at 700 and a line
under it in `onboardingType.helper` in `colors.muted`. The eyebrow above it reads
**KATHA WILL DRAW**.

**Amended 2026-09-12 (second round): the rows carry duotone glyph tiles, not
Ionicons.** Each row's mark is a **`GlyphTile`** — a 40 × 40 tile from
[`expo/src/components/onboarding/glyphs.tsx`](../expo/src/components/onboarding/glyphs.tsx)
— drawing a purpose-made two-tone mark rather than an outline icon borrowed from
the app's icon set. W4's three are `GlyphFaceAndBuild`, `GlyphClothingAndCarry`
and `GlyphTheName`. **These rows never import Ionicons**, and
`src/theme/icons.tsx` stays the only source for every other icon in the flow.

| Glyph | Title | Line |
|---|---|---|
| `GlyphFaceAndBuild` | **Face and build** | **The portrait, from your first line** |
| `GlyphClothingAndCarry` | **Clothes and props** | **What they carry into every chapter** |
| `GlyphTheName` | **The name** | **How every story speaks to them** |

**The copy is balanced on purpose: about three words of title and about six of
line, in every row on both cards.** The round-one set ran **The portrait** under
one row and **What follows them into every chapter** under the next, which made a
three-row card look like three unrelated notes stacked in a box. Rows of one
shape read as one list, and a card that reads as one list is read; a ragged one
is skimmed for the longest row and abandoned.

**Six marks across the two cards, and none of them repeats.** W4's three and
W6's three (§10B) are six distinct drawings. The round-one set reused
`IconPerson` and `IconPencil` on both screens, so a person meeting the second
card recognised the first card's marks against different words, which teaches
that the tiles mean nothing.

**This is the helper text W4 was refusing to carry, and it earns its place by
being about the output rather than the input.** The rule it looks like it breaks
is principle 3's "no helper text": that ban was on a paragraph explaining how to
fill a box in, which is a screen apologising for its own field. Three rows naming
what each thing becomes is the answer to the question the fields actually raise,
which is not *what do I type* but *what is this for*.

### The CTA saves the character and starts the drawing

**Amended 2026-09-12 (third round).** Pressing **Bring {name} to life** /
**Show me** runs two things on the anonymous session, in this order, and then
advances to W5 without waiting on either:

1. **The character is saved** to `user_characters` via
   `expo/src/lib/saved-characters.ts`, with `portraitUrl` null.
2. **`storyApi.generateCharacterImage`** with a fresh `requestId` (§16).

Both are fire-and-forget with respect to navigation, and **a failure in either
does not block W5**. A save failure is logged and retried once when the portrait
lands; a draw failure surfaces on W6 (§10B), not here, because W4 has nothing to
say about it and stopping a person on a filled-in form to report a background
call is worse than letting W6 own the one place a portrait can be looked at.

**This moved off W5's CTA, where it sat from 2026-09-11 until now.** The reason
is arithmetic: the portrait takes about ten seconds, and starting it at W5 bought
only the code screen to hide it behind. Starting it at W4 buys the email screen
as well — typing an address, waiting for a mail to arrive, and typing six digits
— which is comfortably more than ten seconds for almost everybody, so **W6
usually opens ready** and the loading state becomes the exception rather than the
rule. Nothing about the ask changes; the same two screens happen in the same
order, and the only difference is that the work starts at the first moment it
*can* start, which is the moment the two answers that feed it exist.

**Back from W5 to W4 does not redraw by itself.** Returning with an unchanged
name and appearance re-uses the request already in flight or already landed.
Changing either and pressing the CTA again fires a fresh `requestId` and replaces
the pending result, and **resets nothing else**: the reimagine budget (§10B) is
untouched by a W4 edit, because the budget is about W6's redraw control and a
person who has not reached W6 has not spent anything. Each W4 press is still one
image call and still counts against the anonymous lifetime cap (§16).

**No attachments, no suggestion chips, no placeholder essay.**
The genre-seeded **TRY ONE** rail that C1 carried is gone. It was solving for a
person who does not know what to type, and the field's own height plus a 300
character counter solves the same problem without a second thing to read, a
`chip_backed` flag to carry, or a canonical chip list to keep in sync.

**States.**

| State | Behaviour |
|---|---|
| Name or appearance empty or whitespace-only | **CTA disabled**, announced as dimmed. This is the rule; there is no soft-gate and no "continue anyway" |
| Name empty, appearance filled | CTA reads **Bring them to life** and stays disabled |
| Both answered | CTA enabled, reads **Bring {name} to life** with the trimmed name |
| Appearance at 300 | Input stops accepting; the counter is the announcement. No error styling |
| Name at 40 | Announce **A name can be up to 40 characters.** |
| Returning from W5 or the code screen | Both answers restored exactly. **W6 no longer sends anyone back here**: its **Edit details** control was replaced on 2026-09-12 by an inline edit block on W6 itself (§10B) |
| Returning from W5 with both answers unchanged | The CTA advances without a second save or a second image call |
| Returning from W5 with either answer edited | The CTA saves the edit and fires a fresh `requestId`, replacing the pending portrait. The reimagine budget is unaffected |

**Motion.** The CTA's enable is a `motion.fast` colour transition, never a scale
or a bounce. Focus moves a field to its 2 pt accent border and
`shadows.onboardingFieldFocus` over `motion.fast`. Reduced motion drops both
transitions and renders the end states.

**Instrumentation:** `onboarding_character_craft_started { purpose,
initial_genre }`; `onboarding_character_craft_submitted { name_length_bucket,
appearance_length_bucket, prefilled_name }`. `prefilled_name` is true when the
reader path's S1 name was submitted unedited. **Never send the name or the
appearance text.**

**Amended 2026-09-12 (third round): `onboarding_character_craft_submitted` is now
the start of the portrait clock.** It is the event the `latency_bucket` on
`onboarding_character_w6_ready` is measured from, because it is the press that
makes the image call. It carries no new property; what changed is what it means
downstream, and that is written here so nobody measures from W5 again.

---

## 10. W5: Save

Step 6 of 7. **W5 comes before the drawing, not after it**, and that is the
structural change this whole section exists to record.

| Item | Writer copy | Reader copy |
|---|---|---|
| Header | **Where should we send {name}?** | **Where should we send you?** |
| Sub | **Your portrait is being drawn now. Save it to your account so {name} follows you into every story, on every device.** | **Your portrait is being drawn now. Save it to your account so you're in every story, on every device.** (amended 2026-09-14: the reader is the character, and "so Priya follows you", said to Priya, was the writer's sentence with her name in it) |
| Field label | **EMAIL** | **EMAIL** |
| CTA | **Email me a code** | **Email me a code** |
| Terms | **By continuing you agree to our Terms and Privacy Policy.** | same |

**Why the email moved in front of the portrait.** C4 asked for it after the
reveal, which meant the first thing the person saw after their character existed
was a form. Asking here trades a worse moment for a better one: the ask lands
while the portrait is still a promise, and the wait it creates is the wait we
already had. The code screen is not dead time any more, it is the drawing.

**Amended 2026-09-12 (third round): W5's CTA sends the code and nothing else.**
The save and the image call moved back one screen to W4's CTA (§9, §16), so by
the time this screen is on, the portrait is already being drawn behind it and the
character row already exists. **The CTA copy moved with the behaviour**: it read
**Save and draw {name}** until 2026-09-12, which named two actions this button
had stopped performing — the row was already written and the portrait already in
flight. A label is a promise about the press, so it now says what the press does,
and the sub says the drawing is under way rather than about to be. W5 validates the address, calls `sendEmailCode`,
and advances. The stage's dashed placeholder and **Ready to draw** chip are
unchanged and still honest: the person is looking at a promise, and the fact that
the promise is already in flight is not something this screen reports.

**Composition.** A centred **220 × 230** stage, 28 pt below the progress row,
holding two pieces of an unfinished character:

- **The placeholder card**, left 35 / top 16, **150 × 196** at radius 18,
  `colors.surface` with a **1.5 pt dashed `colors.onboardingBorderStrong`**
  border, rotated **-5°**. Inside, centred with a 10 pt gap: a 54 pt disc in
  `colors.accentSoft` carrying the **🎨** emoji at 24 pt, then **PORTRAIT** at 11
  pt / 800 / `0.14em` in `colors.tertiary`.
- **The identity chip**, right 6 / top 120, `colors.surface`, 1 pt
  `colors.onboardingBorder`, radius 14, 12 × 14 pt padding,
  `shadows.onboardingChip`, rotated **+3°**, min-width 150. Three lines:
  **CHARACTER** at 10 pt / 800 / `0.14em` in `colors.accent`; the name in
  `fonts.display` 16 / 700; then a 6 pt `colors.accent` dot and **Ready to draw**
  at 10.5 pt in `colors.muted`.

The emoji is content, not an icon glyph: keep **🎨** rather than substituting an
Ionicon. Heading block 22 pt below the stage; the EMAIL block 24 pt below that,
field at radius 14 with 16 × 18 pt padding, value in `fonts.reader` 16 pt. The
terms line sits 12 pt under the CTA, centred, 12 pt in `colors.tertiary`.

**States, and what the CTA actually does.**

| State | Behaviour |
|---|---|
| Empty or malformed email | CTA disabled. Validation is the existing client rule; no error is shown before a submit |
| CTA pressed | **`sendEmailCode`** only (`expo/src/lib/session.ts`), which is `updateUser({ email })` on the guest session — an in-place conversion, §16 |
| `sendEmailCode` rejects | Stay on W5, existing error copy inside the field block, email retained. **The portrait already in flight is not cancelled and the saved row is not touched** |
| `sendEmailCode` resolves | Advance to the code screen immediately |

**The save and the draw are no longer on this CTA.** They fire on W4's (§9), so
the list of three that stood here from 2026-09-11 is now a list of one. What was
true of them there is still true of them at W4: the row is real from the moment
it is written, there is no `draft-character://` placeholder, the portrait URL is
written onto the existing row when it lands, a save failure is logged and retried
once at that moment, and a draw failure surfaces on W6 (§10B) rather than on the
screen that started it.

A `sendEmailCode` rejection leaves the person on W5 with a character row saved
and an image call running, and **that is correct, not a leak**: both belong to the
anonymous identity, which is the same identity whether or not this address is
ever verified, and a retry or a different address lands on the same one.

**Motion.** The stage rises 8 pt and fades in over `motion.base`; the heading and
field follow, staggered by `motion.fast`. Reduced motion renders the final
composition.

**Back** returns to W4 with both fields intact.

**Instrumentation:** `onboarding_character_save_shown { purpose }`;
`onboarding_character_email_submitted { purpose }`. See §11 for the auth events
that fire alongside. **Never send the email.**

**Renamed 2026-09-12 (third round): `onboarding_character_save_submitted` is
retired and must not be sent.** It was named for a press that saved the character
and started the drawing, and this press does neither any more; a funnel step
called "save" that sends an email is a metric that lies to whoever reads it next.
The save and the draw are counted at `onboarding_character_craft_submitted`
(§9).

---

## 10A. The code screen

Step 6 of 7, sharing W5's pill. Existing `EmailCodeAuth`, unchanged in behaviour
and restyled onto the onboarding palette.

| Item | Copy |
|---|---|
| Header | **Check your inbox** |
| Sub | **Enter the 6-digit code we sent to {email}.** |
| CTA | **Verify and continue** |
| Secondary | **Resend code**, **Use a different email** |

Six individual OTP cells over one invisible numeric `TextInput` (§1). Provider
errors are safe, actionable, rendered in place, and retain every digit already
typed.

**The portrait request is running the whole time this screen is up.** That is its
second job and it is deliberate: the wait a person tolerates for a code is the
wait we need for an image, so the two are spent once instead of twice. Nothing on
this screen mentions the drawing, shows its progress, or waits on it. The screen
never blocks on the image and the image never blocks on the screen.

**Exit.** On a verified code, go to **W6**: loading state if no portrait URL has
arrived, ready state if one has. **Resend code** re-sends only; it does not
re-request the portrait. **Use a different email** returns to W5 with the field
cleared, and **does not** re-fire the save or the draw — the character row and
the in-flight image belong to the same anonymous identity either way.

**Back** returns to W5. Never advance unauthenticated.

> **There are no guest accounts past this screen** *(2026-09-16)*. The
> anonymous session that carries W4's save and the portrait call is pre-auth
> infrastructure and nothing more: the verified code is the only way to W6, and
> W6 is the only way to Home, so no person reaches the app without an email.
> Two things follow and both shipped with this note. **Profile no longer shows
> a "Sign in to keep all of this" card**, because there is nobody it could be
> shown to. **Signing out returns to the sign-in screen**, never to a fresh
> anonymous session on Home — the session reset underneath is unchanged, but
> the screen it lands on is the one that asks for an email. §16's in-place
> conversion and its existing-account fallback are unaffected; they describe
> how the anonymous session becomes the account, not a way around it.

**Instrumentation:** §11.

---

## 10B. W6: Meet

Step 7 of 7. One screen with two states and one cross-fade between them.

### Loading

**Reader voice (amended 2026-09-14):** eyebrow **DRAWING YOU**, heading
**{name}, you're taking shape.**, disabled CTA **Drawing you…**. The writer's
**DRAWING** / **{name} is taking shape.** / **Drawing {name}…** is unchanged.

| Item | Copy |
|---|---|
| Eyebrow | **DRAWING** |
| Header | **{name} is taking shape.** |
| Caption | **Usually about 10 seconds** — the constant `PORTRAIT_WAIT_CAPTION` |
| CTA | **Drawing {name}…**, disabled — the shared `Button`'s grey `colors.borderStrong` plate, announced disabled and busy (§ frame, *Disabled is a grey plate*) |

> **The caption is a constant, and its number is measured rather than chosen.**
> **Amended 2026-09-12 (third round).** The string lives once, as
> `PORTRAIT_WAIT_CAPTION` in
> [`expo/src/screens/CharacterOnboarding.tsx`](../expo/src/screens/CharacterOnboarding.tsx),
> and every place the loading state renders a wait reads it from there. **The
> wording follows the measured p50** from the W4 press (§9) to the portrait on
> screen. Measured 2026-09-12 (`backend/scripts/measure-portrait-latency.ts`,
> 13 runs): provider inference 7 to 9 s on `gemini-2.5-flash-image`, edge boot
> 0.15 s warm / 1.4 s cold, two RPCs ~0.1 s, upload ~0.4 s, download of the
> ~950 KB PNG ~1.5 s: **p50 about 11 s, p90 about 15 s from the W4 press.**
> "About 10" is the honest rounding of that p50, and because the draw now
> starts on W4 while the reader types an address and a code, the wait the
> caption actually describes is the remainder after verification, usually a
> few seconds. Inference is the part outside our control; the request shape,
> aspect ratio, model order and output format were all measured and none moved
> the p50 beyond run-to-run noise.
>
> It was **Usually 20 to 30 seconds**, which principle 7 called the one honest
> range. It is a constant now for two reasons. The first is that the number is
> about to change — starting the draw at W4 and the latency work behind it move
> the real figure — and a wait time typed into a JSX caption is a number nobody
> updates when the system gets faster, so the screen keeps promising the old
> speed for the rest of its life. The second is that it is claimed in one place
> and must stay claimed in one place; a second copy is a second promise.
>
> **Principle 7 is unchanged and this is how it is kept**, not an exception to
> it: one honest range, no percentage, no progress bar, no elapsed time, no
> spinner. A measured p50 is the most honest version of that sentence there is,
> and a number that is measured can be re-measured.

**Composition.** `colors.onboardingBg` with a radial `colors.accentSoft` wash, 90%
× 46% at 50% / 36%. Centred head block 18 pt below the progress row: eyebrow at
11 pt / 800 / `0.16em` in `colors.accent`, then the header in `fonts.display` at
**34 / 1.08**, 6 pt under it. The card sits 20 pt below: **270 × 338**, radius
26, a **4 pt `colors.surface`** border, `shadows.onboardingPortrait`, on a
vertical `colors.onboardingPlate` → `colors.onboardingStone` gradient. Inside it,
the eventual portrait is pre-rendered at **12% opacity, blurred 6 pt and
desaturated**, so the reveal is a resolution rather than a swap. The caption sits
20 pt below the card, centred, 13 pt in `colors.muted`.

**The status chip** is inset 14 pt from the card's left, right and bottom edges:
a dark glass panel at 72% ink with an 8 pt backdrop blur, radius 14, 12 × 14 pt
padding, holding three dots and one line of text at 13 pt / 600.

**Animation, all looping while loading.**

| Element | Specification |
|---|---|
| Scan band | A **120 pt** tall gradient, transparent → `colors.accent` at 28% at the 70% stop → `colors.accent` at 90%, plus a **2 pt** `colors.accent` line with an 18 pt / 4 pt spread glow at 60%. Both translate from **top -4 to top 100%** of the 338 pt card over **2200 ms, linear, repeating forever with no reverse** |
| Dots | Three **6 pt** `colors.accent` dots, 4 pt apart. Scale **0.6 → 1 → 0.6** and opacity **0.4 → 1 → 0.4** over **1200 ms**, staggered **0 / 200 / 400 ms** |
| Status pulse | The line fades **0.55 → 1 → 0.55** over **1600 ms** |
| Status text | Swaps every **2200 ms**, in order, wrapping: **Reading your description** → **Sketching the face** → **Choosing the light** → **Adding the last details** |

The scan and the status rotation share the 2200 ms period on purpose: one sweep
is one line, so the screen has a beat instead of two unrelated clocks.

### Ready

| Item | Writer copy | Reader copy |
|---|---|---|
| Eyebrow | **YOUR LEAD** | **THIS IS YOU** |
| Header | **Meet {name}.** | **Hello, {name}.** |
| Row | **🔄 Reimagine**, one pill, alone | same |
| CTA | **Keep {name}** | **Keep this me** |

The portrait fills the same 270 × 338 card at full opacity, and the person's own
appearance line sits in the glass chip at the bottom, set in `fonts.readerItalic`
at 12.5 / 1.45.

**Rewritten 2026-09-12: one control under the portrait, not three.** `spacing.xl`
below the card, centred, a single outlined pill (12 × 20 pt padding,
`radius.pill`, 2 pt `colors.accent` border, `colors.surface` fill, label in
`colors.accent` 15 / 700) carrying **🔄 Reimagine**. **The counter and
Edit details are gone**, and §10B's old argument for showing the counter is
reversed below.

### The inline edit block

**Tapping Reimagine does not draw.** It expands an edit block in place, between
the pill and the CTA: a Reanimated `withTiming` on height and opacity over
`motion.base`, holding

1. the appearance text in a multiline `Field` (§1), pre-filled with what was
   typed on W4, and
2. a **Redraw** button in the primary CTA's style, inside the block.

**Amended 2026-09-12 (second round): the gender row is gone from here too**, with
the row itself (§9). The block holds one field, which is the one thing that made
the portrait.

**Redraw** collapses the block and re-enters W6's loading state in place — scan,
dots, rotating status — then the same 300 ms cross-fade to ready. Tapping
**Reimagine** again while the block is open collapses it without drawing.

**A reimagine that cannot change anything is a retry.** The old control sent the
same strings to the same endpoint and hoped for different pixels, which meant
the only way to actually fix a wrong portrait was **Edit details**, a second
control that left the screen, unwound to W4, and brought the person forward
through it again. One pill that opens the two fields it would have sent them back
to collapses two controls into one and keeps the portrait on screen while they
edit the words that made it, which is the comparison that was missing.

### The budget

**One redraw per onboarding.** Spending it is pressing **Redraw**, not opening
the block: the block is free to open, read, edit and close, because none of that
is an image call.

Once it is spent, **tapping Reimagine opens W7** (the paywall) instead of
expanding the block. **No counter, no "free left" line, no "Edit details", and no
disabled state** — the pill looks and behaves identically before and after, and
what differs is what it opens.

> **This reverses decision 45, and the reason decision 45 gave is what changed.**
> The counter was there because "a control that acts must say what it has left",
> and that was right about a control whose only act was drawing. It is wrong
> about this one: the pill's first act is opening an editor, the person can open
> it, change their mind and close it without spending anything, and a **1 free
> left** label beside it would be counting something the tap does not do.
> Printing a budget on a control also invites spending it — a number that starts
> at one is a thing to use up — while a pill that quietly opens a paywall the
> second time is the same honest wall with no scoreboard in front of it. The cap
> itself is unchanged at one, and §16's bounds are unchanged.

A failed attempt and its **Try again** still do not consume it, and the budget is
still **per onboarding**, not per edit: opening the block, rewriting the
appearance, redrawing, then opening the block again and redrawing a second time
is two image calls and the second one hits the paywall.

**The loading → ready transition is a 300 ms cross-fade**, card and text
together. Nothing slides, nothing scales, and the card does not resize, because
its geometry is identical in both states.

### States

| State | Behaviour |
|---|---|
| Entered with a portrait URL | **Ready, and since 2026-09-12 this is the expected case**: the draw started at W4 and the email and code screens have run since. No cross-fade, no loading frame |
| Entered with no portrait URL | Loading. Still fully specified and still reachable on a slow draw or a fast typist, and it must look intentional rather than like a fallback |
| Portrait arrives while loading | 300 ms cross-fade to ready |
| **🔄 Reimagine** with budget left | Expands the inline edit block. Nothing is drawn and nothing is spent |
| **Redraw**, inside the block | Fresh `requestId` carrying the edited appearance. The block collapses and the card returns to **loading in place** — scan, dots, rotating status — then the same 300 ms cross-fade. The budget is spent here |
| **🔄 Reimagine** with the budget spent | **Opens W7.** It does not draw, does not expand, does not disable, and does not toast |
| Failure | The status chip stays, and carries the failure copy plus its own control (below) |
| Offline (`!isSupabaseConfigured`) | `draft-character://<id>`. Render a placeholder silhouette in the card at the same proportion. **Never a broken image**, and never an error: offline is a build configuration, not a failure the person caused |

### The benefit card

`spacing.xl` below the control, the informational card recipe (§9): `surface`,
1 pt `colors.onboardingBorder`, `radius.onboardingCard`, three rows divided by
1 pt `colors.onboardingPlate`, a title in `onboardingType.body` at 700 and a line
under it in `onboardingType.helper` in `colors.muted`.

**Amended 2026-09-12 (second round): duotone `GlyphTile`s and balanced copy**, on
the same contract as W4's card (§9). W6's three marks are `GlyphLeadsStories`,
`GlyphSameFace` and `GlyphSavedCast` — **three of the six, and none of them is
one of W4's three**. No Ionicons in these rows.

| Glyph | Writer title | Writer line |
|---|---|---|
| `GlyphLeadsStories` | **Leads your stories** | **At the centre of what you write** |
| `GlyphSameFace` | **Same face, every time** | **Consistent across every chapter and story** |
| `GlyphSavedCast` | **Saved to your cast** | **Reuse them in any story, any time** |

Reader variant: the first row becomes **You, in every story** ·
**Step into anything on your shelf**, and the third becomes **Saved to you** ·
**Step into any story, any time** (amended 2026-09-14: a reader is not building
a cast, they are in it). Row two is the same string in both voices.

**The lines lost `{name}` and gained a shape.** Three words of title and about
six of line is the rule both cards now keep, and the interpolated name was what
made these rows ragged: **Put {name} at the centre of anything you write** is
nine words that grow with the name, so a long name wrapped one row to three lines
and the card stopped looking like a list. The portrait is directly above these
rows with the name on it; the rows do not have to say it again.

**It is here rather than on the paywall because it is about the character, not
the plan.** W6 is the one screen where a person is looking at something they
made and deciding whether to keep it, and the honest case for keeping it is what
it does next. None of the three rows is an entitlement and none of them is
gated, which is why they can sit in front of W7 without being a pitch for it.

**Failure, in the status chip, never as a full-screen error.**

| Case | Chip copy | Control |
|---|---|---|
| Any generation failure | **We couldn't draw {name}. Try again.** | **Try again** inside the chip |
| **429**, `CharacterPortraitRateLimitError` | The endpoint's own message, verbatim | **None.** There is a window to wait out and a retry button would lie about that |
| **403**, `code: "guest_portrait_cap"` | **Sign in to keep making characters.** | **None.** It is an ask, not a failure, and a retry cannot succeed |

**A failed attempt and its Try again do not consume the reimagine.** A person who
has spent nothing and received nothing has not made a choice.

**There is no fallback portrait.** A substituted portrait is a different
character wearing the person's name, which is worse than saying it did not work.

**Reduced motion.** The scan band, the dots and the status pulse are **static**:
the band rests at the top of the card, the dots hold at full scale and opacity,
the line holds at full opacity. **The status text still rotates on its 2200 ms
cadence**, because it is the only thing on the screen that reports progress and a
frozen sentence during a 30 second wait reads as a hang. The cross-fade becomes
an instant swap.

**Exit.** **Keep {name}** / **Keep this me** writes the portrait URL onto the
saved character row and continues to W7. **Exit routing is decided here and
executed after WELCOME:** `purpose = write` enters the Create studio with {Name}
pre-filled as the lead; `read` and `both` enter Home.

**Instrumentation:** `onboarding_character_w6_loading_shown { purpose,
attempt_index }`; `onboarding_character_w6_ready { latency_bucket,
reimagines_used }`; `onboarding_character_portrait_failed { reason }`;
`onboarding_character_reimagine_tapped { index }`;
`onboarding_character_reimagine_blocked_paywall { reimagines_used }`;
`onboarding_character_kept { reimagines_used }`. `index` is always 1. Never send
the portrait URL, the storage path, or the prompt.

**Amended 2026-09-12.** `onboarding_character_reimagine_tapped` now fires on
**Redraw**, the moment an image call is actually made, not on the pill that opens
the editor: an event named for a reimagine that counts an expand is a funnel that
cannot be read. `onboarding_character_edit_details_tapped` is **retired with the
control it named** and must not be sent; there is no event for opening the block,
because the block is free and opening it is not a decision anyone is measuring.
**Amended 2026-09-12 (second round):** the round-one clause banning a `gender`
property on these events is moot and removed with the row it protected (§9).

---

## 11. A1: Save {Name}

**A1 is now W5 Save plus the code screen** (§10, §10A). It has no separate
screens of its own and it no longer sits after the aha: since 2026-09-11 the
email is asked for **before** the drawing, and verification happens while the
image is being made.

`artifact_kind` is **`character`**. The `shelf` and `blueprint` kinds are retired
with §§4-7 and must not be sent.

The auth panel recipe is unchanged where it is used: `colors.surface`,
`radius.xl`, `shadows.overlay`, in order —

1. **Continue with Apple**
2. **Continue with Google**
3. **or**
4. Email input: **you@example.com**
5. **Continue with email**
6. **Already have an account? Sign in**

On the character path W5 renders the email field and CTA in the screen's own
layout (§10) rather than inside a floating panel; the provider buttons, the
divider and the sign-in line keep this order wherever they appear. Provider
errors are safe, actionable, rendered in place, and retain every field.
Existing-account sign-in keeps the artifact.

**The identity contract is unchanged.** Verification upgrades the anonymous user
in place, so the character saved at W5 and the 3 guest credits survive, and the
one fallback for an address that already belongs to somebody re-points the
character instead. Both are specified in **§16**, which is the only place they are
written down.

**Instrumentation:** `onboarding_auth_shown { artifact_kind: character }`;
`onboarding_auth_provider_tapped { provider }`;
`onboarding_auth_completed { provider, artifact_kind: character }`;
`onboarding_auth_failed { provider, error_code }`. Never send email or content.

---

## 12-13. W7: the paywall

**The Reader and Writer paywalls merged 2026-09-11**, one section per the pricing
rebuild that left one product. The two-audience split was always a volume ladder
wearing an identity label, and the character flow erased the line it assumed: a
reader who reimagines a chapter is creating.

**W7 draws no progress row.** The close **×** is the only chrome: 44 × 44, radius
14, `colors.onboardingPlate` plate, top right, **from frame one**.

| Item | Writer copy | Reader copy |
|---|---|---|
| Header | **{name} is ready. Give them a story.** | **{name} is ready. Step into the story.** |
| Sub | **Unlock Katha and start writing tonight.** | **Unlock Katha and start reading tonight.** (amended 2026-09-14) |
| CTA | **Unlock Katha** | **Unlock Katha** |
| Dismiss | The **×**, from frame one | same |

### Layout: a scrolling body over a pinned sheet

**Rewritten 2026-09-12.** W7 is two pieces.

**The body scrolls**, and **since 2026-09-12 (second round) its order is the
close ×, the hero, the benefits card, then the testimonial rail last**. **The
sheet is pinned to the bottom and always visible**: `colors.surface`,
a 1 pt `colors.onboardingBorder` top edge, `shadows.overlay`, safe-area padded,
holding the two plan cards, the **Cancel anytime, no commitments** line and
**Unlock Katha**. The body's scroll content ends clear of the sheet's height.

**The price and the button must not be scrollable away.** The screen grew a
testimonial rail and the benefits card was already tall, which put the thing
being sold and the thing that buys it below the fold on a 360 pt phone. A person
scrolling a paywall is reading the case for it; the decision has to stay under
their thumb while they do.

**The benefits card comes before the rail, because it is the offer and the rail
is the corroboration.** Round one put eight auto-scrolling testimonial cards
between the hero and the four rows that say what the money buys, so the first
thing under the headline was a moving row of strangers and the entitlements were
below it. What the plan includes is the answer to the question the header asks;
other people's use cases are the answer to a question asked only after that one
lands. Last is also where a marquee belongs — it is the one element with no end,
and nothing has to be scrolled past it.

**The hero.** A **104 × 134** portrait card at radius 18 with a 3 pt
`colors.surface` border and `shadows.onboardingPortrait`, 16 pt to the left of
the heading it is the subject of. Heading at `fonts.display` 25 / 1.1; sub 8 pt
under it at 13.5 / 1.45 in `colors.muted`. When the portrait is null, a
placeholder silhouette at the same proportion.

### The testimonial rail

**Added 2026-09-12**, **last in the scrolling body since the same day's second
round**, and it is the one deliberate reversal of this section's own prohibition
list. See the note at the end of this section for why.

| Property | Specification |
|---|---|
| Cards | **Eight**, 260 wide × about 150 tall, in one horizontal row |
| Card content | A **44 pt** round photo, the person's name, and a **two to three sentence** quote in `onboardingType.helper`. **No tag** |
| Motion | One Reanimated shared `translateX` over a **duplicated** row, about **40 pt per second**, linear, repeating forever, wrapping at the width of one copy so the seam never shows |
| Touch | The animation **pauses while the rail is touched** and resumes on release |
| Reduced motion | **A plain horizontal `ScrollView`.** No auto-scroll, no translation, every card reachable by hand |
| Photos | `expo/assets/testimonials/<slug>.png`. The files in the tree are provisional and are replaced by the product lane under the same names |

The eight personas, by slug, in order: `mateo-rpg`, `ana-bedtime`,
`dev-commute`, `chloe-fanfic`, `marcus-dad`, `priya-bilingual`, `ruth-memoir`,
`leo-worldbuilder`. Each persona's use case is what their **quote** is about; the
slug is the asset name and the ordering key and is never rendered.

**The use-case tag is deleted, from the card and from the data.** Round one gave
each card an accent eyebrow — "Bedtime stories for two", "Listens on the commute"
— above a quote that then said the same thing in the person's own words. That is
a label summarising the sentence directly beneath it, on a 260 pt card that has
room for one idea; it made every card a heading plus a paragraph and cost the
quote two lines. The tag is also the half of the card that reads as marketing
copy rather than as somebody talking, which is precisely the line this rail has
to stay on the right side of. The `tag` field leaves the persona data so it
cannot come back as an unused string somebody later renders.

The rail auto-scrolls rather than sitting still because eight cards at 260 pt are
six screens wide and a static row shows one and a half of them: the motion is how
the person learns there is a row at all. It is slow and linear rather than eased
so it reads as a marquee and not as a thing that has just been tapped, and it
stops under a finger because a row that keeps moving while it is being read is a
row nobody finishes a sentence in.

**The benefits card**, 16 pt below the hero and 16 pt above the testimonial rail:
`colors.surface`, 1 pt
`colors.onboardingBorder`, radius 20, four rows divided by 1 pt
`colors.onboardingPlate` rules, each row 10 pt of vertical padding with a 20 pt
emoji, a 14 / 1.35 bold title and a 12.5 pt `colors.muted` line under it. Emoji
are content here, not icon glyphs.

| | Row | Second line |
|---|---|---|
| ✨ | **50 credits a month** | Writer: **About 16 full chapters, every month** · Reader: **About 16 chapters with you as the lead, every month** |
| 🎨 | **Unlimited portraits and reimagines** | Writer: **{name} looks the same in every chapter** · Reader: **You look the same in every chapter** |
| 🎙️ | **Premium voices** | Writer: **Hear {name}'s story read aloud** · Reader: **Hear your story read aloud** |
| 📄 | **Download as PDF** | **Your stories, off the app and in your hands** |

**Four rows, in exactly this order.** The five-row list C4's paywall carried is
gone: portraits and reimagines are one row because they are one entitlement, and
the free-tier parentheticals moved out of the rows entirely. They were arguing
with the product on the screen that sells it.

**The credits row does not follow the selected plan, and that is deliberate.**
It names the monthly grant — 50 — while the weekly card beside it carries its
own **20 credits a week** on its own note line (§ the plan cards above). Weekly
is the larger grant of the two at about 86 a month, so the fixed row is a floor
for every plan on the screen and never an over-promise for the one selected; a
row that re-wrote itself on each tap would also make the benefits card flicker
under the thing the person is choosing between. If a plan is ever added whose
grant is BELOW 50 a month, this row has to become plan-aware in the same change.


**The plan grid**, inside the pinned sheet, two equal columns with a 12 pt gap.
**Rewritten 2026-09-12 (second round): the cards are compact, about 92 pt tall.**
Each is one row of layout rather than a stack: the eyebrow and the price sit on
**one line**, and the note sits under that line. Nothing else is inside a card.

| | Weekly | Yearly |
|---|---|---|
| Card | `colors.surface`, 1.5 pt `colors.onboardingBorder`, radius 20, height about **92** | `colors.accentSoft` fill, **2 pt `colors.accent`** border, radius 20, height about **92**, **selected by default** |
| Badge | none | **SAVE 80%**, `colors.premium` pill, white, **9 pt** / 800 / `0.12em` |
| Eyebrow + price | **WEEKLY** then **$5.99** on one line, with **/wk** at 12 pt in `colors.muted` | **YEARLY** then **$59** on one line, with **/yr** |
| Note | **20 credits a week** | **$0.16 a day** |

The sheet holds the two cards, the cancel line and the CTA above the safe-area
inset on a 360 pt phone, and the tall two-row card it replaced is what made that
tight. A plan card is a price and a unit; stacking the eyebrow, the price and the
note down a 130 pt column spent a third of the sheet on air between three short
strings.

**The yearly note is a daily price, derived, not a monthly one.** **$0.16 a day**
is **59 / 365 rounded to cents**, and it is **computed in code from the plan's
own price** — never written as a literal string, so a RevenueCat price that moves
moves the line with it. It replaces **$4.92 a month, billed yearly**, which
compared the yearly plan against a monthly plan that **is not on this screen**
(§12-13, and `CREDITS_AND_PRICING.md` §3): a person reading it had to be told
what a month costs before the comparison meant anything, and the one price we
deliberately withhold here is the monthly one. A day is a unit that needs no
second price to be understood, and it is the smallest honest way to say what a
year costs. It is a restatement of the same $59, not a separate charge, and the
card still shows **$59 /yr** as the price above it.

**SAVE 80% is annualised weekly against yearly, and it is rounded down.** Weekly
at $5.99 is $311.48 a year; $59 against that is a **81%** saving. The badge says
80% because a claim on a paywall should be the conservative reading of its own
arithmetic, and because the figure has to stay true if RevenueCat returns a
localised price that moves the ratio a point. **It is not a discount off a former
price** and must never be drawn as a struck-through one.

**Both derived numbers on the yearly card are recomputed from its price, never
typed.** The badge is the annualised weekly-against-yearly saving, rounded down;
the note is `59 / 365` rounded to cents. `CREDITS_AND_PRICING.md` §3 carries both
derivations and is canonical for them.

Then, 14 pt below the grid, centred: a `colors.onboardingSuccess` **✓** and
**Cancel anytime, no commitments** at 12.5 pt in `colors.muted`. All of it is
inside the pinned sheet.

**Unlock Katha** closes the sheet, 8 pt below that line, and **there is nothing
under it.**

### "Not now" is removed, and the × is the free path

**Amended 2026-09-12.** W7 had two dismissals: a text link under the button and
the close × in the corner. One of them goes.

**The × survives, not the link.** The × is present from frame one, is 44 × 44 on
a `spacing.huge` target, and is where every full-screen sheet in the app is
dismissed, so a person already knows it. **Not now** was a second control doing
the identical thing, placed where a secondary CTA goes and styled like one, which
makes the last thing on the screen a choice between two buttons rather than one
offer with an exit. The ban in §17 is on a **hidden, delayed or
confirmation-gated** dismiss, and the × is none of those: nothing about removing
the link makes leaving harder, slower, or less obvious, and if it ever did, the
link comes back rather than the × moving.

**No free trial, anywhere on this screen. No monthly plan, and no More options
disclosure.** Both are deliberate removals from the C4-era paywall. A trial on a
credits product hands out the thing being sold and then asks for the card back,
and a third plan under a disclosure was a row nobody opened that still had to be
priced, localised and tested. Two cards, one selected, no fine print to expand.

**Never on this screen:** "unlimited generation", "ad-free", "no interruptions",
"priority generation", "yours forever", "keep your stories", star ratings, fake
reviews, a countdown, a catalogue count, a free trial, a monthly plan, or any
implication that reading requires payment. The ad-free and permanence bans are
load-bearing: there are no ads to remove (`CREDITS_AND_PRICING.md` §12 item 7)
and PDF export ends with the plan.

> **Testimonials left that list on 2026-09-12, and star ratings and fake reviews
> did not.** The ban was written against social proof as a substitute for the
> product: a five-star row, an invented review, a number of happy users. The rail
> above is a different object. Each card is one person's **use case** — bedtime
> stories, the commute, a bilingual reader, a grandmother writing for her
> grandchildren — and it is doing the job the benefits card cannot, which is
> showing that the thing has more than one shape. A person who came to write fan
> fiction has no idea from four entitlement rows that somebody else uses this at
> a bedside. **No stars, no ratings, no counts, and no claim about anyone's
> results.** If a card ever carries a number or a superlative it is a review
> again and it comes out.

RevenueCat supplies the actual display price and renewal terms, purchased by
package type. The values above are configuration, not hardcoded strings; on web
or with no offering the purchase simulates.

The close target is `spacing.huge` and there is no confirm-close sheet. A decline
fires the idempotent **3**-credit welcome grant keyed `welcome:{user_id}`.
Paywall presentation never grants.

### Leaving W7 asks for notifications

**Rewritten 2026-09-12: the notification soft-prompt screen is deleted.** On
either exit — the × or a completed purchase — W7 calls `enableNotifications()`
from [`expo/src/lib/notifications.ts`](../expo/src/lib/notifications.ts)
directly, which raises the **OS** permission dialog, and then continues to
WELCOME. `notificationsEnabled` in the onboarding result carries the OS answer.

**A soft-prompt screen that only ever said yes is a screen.** Katha asked for the
same thing twice: a full Katha-styled page explaining why notifications are
useful, and then the system dialog. The explanation was true and nobody needed
it — the request lands one tap after a paywall, in the same breath as an image
the person just waited for, which is the most legible possible moment for "tell
me when it is ready".

> **The accepted trade: on iOS this is the only chance.** A soft prompt exists so
> a person who is not ready can decline the app instead of declining the OS,
> which iOS never asks again. Firing the real dialog here spends that one shot,
> and a person who taps Don't Allow can only be recovered through Settings.
>
> **It is accepted rather than overlooked.** The soft prompt was not buying much:
> it sat at the end of onboarding where a Not now was a screen to get past, and
> the people it protected are largely the people who would have declined the OS
> dialog anyway. What it cost was an extra full screen at the exact moment the
> flow should be handing over. If the decline rate says otherwise, the soft
> prompt returns in front of `enableNotifications()` and nothing else about this
> section changes.

**Instrumentation:** `onboarding_paywall_shown { entry, product_id }`;
`onboarding_paywall_product_selected { product_id }`;
`onboarding_paywall_purchase_tapped { product_id }`;
`onboarding_paywall_purchase_result { product_id, result_code }`;
`onboarding_paywall_declined { method }`. `entry` is `onboarding` or
`reimagine_blocked`. The `kind`, `paywall_kind` and `trial_eligible` properties
are retired — the first two with the two-audience split, `trial_eligible` with
the trial itself — and must not be sent.

---

## 14. OF: One-time offer

> **REMOVED 2026-09-10, recorded here 2026-09-11.**
> [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §3 removed the offer: at $29
> for 600 credits it netted $24.65 against $44.28 of cost at the worst story
> shape, a $19.63 loss, and the single plan ladder left nothing to discount but
> the thinnest row in the model. The weekly plan at $5.99 is the low-commitment
> entry instead.
>
> **Nothing in this section renders.** Its copy, its 2:00 timer, its
> `ai.katha.sub.reader.yearly.offer` SKU and its entire `onboarding_offer_*`
> event family are deleted, not deprecated — the events are gone from §18 and
> must not be sent. The welcome grant now fires on declining the paywall.
>
> **The consequence worth keeping is the one in §0.** The countdown ban was the
> only prohibition in this document carrying an exception that had to be
> defended and audited. Removing the offer removes the exception. There is no
> surface in Katha where a clock pressures a purchase, and that is a simpler
> promise than the one it replaced.

---

## 15. WELCOME

| Item | Exact copy |
|---|---|
| Header | **Welcome to Katha.** |
| Sub | **Your next chapter starts here.** |
| CTA | **None.** Amended 2026-09-12 (third round): the screen advances itself |

A quiet shared greeting after the OS notification prompt (§12-13), on every path.
**Amended 2026-09-12: there is no soft-prompt screen between W7 and this one any
more**, so WELCOME is now the screen immediately after the paywall. Uses
the wordmark and `colors.bg`. **No plan comparison, no price, no disclaimer, no
grant explanation, and no "reading is free" line** — that claim belongs where a
person might doubt it, not on a congratulation.

### There is no button, and the screen advances on its own

**Amended 2026-09-12 (third round): "Open Katha" is removed.** The coins drop
and settle on the existing spring choreography, the composition holds for
**700 ms**, and then `onOpen()` fires by itself.

| Condition | Behaviour |
|---|---|
| Normal motion | Coins drop and settle, hold **700 ms** after the last one settles, then `onOpen()` |
| Reduced motion | Coins render already settled, and `onOpen()` fires after **900 ms** |
| Tap anywhere | **Nothing.** The screen is not tappable and there is no skip |

**A button here was asking permission to finish something already finished.**
Every other CTA on the path buys the person something — a character, a portrait,
an account, a plan. This one buys nothing: the grant has landed, the flow is
over, and the only thing left is to be in the app. A press that changes nothing
except the moment it happens is a toll, and it was the last thing onboarding did.

**The 700 ms is the coins' beat, not a guess.** It is long enough that the
settle reads as complete and the number is legible before the screen moves, and
short enough that nobody starts looking for the control. Reduced motion gets
**900 ms** because there is no drop to watch: the composition arrives whole, and
the same 700 ms after nothing has moved reads as a flash rather than as a
moment. It is not tappable to skip because a skip target that is invisible and
lasts under a second is a control nobody finds and everybody triggers by
accident.

**This is the only auto-advance in Katha**, and it is allowed exactly because
nothing is lost by missing it. Nothing on this screen is a decision, nothing on
it is dismissible, and nothing on it can be read wrong in 700 ms.

### The credits animation

**Added 2026-09-11.** Three coins settle onto the WELCOME composition while it is
on screen. **Amended 2026-09-12 (third round): the auto-advance is what launches
the flight**, since there is no **Open Katha** to press. They fly to Home's
credits pill, which bumps as each one lands and ticks **0 → 3**.

| Property | Value |
|---|---|
| Coins | **Always 3.** The handful is the picture of a gift at any grant size |
| Amount counted to | **3** for a free user (the guest grant), or **the plan's credits** for someone who just subscribed: 20 weekly, 50 yearly. Read from `PLANS` in `OnboardingPaywall.tsx`, never typed a second time |
| Mark | **`CreditCoin`**, the credit currency's face as an object. Not a flat disc, and not the `Sparkles` glyph. See below |
| Trigger | The 700 ms hold after the coins settle, then `onOpen()` (above) |
| Target | Home's credits pill, measured in window coordinates at flight time |
| Per landing | The pill scale-bumps and the number increments by one |
| Frequency | **Once per account.** Persisted, not session state |
| Reduced motion | **No flight.** The pill renders **3** directly, and WELCOME shows the coins settled and static for the 900 ms |
| On a subscriber | **Played, amended 2026-09-13.** Three coins still, counting to the plan's grant |

**Three coins, and the number is what changes. Amended 2026-09-13.** The coin
count is a picture, not a count: a subscriber is granted 20 or 50 credits and a
stack of 50 coins is a swarm rather than a gift, so the flight is always three
coins and the pill's number is what carries the grant. A free user's pill ticks
**0 → 1 → 2 → 3**; someone who just bought yearly on W7 sees **0 → 17 → 34 → 50**,
and the last landing always shows the exact amount rather than a rounded figure,
because that figure stays on screen until the real balance replaces it. The
amount comes out of the paywall with the purchase (`onSubscribed` reports
`{ credits, plan }` from the plan the person chose) and defaults to the free
grant of 3 when they declined, so no number is written down twice. It was
previously specified as "not played for a subscriber", which left the one person
who had just paid as the only one who never saw where their credits live.

**The coins are `CreditCoin`, a drawn mark, not a yellow circle.** **Added
2026-09-12 (third round).** It is the credit currency's face **everywhere a
credit appears as an object**: WELCOME's settled stack and the three that fly to
Home. It is a duotone coin with a gold face, a darker rim, an inner highlight and
the Katha spark on it, and it must read at **20 pt and at 52 pt**, because it is
both a thing in a stack and a thing in flight. Its drawing and its rules are
`DESIGN_SYSTEM.md` §7.2, which is where the mark is specified.

**Home's header pill keeps its `Sparkles` glyph.** The coin carries the same
spark on its face, which is what makes the flight legible: three objects land on
the pill and the mark they were carrying is the mark already sitting there, so it
reads as arriving at the place credits live rather than as two different symbols
for one thing. A pill wearing the coin instead would be a coin containing a coin.

**The flat disc was the reason the animation read as decoration.** Three yellow
circles crossing a screen are three yellow circles; a coin with a rim, a
highlight and a face has mass, and mass is what makes an object look like it went
somewhere rather than like an effect that played. This is the one moment in the
product where a credit is a thing rather than a number, and it was being drawn
with the least specific shape available.

**This is the exception to "WELCOME carries no number", and it is deliberate.**
The rule existed because a balance printed as text on a congratulation screen is
an administrative detail interrupting a moment. Three coins arriving in the place
the balance lives is not a statement of a number; it is where the number came
from, shown once. The in-app messaging system still announces the balance after
landing, and the two do not duplicate each other because one is a fact and the
other is an arrival.

**It is once per account because a repeat is a lie.** The grant happens once, so
an animation that replays is showing money arriving that did not arrive. The flag
is persisted (`hasPlayedWelcomeFlight` / `markWelcomeFlightPlayed`), not held in
memory, precisely so a reinstall-and-replay cannot happen by accident.

Backend grants before this screen with `welcome:{user_id}`. WELCOME does not wait
on or claim the balance. The flight makes no balance request: it ticks the pill
to the grant it was told about, and when it finishes the pill shows the balance
the app already holds, which is whatever the last bootstrap returned. If that is
stale, it stays stale until the next bootstrap (the next launch) reconciles it;
the grant is idempotent, so the number the flight showed is the number that
arrives. An animation that stalls on a network call is worse than one that is
briefly optimistic about a grant we control.

Exit: `purpose = write` enters Create with {Name} pre-filled as the lead;
`read` and `both` enter Home.

**Instrumentation:** `onboarding_welcome_shown { grant_path:
paywall_declined|subscribed }`; `onboarding_welcome_flight_played { credits }`;
`onboarding_completed { purpose, terminal_route, subscription_outcome,
reimagines_used }`.

---

## 16. Pre-paywall portrait contract

> **Replaces the pre-paywall *concept* contract, 2026-09-11.** Onboarding no
> longer requests a concept, a blueprint, opening variants or preview prose, and
> the `OnboardingConcept` payload that section specified is retired. What
> onboarding requests now is one image.

### The call order

**Amended 2026-09-12 (third round): the save and the draw fire on W4's CTA, and
W5's CTA sends the code.** They were moved onto W5's CTA on 2026-09-11 and onto
W4's today. On the anonymous session, in this order across the two screens:

| # | Call | Fired by | Blocking? |
|---|---|---|---|
| 1 | `saveCharacter` → one `user_characters` row, `portraitUrl` null | **W4**'s CTA | No. Fire-and-forget; a failure is logged and retried once when the portrait lands |
| 2 | `storyApi.generateCharacterImage` → fresh `requestId` | **W4**'s CTA, immediately after 1 | No. A failure surfaces on W6's status chip (§10B) |
| 3 | `sendEmailCode` | **W5**'s CTA | **Yes.** The code screen is entered only if this resolves |

W4 advances to W5 without awaiting 1 or 2. The portrait URL is written onto the
existing row when it lands, and again on a reimagine. **There is no
`draft-character://` row**: offline builds render the placeholder silhouette
against a real row rather than persisting a fake URL.

**Two screens of cover instead of one.** The call takes about ten seconds and the
code screen alone did not reliably cover it, so W6 opened loading more often than
not. Starting at W4 puts the email screen in front of the code screen as cover as
well, and **W6 opening ready is now the expected outcome** (§10B). The ordering
constraint that forced 3 first has gone with it: the code send was in front only
because it was the gate on advancing, and it is not a prerequisite of either
other call — every one of the three runs on the same anonymous identity, which
exists from `bootstrapUser` and is unchanged by any of them.

**A repeated W4 press with an edited sheet makes a second call**, with a fresh
`requestId` replacing the pending result (§9). It counts against the lifetime cap
below, and it does not touch the reimagine budget.

### The request

`generate-character-image`, through `storyApi.generateCharacterImage` in
[`expo/src/lib/api.ts`](../expo/src/lib/api.ts):

~~~ts
{
  requestId: string,
  name: string,
  appearance: string,
  imageStyle: "auto",
}
~~~

**There is no `gender` field.** It was added to this shape on 2026-09-12 and
removed the same day (§9): the client does not send it, `generate-character-image`
does not read it, and
[`backend/supabase/functions/_shared/image.ts`](../backend/supabase/functions/_shared/image.ts)
composes no clause from it. The endpoint's own support and its tests came out
with the field, so the contract carries no unreachable branch. A reimagine sends
this same shape with whatever appearance the W6 edit block currently holds.

**No reference image in onboarding.** The endpoint accepts one and the Craft
character sheet sends one; onboarding does not, because attaching a photo is a
permissions prompt and a likeness question in the first ninety seconds of the
app.

### The response

~~~json
{ "url": "https://…", "image_url": "https://…", "storage_path": "…", "provider": "…", "model": "…" }
~~~

`provider` is the only field of the five that reaches analytics, and only as an
enum on `onboarding_character_w6_ready`.

### Bounds

| Bound | Value | Enforced by | What the client renders |
|---|---|---|---|
| Characters per person | **1** | The flow. There is no add-another control | — |
| Reimagines | **1**, **per onboarding**, **no counter** | The flow (§10B) | **🔄 Reimagine** opens the inline edit block; **Redraw** spends it; once spent the pill opens **W7** |
| Image calls per person | **2** on the happy path: the W4 press plus 1 reimagine. A W4 edit-and-resubmit adds one each (§9) | The above, plus a fresh `requestId` per attempt | — |
| Requests per anonymous identity, lifetime | **4**, reimagines included | `claim_guest_portrait_request`, server-side (migration 00084). **403**, `code: "guest_portrait_cap"` | The endpoint's own copy in W6's status chip: **Sign in to keep making characters.** No retry control |
| Requests per user per hour | **12** | `claim_character_portrait_request`, server-side (migration 00055). **429** | `CharacterPortraitRateLimitError`'s own message in W6's status chip. No retry control |
| Any other failure | — | — | **We couldn't draw {name}. Try again.** with **Try again** inside the chip |
| Field lengths | name ≤ 100, appearance ≤ 500 | The endpoint, 400 on overflow | W4 caps NAME at 40 and APPEARANCE at 300, so neither is reachable from onboarding |

`CharacterPortraitGuestCapError` is a subclass of `GenerationRequestError` in
[`expo/src/lib/api.ts`](../expo/src/lib/api.ts) carrying the body's message, so
the 403 is distinguishable from the 429 and from a generic failure at the call
site rather than by string matching.

A failed attempt and its **Try again** do not consume a reimagine, so a person on
a bad network can exceed two calls. The two server-side limiters bound that, and
both refuse rather than degrade — a broken limiter is never a free pass.

**The lifetime cap is the one that matters here, and it is new on 2026-09-11.**
The hourly window bounds a burst inside one session; it does not bound anything
at all when a fresh anonymous session is one `signInAnonymously` call away, which
is the gap migration 00055 recorded against itself. 00084 closes it by giving an
**anonymous identity** six character images for the life of that identity,
reimagines and retries included, keyed on `auth.users.id`. **Never on a device
identifier** — Katha collects none, and starting to would be a privacy and
store-disclosure decision rather than a rate-limit detail (§17).

**The six are per ACCOUNT, and they survive verification** (migration 00088).
The counter was anonymous-only when this section was written, and a named user
was not bounded by it at all. It now bounds everyone — free tier and paid plan
alike — and because it is keyed on `auth.users.id` while email verification
converts the anonymous user *in place*, the count does not reset when somebody
signs up. Someone who spent four getting a face they liked during onboarding has
two left, not six.

Past the six, each image costs **1 credit** — except for an anonymous identity,
which is refused rather than charged: its credits are the three from
`bootstrap_user` and those exist to get it a story, the thing that converts it.

A generation that fails calls `release_guest_portrait_request`, so **Try again**
costs the person nothing: the slot comes back and the endpoint has no credit
reservation to refund in its place.

**At least one of the four is spent before the code is verified**, and from
2026-09-12 it is spent before the email is even typed, because the draw now
starts on W4's CTA. That is the one consequence of putting the draw in front of
verification and it is acceptable for the same reason it always was: the cap is
keyed on the identity, verification upgrades that identity in place, and the same
person spends the same requests either way. **A W4 edit-and-resubmit spends a
second**, which is the new way to reach the cap without failing anything, and
six is comfortably above what two edits and a reimagine cost.

### The session

**The portrait is generated on the anonymous session**, and so is the save and
the code send. `bootstrapUser` → `signInAnonymously` already exists and runs
before all three; `generateCharacterImage` awaits it. Anonymous is the whole
point — the aha must not be behind an account.

### Failure semantics

| Case | Behaviour |
|---|---|
| 502, no image | W6's status chip, **Try again**, no reimagine consumed |
| **429, rate limited** | The chip carries `CharacterPortraitRateLimitError`'s own message and **no retry control**. There is a window to wait out |
| **403, `code: "guest_portrait_cap"`** | The chip carries the endpoint's own copy — **Sign in to keep making characters.** — and no retry control, because it is an ask, not a failure, and the flow's own failure state would invite a retry that cannot succeed. Unreachable on the happy path: it takes four requests to hit and onboarding makes two |
| 500 / network | The generic chip and **Try again** |
| `!isSupabaseConfigured` | `draft-character://<id>` after ~700 ms. Render a placeholder silhouette; never a broken image and never an error |

**There is no silent fallback portrait.** A portrait is of a named person the
user just described, so a substitute is a different character wearing their name,
which is worse than saying it did not work.

### What is not created

**No ledger row, no reservation, no refund path, and no credit of any kind.**
`generate-character-image` has no credit reservation today and onboarding must
not add one. The onboarding portrait **is** counted, though: the anonymous
lifetime cap of four (above, migration 00084) counts every request an anonymous
identity makes, onboarding's included. It has to — onboarding is the only place
an anonymous identity can reach this endpoint, so exempting it would exempt the
whole cap.

The **named** four-free-per-account ledger in
[`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) §3 is still a **follow-up in
that endpoint**, and it is a different counter. When it lands, the two must not
be summed: a person who signs in has not spent any of their named four, for the
same reason `claim_guest_characters` moves characters and not credits.

Onboarding also creates no `stories`, `chapters`, `characters`, `covers`, audio,
or generation operation.

### What W4 saves

**Renamed 2026-09-12 (third round) with the CTA that fires it.** It was "What W5
saves" for one day.

**One `user_characters` row** (migration 00057): owner, name, appearance, and the
portrait URL once it exists. That is the artifact, it is cross-story, and reusing
it later costs nothing.

> **Verified 2026-09-11 in code: email verification upgrades the anonymous user
> in place, and the character and the 3 guest credits survive.**
>
> [`expo/src/lib/session.ts`](../expo/src/lib/session.ts) takes Supabase's
> convert-an-anonymous-user pair, not its create-or-sign-into-an-account pair.
> `sendEmailCode` calls `supabase.auth.updateUser({ email })` on the guest
> session and `verifyEmailCode` calls
> `supabase.auth.verifyOtp({ type: "email_change" })`. **Same `auth.users.id`,
> same `profiles.id`**, so the `user_characters` row, the guest credits and the
> cached display name all stay attached and nothing has to be migrated. Only
> `auth.users.is_anonymous` flips to false; `bootstrap-user` called again by the
> now-named user upserts the same profile row, no longer takes the guest branch,
> and mints no second grant.
>
> **This was not always true, and the note it replaces is worth keeping.** Until
> 2026-09-11 the call was `signInWithOtp({ shouldCreateUser: true })` followed by
> `verifyOtp({ type: "email" })`, which issues a session for a **different**
> `user_id`. `user_characters` is owner-scoped under RLS (migration 00057), so
> the row stayed where it was and the caller could no longer see it: the library
> came back empty, the credits read zero, and nothing reported an error. **The
> screen is titled Save {Name}, and it was the one thing the screen lost.** A
> silent data loss on the exact artifact the flow exists to produce is why this
> contract names the identity behaviour rather than assuming it. **It matters
> more now than it did**, because the row is written at W5 and the conversion
> happens one screen later with the image still in flight.
>
> **There is one fallback, and it behaves differently on purpose.** `updateUser`
> fails when the address already belongs to somebody, and there is no in-place
> merge for that — the person is signing into an account that predates this
> device. That path signs in with `signInWithOtp` / `verifyOtp({ type: "email" })`
> and then re-points the guest's `user_characters` rows onto the account they
> just proved they own, by handing `bootstrap-user` the still-valid anonymous
> access token. The server verifies that token with Supabase Auth rather than
> trusting any client claim about which id it was, requires `is_anonymous`, and
> calls the service-role-only `claim_guest_characters` RPC (migration 00082),
> which moves `owner_id` on that one table and nothing else — not credits, and not the guest's portrait count.
>
> | | In-place conversion (normal) | Existing-account fallback |
> |---|---|---|
> | `user_id` | **Preserved** | New |
> | The saved character | Stays attached | **Re-pointed** by `claim_guest_characters` |
> | The 3 guest credits | Stay attached | **Do not move** |
>
> **Credits deliberately do not move on the fallback.** The guest grant is
> rate-limited per network prefix (`CREDITS_AND_PRICING.md` §9), and carrying it
> onto named accounts would convert that limit into a farm: sign in repeatedly
> from fresh guest sessions and each one donates its 3. The character moves
> because it is the person's own artifact and there is exactly one of it; the
> credits are money and are bounded by the limit that created them.
>
> Re-homing is **never fatal**. The person has verified their email and is
> standing in the middle of onboarding with an image in flight; failing that
> screen because a character could not be moved costs them more than the
> character does. The failure is logged rather than swallowed, because a silent
> one here is the exact class of bug this contract was written against.

---

## 17. Prohibitions

Never ship: an author byline; **any model or image call on the shared
questionnaire, on W3, or while W4 is being filled in** — W4's CTA is where the
save and the draw now fire (§9, amended 2026-09-12), so the prohibition is about
the screen, not about its press: nothing may call a model while the person is
still typing a name and an appearance; more than one character in onboarding; more
than one reimagine per onboarding; a disabled **🔄 Reimagine** control at 0 free
left, or a toast in place of the paywall it opens; a spinner, percentage,
progress bar, elapsed time or generation claim on W6; a frozen status line under
reduced motion; a settle-back, spring or overshoot on W3's hero card; a
substituted or fallback portrait presented as the person's character; a broken
image on the offline path; a portrait that is truncated, faded, watermarked or
otherwise held back behind the paywall; a reference-image or photo attachment in
onboarding; a `draft-character://` row persisted as a real portrait URL; **a free
trial or a monthly plan on the onboarding paywall**, or a struck-through former
price beside **SAVE 80%**; "unlimited generation", "ad-free", "no interruptions",
"priority generation" or "yours forever" on the paywall; **a star rating, a
review, a user count or any claim about anyone's results** on the paywall's
testimonial rail, which carries use cases and nothing else (§12-13); any
implication that reading requires payment; a hidden, delayed or
confirmation-gated dismiss; **any timer anywhere**; an anonymous purchase; any
anonymous grant outside the rate-limited guest bootstrap defined in
`CREDITS_AND_PRICING.md` §9; **device identifiers for abuse control** — an
IDFV, an install UUID, an advertising id or any fingerprint, on this flow or
behind it; every bound in §16 is keyed on the account or the network instead, and
adding one would be a privacy and store-disclosure decision rather than a
rate-limit detail; a credit charge or ledger row anywhere in onboarding; a name,
appearance string, email, portrait URL or storage path in telemetry; **a gender
control anywhere in onboarding, or a `gender` field in the portrait request** —
the row lived for one round on 2026-09-12 and came out the same day, and W4 is
two answers (§9, §16); an Ionicon in a KATHA WILL DRAW or W6 benefit row, or one
glyph tile reused across those two cards; a reimagine counter or a "free left"
label on W6; a use-case tag on a testimonial card; a monthly price on W7's yearly
card, including as the note under it; **a second dismissal beside W7's ×**; a replayed welcome credits animation; **a Katha-styled screen asking for
notification permission in front of the OS dialog**, unless the decline rate
brings it back deliberately (§12-13); a tick mark, an emoji that is not
`genreChipLabel`'s, or an "Other" option
on the S2 genre chips; a genre on S2 that is not a real `Genre` id; a field
anywhere in onboarding set in `fonts.display` or `fonts.reader` (§1); **a primary
button anywhere between Get started and WELCOME that is not drawn by
`Button`** -- the size is `controls.primaryCtaHeight` at `radius.pill` and
there is no longer a second recipe to be drawn at instead (§1,
`DESIGN_SYSTEM.md` §6.1); **a pinned CTA on W3** (§8); **a wait time typed into
W6's JSX rather than read from `PORTRAIT_WAIT_CAPTION`** (§10B); **a button, a
tap target or a skip on WELCOME** (§15); **a flat disc standing in for
`CreditCoin`** anywhere a credit is drawn as an object (§15); or a
parallel design system.

---

## 18. Analytics event table

| Event group | Required safe properties |
|---|---|
| Purpose | `purpose` |
| Character CTA (W3) | `purpose` |
| Character craft (W4) | `purpose`, `initial_genre`, `name_length_bucket`, `appearance_length_bucket`, `prefilled_name` |
| Character save (W5) | `purpose` |
| Character portrait (W6) | `attempt_index`, `latency_bucket`, `provider`, `reason`, `index`, `reimagines_used` |
| Auth | `artifact_kind` (`character` only), `provider`, `error_code` |
| Paywall (W7) | `entry`, `product_id`, `result_code`, `method` |
| Completion | `grant_path`, `purpose`, `terminal_route`, `subscription_outcome`, `reimagines_used`, `credits` |

**Renamed 2026-09-11 with the C0-C4 screens they were written for.** The old name
on the left must not be sent:

| Retired name | Sent instead |
|---|---|
| `onboarding_character_bridge_shown` | `onboarding_character_cta_shown` |
| `onboarding_character_who_started` | `onboarding_character_craft_started` |
| `onboarding_character_who_submitted` | `onboarding_character_craft_submitted` |
| `onboarding_character_portrait_wait_shown` | `onboarding_character_w6_loading_shown` |
| `onboarding_character_portrait_ready` | `onboarding_character_w6_ready` |
| `onboarding_character_reveal_accepted` | `onboarding_character_kept` |
| `onboarding_character_plan_bridge_shown` | nothing. C4 has no successor screen |
| `onboarding_character_chip_selected` | nothing. W4 has no chips |

**Renamed 2026-09-12 (third round), because the draw moved off W5's CTA** (§9,
§10, §16). A name that describes a screen's position survives a change of
behaviour and goes on being read as the old behaviour, which is the failure this
row exists to stop:

| Retired name | Sent instead | Why |
|---|---|---|
| `onboarding_character_save_submitted` | `onboarding_character_email_submitted` | W5's CTA sends a code. It no longer saves the character or starts the portrait, so "save" names the wrong act |

**`onboarding_character_craft_submitted` keeps its name and gains a meaning**: it
is the press that writes the `user_characters` row and makes the image call, so
it is the start of the portrait clock and the denominator for
`onboarding_character_w6_ready`'s `latency_bucket`. **Never measure that bucket
from a W5 event again.** No new event is added for the save or the draw: they
fire together on one press that already has an event, and a second event on the
same press measures the same thing twice.

**There is no WELCOME dismissal event**, because WELCOME has no button (§15).
`onboarding_welcome_shown` and `onboarding_welcome_flight_played` are unchanged
and are the whole of that screen's instrumentation; the auto-advance emits
nothing, since a timer firing is not a decision anybody made.

**Retired 2026-09-12 with the controls and screens they named**, and not to be
sent: `onboarding_character_edit_details_tapped`, with W6's **Edit details**
(§10B); and any event belonging to the deleted notification soft-prompt screen
(§12-13). The OS answer is carried in the onboarding result as
`notificationsEnabled` and there is no shown/accepted/declined trio to send,
because there is no screen to send it for.
`onboarding_character_reimagine_tapped` is unchanged in name and
**moves to the Redraw press**, so it counts image calls rather than editor
opens. Opening W6's edit block emits nothing.

**No gender property exists on any event, and now there is nothing it could have
come from.** The round-one ban is superseded by the row's removal on the second
round of 2026-09-12 (§9): W4 asks two things, so there is no third answer to
bucket, enum or forget to strip. The ban stands in §17 as a floor rather than as
a rule about a live control.

`onboarding_genres_completed`'s `genre_ids` are now real `Genre` ids rather than
display strings (§3), so a pick here joins to the same value Explore and Create
send. Never send a free-text genre label: there is no longer a chip that
produces one.

**Retired 2026-09-11 and not to be sent:** the whole `Taste`, `Reader`, `Shelf`,
`Idea`, `Blueprint` and `Preview` groups with §§4-10's predecessors; the entire
`onboarding_offer_*` family with §14; the `chip_backed` property with W4's chips;
the `trial_eligible` property with the trial; and the `kind` and `paywall_kind`
properties with the two-audience split.

Events use the exact `onboarding_*` names stated in each screen section. Use only
enums, IDs, and coarse duration/length buckets. Production failures follow the
error logging contract and contain identifiers and enums only.

---

## 19. Conflicts with canonical

1. **Story Generation Flow §10.6's multi-chapter pricing analysis is
   historical.** Pricing wins.
2. **KathaOnboardingFlowV2 is in the product path for the shared questionnaire.**
   Its pricing and product IDs do not govern; the sequence, typography,
   genre-interest chips, writer setup questions, and auth geometry follow this
   file and `DESIGN_SYSTEM.md`.
3. **Pricing §6's prose diagram still draws a Reader and a Writer paywall and a
   reader-first Both path.** Superseded by §2 and §12-13 here: one paywall, one
   flow, one voice difference. The *money* in that section governs — the welcome
   bonus is 3, the guest bootstrap is 3, and the grant fires on declining the
   paywall.
4. **RESOLVED 2026-09-14: a story start is ONE credit**, settled by the product
   owner in `CREDITS_AND_PRICING.md`'s favour; AGENTS.md no longer carries the
   1-versus-3 disagreement. Onboarding prints no start price anywhere — C4's
   **Their first chapter is 3 credits** line went with C4, and W7 names only
   plan prices — so this file needed no amendment when it resolved, which is an
   accidental benefit of the screen's removal rather
   than a reason it was removed.
5. **`CREDITS_AND_PRICING.md` §3 still describes a 3-day free trial on the yearly
   plan, and a monthly plan at $12.99.** W7 shows neither (§12-13). Pricing wins
   on whether those products exist and what they cost; **this file wins on what
   the onboarding paywall renders**, and it renders two cards with no trial. If
   pricing decides the trial must appear in onboarding, W7 changes in the same
   commit that says so.
6. **The C0-C4 specification is superseded, on the same day it was written.**
   C0 Bridge, C1 Who, C2 Wait, C3 Reveal and C4 Plan bridge were specified and
   built on the morning of **2026-09-11**; W3-W7 replaced them the same
   afternoon, and nothing in this file describes C0-C4 as current any more.
   **The reason is that a signed-off pixel reference arrived**: five `.dc.html`
   artboards with exact geometry, durations, easings and both copy variants,
   against which the C0-C4 sections were an independent description of the same
   intention. Two descriptions of one flow is the failure mode
   `source-of-truth/README.md` exists to prevent, so the reference won and this
   file was rewritten to specify it rather than to sit beside it. The decisions
   C0-C4 carried that survived — one character, one reimagine, no fallback
   portrait, no credits, the anonymous cap — are re-stated in their new sections
   and in the Decisions block below; the ones that did not are listed there with
   the reason.

---

## Decisions

1. **Intro remains unchanged.**
2. **Name and genre interests precede Purpose; Purpose remains the branch.**
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
22. ~~**Yearly default/trial; weekly visible/no trial; monthly below; dismiss obvious.**~~
    Superseded 2026-09-11 by decision 47: yearly default, weekly visible, **no
    trial and no monthly**, dismiss obvious.
23. ~~**OF is Reader yearly $19.99 first year, then $29.99, one real 2:00 showing.**~~
    Superseded 2026-09-10: the one-time offer is removed. See §14.
24. ~~**10 credits follow only authenticated offer decline/expiry.**~~ Superseded
    2026-09-11: the welcome grant is 3, and it is the guest bootstrap grant the
    account already holds; see `CREDITS_AND_PRICING.md` §6 and decision 36.
25. **WELCOME has no number or disclaimer.**
26. ~~**Onboarding costs at most one model call and no image calls.**~~ Superseded
    2026-09-11: onboarding makes no model call and at most two portrait calls
    (one draw, one reimagine). See §16 and decisions 32 and 41.

> **Decisions 4-18, 20-24 and 26 are superseded by the 2026-09-11 entries below.**
> They are left in place because the sections they belong to are left in place,
> and because a decision list that quietly loses its rows stops being a record.

### 2026-09-11, morning: the character onboarding rebuild

27. **The aha is one character and their portrait**, not a typed idea and a
    150-word preview.
28. **Read, Write and A bit of both take the same flow.** Purpose selects a copy
    voice and the exit route; it no longer selects a path. The reader path R1-R4
    is retired: one flow to maintain, an artifact that is whole rather than a
    truncated preview, and a saved character that is cross-story and makes the
    person's next story start cheaper.
29. **Exactly one character, and exactly one reimagine.** *(Amended the same day
    by decision 45, and again 2026-09-12 by decision 55: the cap is still one,
    the control opens the paywall once it is spent, and the counter that
    decision 45 added is gone.)* The reimagine
    mints a fresh `requestId`. A failed attempt and its retry do not consume it.
    The budget is **per onboarding**, not per edited sheet.
30. ~~**C2 never claims work.**~~ Superseded by decision 46: there is no C2. W6's
    loading state does claim work, in four plain lines and one honest range, and
    the ban on percentages, progress bars and elapsed time survives intact.
31. **There is no fallback portrait.** A substituted portrait is a different
    character wearing the person's name. Failure says so and offers a retry; the
    offline build renders a placeholder silhouette, never a broken image.
32. **Onboarding makes at most two image calls on the happy path and no text
    call**, spends no credits, and writes no ledger row.
33. **A1 saves a character.** `artifact_kind` is `character`; `shelf` and
    `blueprint` are retired.
34. ~~**One paywall, with monthly under More options and a 3-day trial.**~~ The
    merge into one paywall stands; the trial, the monthly row and the five-row
    entitlement list are superseded by decision 47.
35. **The one-time offer is deleted, not deprecated.** The countdown ban is now
    absolute.
36. **The welcome bonus is 3 and it fires on declining the paywall.**
37. **WELCOME gains a credits animation and keeps its copy.** Once per account,
    persisted. Reduced motion shows the number instead.
38. **The pre-paywall contract is a portrait contract.** `generate-character-image`
    on the anonymous session, `{ requestId, name, appearance, imageStyle: "auto" }`,
    no reference image, bounded by the flow at two calls, by
    `claim_guest_portrait_request` at four per anonymous identity for life, and
    by `claim_character_portrait_request` at 12 per hour.
39. **Email verification upgrades the anonymous user in place, so the saved
    character and the 3 guest credits survive sign-in.** The one fallback, when
    the address already belongs to an account, signs into that account and
    re-points the character with `claim_guest_characters`; the credits do not
    move. See §16.
40. ~~**Suggestion chips are genre-seeded, never preselected.**~~ Superseded by
    decision 44: W4 has no chips.
41. **An anonymous identity gets four character portraits, for the life of that
    identity, reimagines and retries included.** Migration 00084,
    `claim_guest_portrait_request`, enforced in `generate-character-image`.
    **Keyed on `auth.users.id`, never a device identifier.** Refusal is **403**
    with `code: "guest_portrait_cap"` and the copy **Sign in to keep making
    characters.**, not 429, because there is nothing to wait for. A failed
    generation releases the slot. A named user is unchanged.

### 2026-09-11, afternoon: the W3-W7 hand-off

42. **C0-C4 is superseded by W3-W7 on the day it was written, because a
    signed-off pixel reference arrived.** Five artboards with exact geometry,
    durations, easings and both copy variants are a stronger specification than
    an independent prose description of the same intention, and keeping both
    would be two descriptions of one flow. §19 item 6 records it once. No
    section of this file describes C0-C4 as current.
43. **The email is asked for before the portrait is drawn.** W5's CTA fires
    `sendEmailCode`, the character save and the image call together on the
    anonymous session, and the six-digit code screen covers the wait. The aha is
    not gated by auth; the two now run at once, and the wait is spent once
    instead of twice. W6 opens loading or ready depending on what has landed.
44. **W4 has two fields and nothing else.** *(Superseded 2026-09-12 by decisions
    53 and 54: three answers, and a KATHA WILL DRAW card.)* No suggestion chips,
    no attachments. The 300-character counter does the work the **TRY ONE** rail
    was doing, without a canonical chip list to keep in sync or a `chip_backed`
    flag to carry. The CTA is disabled until both fields are non-empty, and reads
    **Bring them to life** while the name is blank.
45. ~~**The reimagine counter is visible, and at zero the control opens the
    paywall.**~~ *(Superseded 2026-09-12 by decision 55: the paywall half
    stands, the counter is gone.)* One free reimagine per onboarding, **1 free
    left** → **0 free
    left**. This reverses C3's invisible cap, and the reason is that the control
    at zero still does something: a control that acts must say what it has left.
    Failures still do not consume it, and **Edit details** returns to W4 without
    restoring a spent one.
46. **W6's loading state is a scan, three dots and four rotating lines**, on a
    shared 2200 ms beat, with the caption **Usually 20 to 30 seconds** and a
    300 ms cross-fade to ready. Under reduced motion the scan, dots and pulse
    hold still **and the status text keeps rotating**, because a frozen sentence
    during a thirty second wait reads as a hang. W3's hero card swells to 1.08
    over two seconds and **holds there**: no settle-back, no spring, no overshoot.
47. **W7 has no free trial and no monthly plan.** Two cards, weekly $5.99 and
    yearly $59 selected by default with a **SAVE 80%** badge, four benefit rows,
    **Cancel anytime, no commitments**, **Unlock Katha**, ~~**Not now**~~ and a
    close × from frame one. *(Amended 2026-09-12 by decision 57: **Not now** is
    removed, the plan cards and the CTA sit in a pinned sheet, and a testimonial
    rail is added. Everything else here stands.)* A trial on a credits product
    hands out the thing
    being sold; a third plan under a disclosure was a row nobody opened that
    still had to be priced and localised. The badge is the annualised weekly
    against yearly saving of 81%, **rounded down**, and it is never drawn as a
    discount off a former price.
48. **Seven progress pills, and the paywall has none.** W3 = 4, W4 = 5, W5 and
    the code screen = 6, W6 = 7, announced as **Step n of 7**. The writer setup
    questions share step 3 and the code screen shares W5's pill, because a row
    that lengthens for one answer, or advances on our own email latency, is
    measuring the wrong thing. Where `W4-Craft.dc.html` and `W6-Meet.dc.html`
    disagree, this file wins.
49. **W3-W7 use the onboarding palette and shadow tokens**, not a parallel set of
    literals: `colors.onboardingBg/Border/BorderStrong/Plate/Success/Stone` with
    `accentSoft`, `accent`, `premium`, and `shadows.onboarding*`. A hand-off
    colour with no token maps to the nearest existing one and the mapping is
    noted rather than a new token minted — W6's glass-chip text takes
    `colors.accentSoft` and its loading card takes a
    `onboardingPlate → onboardingStone` gradient. The frame is still 390 × 844
    with a 30 pt gutter, and every fixed stage scales by
    `min(1, (width - 60) / 330)` so a 360 pt phone does not clip.

### 2026-09-12: the feedback round

> Decisions 44, 45 and the **Not now** and four-row clauses of 47 are superseded
> by 50-58. The rows stay where they are, annotated, for the reason given above.

50. **Onboarding has one field recipe and one component that draws it.**
    `onboardingType.field` at 16 / 22 in `fonts.ui`, the shared `Field`
    primitive, a 1.5 pt `onboardingBorderStrong` border that becomes 2 pt accent
    with `shadows.onboardingFieldFocus` on focus, about 50 pt on one line and
    150 pt multiline. **A field never uses `fonts.display` or `fonts.reader`**:
    text being typed is a control. The flow had three field recipes across five
    screens. `DESIGN_SYSTEM.md` §6 carries the measurements, and the Create
    brief's fields are a deferred alignment named there rather than a silent
    inconsistency.
51. **S1's name field is the shared `Field`, and the gap under the sub is
    `spacing.lg`.** The headline asks a question and the field answers it, so
    they are one group; `spacing.betweenGroups` read as two separate things on a
    screen holding nothing else. No eyebrow, because the placeholder and the
    headline already say it twice.
52. **S2 offers `UI_GENRES`, the Create picker's own constant, as real `Genre` ids**, chipped
    in Explore's recipe, wrapping, pick at least three, CTA **Continue** with
    **Pick at least 3** as the disabled label. **Cozy Fantasy, Paranormal
    Romance and Other are removed**: the first two named nothing downstream and
    quietly resolved to plain fantasy and plain romance, and a free-text genre
    could not key a shelf, seed a create chip or be filtered on. ~~**No emoji and
    no tick**: twelve emoji in a wrapping grid is a second alphabet, and a
    tick inside a filled chip says the fill twice.~~ *(The emoji half is
    superseded 2026-09-12 by decision 59; the tick half stands.)*
53. ~~Supersedes 44. Superseded 2026-09-12 by decision 60.~~ **W4 asks three things: name, gender, appearance.** The
    gender row is four options — Woman, Man, Non-binary, Prefer not to say —
    required, with the decline sending nothing. It exists because the portrait
    was resolving gender from the **name**, which is a worse guess than a tap.
    **It is never persisted**, never reaches the Create flow, and never reaches
    telemetry. The CTA is disabled until all three are answered.
54. *(Amended 2026-09-12 by decision 61: the rows are duotone glyph tiles with
    balanced copy.)* **W4 gains a KATHA WILL DRAW card** of three glyph rows, and it is not the
    helper text principle 3 bans. That ban is on a paragraph explaining how to
    fill a box in; these rows say what each answer becomes, which answers the
    question the fields actually raise.
55. ~~Supersedes 45.~~ *(The gender row leaves the block 2026-09-12, decision
    60.)* **W6 has one control under the portrait, and it has no
    counter.** **🔄 Reimagine** expands an inline edit block holding the
    appearance in a `Field` and a **Redraw** button; Redraw
    spends the one budgeted call and re-enters loading in place. **Edit details
    is gone** with the trip back to W4 it caused. The counter goes with it:
    decision 45's rule was right about a control whose only act was drawing, and
    this pill's first act is opening a free editor, so a **1 free left** label
    would be counting something the tap does not do. Once spent, the pill opens
    W7 — no counter, no disabled state, no toast.
56. *(Amended 2026-09-12 by decision 61.)* **W6 carries a three-row benefit card under the control**, writer and reader
    voiced. It is about the character rather than the plan, and none of its rows
    is an entitlement, which is why it can sit in front of the paywall without
    being a pitch for it.
57. ~~Amends 47.~~ *(Amended 2026-09-12 by decision 62: the rail moves last, the
    plan cards go compact, the yearly note becomes a daily price, and the
    testimonial tag is deleted.)* **W7 is a scrolling body over a pinned plan sheet, it carries
    a testimonial rail, and Not now is removed.** The sheet holds both plan
    cards, the cancel line and **Unlock Katha**, always visible and safe-area
    padded, because a rail and a benefits card had pushed the price and the
    button below the fold. The rail is eight use-case cards auto-scrolling at
    about 40 pt per second over a duplicated row, pausing under a finger and
    degrading to a plain `ScrollView` under reduced motion. **Testimonials leave
    §17's ban and star ratings, reviews and counts do not**: the ban was on
    social proof standing in for the product, and a row of use cases is showing
    the thing has more than one shape. **Not now** goes because the × is the
    same act in the place every sheet in the app is dismissed, and two
    dismissals made the last thing on the screen a choice between buttons.
58. **The notification soft-prompt screen is deleted.** W7 calls
    `enableNotifications()` on close or purchase and goes to WELCOME; the result
    carries the OS answer. **The accepted trade is that on iOS this spends the
    one prompt**, and a decline is only recoverable through Settings. It is
    accepted because the soft prompt sat at the end of onboarding as a screen to
    get past, and it comes back in front of the OS call if the decline rate says
    so.

### 2026-09-12, second round: the feedback on the feedback

> Decisions 52's emoji clause, 53, and the gender clause of 55 are superseded by
> 59-62; 54, 56 and 57 are amended by them. The rows stay where they are,
> annotated.

59. ~~Amends 52.~~ **S2's chips carry Explore's emoji and are bigger.** The label
    is `genreChipLabel(genre)`, exported from `GenreStrip.tsx` and built there
    from its own `GENRE_EMOJI`, so onboarding never copies an emoji map; the chip
    is 44 pt with `spacing.xl` gutters and a 15 pt label. The "no emoji" rule was
    an argument about a 40 pt pill sized for a word, where twelve marks crowd;
    at 44 pt the emoji is what the eye lands on before it reads, and it is the
    same mark Explore shows for the same genre, so the two screens teach each
    other. **The tick mark stays banned**, because the fill already says it.
60. ~~Supersedes 53.~~ **The gender row is removed entirely, one round after it
    was added.** Not from W4 only: it leaves W6's edit block, the request shape
    (§16), `generate-character-image`, `_shared/image.ts` and their tests, so no
    dead contract survives it. Two reasons. **The screen**: with the KATHA WILL
    DRAW card below, W4's bottom already fills the frame, and a four-option row
    between the fields pushed the card that earns the screen under the fold.
    **The prompt**: the clause it added sat in front of an appearance line the
    person wrote themselves, where it is either redundant or overrides a
    description with a checkbox. Decision 53 was right that the model had been
    resolving gender from the **name** — and the sentence after the name is a
    better fix than a fourth control. W4 is NAME → APPEARANCE → the card, and the
    CTA waits on both fields.
61. ~~Amends 54 and 56.~~ **Both cards use six duotone glyph tiles and balanced
    copy.** `GlyphFaceAndBuild`, `GlyphClothingAndCarry`, `GlyphTheName` on W4;
    `GlyphLeadsStories`, `GlyphSameFace`, `GlyphSavedCast` on W6, from
    `src/components/onboarding/glyphs.tsx` as 40 × 40 tiles, and **no mark
    repeats across the two screens** — round one reused `IconPerson` and
    `IconPencil` on both, which teaches that the tiles mean nothing. Every row is
    about three words of title and six of line, and W6's lines drop `{name}`:
    ragged rows read as notes stacked in a box rather than as a list, and an
    interpolated name grows a row to three lines on a long name while the
    portrait directly above already says it.
62. ~~Amends 57.~~ **W7's body is header → benefits → testimonials, its plan
    cards are compact, and the yearly note is a daily price.** The benefits card
    comes first because it is the offer and the rail is the corroboration; last
    is also where a marquee belongs, since nothing has to be scrolled past it.
    The cards are about 92 pt with the eyebrow and price on one line and the note
    under it, and the badge drops to 9 pt, so the sheet clears the safe area on a
    360 pt phone. The yearly note is **"$0.16 a day"**, derived in code as
    `59 / 365` rounded to cents, replacing **"$4.92 a month, billed yearly"** — a
    comparison against the one plan this screen deliberately withholds. **The
    testimonial cards lose their use-case tag**, from the card and from the data:
    it was a label summarising the quote directly beneath it, and it was the half
    of the card that read as marketing rather than as somebody talking.

### 2026-09-12, third round: one button, one clock

> Decision 63 governs every CTA on the path; 64-68 amend §8, §9, §10, §10B, §15
> and §16. Nothing here is superseded, so no earlier row is struck through: the
> decisions below change where work happens and what a button looks like, not
> what the flow asks for.

63. **The whole onboarding journey has one primary button recipe.** From the
    intro's **Get started** through the questionnaire, W3-W7, the email and
    code screens, to W6's **Redraw**. Drawn by `Primary` in
    `src/components/onboarding/primitives.tsx`, which every screen on the path
    composes.

    **WELCOME is not in that list and never was.** This enumeration used to
    end "…to WELCOME", which contradicted §15 and decision 67 on the same
    page: WELCOME has no button, no skip and nothing to tap — the coins settle
    and `onOpen()` fires on a timer (`WelcomeScreen.tsx` contains no `Primary`,
    no `Pressable` and no `onPress`). A recipe that claims a screen with no
    button is how the next reader adds one.

    **Amended 2026-09-20: it is the app's recipe, not a second one.**
    `controls.primaryCtaHeight` (**52**) at `radius.pill` in `colors.accent`,
    white 17 / 700 `fonts.ui` — and `Primary` is now a wrapper over
    `src/components/Button.tsx`, the one text button in the app.

    The two-recipe argument was that onboarding is a sequence of full-bleed
    compositions where a 64 pt slab competes with the picture above it. That
    observation was right, and 52 is what it was reaching for; what was wrong
    was the conclusion that the rest of the app should keep the slab. It never
    had one — `primaryCtaHeight` was documented and consumed by nothing, and
    the app's real buttons were per-screen copies at 48 to 56.
    `DESIGN_SYSTEM.md` §6.1 carries it.
64. **W3 centres its group and does not pin its CTA**, alone on the path. The
    stage, the copy and the button are one vertically centred group —
    `spacing.xxl` stage to copy, `spacing.xl` copy to CTA — with equal free space
    above and below it; the progress row stays at the top and the animation is
    untouched. W3 holds a picture and a sentence where every other character
    screen holds fields or a card, so pinning left a band of empty paper that
    grew with the phone and spread three things meant to read as one thought
    across the frame. Symmetrical space reads as composition; a gap at the bottom
    reads as something that failed to load.
65. **The draw and the library save move to W4's CTA; W5's CTA only sends the
    code.** Pressing **Bring {name} to life** writes the `user_characters` row
    and fires `generateCharacterImage` on the anonymous session, fire-and-forget,
    and W4 advances without awaiting either. The portrait takes about ten seconds
    and starting it at W5 bought only the code screen to hide it behind; starting
    it at W4 buys the email screen as well, so **W6 opening ready is now the
    expected case** and loading is the exception. The ordering that put
    `sendEmailCode` first existed only because it gated advancing, and it gates
    nothing else: all three calls run on the identity `bootstrapUser` already
    made. Back from W5 with an unchanged sheet does not redraw; a changed sheet
    redraws on a fresh `requestId` and **resets nothing else** — the reimagine
    budget belongs to W6's Redraw and is untouched by a W4 edit.
66. **W6's wait caption is a constant whose number is measured.**
    `PORTRAIT_WAIT_CAPTION` in `CharacterOnboarding.tsx` is the only place the
    wait is claimed, and its wording follows the **measured p50** from the W4
    press to the portrait on screen: measured p50 about 11 s, p90 about 15 s
    on 2026-09-12 (§10B has the breakdown), so the constant reads **Usually
    about 10 seconds**. **Usually 20 to 30 seconds** was typed into
    JSX, which is a number nobody updates when the system gets faster, so the
    screen goes on promising the old speed for the rest of its life. Principle 7
    is unchanged and this is how it is kept: one honest range, and a measured one
    can be re-measured.
67. **WELCOME has no button and advances itself.** The coins settle on the
    existing spring, hold **700 ms**, and `onOpen()` fires; under reduced motion
    they render settled and it fires after **900 ms**. **Not tappable, no skip.**
    Every other CTA on the path buys something — a character, a portrait, an
    account, a plan — and this one bought nothing: the grant has landed and the
    only thing left is to be in the app, so a press that changes nothing but its
    own timing is a toll on the last screen of onboarding. 900 ms under reduced
    motion because a composition that arrives whole and leaves after 700 ms reads
    as a flash rather than a moment; no skip because an invisible sub-second tap
    target is one nobody finds and everybody triggers. It is the only
    auto-advance in Katha, and it is allowed because nothing is lost by missing
    it.
68. **The credit is an object with a face: `CreditCoin`.** A drawn duotone coin —
    gold face, darker rim, inner highlight, the Katha spark on it — replaces the
    flat yellow circle everywhere a credit appears as an object, which is
    WELCOME's settled stack and the three that fly to Home's pill. It must read
    at 20 pt and at 52 pt. **Home's header pill keeps its `Sparkles` glyph**: the
    coin carries the same spark, so the flight reads as landing on the place
    credits live rather than as two symbols for one thing, and a pill wearing the
    coin would be a coin containing a coin. Three yellow circles crossing a
    screen are three yellow circles; mass is what makes an object look like it
    went somewhere. `DESIGN_SYSTEM.md` §7.2 specifies the mark.

### 2026-09-14: the reader's own questions, and one progress row

> Decisions 69-72 amend §1, §2, §3, §3C, §9, §10, §10B and §12-13. The 2026-09-11
> progress table in §1 is superseded by 69; nothing else is struck through.

69. **One progress row, one pill per step, counted per purpose.** The
    questionnaire draws the character screens' `OnboardingTopBar` from the
    first question; the `n/5` track is gone. Every question is a step, W3 is a
    step, and W4 to W6 are one step. Eight for a reader, seven for a writer or
    "both"; the first three screens draw eight and a writer's row settles to
    seven at "Writing". The count lives in one table
    (`expo/src/lib/onboarding-progress.ts`) that both screens read, so the row
    cannot restart or skip between them.
70. **A reader answers three questions of their own.** How they like their
    stories (the existing question, re-headed with no sub), what they are in
    the mood for tonight (new, six options), and when they usually read (new,
    five one-line options, the UP NEXT card, and the flow's only Skip). Copy
    and options are the owner's design frames verbatim (§3C). Writers and
    "both" keep their two questions.
71. **The mood goes somewhere.** "Tonight only. It sets the story" is kept by
    Home's **Tonight** rail, the first shelf under the reader's own stories,
    for this session only. An answer that feeds nothing is a question that
    should not have been asked.
72. **Every helper line on the reader's character screens says "you".** The
    headlines and CTAs were reader-voiced from 2026-09-11; the KATHA WILL DRAW
    rows, W5's sub, W6's loading state and third benefit row, and the
    paywall's sub and first two benefit lines still said "they", "them" or
    the reader's own name in the third person. Each now has a reader string
    (§9, §10, §10B, §12-13). **One selected-card look** on every option row in
    the questionnaire (§3B's), because the design frames showed two and a
    person walking three screens reads a second treatment as a state they did
    not choose.
