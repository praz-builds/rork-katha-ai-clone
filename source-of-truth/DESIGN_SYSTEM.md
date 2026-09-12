# Design System: source of truth

<!-- markdownlint-disable MD013 -->

> **This file is canonical for visual language.** Type, colour, elevation,
> radius, the semantic spacing rhythm, and the control recipes built from them
> are defined here. If a component, a prototype, or a screenshot disagrees, this
> file is right.
>
> **Scope today is the onboarding flow only.** Onboarding uses `onboardingType`,
> `colors.strong`, `colors.track`, the layered `shadows`, `controls`, and the
> Ionicons set in `expo/src/theme/icons.tsx`. Every other surface keeps the
> existing `type` scale, its existing colour usage, and `lucide-react-native`
> for icons until it is migrated deliberately, one surface at a time. Section 2
> names that boundary exactly.
>
> The neutral ramp is the one exception, because token names did not change: the
> retune in section 4.1 reaches every surface at once. That is intended and is a
> like-for-like improvement, not a redesign. Section 4.1 says what to watch for.
>
> [`ONBOARDING_FLOW.md`](ONBOARDING_FLOW.md) is canonical for behaviour, copy,
> screens, and events; this file is subordinate to it on anything behavioural.
> [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) is canonical for prices,
> credits, trials, grants, and store products, and pricing wins on any conflict.
>
> Reference frame: 390 × 844 pt, light theme only. Last revised 2026-09-12.
> *Inference* marks a decision not yet shipped.

---

## Summary

Tight tokens, layered shadows instead of borders, negative tracking on
sentence-case headings. The look comes from four moves: type that is set tighter
than a default UI stack, depth carried by stacked shadows rather than by
outlines, controls that are lit rather than filled, and a quiet ground that pure
white cards lift off. All of it resolves to `expo/src/theme/`. There are no
local style constants; if a value is not in the theme it does not ship.

---

## 1. Where the tokens live

| File | Exports |
|---|---|
| [`expo/src/theme/theme.ts`](../expo/src/theme/theme.ts) | `colors`, `spacing`, `radius`, `fonts`, `controls`, genre data |
| [`expo/src/theme/typography.ts`](../expo/src/theme/typography.ts) | `type` (app-wide), `onboardingType` (onboarding) |
| [`expo/src/theme/shadows.ts`](../expo/src/theme/shadows.ts) | `shadows` |
| [`expo/src/theme/motion.ts`](../expo/src/theme/motion.ts) | `motion` |
| [`expo/src/theme/icons.tsx`](../expo/src/theme/icons.tsx) | the named Ionicons set, `opticalSize`, `OPTICAL_SCALE`. Onboarding only. See section 6. |
| [`expo/src/theme/index.ts`](../expo/src/theme/index.ts) | the barrel. Always import from `@/theme`, never from a leaf file. |

Fonts are registered in [`expo/App.tsx`](../expo/App.tsx) under the local family
names `BricolageGrotesque`, `HankenGrotesk`, `Baloo2`, `Literata`,
`LiterataItalic`, `InterTight`, and `InterTightSemiBold`.

Invariants are enforced by
[`expo/src/__tests__/theme.test.ts`](../expo/src/__tests__/theme.test.ts). A
change that breaks a rule in this document should break that suite.

---

## 2. Migration boundary

**In scope now.** The onboarding flow: the writer onboarding screens, the
crafting loader, and any new component built for onboarding. These use
`onboardingType`, `colors.strong` for icons, `colors.track` for dividers, and
the layered `shadows`.

**Out of scope now.** Home, Library, Reader, Create Studio, Profile, and the
paywalls. They keep `type`, keep `colors.border` where they already use it, and
keep their current elevation. The layered rewrite of `card`, `raised`, and
`overlay` reaches them because the token names did not change, and that is
intended: it is a like-for-like quality improvement at the same three
elevations, not a redesign.

**How a surface migrates.** One pull request per surface. Swap `type` for
`onboardingType`, swap icon colours to `colors.strong`, swap divider borders for
a `colors.track` hairline, delete borders that a shadow now draws, and update
this section to move the surface into "in scope". Do not migrate a surface as a
side effect of unrelated work.

Inter Tight is loaded for every surface because font registration is global. A
surface being able to reach `fonts.tight` is not permission to use it.

---

## 3. Type

`onboardingType` is the onboarding scale. `type` is the app-wide scale and is
unchanged.

| Token | Size / line height | Family | Tracking | Use for |
|---|---|---|---|---|
| `onboardingType.title` | 28 / 34 | `fonts.display` | 0 | The one screen title. Sentence case. |
| `onboardingType.sectionHeader` | 12 / 16 | `fonts.ui` | +1 | The uppercase eyebrow above a group. A treatment, not a level. |
| `onboardingType.body` | 16 / 21 | `fonts.ui` | 0 | Content: what the user types, option-card text, body UI copy. |
| `onboardingType.helper` | 14.5 / 18 | `fonts.ui` | 0 | Secondary copy: the line under a title or an eyebrow. |
| `onboardingType.caption` | 12 / 16 | `fonts.ui` | 0 | Asides: legal lines, counters, the "(optional)" marker. |

Rules:

1. **One large size per screen.** `title` is the only size above `body`, and a
   screen gets one. If a screen appears to need two, it is two screens.
2. `sectionHeader` renders uppercase, always. If the string is sentence case,
   the token is wrong.
3. **Secondary copy is `helper`, never `body`.** A supporting line must be
   smaller than the text in the field it supports.
4. `body` is content: the user's own words, the story's words, the text on a
   control. If our sentence is set at the same size as theirs, it is the wrong
   token.
5. A size never moves without its line height. The pairs above are single values.
6. `fonts.brand` stays wordmark and accent only. `fonts.reader` stays prose only.

### 3.0 The ramp: 28 / 16 / 14.5 / 12, and one eyebrow beside it

The size ramp is **28 / 16 / 14.5 / 12** and `onboardingRamp` names it in that
order. `sectionHeader` is deliberately **not** in it: it shares `caption`'s size
and is an eyebrow treatment rather than a rank. `theme.test.ts` asserts both
facts, including that nothing but `title` is set above `body`.

**The correction this records.** A previous pass promoted the section labels to
21pt on the argument that a label heading a group cannot be the quietest thing
in the group, and set supporting copy at `body` (16) so it would not sit 1.5pt
from the field text beside it. Both moves were wrong on the screen, and the
details screen is what proved it:

