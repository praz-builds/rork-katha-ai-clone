# Katha Design System

<!-- markdownlint-disable MD013 -->

This file is the definitive design contract for the Katha Expo app. It describes the implementation in `src/components/BrandWordmark.tsx`, `src/screens/KathaOnboarding.jsx`, `src/screens/KathaOnboardingFlowV2.tsx`, `src/screens/CharacterOnboarding.tsx`, and `src/theme/theme.ts` as of 2026-09-21. (`WriterOnboarding.tsx` was deleted in #92 -- the writer branch is `CharacterOnboarding.tsx` now.)

Use this document before changing onboarding, paywall, or shared visual components. The reference viewport is **390 x 844 points**. Local screenshots and the historical handoff are supporting evidence, not permission to fork the system.

## Non-Negotiable Rules

1. Use `BrandWordmark` everywhere the Katha AI wordmark appears. Do not rebuild it from ordinary text or use the square app icon as a wordmark.
2. Use bundled fonts and wait for `Font.loadAsync` before rendering the app.
3. Use `BricolageGrotesque` for display text, `HankenGrotesk` for product UI, `Baloo2` only for the brand, and `Literata` for long-form reading. **A CTA never uses the display font**: every button label is Hanken.
4. Set visible text to `letterSpacing: 0`. Do not introduce negative letter spacing.
5. Do not introduce visible em dashes. Rewrite the sentence or use punctuation that reads naturally.
6. Preserve the fixed intro geometry and fixed message slots across all three slides.
7. Do not add a replay screen after onboarding. Success hands off to Home.
8. Prices shown in the current prototype are placeholders. Production pricing and currency must come from RevenueCat/store products.

## Brand Identity

### Shared Wordmark

The official in-app wordmark is constructed by `src/components/BrandWordmark.tsx` as three adjacent text segments on one baseline:

| Segment | Text | Color | Typeface | Weight |
| --- | --- | --- | --- | --- |
| Lead | `K` | `#FF6B1A` | Baloo2 | 900 |
| Name | `atha` | `#1E1A16` | Baloo2 | 900 |
| Suffix | `AI` | `#FF6B1A` | Baloo2 | 900 |

Construction rules:

- Container: horizontal row with `alignItems: 'baseline'`.
- `Katha`: `lineHeight = size * 1.04`.
- `AI`: `fontSize = size * 0.43`, `lineHeight = size * 0.52`, and `marginLeft: 2`.
- Every segment uses `letterSpacing: 0`.
- The component has `accessibilityRole="image"` and `accessibilityLabel="Katha AI"`.
- Do not insert spaces inside `Katha`, add a gap before `AI`, substitute another font, or lower the weight.

Approved sizes:

| Context | `size` prop | Placement |
| --- | ---: | --- |
| Intro hero | 28 | Horizontally centered, top 34 |
| Purpose and name screens | 28 | Left aligned within 30 point page gutters |
| Notification education | 26 | Horizontally centered, 30 points above alert |
| Default shared fallback | 28 | Use only when no context override is needed |

The app icon and the wordmark are different assets. The wordmark is text-built for crisp baseline control. Cover art and avatars are content assets, not brand marks.

## Color System

`src/theme/theme.ts` contains the app-wide baseline. The onboarding files add warm, more specific aliases. Prefer the shared token when the value is equivalent.

### Core Tokens

| Token | Hex | Use |
| --- | --- | --- |
| `bg` | `#FAF7F2` | General app background |
| onboarding `bg` / `phoneBg` | `#FBF6EC` | Onboarding canvas and intro frame |
| `canvas` | `#F2EEE8` | Secondary canvas |
| `surface` / `card` | `#FFFFFF` | Cards, inputs, alerts |
| `surface2` | `#F5F0E9` | Muted surfaces |
| `ink` | `#1E1A16` in onboarding, `#0F0E0C` globally | Primary text; preserve the local onboarding value inside onboarding |
| `inkSoft` | `#2A231C` | Strong body text |
| `inkBody2` | `#3A2E20` | Secondary strong body text |
| `muted` | `#6B625A` in onboarding, `#6B6560` globally | Descriptions and supporting copy |
| `muted2` | `#8A7F73` | Metadata |
| `muted3` | `#B49A82` | Placeholders and tertiary labels |
| `accent` / `orange` | `#FF6B1A` | Primary CTA, brand K, AI suffix, selected state |
| `orangeHi` | `#FF8A3D` | Accent gradient highlight |
| `accentPressed` | `#E85610` globally, `#E5560A` in intro | Pressed accent |
| `orangeDeep` | `#B15A18` | Accent text on pale orange |
| `peach` / `chipPeach` | `#FFF1E5` | Selected rows and edit chips |
| `peachSoft` | `#FFF6EF` | Selected paywall surfaces |
| `line` | `#E7DCC9` | Onboarding borders |
| `border` | `#EEE7DE` | General borders |
| `borderStrong` | `#DED5C7` | Stronger neutral border |
| `track` | `#EAE0D0` | Progress track |
| `disabledBg` | `#EDE3D4` | Disabled CTA fill |
| `disabledFg` | `#B7AB99` | Disabled CTA label |
| `reviewBorder` | `#F3EADB` | Review card border |
| iOS action blue | `#007AFF` | Notification alert actions only |

### Intro-Specific Colors

| Token | Hex | Use |
| --- | --- | --- |
| `heroA` | `#FEFBF3` | Top of intro hero gradient |
| `heroB` | `#F3EAD8` | Bottom of intro hero gradient and marquee edge fade |
| `hairline` | `#F0E7D6` | Story and publish separators |
| `dotIdle` | `#DED5C8` | Inactive carousel dots |
| `orangeEdit` | `#8A3E12` | In-place rewritten word |
| `shadowWarm` | `#7A2E0E` | Warm card shadow |

Do not replace the warm neutral system with a one-color orange interface. Orange is an action and emphasis color, while ink, white, and warm neutrals carry the layout.

## Spacing and Layout Rhythm

The shared scale in `src/theme/theme.ts` is:

| Name | Value |
| --- | ---: |
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 20 |
| `xxl` | 24 |
| `xxxl` | 32 |
| `huge` | 48 |

Onboarding also uses **6, 10, 14, 18, and 30** where the component geometry requires them. Apply these rules:

- Standard onboarding page gutter: 30.
- Intro message-sheet gutter: 28.
- Paywall gutter: 24.
- Main content gap: 12 or 14.
- Heading-to-description gap: 8 on compact screens, 10 on standard screens.
- Option-row gap: 12 between rows; 14 inside a row.
- Footer separation: 12 above the CTA and 30 below.
- Do not vertically recenter individual intro slides based on their content. Their stage and message slots are fixed.

## Radius System

The shared theme exposes 8, 14, 18, 24, and pill. Onboarding uses additional values for exact components.

| Radius | Component category |
| ---: | --- |
| 6 | Tiny book spine and progress track |
| 8 | Small general controls from the shared theme |
| 12 | Intro Home cover well |
| 14 | OTP boxes, intro shelf tiles and direction rows |
| 15 | Icon badges |
| 18 | Text fields and prompt boxes |
| 18 | Option rows, plan cards, review cards |
| 22 | Intro slide cards, genre chips, edit chips |
| 24 | Large shared card radius |
| 28 | Apple-style notification education alert |
| 999 | Pills only |

Use the smallest established radius that matches the component category. Do not round every panel into a pill.

## Typography

All font files are bundled in `assets/fonts` and loaded in `App.tsx` under these exact family names.

| Family | Role | Bundled files |
| --- | --- | --- |
| `Baloo2` | Brand wordmark only | `Baloo2.ttf` |
| `BricolageGrotesque` | Display headings on Home and onboarding. Never a button label, Profile UI heading, or create-flow heading | `BricolageGrotesque.ttf` |
| `HankenGrotesk` | UI labels, body copy, metadata, inputs | `HankenGrotesk.ttf` |
| `Literata` | Long-form story reading | `Literata.ttf` |
| `LiterataItalic` | Long-form italic reading | `Literata-Italic.ttf` |

### Product Type Scale

| Style | Family | Weight | Size / line height | Use |
| --- | --- | ---: | --- | --- |
| Flow H1 | Bricolage | 800 | 31 / 35 | Primary name screen heading |
| Flow H1 medium | Bricolage | 800 | 28 / 32 | Email, OTP, compact feature headings |
| Flow H1 compact | Bricolage | 800 | 27 / 31 | Purpose, genre, persona questions |
| Intro headline | Bricolage | 700 | 27 / 31.3 | Intro message slot, one line (see *The intro* below) |
| Paywall title | Bricolage | 800 | 25 / 29 | Personalized paywall headline |
| Notification title | Bricolage | 800 | 22 / 26 | Alert title |
| Standard body | Hanken | 500 | 15 / 23 | Flow descriptions |
| Compact body | Hanken | 500 | 14.5 / 22 | Compact descriptions |
| Option title | Hanken | 700 | 16 / natural | Selection labels |
| Option detail | Hanken | 400 | 13 / natural | Selection descriptions |
| Create step heading | Hanken | 700 | 26 / 32 | `type.createTitle`: every create-flow step heading ("What's your story about?", "Where does it begin?", "Craft character", the crafting loader, create dialogs) |
| Primary CTA | Hanken | 700 | 17 / natural | Main button labels. **CTAs never use the display font** -- not a Button, not a text link, not a tappable card whose label is its only text |
| Input | Hanken | 600 | 17 / natural | Email input |
| Name input | Bricolage | 700 | 24 / natural | First-name entry |
| Review copy | Hanken | 500 | 12.5 / 17 | Social proof cards |
| Metadata | Hanken | 400 to 700 | 11 to 13 / 17 to 19 | Hints, labels, prices |
| Story text in intro | Hanken | 400 | 13 / 18 | Typed story idea on intro screen 2 |

### The intro

The three animated screens before **Get started** are **Character, then Story,
then Read and listen** (2026-09-29). They were Create, then Publish and
Community, then Read; that entry described a notification tile, a publish card,
reaction chips and a rewrite chip, none of which exist any more, and those rows
have been removed from the tables above rather than left to be matched against.
`source-of-truth/ONBOARDING_FLOW.md` is canonical for what each screen says.

What this file is still the contract for:

- **Every headline is one line.** The slot is sized to one (`minHeight: 32`),
  so a longer headline wraps and that slide's dots-to-headline and
  headline-to-subcopy gaps stop matching the other two. That is the whole
  reason the headlines are short; it is not a tone choice.
- Hero band 478, message sheet minimum 322, slide cards at radius 22.
- The slide cards are 334 wide and the column is clamped to 430. Below about
  342 points of window width the first headline wraps. See *Narrow windows*
  under **Intro Frame** for what the cards do; the reference frame is
  390 x 844.

**Bricolage is for Home display titles and onboarding headings only.** Profile,
public profile, Journey, and Profile-owned sheet headings, display names, and
metrics use Hanken 700; this supersedes the earlier Profile-display exception.
The create flow is a working surface, so its headings are Hanken bold
(`type.createTitle`); Bricolage at 32 there read as a poster rather than a form.

The design rule is zero letter spacing for visible text. The only currently tolerated positive tracking is tiny uppercase metadata such as `NEW STORY`, cover-author labels, rating stars, and paywall badges. Do not add tracking to headings, body copy, buttons, or the wordmark.

## Borders and Shadows

### Borders

- Inputs and option rows: 1.5 points; selected border `#FF6B1A`, unselected `#E7DCC9`.
- OTP cells and plan cards: 2 points.
- Review cards: 1 point `#F3EADB`.
- Alert dividers: `StyleSheet.hairlineWidth`, `#D9D9DD`.
- Intro internal separators: 1 point `#F0E7D6`.

### Shadows

Use shadows to establish a single center piece or actionable surface, not on every section.

| Surface | iOS shadow | Android | Web |
| --- | --- | --- | --- |
| Intro warm cards | `#7A2E0E`, radius 15, offset 0/12, opacity supplied by component | elevation 12 | No explicit fallback in intro helper |
| The text button | orange, opacity 0.42, offset 0/12 | elevation 6 | `boxShadow: shadows.primaryCta`, applied by `Button` |
| Notification alert | `#3D2B1E`, opacity 0.18, radius 24, offset 0/12 | elevation 10 | `0 12px 30px rgba(61,43,30,0.16)` |
| Review card | `#7A2E0E`, opacity 0.15, radius 12, offset 0/6 | elevation 3 | Platform default |

## Component Recipes

### Button

**There is one text button and it is `src/components/Button.tsx`. A screen
never draws its own.** The four recipes this section used to list — 58/16 for
the standard flow, 56/16 for the intro, 60/17 for the paywall, 64/20 in the
theme — are exactly the drift it replaced: four sizes and four radii for one
act, none of them reading the token that was supposed to govern them.

- `controls.primaryCtaHeight` **52** (a `minHeight`, so a long label wraps
  rather than clipping) at `controls.primaryCtaRadius`, which is
  `radius.pill`.
- `colors.accent`, going to `colors.accentPressed` while held, with
  `shadows.primaryCta`.
- Label `type.button`: white, **17 / 700**, `fonts.ui`. **A CTA never uses the display font**, and that includes a hand-rolled text link: `button-recipe.test.ts` fails on a `<Pressable>` whose only `<Text>` is set in `fonts.display`. Home's write card (`WriteAnotherCTA`) is a button too, so its heading is Hanken 700, not Bricolage; the scan cannot see labels drawn by a child component, so that one is held by review.
- Full available width inside the page gutter, unless `fullWidth={false}`.
- `size="sm"` is `controls.buttonSmHeight` **44** with `type.buttonSmall`
  (15 / 700), for a control sitting in a row rather than under the content.
- Variants: `primary`, `secondary` (`colors.surface` with a 1.5pt
  `borderStrong` edge) and `ghost` (label and target only).
- Disabled draws a `colors.borderStrong` plate with a `colors.tertiary`
  label, not a faded orange one: a primary at 40% opacity still reads as the
  accent, so it looks pressable and does nothing.
- Destructive controls are **not** a variant. Deleting an account is
  `colors.danger` and blocking an author is `colors.premium`, deliberately
  unlike every other button in the app.
- Keep command copy direct. Current examples include `Continue`,
  `Build my profile`, and personalized paywall actions.

`source-of-truth/DESIGN_SYSTEM.md` section 6.1 carries the reasoning and
`src/__tests__/button-recipe.test.ts` enforces it.

### Icons

Icons are lucide (`lucide-react-native`). Some glyphs carry one meaning across the app and must not be reused for another:

- **`Sparkles` means credits, and nothing else.** The credits pill, prices and the credits screen. Not AI, not generation, not a suggestion.
- **`Signpost` is a direction the story could take**: the opening chips on Create's "Where does it begin?" and the chapter-end direction cards (both drawn by `DirectionChoices`).
- **`RefreshCw` is Reimagine**: the reader chrome action, the chapter-end pill and the re-prompt sheet's submit.

### Option Row

- Radius 18, border 1.5, padding 18, internal gap 14.
- Leading icon at 24, label at 16/700, detail at 13/400.
- Trailing radio: 22 x 22 with a 2 point border.
- Selected: orange border, pale peach background, orange filled radio with white check.
- Entire row is the hit target.

### Toggle

The one switch in the app is `src/components/Toggle.tsx`. **Never use React
Native's `Switch`, and never hand-roll another one.** `Switch` paints its thumb
and its off-state fill from the *platform* palette, so any prop a caller
forgets is not a missing colour, it is iOS green — which is how the create
brief shipped an orange track under a green thumb, a colour that appears in no
token file here. `Toggle` draws every pixel itself from `@/theme`.

- Geometry lives in `controls`: `toggleTrackWidth` 52, `toggleTrackHeight` 32,
  `toggleThumb` 26, `toggleInset` 3, `toggleHitTarget` 44. The control is 52 x
  32; the *target* is 44 x 44, the platform minimum, plus 6pt of `hitSlop`.
- Off: `borderStrong` track, `surface` thumb with `shadows.card`.
- On: `accent` track (the same accent as the onboarding option row and genre
  chip — this is that treatment, ported through tokens rather than copied out
  of onboarding's private `C` palette), `surface` thumb.
- Disabled: keeps its position and a tint of its state — `accentSoft` when on,
  `border` when off — and loses the thumb shadow. **A disabled toggle must
  never be drawn as an off one**: "Make it public" is disabled for a signed-out
  writer, and drawing it off tells them their story is private by their own
  choice.
- Motion: one shared value cross-fades the accent fill and slides the thumb
  over `motion.fast`. `useReducedMotion` makes the state *arrive* rather than
  travel; it never suppresses the change.
- Accessibility: `accessibilityRole="switch"` with
  `accessibilityState={{ checked, disabled }}`, and `accessibilityLabel` is a
  required prop — a switch with no name is unusable by voice.
- Props: `value`, `onValueChange(next)`, `disabled`, `accessibilityLabel`,
  `accessibilityHint`, `style`, `testID`. `onValueChange` receives the opposite
  of the current value and fires once per press, never when disabled.

### Genre Chip

- Horizontal wrap with 10 point gaps.
- Padding 11 vertical and 16 horizontal, radius 22, border 1.5.
- Selected: peach surface and orange border/text.
- Keep discovery-first order: Thriller, Fantasy, Bedtime Stories, Mystery, Adventure, Sci-Fi, then the wider catalog. Romance sits in the middle, not first.

### Inputs

- Name input uses a 2 point bottom rule, no enclosing card, Bricolage 24.
- Email and Other inputs use a white surface, radius 14, border 1.5.
- Email padding is 16 with Hanken 600 at 17.
- **Text buttons are never hand-rolled.** Compose `src/components/Button.tsx`: `controls.primaryCtaHeight` 52 at `controls.primaryCtaRadius` (`radius.pill`), a white `type.button` 17/700 label on `colors.accent`, and `shadows.primaryCta`. `size="sm"` is `controls.buttonSmHeight` 44 for a control in a row. The 58/60/64 heights and the 16/17/20 radii recorded elsewhere in this file were the per-screen copies this replaced; see `source-of-truth/DESIGN_SYSTEM.md` section 6.1.
- Form fields and prompt boxes use `controls.formFieldMinHeight` 58, `controls.formFieldRadius` 18, and `shadows.formField`.
- OTP is six equal cells, height 58, radius 14, with a single invisible numeric input over the row.
- Focus is orange. Placeholders use `#B49A82`.

### Progress

- Five visible personalization steps only: name, genres, purpose, first persona question, second persona question.
- Top bar gutter 24, element gap 14.
- Back button 34 x 34, radius 17.
- Track height 6, rounded, `#EAE0D0`; fill uses `#FF8A3D` to `#FF6B1A`.
- Label is `step/5`, Hanken 700 at 12.

### Cards, Reviews, and Chips

- Avoid cards inside cards.
- Use cards for individual story, price, review, or alert objects only.
- Review card: 286 x 106, radius 18, padding 13, avatar 30, one-point border, subtle warm shadow. At 390 points the next card appears only as a deliberate preview.
- Paywall plan card: radius 18, border 2, 16 vertical and 18 horizontal padding.

## Intro Frame: 390 x 844

The intro must not reflow between Character, Story, and Read and listen.

| Region | Geometry | Rules |
| --- | --- | --- |
| Root | 390 x 844 reference | `#FAF7F2` canvas; the column is clamped to `controls.introMaxWidth` (430) and the page scrolls when the window is short |
| Hero | x 0, y 0, w 390, h 478 | Clipped; `#FEFBF3` to `#F3EAD8` gradient behind the full window width |
| Wordmark | top 34, centered | `BrandWordmark size={28}` |
| Sign in | top 40, right 24 | 13.5/700, orange, always present. Not heavier: it is the one control on the screen that should not be pressed |
| Animation stage | the whole hero, per slide | Each slide centres its own card; clipped |
| Message sheet | below the hero, min height 322 | `#FAF7F2`, 28 horizontal, 22 top, 24 bottom |

Message-sheet slots are fixed:

- Dots: height 6, bottom gap 16. Active dot is 22 x 6; inactive dots are 6 x 6.
- Headline: **one line**, min height 32, Bricolage 27/31.3. Every headline is written to fit it — see *The intro* above. The slot is a minimum rather than a fixed height so a wrap grows it instead of overlapping the description.
- Description: fixed height 54, margin top 6, Hanken 15/22.5.
- Action slot: `flex: 1`, bottom aligned. Reserved on slides one and two.
- Slide three CTA: the shared `Primary` pill. Account sign-in follows with a 14 point gap.

Animation-object geometry:

- Character card: 306 x 346, radius 22, padding 16, top 92.
- Brief card: 334 x 372, radius 22, padding 16, top 84.
- Read card: 334 x 392, radius 22, top 78, `#F3F2EF`.
- Shelf tiles: 74 x 96, radius 14, gap 8. This is the intro's own tile size, not the product's `mini` cover, which is a 96 point square.
- Carousel transition: 600 ms, ease-in-out `(0.77, 0, 0.175, 1)` (the expo-animation skill's on-screen curve). A swipe follows the finger, rubber-bands past the first and last slide, and settles with a `{ duration: 400, dampingRatio: 0.8 }` spring carrying the release velocity; a quarter-width drag or a 500 pt/s flick turns the page.
- Dots: each 6 point dot has a 44 point touch target; the active width change is a 200 ms ease-out transition. The headline and description crossfade in their fixed slots (opacity only, 300 ms).

Do not size the hero or message sheet from child content. Long copy must be edited to fit the assigned slot.

**Narrow windows.** The cards are 334 wide and centred, so they are fully visible down to a 334 point column and are clipped by the slide's `overflow: hidden` only below that. Between 334 and 390 they simply run wider than the sheet's 28 point gutter. Separately, below about 342 points of window width the first headline wraps and that slide's spacing stops matching the other two.

## Intro Animation Storyboard

Each slide has **one shared progress value, counted in milliseconds**, read by every element through `useAnimatedStyle` on the UI thread. React re-renders on a phase change, not per frame; only text content that must change — the typed lines, the counters, the swapped labels — re-renders itself through `useAnimatedReaction`. Times below are milliseconds of that clock.

**Every slide's animation starts 350 ms after the slide becomes active** (`LEAD_IN`), so the carousel transition is most of the way done before anything on the new slide moves. Slide one runs 5,200 ms, slide two 9,200 ms, slide three 8,800 ms and then holds.

**Reduced motion sets every clock to its end frame.** Each slide's end frame is therefore a design deliverable in its own right and must read correctly as a still.

### Slide 1: Character

| Time | Event |
| --- | --- |
| 0 to 220 | Card fades in |
| 0 to 500 | Appearance types from 70 percent to complete, character by character; cursor blinks |
| 650 to 900 | CTA pulses to 1.06 |
| 900 to 1,100 | CTA presses to 0.95 and releases |
| 1,000 to 1,150 | Form dims to 0.5; CTA label becomes `Drawing Raya...` on `#E5560A` |
| 1,000 to 1,850 | Scan band and its 2 point orange line sweep the card once, top to bottom |
| 1,850 to 2,350 | Portrait fades in over an `#E9E0D3` ground, scale 1.06 to 1, with the name and `DRAWN BY KATHA` chips. End frame |

### Slide 2: Story

| Time | Event |
| --- | --- |
| 0 to 400 | Brief card rises 14 points and fades in |
| 500 to 700 | `Adventure` genre chip fills orange |
| 800 to 2,800 | Story idea types, character by character; the field takes an orange ring from 800 |
| 3,000 to 3,250 | Praz joins the cast; the counter goes 1 of 3 to 2 of 3 |
| 3,400 to 3,900 | `Create story` pulses, then presses |
| 3,900 to 4,200 | Brief content fades out |
| 4,000 to 4,300 | Directions container fades in (variant A, in place) |
| 4,300 / 4,550 / 4,800 | Each direction row rises 14 points and fades in, over 400 ms |
| 5,400 to 5,800 | `Edit` and `Reprompt` fade in |
| 5,900 to 6,200 | The chosen row fills `#FFF1E5` with an orange border and tick. End frame |

`INTRO_S2_VARIANT` selects variant A (swap in place) or B (collapse the card to 110 and stack the rows below it). Both end on the same frame. A ships.

### Slide 3: Read and listen

| Time | Event |
| --- | --- |
| 0 to 450 | Card fades in |
| 300 / 600 / 900 | Story card, then the two shelves, rise 10 points and fade in over 400 ms |
| 1,200 to 3,300 | Both shelves settle from a small inset to flush left, at different rates. They never drift negative: a shelf already says *there is more* by overflowing the right edge, and a negative drift slices the leading tile against the card edge |
| 2,650 | The first tile's heart fills and its count ticks by one, in one step |
| 3,000 to 3,350 | The story card takes an orange border, as if tapped |
| 3,350 to 4,150 | Shared-element morph, ease-out cubic: the cover grows from the Home well to a 334 x 230 band. Its box is computed by hand from this clock, anchored towards the top (`COVER_FOCUS_Y`), because `resizeMode="cover"` always centres and centred cuts a head off |
| 3,350 to 3,750 | Home content fades out |
| 3,900 to 4,300 | Story-page text fades in under a gradient into the page |
| 5,550 to 5,850 | `Listen` presses and becomes `Listening`; the meter then runs continuously. End frame |

The meter is three bars a third of a cycle apart on a plain sine, which is a travelling wave. Do not use `abs(sin)` with arbitrary offsets: it has period pi, so the outer bars fall into phase and pulse against the middle one, and it turns around instantly at every zero crossing.

## Onboarding Product Sequence

The implemented order is:

1. Animated Character, Story, and Read-and-listen introduction.
2. First name.
3. At least three genre interests (`MIN_GENRE_SELECTIONS` in `KathaOnboardingFlowV2.tsx`), with emoji chips. The first selected genre with a create mapping becomes the initial writer-genre chip.
4. Purpose: Reading, Writing, or A bit of both.
5. Adaptive persona question one.
6. Adaptive persona question two. For Writing this opens the dedicated writer story flow; for Reading or Both the CTA is `Build my profile`.
7. Profile-building transition.
8. Notification education.
9. Personalized paywall.
10. If the paywall is closed, a confirmation sheet. **There is no one-time offer** -- it was removed 2026-09-10 and deleted rather than deprecated (`../source-of-truth/ONBOARDING_FLOW.md` §14, decision 35). The welcome grant fires on declining the paywall.
11. Email capture after the user acts on the paywall.
12. Six-digit OTP verification.
13. Personalized success screen.
14. Home handoff.

**Email comes before the drawing, not after it.** `ONBOARDING_FLOW.md` is the record: **W5 Save** asks for the address while the portrait is still a dashed placeholder, so the portrait has an owner before it exists. Amended 2026-09-12: the image call fires one screen earlier still, on **W4**'s CTA, and W5's CTA only validates the address and sends the code -- the email and six-digit code screens exist to cover that wait. **W6 Meet** opens ready if the portrait landed while the code was being typed, loading if it has not. Auth never gates the aha; it runs beside it. The order is `w3 -> w4 -> w5 -> code -> w6 -> paywall -> welcome` (`Step` in `src/screens/CharacterOnboarding.tsx`). Both acceptance and decline paths still lead to profile saving. This ordering is a product decision of 2026-09-11 (#92) and 2026-09-12; do not reverse it without another.

### Persona Branches

| Purpose | Question 1 | Question 2 | Product consequence |
| --- | --- | --- | --- |
| Read | Reading, listening, or a mix | Before sleep, commutes/breaks, weekend binges, or on-demand escape | Tunes narration, recommendation framing, and routine messaging |
| Write | Novel, short stories, fan fiction, or poetry | Drafting, voice rewrites, chapter planning, or publishing/finding readers | Routes into the writer story-generation flow with the first selected genre prefilled |
| Both | Find a read, start creating, balance both, or surprise me | Read/remix, write/publish, listen/unwind, or explore/save | Connects discovery and creation without treating the user as read-first |

Name is first because it makes the questionnaire feel personal without asking for intent too early. Genres provide concrete taste before the purpose branch; Purpose then determines the copy and routing for the two adaptive questions.

## Notification Education

This screen educates before the real native permission request. It must look familiar without pretending to be the operating system dialog.

### Center Alert

- Width 326, centered.
- White background, radius 28, top padding 22, overflow hidden.
- Orange notification icon tile: 58 x 58, radius 15, bottom gap 14.
- Title: Bricolage 800, 22/26, centered, 26 horizontal padding.
- Body: Hanken 500, 13.5/19, centered, 25 horizontal padding, 8 top and 18 bottom margins.
- Hairline divider `#D9D9DD`.
- Actions row: height 52, equal halves, blue `#007AFF` labels at 16. `Allow` uses the stronger weight.
- `Not now` continues without permission. `Allow` is the handoff point for the native permission call.
- During browser review, a tap outside either action also continues without permission. It must never record notification consent.
- During the current pre-native integration phase, tapping anywhere on the education screen advances to the paywall. Preserve this temporary fallback until the real permission request is wired.
- Do not add a second notification CTA below the alert.

### Review Rail

- Label begins 34 points below the alert and has a 12 point bottom gap.
- One horizontal row only, with 30 point leading/trailing padding and 12 point gaps.
- Cards are 286 x 106 with 12 point gaps, leaving a deliberate preview of the next card.
- The rail auto-scrolls one point every 40 ms, loops over a duplicated review set, remains natively draggable, hides its scrollbar, and pauses while the user drags.
- Use the three bundled photos when assigned; initials use stable colored circles for the remaining reviewers.

## Paywall Personalization

The paywall receives and must continue to use:

| Input | Current use |
| --- | --- |
| `fname` | Personalized headline |
| `purpose` | Selects read, write, or both headline, subtitle, features, and CTA |
| `topGenre` | Names the shelf/audience genre |
| `refine` | Changes format-specific benefits, especially narration |
| `moment` | Changes routine, blocker, or outcome benefits |
| `plan` | Annual or weekly selection |
| `trial` | Annual-only 3-day trial flag; weekly never has a trial |

Read-first, write-first, and both users must not receive the same generic value proposition. The paywall must not use a trial toggle. Annual is selected by default and includes the canonical trial; weekly is available through the additional plan option and has no trial. All prices, grants, trials, and offers are defined only in `../source-of-truth/CREDITS_AND_PRICING.md` §3. The UI must read price, renewal, trial eligibility, and offer copy from RevenueCat product data — never hardcode these values.

Closing the paywall shows a confirmation sheet, and that is where the close flow ends. **The one-time offer is deleted, not deprecated**, and the countdown ban is absolute (`../source-of-truth/ONBOARDING_FLOW.md` §14 and decision 35): at $29 for 600 credits it netted $24.65 against $44.28 of cost at the worst story mix. Closing must not erase the collected persona. Email/OTP is an integration handoff after the paywall action. Supabase should persist the final `onDone` payload. RevenueCat should provide localized product titles, prices, currencies, eligibility, restore, and purchase results.

## Accessibility, Motion, and Responsiveness

### Accessibility

- Preserve accessible names on the wordmark and all icon-only controls.
- Pressable rows must expose the whole visual row as the hit target.
- Keep body copy at or above 12 points and critical actions at or above 16 points.
- Never rely on orange alone for selected state; combine fill, border, radio, and checkmark.
- Keep text contrast against warm backgrounds and pale peach selected states.
- OTP must retain a real `TextInput`; the six boxes are presentation.
- Do not place important text inside raster images.

### Reduced Motion

The intro, marquee, loading, paywall entry, and success pulse paths read the operating-system reduced-motion preference. Reduced motion renders the completed prompt and final `warning` edit, publish stats at 246, static representative cover rows, and final paywall/offer states without looping or entry motion.

When motion is touched:

- Read the platform preference and provide a reduced path.
- Replace typing with the completed prompt, show the final rewritten sentence, show publish stats at 246, and stop marquees on representative covers.
- Keep state transitions and meaning intact; remove looping scale, float, spin, and marquee motion.
- Animate transform and opacity where possible. Avoid layout-driven animation.

### Responsive Behavior

- Validate first at exactly 390 x 844.
- The carousel width follows `useWindowDimensions` up to `controls.introMaxWidth` (430). Wider than that -- a desktop browser -- the intro is a centred phone-width column and the hero gradient band carries on behind it. Hero height, stage height, and message-sheet height remain fixed.
- A window shorter than hero + sheet (478 + 322) scrolls. It used to clip, which put Get started on top of the description on a laptop window.
- On narrower phones, preserve 24 to 30 point outer gutters where possible and reduce only content width, not type scale.
- On taller phones, extra space belongs outside the fixed intro frame. Do not stretch gaps inside it.
- Text must wrap without overlapping controls. Edit copy before reducing type below the approved scale.
- Mobile web is a review surface, not permission to diverge from native layout.

### Mobile-Web Preview and Visual QA

After onboarding or paywall changes:

1. Run `pnpm typecheck`.
2. Run `pnpm exec expo-doctor`.
3. Confirm the Expo web bundle compiles.
4. Start the preview with `scripts/preview.sh` and open the URL it prints (8090 unless `KATHA_PREVIEW_PORT` overrides it; only 8090 is in `ALLOWED_ORIGINS`, so any other port fails every edge call). It serves `main` from its own worktree -- so run this pass **after** the change has merged. Do not start a server on 8090 from your lane worktree to shortcut it; that silently replaces the reviewed state with your branch (see *The preview shows main, and only main* in AGENTS.md). For a pre-merge look, use port 8091 and expect edge calls to fail CORS.
5. Open that URL in the in-app browser, and confirm the commit the script printed is the one you expect.
6. Set the viewport to 390 x 844.
7. Watch all 5.2 seconds of Character, all 9.2 seconds of Story, and all 8.8 seconds of Read and listen. Each begins 350 ms after its slide becomes active.
8. Confirm the appearance field finishes typing and the portrait lands whole; Praz joins the cast and the second opening is chosen; the first shelf heart ticks 428 to 429, the cover morphs without cutting either character's head, and **Listen** becomes **Listening** with the meter running.
9. Confirm all three intro slides use identical hero, stage, sheet, headline, description, and action slots.
10. Complete purpose, name, genre, all three persona branch variants, building, notification actions, annual paywall trial, weekly no-trial option, close confirmation, email, OTP, success, and Home handoff. There is **no** one-time offer step to verify; if you find one on screen, that is the bug.
11. Check keyboard-open states, narrow width, and at least one native phone build before release.
12. Leave the 390 x 844 preview visible for product review.

## Source-of-Truth Map

| File or directory | Authority |
| --- | --- |
| `DESIGN.md` | Canonical visual, motion, and onboarding product contract |
| `src/components/BrandWordmark.tsx` | Only approved Katha AI wordmark implementation |
| `src/theme/theme.ts` | App-wide baseline colors, spacing, radii, and font-family names |
| `src/screens/KathaOnboarding.jsx` | Intro geometry, assets, copy, and animation timelines |
| `src/screens/KathaOnboardingFlowV2.tsx` | Question sequence and branches only -- purpose, name, genres, refine, mood |
| `src/screens/CharacterOnboarding.tsx` | W3-W6, email/OTP, the single paywall and the welcome hand-off (#92, 2026-09-11) |
| `src/screens/KathaOnboardingComplete.jsx` | Production intro-to-flow composition |
| `App.tsx` | Font loading and app-level onboarding entry |
| `assets/fonts` | Approved bundled type assets |
| `assets/covers` | Approved intro and story cover imagery |
| `assets/avatars` | Approved social-proof people imagery |
| `BUILD_LOG.md` | Approved shipped-state history, verification record, and remaining integration work |
| `CLAUDE.md` | Engineering workflow and repository boundaries |

## Drift Prevention

- Change shared identity once in `BrandWordmark`, never per screen.
- Every switch is `src/components/Toggle.tsx`. A new `Switch` import, or a
  second hand-rolled track-and-thumb, is drift — see the Toggle recipe above.
- Promote repeated visual values into `src/theme/theme.ts` when more than one product area uses them.
- Keep local onboarding constants only when they are tied to the exact 390 x 844 composition or animation story.
- Update this file in the same change as any approved token, geometry, animation, screen-order, or branch change.
- Compare implementation values against this document during review. If they disagree, resolve the disagreement explicitly rather than adding another source of truth.
- Never substitute placeholder covers, synthetic avatars, fallback fonts, or improvised logos when bundled assets exist.
- Preserve explicit callbacks for Supabase, RevenueCat, purchases, restore, OTP, notifications, and Home handoff.