- Five 21pt uppercase heads down one scroll gave the screen five things that
  looked like titles and one that was one. The hierarchy the promotion was meant
  to create is what it destroyed. **When everything is a heading, nothing is.**
- Helper copy at 16 gave our supporting sentence the same billing as the text
  the user types, and made supporting copy the widest, loudest block on a 390pt
  screen. A helper line is not content.

**What carries an eyebrow instead of size.** Four signals at once, none of them
shared with anything near it: uppercase against sentence case, semibold against
regular, +1 tracking (0.083em) against +0.3, and `colors.tertiary` against
`colors.muted`. It is read first without being large, which is how a grouped-list
section header works on iOS. A signpost does not have to be the biggest thing on
the road. `writer-onboarding.test.tsx` asserts the four-signal separation rather
than a size relationship, because the size relationship is intentionally
inverted.

**Why the title is 28.** Measured against the 390pt frame, not estimated.
Content width is 390 minus two `spacing.xxxl` gutters, so 326pt. Advance widths
were read out of `expo/assets/fonts/InterTight-SemiBold.ttf` for every `title`
string in the writer flow:

| Size | Longest heading, "The parts you already have in mind." | Result |
|---|---|---|
| 22 | 325.5pt against a 326pt column | Fits on one line by half a point. That is a coincidence, not a heading size, and it is one word of copy from breaking. |
| 28 | 414pt | Wraps to exactly two lines. "Save your story before we shape it." at 411pt does the same. The short headings stay on one line. Nothing reaches three lines and nothing clips. |
| 34 | 506pt | The old `type.largeTitle`. Even "What's your story about?" wraps. This is the overcorrection 22 was reacting to. |

28 is the level that survived the correction above, because the complaint was
never that the title was too large — it was that everything else had grown to
meet it.

**Why helper is 14.5 and not 15.** It is the size the supplied spec names for
supporting copy ("Inter Tight 14.5/18px Regular, 0.3px letter spacing"), and it
is far enough under the 16pt field text to read as a deliberate step once the
two are also different colours. The earlier objection to 14.5 — that 1.5pt is
below the threshold where a size change reads as intent — was true of a size
difference *alone*, and is not true of one carried by colour as well.

**Why caption is 12 and shares the eyebrow's size.** They are the same tier of
the page and are separated by family, case and tracking. A fifth size for a
two-word aside would be a size nobody could pick out of a lineup, and at 12pt
there is no room below to take one.

**Line height moves with size.** Headings are set tight, about 1.21, because
they wrap to two lines and should read as one block. Body-weight levels are set
looser, about 1.24 to 1.33, because they are read as paragraphs.

**Size alone is half the answer.** The other half is the spacing rhythm in
section 8. A ramp with a uniform gap still reads as a flat list, and a flat list
was half of what the details screen was complained about for.

### 3.1 Conflict resolved: tracking direction

The supplied spec closes with "negative tracking on every heading" while
specifying the section header at positive 0.6px. Both are correct, because they
describe two different treatments and the closing line is about sentence case.

Large sentence-case type has too much air between letterforms at its optical
size, so `title` closes up with -0.9. Uppercase has no ascender or descender
interlock and jams together, so the eyebrow opens up with +1.

**Tracking is proportional to size, not a fixed pixel value.** -0.9 at 28 is
-0.032em, exactly the em-relative tightness -0.7 carried at 22, so the title got
bigger without getting looser. +1 at 12 is 0.083em, which is
[`ONBOARDING_FLOW.md`](ONBOARDING_FLOW.md) section 1's rule verbatim:
"letterSpacing: 0 except uppercase eyebrows at 0.08em". Carrying a pixel value
up or down a ramp silently changes the tracking; `theme.test.ts` asserts the
title inside 0.025em to 0.04em and the eyebrow inside 0.07em to 0.095em.

Negative on the sentence-case heading, positive on the uppercase one. Neither
reading was discarded. `body`, `helper` and `caption` are neither: they sit at
or just above zero and never go negative, because tracking in at a small optical
size closes the counters and costs legibility.

### 3.2 Conflict resolved: `fontWeight` cannot reach semibold

Inter Tight ships here as two **static** instances, `InterTight-Regular.ttf`
(400) and `InterTight-SemiBold.ttf` (600), not as a variable font. React Native
cannot synthesise a weight from a static file. `fontWeight: '600'` on
`fonts.tight` renders plain regular on iOS and a faked smear on some Android
builds, and nothing warns you.

**A token that wants semibold names `fonts.tightSemiBold` as its `fontFamily`.**
`onboardingType` does this at every level that carries `fontWeight: '600'`, and
`theme.test.ts` asserts it over the whole ramp rather than token by token, so a
level added later cannot skip it; the `fontWeight` field it also carries is a
hint for the web bundle and is never what produces the weight. If you write a
new Inter Tight style by hand, name the family. This is the most common way this
system breaks.

**It is not only Inter Tight.** `Baloo2.ttf` is a *variable* font, and the same
rule bit it for the same reason: `fontWeight: "900"` on `fonts.brand` rendered
at 400, because React Native has no weight-axis control either. `fonts.brandHeavy`
(`Baloo2-ExtraBold`) names the static instance. Note that the axis tops out at
800, so the 900 that was being asked for was a weight the file does not contain
at any API. **Whenever a weight looks wrong, check whether the token names a
family or a `fontWeight` before checking anything else.**

---

## 4. Colour

The supplied spec named four CSS variables. They map onto the palette as
follows, and no existing colour was renamed or revalued.

| Spec var | Token | Value | Use for |
|---|---|---|---|
| `--text` | `colors.ink` | `#0F0E0C` | Primary text: titles, body, values. |
| `--muted` | `colors.muted` | `#6B6560` | Secondary text: supporting lines, helper copy, timestamps. |
| `--strong` | `colors.strong` | `#3A3632` | **New.** Icons and icon-button glyphs. |
| `--track` | `colors.track` | `#F4EEE7` | **New.** 1px dividers. |

**Why `strong` is `#3A3632`.** An icon is a glyph with a fraction of the stroke
area of a word, so it needs more presence than secondary text and less than a
title. At `muted` an icon reads as disabled; at full `ink` it out-shouts the
title beside it. `#3A3632` is the midpoint of `muted` and `ink` on the same warm
neutral ramp the rest of the greys use, R greater than G greater than B by the
same four-step delta, roughly 11:1 against `colors.bg`. Icons only. Never body
text.

**Why `track` is `#F4EEE7`.** A divider must read as a seam inside one surface,
not as the edge of a box. `colors.border` at `#EEE7DE` is correct for the edge
of a flat, unelevated card, but a full-bleed 1px line at that weight looks like
an unclosed frame. `#F4EEE7` is lighter, carrying roughly a third of the
separation, which is enough to part two rows on `colors.surface` or
`colors.surface2` and no more. This is the spec's "never a visible border
colour".

Rules:

1. `track` for dividers. Never `border`, never `borderStrong`, never a
   hairline in `muted`.
2. `strong` for icons. Never `ink`, never `muted`.
3. Selected and accent states are unchanged: `colors.accentSoft` fill with a
   `colors.accent` border, per `ONBOARDING_FLOW.md`.
4. Reader keeps the `colors.sepia*` tokens.

### 4.1 The retuned neutral ramp

The product owner supplied a reference from a crafting community app and asked
for its surface treatment: a very light, slightly cool ground with pure white
cards and fields lifting off it, generous radii, soft shadows, no visible
borders. The accent is **not** part of that ask. Katha orange `#FF6B1A` stays,
and a tinted chip is `colors.accentSoft`, never the reference's green.

The thing that made the reference work was not its hue. It was the **gap between
the ground and the card**. Our ground was `#FAF7F2` and our card was `#FFFFFF`,
a relative-luminance gap of 0.067, which is a contrast ratio of 1.069. Across a
large flat field that is under the perceptual floor: the page and the card read
as the same colour, so every card needed a border to exist at all, and the
borders were what made the flow look heavy.

Every name is kept. Only values moved.

| Token | Before | L | After | L | Note |
|---|---|---|---|---|---|
| `bg` | `#FAF7F2` | 0.9326 | `#F3F2EF` | 0.8879 | The ground. Drops so the card can lift. |
| `canvas` | `#F2EEE8` | 0.8585 | `#EBEAE7` | 0.8228 | Moves with the ground. |
| `surface` | `#FFFFFF` | 1.0000 | `#FFFFFF` | 1.0000 | Unchanged. Pure white, and it stays that way. |
| `surface2` | `#F5F0E9` | 0.8762 | `#EEEDEA` | 0.8469 | Recessed inset fill. Stays below `bg`. |
| `border` | `#EEE7DE` | 0.8060 | `#E7E6E2` | 0.7907 | Flat unelevated case only. |
| `borderStrong` | `#DED5C7` | 0.6724 | `#D7D5D0` | 0.6659 | Moves with the ramp. |
| `track` | `#F4EEE7` | 0.8615 | `#EDECE9` | 0.8388 | Divider. Slightly firmer on white, 1.152 to 1.181. |

`accent`, `accentPressed`, `accentSoft`, `ink`, `muted`, `strong`, `tertiary`,
`heart`, `info`, `premium`, `success` and every `sepia*` token are untouched.

**The delta we landed on: 0.112, a contrast ratio of 1.120.** That is up from
0.067 and 1.069, a two-thirds increase in separation. It is enough because 1.12
is the point at which a large field of `bg` and a large field of `surface` stay
distinguishable side by side on a dimmed phone at minimum brightness, which is
where the old ramp collapsed into one colour. It is also the ceiling worth
having: past roughly 1.2 the ground stops being a ground and starts reading as a
grey panel behind the content, and the sepia reader then arrives as a jarring
warm flash. The floor is enforced as a computed invariant in `theme.test.ts`,
not as a pair of hardcoded hexes, so a future retune cannot quietly collapse it
again.

**Why the ramp is desaturated instead of blued.** "Cooler" was delivered by
cutting saturation, not by adding blue. The ramp keeps its amber hue angle, 40
to 48 degrees, and drops saturation by about two thirds: `bg` goes from
hsl(38, 44%, 96.5%) to hsl(45, 14%, 94.5%). It reads lighter, quieter and cooler
without a blue cast, and every step still holds R greater than G greater than B,
the same warm-neutral ordering `colors.strong` uses.

**What was checked against the sepia reader.** `colors.sepia` is `#F4E8D0`,
hsl(40, 62%, 89%), used full bleed. It is the same hue family as the new ramp at
45 degrees, so it now reads as the saturated member of one family rather than as
a different colour. A genuinely cool ground, blue greater than red, was drafted
and rejected: against it `sepia` stops reading as warm paper and starts reading
as a yellow stain, and the genre gradients, which were all picked against a warm
neutral, pick up a green cast in their mid stops. Keeping a trace of warmth is
what makes the reader and the gradients survive the retune untouched. The two
adjacency cases checked were onboarding to reader, where the ramp and `sepia`
share a hue and only saturation changes, and `accentSoft` on `bg`, where the
tinted chip at hsl(27, 100%, 94%) now sits on a quieter ground and reads warmer,
not muddier.

Text contrast was re-measured on the new ground: `ink` 17.2:1, `strong` 10.7:1,
`muted` 5.1:1. All improved, because the ground got darker.

### 4.2 Ground versus surface

The rule that falls out of the ramp, and the reason for it:

1. **A card is `colors.surface`, and `colors.surface` is pure white.** Not
   tinted, not `surface2`, not the ground with a border.
2. **A card gets an elevation, never a border.** `shadows.card` if it sits in
   flow, `shadows.raised` if it lifts. The gap in section 4.1 plus the contact
   layer of the shadow is what draws the edge. Adding `borderWidth` to a white
   card on `bg` is now a mistake, not a preference.
3. **A text field is a card.** Same white fill, same absence of a border, same
   radius rule as in section 5.
4. **`surface2` is recessed, not raised.** It is the inset fill that sits on top
   of a white card: segmented control tracks, avatar plates, option panels. It
   stays below `bg` on the ramp so it cannot start reading as a lifted card.
5. **`colors.border` survives only for the flat, unelevated case**, and
   `colors.borderStrong` only where a control genuinely needs an outline. If a
   surface has a shadow it does not have a border.

---

## 5. Elevation, radius, and borders

`shadows` values are CSS `box-shadow` strings consumed through the `boxShadow`
style property, supported in `StyleSheet` on RN 0.76+ / Expo SDK 54. That is the
established convention here; see `CreateBriefFlow.tsx` for precedent. Layers are
comma separated.

Every elevation is **layered**: a tight, near-opaque contact shadow that anchors
the element to the surface below it, plus a wider, softer ambient shadow that
carries height. One layer cannot do both, which is why a single shadow reads as
a grey smudge instead of as depth.

| Token | Value | Use for |
|---|---|---|
| `shadows.card` | `0 1px 1px rgba(15,14,12,.06), 0 2px 6px rgba(15,14,12,.04)` | Flat surfaces that sit on the page: rows, list cards. |
| `shadows.raised` | `0 1px 2px rgba(15,14,12,.08), 0 6px 16px rgba(15,14,12,.08)` | Lifted surfaces: option cards and selected states. |
| `shadows.primaryCta` | `0 1px 2px rgba(255,107,26,.24), 0 12px 26px rgba(255,107,26,.22)` | Full-width primary text CTA. |
| `shadows.formField` | `0 1px 1px rgba(15,14,12,.05), 0 5px 14px rgba(15,14,12,.06)` | Text fields, prompt boxes, OTP cells. |
| `shadows.iconCta` | `0 1px 1px rgba(15,14,12,.05), 0 5px 14px rgba(255,107,26,.10)` | Small accent icon CTA, such as the moment add button. |
| `shadows.overlay` | `0 2px 4px rgba(15,14,12,.10), 0 12px 32px rgba(15,14,12,.16)` | Floats over content: sheets, popovers, toasts, modals. |
| `shadows.iconButton` | 4 layers, 2 of them `inset` | The circular icon button. See section 6. |
| `shadows.iconButtonPressed` | 3 layers, 2 of them `inset` | Its pressed state. |

**Layered shadows replace borders.** An elevated surface gets an elevation and
no `borderWidth`. `colors.border` survives for the flat, unelevated case;
`colors.track` for dividers. If you find yourself reaching for a border on
something that also has a shadow, pick the next elevation instead.

**Radius follows depth.** The spec asks for "12 to 18 depending on depth". That
maps onto the existing scale and no near-duplicate values were added:

| Depth | Radius | Which token |
|---|---|---|
| Flat, in flow (the 12 end) | 14 | `radius.md` |
| Lifted, carries `raised` or `overlay` (the 18 end) | 18 | `radius.lg` |
| Panels and sheets | 24 | `radius.xl` |
| Sub-component detail | 8 | `radius.sm` |
| Chips | 999 | `radius.pill` |
| Full-width primary text CTA | 20 | `controls.primaryCtaRadius` |

The rule: deeper shadow, larger radius.

**The card-and-field rule.** The reference's cards and fields are noticeably
rounder than ours were, and the fix is a rule, not a sixth token: **a white
`colors.surface` card or a text field sitting on `colors.bg` moves up one step,
from `radius.md` to `radius.lg`.** `md` stays for detail inside a card, `sm` for
sub-component detail. Nothing above `lg` moves, so panels and sheets stay at
`xl`, and option cards, already at `lg`, are unchanged. `ONBOARDING_FLOW.md`
section 1 holds exactly as written.

A value between `lg` and `xl`, around 21, was considered and rejected. It would
sit 3pt from one neighbour and 3pt from the other, and nobody picks correctly
between three near-identical numbers twice in a row. One extra step on an
existing five-value scale is a rule an engineer can apply without looking it up.

---

## 6. The circular icon button

This rule is about **icon buttons** only: the 38 to 46px circular single-glyph
controls such as Back and Close. The full-width primary text CTA is not one of
these.

### Text CTAs, Fields, And OTP

| Token | Value | Use for |
|---|---:|---|
| `controls.primaryCtaHeight` | 64 | Full-width primary text CTAs. |
| `controls.primaryCtaRadius` | 20 | Full-width primary text CTAs. |
| `controls.formFieldMinHeight` | 58 | Single-line form fields. |
| `controls.formFieldRadius` | 18 | Form fields and prompt boxes. |
| `controls.otpCellHeight` | 58 | Individual OTP cells. |
| `controls.otpCellRadius` | 14 | Individual OTP cells. |

Recipes:

- Primary text CTA: `height: controls.primaryCtaHeight`,
  `borderRadius: controls.primaryCtaRadius`, `backgroundColor: colors.accent`,
  `boxShadow: shadows.primaryCta`, Hanken 700 label.
- Text field: `minHeight: controls.formFieldMinHeight`,
  `borderRadius: controls.formFieldRadius`, `backgroundColor: colors.surface`,
  `boxShadow: shadows.formField`, Hanken body text.
- OTP: six equal cells using the OTP tokens over one invisible numeric
  `TextInput`. Never use one large visible code field.
- Small accent icon CTA: accent-soft surface, `shadows.iconCta`, named icon
  component. Use the heavier `IconAdd` glyph for plus-only add controls.

### The onboarding CTA

**Added 2026-09-12 (third round).** The onboarding journey has **one primary
button**, and it is not the app's primary button.

| Part | Specification |
|---|---|
| Height | `controls.onboardingCtaHeight` (**56**) |
| Radius | `radius.pill`. Fully rounded, never `controls.primaryCtaRadius` |
| Fill | `colors.accent` |
| Label | White, **17 / 700**, `fonts.ui` |
| Elevation | `shadows.onboardingCta` |
| Width | Full width inside the screen gutter |
| Primitive | `Primary` in [`expo/src/components/onboarding/primitives.tsx`](../expo/src/components/onboarding/primitives.tsx). A screen composes it; a `.jsx` file that cannot import it cleanly matches these six values exactly |

**The scope is the whole journey, from the intro's Get started to WELCOME.** That
is the three-screen animated intro's CTA, the questionnaire's **Continue** on
every step, W3 through W7, the email and code screens, and every button inside
them — W6's **Redraw** included, which is drawn in this recipe rather than in a
recipe of its own. There is no second primary anywhere between those two points.

**The app-wide primary is unchanged and stays everywhere else.**
`controls.primaryCtaHeight` (64) at `controls.primaryCtaRadius` (20) with
`shadows.primaryCta` is still the rule for Create, the reader, the library and
the rest of the product. This is a deliberate two-recipe system, not a drift to
be reconciled: onboarding is a sequence of full-bleed compositions where a 64 pt
rounded-rectangle slab competes with the picture above it, and a 56 pt pill reads
as the one thing to press. Outside onboarding the button sits under dense
content and wants the heavier target.

**The failure this fixes was six buttons, not two recipes.** The path shipped
with the intro on one size, the questionnaire on another, and W3-W7 on a third,
with two of them rounding differently and one carrying the wrong shadow, so the
same act looked like a different control on every consecutive screen. One
recipe in one primitive is what makes a sequence feel like one flow; the choice
of 56 over 64 matters less than that nothing on the path chooses for itself.

### The onboarding field

**Added 2026-09-12.** Every text input on the onboarding path is one recipe in
one place, and it is drawn by one component.

| Part | Specification |
|---|---|
| Face | `onboardingType.field`: **16 / 22, `fonts.ui`, regular**. The value and the placeholder both |
| Primitive | [`expo/src/components/onboarding/Field.tsx`](../expo/src/components/onboarding/Field.tsx). A screen composes `Field`, never a bare `TextInput` |
| Box | `colors.surface`, **1.5 pt `colors.onboardingBorderStrong`**, radius 14 (`controls.onboardingPlateRadius`) |
| Padding | `spacing.lg` across and `spacing.md` down, which lands a single line at **about 50 pt** |
| Multiline | **min-height 150 pt**, `spacing.lg` down, radius 16, top-aligned text |
| Focus | **2 pt `colors.accent`** plus `shadows.onboardingFieldFocus`, over `motion.fast` |
| Eyebrow | The uppercase `sectionHeader` label and an optional right-aligned counter share one row above the box, `spacing.sm` clear of it. Both belong to the primitive so neither can drift |

**An input never uses the display face or the reader face.** This is the rule the
component exists to hold. The flow shipped with three fields instead of one: the
name screen set its input in Bricolage at headline size, the Craft sheet set
appearance in Literata, and the email screen carried a third box of its own.
Three fields that looked like three products, in a sequence of five screens. The
distinction that resolves it is what the words are doing: a field holds text that
is **being typed**, which makes it a control, and controls are `fonts.ui`.
`fonts.display` is the one heading on the screen and `fonts.reader` is prose
already written, including the person's own appearance line once it is quoted
back to them inside W6's glass chip.

**The Create brief's fields already use the UI face at 16**, and that is where
`onboardingType.field`'s 16 / 22 came from rather than from a new measurement.
Their border and radius are **not** this recipe yet, and aligning them is
**deferred, not forgotten**. Exactly what would change in
[`expo/src/components/create/CreateBriefFlow.tsx`](../expo/src/components/create/CreateBriefFlow.tsx):

- `textArea`, `characterInput` and `optionInput`: `borderWidth` **1 → 1.5** and
  `borderColor` `colors.border` → **`colors.onboardingBorderStrong`**.
- The same three: `borderRadius` **`radius.md` → 14**.
- A focus ring added to all three: 2 pt `colors.accent` plus
  `shadows.onboardingFieldFocus`, which those fields have no equivalent of today.
- The `counter` style moves from under the box onto the label's eyebrow row,
  which is where `Field` puts it.

It is deferred because Create is out of scope under the section 2 migration
boundary, and because a border weight and a radius on the app's busiest form is a
change that deserves its own pull request rather than arriving as a side effect
of onboarding work.

| Token | Value | Use for |
|---|---|---|
| `controls.iconButtonSm` | 38 | The control in a dense row beside other content. |
| `controls.iconButton` | 42 | The default. Use this unless you have a reason. |
| `controls.iconButtonLg` | 46 | A lone control on an otherwise empty header. |
| `controls.iconButtonHighlightInset` | 6 | The highlight offset, exposed so a custom size can reuse it. |

Recipe:

- `width` and `height` from a `controls.*` size, `borderRadius` half of it, so
  the plate is a true circle and not a squircle.
- `backgroundColor: colors.surface`. No `borderWidth`.
- `boxShadow: shadows.iconButton`, swapped for `shadows.iconButtonPressed` on
  `onPressIn` and back on `onPressOut`. Do not animate the fill colour instead.
- Glyph in `colors.strong`.
- Hit area stays `spacing.huge` high, per `ONBOARDING_FLOW.md` section 1.

**"No flat fills", achieved without a gradient library.** The first layer is an
`inset` white highlight pushed 6px down from the top edge and pulled in by a
negative spread, so it lights the top of the plate and fades out before the
bottom. Over a solid `colors.surface` fill that reads as a soft top-lit sphere.
The inset highlight does the lifting, not a gradient, so no
`expo-linear-gradient` and no extra view. The second inset is the answering
shade at the bottom lip; layers three and four are the usual contact and ambient
drop shadow.

---

## 6A. Filter Chips

Use filter chips for compact option sets where the current value is visible and
the other values are secondary: genre, chapter length, and chapter count.

Recipe:

- Closed chip: `controls.formFieldMinHeight` hit target, `radius.pill`,
  `colors.accentSoft`, `shadows.card`, Hanken semibold text in `colors.accent`.
- The selected value is bold enough to scan. Use the down chevron from
  `IconChevronDown` at 14.
- Open menu: `colors.surface`, `radius.lg`, `shadows.overlay`, one row per
  option, selected row in `colors.accentSoft` with `IconCheck`.
- Menus are overlays anchored to the chip. They must not participate in normal
  layout and must not push helper text, CTAs, or adjacent filter groups down.
- Two filter chips in the same row close each other; only one menu is open at a
  time.

---

## 7. Iconography

**Icons are Ionicons outline, from `@expo/vector-icons`.**

**Why not SF Symbols.** SF Symbols is the literal answer to "Apple line icons",
and it is the wrong one here. `expo-symbols` renders nothing on Android and
nothing in a web bundle, because the glyph comes from the OS. Product review
happens in the Expo web preview, so an SF Symbols flow reviews as blank boxes.
Ionicons is drawn in the same Apple line idiom, ships as a font inside
`@expo/vector-icons`, which is already a dependency, and renders identically on
iOS, Android and web.

**Why outline.** Ionicons ships each glyph three ways: `-outline` (thin, open),
plain (heavier), and `-sharp` (squared terminals). `-outline` is the line style
being matched, so it is the default. Two glyphs deliberately break it, and each
says so at its definition in `icons.tsx`:

| Role | Glyph | Call |
|---|---|---|
| `IconBack` | `chevron-back-outline` | A chevron, not `arrow-back-outline`. Apple's back affordance is a chevron; the arrow reads as undo beside a title. |
| `IconClose` | `close-outline` | Default. |
| `IconRemove` | `close` | **Not outline.** At 14pt in a chip, `close-outline` is a hairline that disappears against a tint, and it is a destructive control. |
| `IconAdd` | `add` | **Not outline.** Plus-only CTAs need the heavier line to read as an intentional control at small size. |
| `IconCheck` | `checkmark` | **Not outline.** Ionicons draws both as the same open path; only `checkmark` carries enough stroke to register as a state at 16pt. |
| `IconCheckCircle` | `checkmark-circle-outline` | Default. |
| `IconChevronDown` | `chevron-down-outline` | Default. |
| `IconChevronForward` | `chevron-forward-outline` | Default. |
| `IconPencil` | `pencil-outline` | Editing/rewriting benefit rows. |
| `IconRefresh` | `refresh-outline` | Retry, redraw, refund, or regeneration benefit rows. |
| `IconPalette` | `color-palette-outline` | Cover/art benefit rows. |
| `IconTrash` | `trash-outline` | Delete/private/publish ownership benefit rows. |

**Optical sizing.** Ionicons and lucide do not agree on what a 16pt icon is.
Lucide draws on a 24-unit box with a 2-unit margin, so the mark fills about 83%
of the nominal size. Ionicons draws on a 512-unit box with more padding, so at
the same nominal size the mark lands visibly smaller and the stroke lands
lighter. `icons.tsx` exports `OPTICAL_SCALE = 1.125` and applies it inside every
component: **the `size` a caller passes is the size the old lucide glyph
occupied**, and it is scaled up before it reaches Ionicons. Call sites keep the
numbers they already have. 1.125 was chosen because the common sizes land on
whole points: 14 to 16, 16 to 18, 20 to 23, 22 to 25.

Rules:

1. **`expo/src/theme/icons.tsx` is the only sanctioned place in onboarding that
   imports `@expo/vector-icons`.** A screen imports named components, from that
   module or from the `@/theme` barrel, and never a raw glyph name. The glyph,
   its optical size and its default colour stay one decision in one file.
2. **Every icon defaults to `colors.strong`.** Pass a colour only for a state:
   `colors.accent` on a selected control, `colors.success` on a satisfied
   requirement, `colors.tertiary` on a de-emphasised remove.
3. **The rest of the app is still on `lucide-react-native` and stays there.**
   `App.tsx`, `CreateStudioScreen`, and everything under `src/components/` are
   not migrated. Do not swap a file over as a side effect of unrelated work; it
   is a per-surface pull request, exactly like the type migration in section 2.
4. **A new role gets a new named export here**, not an inline `<Ionicons>` at
   the call site.

### 7.1 Onboarding glyph tiles

**The one sanctioned exception to "icons are Ionicons".** The six rows of the
W4 "Katha will draw" card and the W6 benefit card are drawn by hand in
`react-native-svg`, in `expo/src/components/onboarding/glyphs.tsx`. Nothing
else in the app may do this; a new pictogram anywhere else is still a named
export in `icons.tsx`.

**Why.** Those twelve rows sat as an `accentSoft` square with an Ionicons
outline glyph in `accent`, six times, on two consecutive screens. An icon font
gives one stroke weight, one tone and one silhouette vocabulary, so the rows
differed only in which pictogram sat in the same orange box, and the cards read
as a list of identical tiles rather than as six promises. That is a structural
limit of an icon set, not a choice of the wrong glyph names, so it cannot be
fixed by picking different ones.

The language, which any future glyph in this file follows:

| Rule | Value |
|---|---|
| Grid | 24 x 24 viewBox, rendered at 22 inside a 40 tile |
| Optical margin | 3 to 4 units, so nothing touches the tile's rounded corners |
| Tones | Exactly two: a soft fill and a `colors.ink` stroke |
| Fill | A theme colour at low `fillOpacity` (`accent` 0.22, `sepiaAccent` 0.20, `chromeStar` 0.35), picked to sit on its own tile ground |
| Stroke | `colors.ink`, width 1.75, round caps and joins |
| Forbidden | Gradients, shadows, a third tone, a second stroke weight |
| Tile | `GlyphTile`: `radius.md`, ground = `tint`, `size` default 40, glyph scaled at 22/40 |

**Stroke is `colors.ink`, not `colors.strong`.** Section 7 rule 2 governs
Ionicons glyphs on `bg` or `surface`, where `strong` stops a mark out-shouting
the title beside it. These marks sit on a saturated tint, where `strong` loses
about a third of its contrast and the line goes soft; `ink` on a tint lands at
roughly the apparent weight `strong` has on white. Icon-set glyphs are
unaffected and still default to `strong`.

**The tint rotates, and the two cards rotate it differently.**
`colors.accentSoft` (warm), `colors.sepia` (parchment) and
`colors.sepiaPlaceholder` (deeper parchment) take turns down each card, W6 in a
different order from W4, so neither card is a column of orange and the two
screens do not rhyme. Each glyph carries its intended ground as a `tint`
property and `GlyphTile` defaults to it, so a call site that passes only
`glyph` still gets the rotation; an explicit `tint` overrides it.

**Six marks, none reused across the two screens.** W4 is a framed portrait, a
hanger with a tag, a name plate with a written line. W6 is an open book with a
figure on the spine, two overlapping portrait frames, a shelf of three
character tokens. The two frame-based marks are the pair most at risk of
collapsing into each other, so one is strictly singular and centred and the
other is duplicated and offset. The reader variant of the W6 first row reuses
`GlyphLeadsStories`: the copy changes, the claim does not.

### 7.2 The credit coin

**The second sanctioned hand-drawn mark**, and the last one: `CreditCoin` in
`expo/src/components/onboarding/CreditCoin.tsx`. It is the credit currency's
face wherever a credit appears as an **object** rather than as a label. Today
that is two places: the welcome screen's stack, and the coins that fly from it
to Home's credits pill. The pill itself keeps its Ionicons `Sparkles` glyph,
because a pill is a label.

**Why it is not a circle with an icon in it.** It was exactly that: a
`chromeStar` `View` with `borderRadius` and an outlined sparkle inside. A flat
disc is read as a status dot or a colour swatch, not as a thing that was given
to you, and the screen it sits on has one job, which is to make a grant feel
like a grant. What was looked at before drawing it: Duolingo's gems, Headspace's
flat brand marks, the Notion and Canva credit marks, and the gold of Clash
Royale and Coin Master. They differ in hue and in emblem and agree on four
moves, all four of which this mark uses.

| Rule | Value |
|---|---|
| Grid | 24 x 24 viewBox, `size` in points, square |
| Rim | A full circle, `r` 11, in the rim tone. 1 unit of margin so a call site's round contact shadow does not cut the drawing |
| Face | A circle, `r` 8.6, `colors.chromeStar`, centre `cy` **11.6** |
| Highlight | One crescent between two arcs, upper left, `colors.surface` at `fillOpacity` 0.5 |
| Emblem | The four-point Katha spark, solid `colors.ink`, centred on the face |
| Tones | Three flats plus ink. No gradient, ever |
| Forbidden | A gradient library, a milled edge, an inner ring, numerals, a second emblem |

**The face sits high in the rim, and that is the whole trick.** `cy` 11.6
against the rim's 12 makes the visible edge 2 units at the top and 2.8 at the
bottom, so the bottom edge reads as the coin's thickness catching its own
shadow. It is the cheapest possible top-lit cue and it is the one that survives
being scaled to 20pt. Centre the face and the mark goes back to being two
concentric circles.

**No gradient, at any size.** At 20pt a two-stop gradient resolves to one muddy
tone; at 52pt it reads as a smear rather than as metal. Every consumer app
shipping a small currency mark flattens it for the same reason. The highlight
does the lighting instead, and it is a filled band rather than a stroked arc
because a stroke's round caps become two visible dots once the coin is scaled to
the flight's landing size.

**The rim tone is a constant, not a token.** `#C48F1D` is `colors.chromeStar`
`#F5B324` with all three channels at 80%, which keeps the hue and the saturation
exactly: the same gold with the light taken off it, not a new colour. It stays a
documented constant inside `CreditCoin.tsx` because it exists only to be the
shaded side of one object; as a token it would end up on text and borders, where
an 80%-value amber fails contrast.

**The emblem is the four-point spark Home's pill carries.** That is not a
rhyme for its own sake. The flight exists to answer "where did my credits go",
and the coins can only read as landing **on** the pill if the thing on the coin
and the thing on the pill are the same shape.

---

## 8. Spacing

The raw scale is unchanged and is not redefined here. There are **two** semantic
tokens, and they are one rhythm:

| Token | Value | Use for |
|---|---|---|
| `spacing.related` | 8 | The gap **inside** a group: a label and its control, a heading and the content it heads, a helper line and the field it explains. |
| `spacing.betweenGroups` | 24 | The gap **between** one such group and the next, and below a screen title and its sub before content begins. |

**They are always used together, and neither means anything alone.** Hierarchy
is the contrast between them, not either number. 24 against 8 is a ratio of
3:1, which is unmistakable at a glance. If you reached for `related` inside a
group, `betweenGroups` is what goes around it; if you find yourself typing a raw
size on either side of that pair, one of the two tokens is the answer.

**Why 24 and not 12, 16 or 20.** The invariant is *clearly* larger, not
marginally larger. 12 gives 1.5:1 and 16 gives 2:1, and neither survives a
screen where a group's own internal leading already eats several points: the
section head floats and the screen reads as one flat list. 24 gives 3:1, sits on
the 4pt grid, and is the value section 8.1 already called for under a title and
sub pair, so one token covers both cases rather than two near-identical numbers
nobody can choose between.

The full rationale lives in the doc comment on `spacing` in
[`expo/src/theme/theme.ts`](../expo/src/theme/theme.ts). `theme.test.ts`
enforces `related < md`, `betweenGroups > related`, and
`betweenGroups >= related * 2`.

A uniform gap destroys grouping: if the gap inside a group equals the gap
between groups, the reader sees several separate items instead of one unit, and
a section head belongs to the section above it as much as to the content it is
supposed to head.

### 8.1 A screen title and the sentence under it are one group

This is the case that keeps getting missed, and it was missed on "Anything that
has to happen?", where the sub floated far enough from the title to look like a
separate paragraph. The pair in section 8 already covers it and nothing further
is needed. The failure is that the title and its sub were never treated as a
group at all: they are siblings in a container
with one large uniform gap, so they inherit the gap meant for separating
sections.

The rule:

- `spacing.related` between the screen title and the sentence under it. The sub
  is the second line of the title, not the next item.
- `spacing.betweenGroups` goes **below the pair**, before content begins.
- If the title-to-sub gap is bigger than the sub-to-first-card gap, the reader
  attaches the sentence to the card and the screen loses its opening statement.
  That is the symptom to look for.

The same shape applies one level down: a `sectionHeader`, its helper line, and
the control they head are one group at `spacing.related`, with
`spacing.betweenGroups` before the next section. That pairing plus the ramp in
section 3.0 is the whole of what "size and space hierarchy" means here.

Gutter stays `spacing.xxxl`. Safe area plus `spacing.lg` under fixed CTAs.

---

## 9. Applying this to a new component

Work down the list. Every item is answerable without asking anyone.

1. **Import from `@/theme`.** No local constants, no inline hex, no magic
   numbers. If the value you need is missing, add a token here rather than a
   literal there.
2. **Type.** One `title` per screen, sentence case, and it is the only size
   above `body`. Uppercase eyebrows use `sectionHeader`. Secondary copy uses
   `helper` and is never the same size as the field text beside it. The user's
   words and the story's words are `body`. Asides are `caption`. A size never
   moves without its line height. Section 3.0.
3. **Weight.** Any semibold Inter Tight names `fonts.tightSemiBold`. Never rely
   on `fontWeight`.
4. **Colour.** `ink` for primary text, `muted` for secondary, `strong` for every
   icon. Selected states use `accentSoft` with an `accent` border.
5. **Cards are white and lift.** `colors.surface` fill on a `colors.bg` ground,
   an elevation, and no `borderWidth`. A text field is a card. Section 4.2.
6. **Elevation before borders.** Pick `card`, `raised`, or `overlay`. Delete the
   `borderWidth` the shadow now replaces.
7. **Radius follows depth.** `md` flat, `lg` lifted, `xl` panels, `pill` chips
   and the CTA. A white card or field on the ground moves up one step, `md` to
   `lg`. Section 5.
8. **Dividers.** 1px in `colors.track`. Never `border`.
9. **Circular icon buttons** follow section 6 exactly: a `controls.*` size, half
   that as radius, `shadows.iconButton`, a `strong` glyph, no border, no flat
   fill.
10. **Icons.** A named component from `expo/src/theme/icons.tsx`. No direct
    `@expo/vector-icons` import, no raw glyph name, no lucide in onboarding.
    Section 7.
11. **Grouping.** The pair, always together: `spacing.related` inside a group,
    `spacing.betweenGroups` between groups. Never a raw size on either side of
    it. If a `sectionHeader` is not visibly closer to the content under it than
    to the section above it, the rhythm is wrong. Section 8.
12. **Title and sub.** Verify this on every new screen: the screen title and the
    sentence under it are ONE group at `spacing.related`, with the larger gap
    below the pair. If the sub sits closer to the first card than to the title,
    it is wrong. Section 8.1.
13. **Motion.** `motion.fast`, `motion.base`, or `motion.slow` only. Honour
    reduced motion, per `ONBOARDING_FLOW.md` section 0.
14. **Copy.** No em dashes.
15. **Prove it.** If your component relies on a new token, add the invariant to
    `theme.test.ts` so the rule cannot silently regress.

---

## 10. Conflicts resolved

| Conflict | Resolution |
|---|---|
| "Negative tracking on every heading" versus `sectionHeader` at positive tracking | Both hold. Negative on sentence-case titles, positive on uppercase eyebrows. Section 3.1. |
| Semibold by `fontWeight` versus static font instances | `fontWeight` cannot reach 600 from a static 400 file. Semibold tokens name `fonts.tightSemiBold`. Section 3.2. |
| "A lighter ground" versus "a wider gap so cards lift" | Both hold, because they measure different things. The ground reads lighter and airier because two thirds of its saturation is gone; its luminance drops so white can separate from it. Section 4.1. |
| "Cool the ground" versus the warm `sepia*` reader and the genre gradients | Cool by removing saturation, not by adding blue. The ramp keeps a 40 to 48 degree amber hue, so `sepia` stays the saturated member of one family. Section 4.1. |
| "Apple line icons" versus a web preview | Ionicons outline, not SF Symbols. SF Symbols renders blank on web and Android. Section 7. |
| "The sub is too far from the heading" versus "do not add tokens" | A title and its sub were never grouped; the `related` / `betweenGroups` pair covers it with no case-specific token. Section 8.1. |
| "The eyebrow must not be the quietest text in its group" versus "these headings are far too big" | The second wins, and the first was the wrong frame. An eyebrow is told apart by case, weight, tracking and colour, not by size; promoting it to 21 gave the details screen five near-titles and destroyed the hierarchy it was meant to build. 12pt eyebrow, 28pt title, nothing in between. Section 3.0. |
| "Secondary copy at 14.5 sits too close to 16pt field text to read as intent" versus "secondary copy must not be as loud as the field" | The second wins. 1.5pt is below the threshold for a size difference carried by size ALONE; `helper` is also `colors.muted` against `colors.ink`, and two signals clear it. Section 3.0. |
| "Make the heading bigger" versus "34 was too big" | 28. Measured: 34 wraps even the short headings, 22 fits the longest by half a point, 28 wraps the two longest to exactly two lines. Section 3.0. |

---

## Decisions

1. **Scope is onboarding only until a surface is migrated deliberately.**
2. **Import from the `@/theme` barrel, never from a leaf file.**
3. **Semibold is a family, never a `fontWeight`.**
4. **Negative tracking on sentence case, positive on uppercase.**
5. **`colors.strong` for icons, `colors.ink` for primary text, `colors.muted` for
   secondary.**
6. **`colors.track` for dividers, never `colors.border`.**
7. **Every elevation is layered, and elevation replaces borders.**
8. **Radius follows depth: `md` flat, `lg` lifted, `xl` panels.**
9. **The circular icon button is lit by an inset highlight, never a flat fill,
   and never a gradient library.**
10. **The full-width primary CTA stays a flat accent pill and is not an icon
    button.**
11. **`spacing.related` inside a group, `spacing.betweenGroups` between groups**,
    always as a pair and never a raw size on either side of it.
12. **New tokens ship with an invariant in `theme.test.ts`.**
13. **No em dashes in product copy.**
14. **The ground and the card must measure at least 0.10 apart in relative
    luminance**, and `theme.test.ts` computes it rather than asserting a pair of
    hexes.
15. **`colors.surface` is pure white and is the card.** A card is never the
    ground with a border, and never `surface2`.
16. **`surface2` is a recessed inset fill and stays below `bg` on the ramp.**
17. **The ramp is cooled by cutting saturation, never by adding blue**, so the
    `sepia*` reader and the genre gradients survive untouched.
18. **The accent stays Katha orange `#FF6B1A`.** A tinted chip is `accentSoft`,
    never the reference's green.
19. **A white card or text field on the ground moves up one radius step, `md` to
    `lg`.** No new radius token.
20. **Icons are Ionicons outline, not SF Symbols**, because SF Symbols renders
    blank on web and Android.
21. **`expo/src/theme/icons.tsx` is the only sanctioned `@expo/vector-icons`
    import surface in onboarding**, and the rest of the app stays on lucide
    until migrated deliberately.
22. **Icon sizes are passed in lucide-equivalent points** and scaled by
    `OPTICAL_SCALE` inside the icon components.
23. **A screen title and the sentence under it are one group at
    `spacing.related`**, with `spacing.betweenGroups` below the pair.
24. **The onboarding size ramp is 28 / 16 / 14.5 / 12**, and `title` is the only
    size above `body`. One large heading per screen.
25. **The screen title is 28**, chosen by measuring every heading in the flow
    against a 326pt column: 22 fitted the longest by half a point, 34 wrapped
    even the short ones, 28 wraps the two longest to exactly two lines.
26. **An eyebrow is a treatment, not a ramp level.** `sectionHeader` is 12pt and
    deliberately smaller than the copy it heads; it is read first because it is
    uppercase, semibold, tracked +1 and `colors.tertiary`, four signals at once.
    Reversed in favour of size once, on the details screen, and reverted.
27. **Secondary copy is smaller than the content it supports.** `helper` (14.5)
    under a title or an eyebrow; `body` (16) for the user's own words and the
    story's. Setting a helper line at `body` gives our sentence equal billing
    with theirs.
28. **A size never moves without its line height**, and tracking is held
    proportional to size (0.032em on the title, 0.083em on the eyebrow) rather
    than carried as a fixed pixel value.
29. **`spacing.betweenGroups` is 24, at least three times `spacing.related`**,
    because grouping is the contrast between the two gaps and not either value.
30. **Onboarding has one field recipe and one component that draws it.**
    `onboardingType.field` at 16 / 22 in `fonts.ui`, the `Field` primitive, a
    1.5 pt `onboardingBorderStrong` border that becomes 2 pt accent with
    `shadows.onboardingFieldFocus` on focus, about 50 pt on one line and 150 pt
    multiline. **An input never uses `fonts.display` or `fonts.reader`**, because
    a field holds text being typed and that makes it a control. Section 6.
31. **The Create brief's fields keep their border and radius for now.** They
    already use the UI face at 16, which is where the token's size came from;
    the 1.5 pt border, the 14 radius, the focus ring and the eyebrow-row counter
    are a deferred Create-surface pull request under the section 2 boundary, not
    an onboarding side effect. Section 6 lists the four changes.
