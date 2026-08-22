# Katha Design System

<!-- markdownlint-disable MD013 -->

This file is the definitive design contract for the Katha Expo app. It describes the implementation in `src/components/BrandWordmark.tsx`, `src/screens/KathaOnboarding.jsx`, `src/screens/KathaOnboardingFlowV2.jsx`, and `src/theme/theme.ts` as of 2026-08-22.

Use this document before changing onboarding, paywall, or shared visual components. The reference viewport is **390 x 844 points**. Local screenshots and the historical handoff are supporting evidence, not permission to fork the system.

## Non-Negotiable Rules

1. Use `BrandWordmark` everywhere the Katha AI wordmark appears. Do not rebuild it from ordinary text or use the square app icon as a wordmark.
2. Use bundled fonts and wait for `Font.loadAsync` before rendering the app.
3. Use `BricolageGrotesque` for display text, `HankenGrotesk` for product UI, `Baloo2` only for the brand, and `Literata` for long-form reading.
4. Set visible text to `letterSpacing: 0`. Do not introduce negative letter spacing.
5. Do not introduce visible em dashes. Rewrite the sentence or use punctuation that reads naturally.
6. Preserve the fixed intro geometry and fixed message slots across all three slides.
7. Do not add a replay screen after onboarding. Success hands off to Home.
8. Prices shown in the current prototype are placeholders. Production pricing and currency must come from Adapty/store products.

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
| Intro hero | 28 | Horizontally centered, top 54 |
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
| 9 | Intro notification icon tile |
| 12 | Intro cover cards |
| 14 | Inputs, OTP boxes, reaction chips |
| 15 | Icon badges |
| 16 | Primary buttons, intro notification, success button |
| 17 | Paywall CTA |
| 18 | Option rows, plan cards, review cards, one-time-offer CTA |
| 20 | Publish card |
| 22 | Create card, genre chips, edit chips, one-time-offer card |
| 24 | Large shared card radius |
| 28 | Apple-style notification education alert |
| 999 | Pills only |

Use the smallest established radius that matches the component category. Do not round every panel into a pill.

## Typography

All font files are bundled in `assets/fonts` and loaded in `App.tsx` under these exact family names.

| Family | Role | Bundled files |
| --- | --- | --- |
| `Baloo2` | Brand wordmark only | `Baloo2.ttf` |
| `BricolageGrotesque` | Display headings, important numbers | `BricolageGrotesque.ttf` |
| `HankenGrotesk` | UI labels, body copy, metadata, inputs | `HankenGrotesk.ttf` |
| `Literata` | Long-form story reading | `Literata.ttf` |
| `LiterataItalic` | Long-form italic reading | `Literata-Italic.ttf` |

### Product Type Scale

| Style | Family | Weight | Size / line height | Use |
| --- | --- | ---: | --- | --- |
| Flow H1 | Bricolage | 800 | 31 / 35 | Primary name screen heading |
| Flow H1 medium | Bricolage | 800 | 28 / 32 | Email, OTP, compact feature headings |
| Flow H1 compact | Bricolage | 800 | 27 / 31 | Purpose, genre, persona questions |
| Intro headline | Bricolage | 700 | 27 / 31.3 | Fixed two-line intro message slot |
| Paywall title | Bricolage | 800 | 25 / 29 | Personalized paywall headline |
| Notification title | Bricolage | 800 | 22 / 26 | Alert title |
| Standard body | Hanken | 500 | 15 / 23 | Flow descriptions |
| Compact body | Hanken | 500 | 14.5 / 22 | Compact descriptions |
| Option title | Hanken | 700 | 16 / natural | Selection labels |
| Option detail | Hanken | 400 | 13 / natural | Selection descriptions |
| Primary CTA | Hanken | 700 | 17 / natural | Main button labels |
| Input | Hanken | 600 | 17 / natural | Email input |
| Name input | Bricolage | 700 | 24 / natural | First-name entry |
| Review copy | Hanken | 500 | 12.5 / 17 | Social proof cards |
| Metadata | Hanken | 400 to 700 | 11 to 13 / 17 to 19 | Hints, labels, prices |
| Story text in intro | Hanken | 400 | 13.2 / 19 | Generated story lines |

The design rule is zero letter spacing for visible text. The only currently tolerated positive tracking is tiny uppercase metadata such as `NEW STORY`, cover-author labels, rating stars, and paywall badges. Do not add tracking to headings, body copy, buttons, or the wordmark.

## Borders and Shadows

### Borders

- Inputs and option rows: 1.5 points; selected border `#FF6B1A`, unselected `#E7DCC9`.
- OTP cells and plan cards: 2 points.
- One-time-offer card and CTA: 2.5 points in ink.
- Review cards: 1 point `#F3EADB`.
- Alert dividers: `StyleSheet.hairlineWidth`, `#D9D9DD`.
- Intro internal separators: 1 point `#F0E7D6`.

### Shadows

Use shadows to establish a single center piece or actionable surface, not on every section.

| Surface | iOS shadow | Android | Web |
| --- | --- | --- | --- |
| Intro warm cards | `#7A2E0E`, radius 15, offset 0/12, opacity supplied by component | elevation 12 | No explicit fallback in intro helper |
| Primary flow CTA | orange, opacity 0.5, radius 15, offset 0/10 | elevation 6 | Platform default |
| Notification alert | `#3D2B1E`, opacity 0.18, radius 24, offset 0/12 | elevation 10 | `0 12px 30px rgba(61,43,30,0.16)` |
| Review card | `#7A2E0E`, opacity 0.15, radius 12, offset 0/6 | elevation 3 | Platform default |
| Paywall CTA | orange, opacity 0.7, radius 17, offset 0/12 | elevation 8 | Platform default |

## Component Recipes

### Primary Button

- Full available width inside the page gutter.
- Standard flow: height 58, radius 16, orange fill, Hanken 700 at 17, white label.
- Intro: height 56, radius 16.
- Paywall: height 60, radius 17, vertical orange gradient.
- Disabled: `#EDE3D4` fill and `#B7AB99` label; remain non-pressable.
- Keep command copy direct. Current examples include `Continue`, `Build my profile`, and personalized paywall actions.

### Option Row

- Radius 18, border 1.5, padding 18, internal gap 14.
- Leading icon at 24, label at 16/700, detail at 13/400.
- Trailing radio: 22 x 22 with a 2 point border.
- Selected: orange border, pale peach background, orange filled radio with white check.
- Entire row is the hit target.

### Genre Chip

- Horizontal wrap with 10 point gaps.
- Padding 11 vertical and 16 horizontal, radius 22, border 1.5.
- Selected: peach surface and orange border/text.
- Keep discovery-first order: Thriller, Fantasy, Bedtime Stories, Mystery, Adventure, Sci-Fi, then the wider catalog. Romance sits in the middle, not first.

### Inputs

- Name input uses a 2 point bottom rule, no enclosing card, Bricolage 24.
- Email and Other inputs use a white surface, radius 14, border 1.5.
- Email padding is 16 with Hanken 600 at 17.
- OTP is six equal cells, height 60, radius 14, 2 point border, with a single invisible numeric input over the row.
- Focus is orange. Placeholders use `#B49A82`.

### Progress

- Five visible personalization steps only: purpose, name, genres, first persona question, second persona question.
- Top bar gutter 24, element gap 14.
- Back button 34 x 34, radius 17.
- Track height 6, rounded, `#EAE0D0`; fill uses `#FF8A3D` to `#FF6B1A`.
- Label is `step/5`, Hanken 700 at 12.

### Cards, Reviews, and Chips

- Avoid cards inside cards.
- Use cards for individual story, price, review, or alert objects only.
- Review card: 286 x 106, radius 18, padding 13, avatar 30, one-point border, subtle warm shadow. At 390 points the next card appears only as a deliberate preview.
- Intro reaction chip: radius 14, 7 vertical and 11 to 12 horizontal padding.
- Intro rewrite chip: radius 22, 5 vertical and 10 horizontal padding.
- Paywall plan card: radius 18, border 2, 16 vertical and 18 horizontal padding.

## Intro Frame: 390 x 844

The intro must not reflow between Create, Publish, and Read.

| Region | Geometry | Rules |
| --- | --- | --- |
| Root | 390 x 844 reference | Warm `#FBF6EC` canvas |
| Hero | x 0, y 0, w 390, h 522 | Clipped; `#FEFBF3` to `#F3EAD8` gradient |
| Wordmark | top 54, centered | `BrandWordmark size={28}` |
| Sign in | top 57, right 24 | 13.5/700, orange, always present |
| Animation stage | x 0, y 104, w 390, h 360 | Fixed and clipped on every slide |
| Message sheet | x 0, y 522, w 390, h 322 | `#FAF7F2`, 28 horizontal, 24 top, 20 bottom |

Message-sheet slots are fixed:

- Dots: height 6, gap 6, bottom gap 16. Active dot is 22 x 6; inactive dots are 6 x 6.
- Headline: fixed height 64, Bricolage 27/31.3.
- Description: fixed height 54, margin top 8, Hanken 15/22.5.
- Action slot: fixed height 100, bottom aligned. It remains reserved on slides one and two.
- Slide three CTA: height 56. Account sign-in follows with a 14 point gap.

Animation-object geometry:

- Create card: 306 x 346, radius 22, padding 16.
- Publish card: width 290, radius 20, padding 18.
- Continuation notification: width 270, radius 16, anchored 18 points above the stage bottom.
- Read covers: 92 x 108, radius 12, three rows with 8 point gaps; title copy is capped at two lines.
- Covers: 86 x 104, radius 12, gap 12. Three rows fit the same 360 point stage.
- Carousel transition: 600 ms with cubic bezier `(0.45, 0, 0.2, 1)`.

Do not size the hero or message sheet from child content. Long copy must be edited to fit the assigned slot.

## Intro Animation Storyboard

The first two slides use a normalized progress value driven by `requestAnimationFrame`. Create lasts 10.5 seconds. Publish lasts 9.6 seconds. Read then holds while the cover rows continue looping.

### Slide 1: Create and Rewrite, 10.5 Seconds

| Time | Event |
| --- | --- |
| 0 to 420 ms | Create card fades in |
| 525 to 2,310 ms | Prompt appears character by character using a string slice; cursor blinks until complete |
| 2,520 to 3,150 ms | Generate button scales and fades in |
| 3,255 to 3,885 ms | Generate button compresses and releases to communicate a press |
| 3,885 to 4,515 ms | `Katha is writing...` fades in |
| 4,620 to 5,670 ms | First generated line rises 6 points and fades in |
| 5,250 to 6,300 ms | Second line rises and fades in |
| 5,880 to 6,930 ms | Final line fades in; writing indicator fades out from 5,880 to 6,510 ms |
| 6,930 to 7,560 ms | The existing word `dream.` receives a pale orange highlight |
| 7,718 to 8,085 ms | `dream.` moves up and fades out while `warning.` moves into the same fixed 54 x 20 slot and fades in |
| 8,190 to 8,925 ms | `You rewrote this line` chip rises 6 points and fades in |
| 8,820 to 9,555 ms | Word highlight clears; final rewritten sentence remains stable |

Typing must use `prompt.slice(0, characterCount)`. Never reveal the prompt through a changing-width mask because that changes line wrapping. The rewrite must occur in the original word slot. Do not place the replacement in a detached overlay at screen center.

### Slide 2: Publish and Community, 9.6 Seconds

| Time | Event |
| --- | --- |
| 1,536 to 2,112 ms | Publish button compresses and releases |
| 2,112 to 2,880 ms | Publish control fades/scales out and published state takes over |
| 2,496 to 3,264 ms | Like and comment statistics fade in |
| 2,880 to 5,568 ms | Like counter advances smoothly from 128 to **246**, then holds |
| 2,880 to 3,840 ms | Reader label appears |
| 3,264 to 6,144 ms | Three real avatar assets appear in sequence, each with scale and opacity |
| 3,840 to 6,816 ms | Three reaction chips appear sequentially, each over 864 ms |
| 6,912 to 7,872 ms | Continuation notification rises 22 points into its fixed bottom position |

Keep reactions readable and inside the 360 point stage. The continuation notification must not be clipped.

### Slide 3: Cover Marquee

- Three rows move continuously with linear easing.
- Durations: 32 seconds, 26 seconds, and 36 seconds.
- Direction alternates forward, reverse, forward.
- Each row duplicates a ten-cover strip for a seamless loop.
- Use the bundled art in `assets/covers`; do not synthesize gradients as replacement covers.
- Apply 12 percent gradient fades at both horizontal edges.
- Motion speed must remain calm enough to inspect cover art.

## Onboarding Product Sequence

The implemented order is:

1. Animated Create, Publish, and Read introduction.
2. Purpose: Reading, Writing, or A bit of both.
3. First name.
4. At least two genres.
5. Adaptive persona question one.
6. Adaptive persona question two. CTA: `Build my profile`.
7. Profile-building transition.
8. Notification education.
9. Personalized paywall.
10. If the paywall is closed, one-time offer.
11. Email capture after the user acts on the paywall or one-time-offer path.
12. Six-digit OTP verification.
13. Personalized success screen.
14. Home handoff.

Email comes after the offer action so the user first sees Katha's value, invests in a personalized profile, and understands the relevant paid outcome before account friction. Both acceptance and decline paths still lead to profile saving. Do not move email ahead of purpose or personalization without an explicit product decision and a measured experiment.

### Persona Branches

| Purpose | Question 1 | Question 2 | Product consequence |
| --- | --- | --- | --- |
| Read | Reading, listening, or a mix | Before sleep, commutes/breaks, weekend binges, or on-demand escape | Tunes narration, recommendation framing, and routine messaging |
| Write | Novel, short stories, fan fiction, or poetry | Drafting, voice rewrites, chapter planning, or publishing/finding readers | Tunes writing tools, build-state copy, and paywall benefits |
| Both | Find a read, start creating, balance both, or surprise me | Read/remix, write/publish, listen/unwind, or explore/save | Connects discovery and creation without treating the user as read-first |

Purpose is always first because it determines all later copy. Name personalizes subsequent questions. Genres provide concrete taste before the adaptive questions.

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

Read-first, write-first, and both users must not receive the same generic value proposition. The paywall must not use a trial toggle. Annual is selected by default and includes the 3-day free trial. Weekly is available through the additional plan option and has no free trial. The current reference pricing is annual `$49.99/year`, weekly `$4.99/week`, and one-time-offer annual `$17.99/year`; production values must come from Adapty/store products before release.

Closing the paywall shows a confirmation sheet before the one-time offer. The one-time offer may follow that close flow, but it must not erase the collected persona. Email/OTP is an integration handoff after the paywall or offer action. Supabase should persist the final `onDone` payload. Adapty should provide localized product titles, prices, currencies, eligibility, restore, and purchase results.

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

The current intro and offer animations do not yet branch on the operating-system reduced-motion preference. This is a known implementation gap, not approval to ignore accessibility.

When motion is touched:

- Read the platform preference and provide a reduced path.
- Replace typing with the completed prompt, show the final rewritten sentence, show publish stats at 246, and stop marquees on representative covers.
- Keep state transitions and meaning intact; remove looping scale, float, spin, and marquee motion.
- Animate transform and opacity where possible. Avoid layout-driven animation.

### Responsive Behavior

- Validate first at exactly 390 x 844.
- The carousel width follows `useWindowDimensions`, but hero height, stage height, and message-sheet height remain fixed.
- On narrower phones, preserve 24 to 30 point outer gutters where possible and reduce only content width, not type scale.
- On taller phones, extra space belongs outside the fixed intro frame. Do not stretch gaps inside it.
- Text must wrap without overlapping controls. Edit copy before reducing type below the approved scale.
- Mobile web is a review surface, not permission to diverge from native layout.

### Mobile-Web Preview and Visual QA

After onboarding or paywall changes:

1. Run `pnpm typecheck`.
2. Run `pnpm exec expo-doctor`.
3. Confirm the Expo web bundle compiles.
4. Start or reuse the Expo web server on port 8090.
5. Open `http://localhost:8090/` automatically in the in-app browser.
6. Set the viewport to 390 x 844.
7. Watch all 10.5 seconds of Create and all 9.6 seconds of Publish.
8. Confirm prompt wrapping remains fixed, the button visibly presses, the rewritten word changes in place, likes reach 246, avatars use real assets, and the notification is not clipped.
9. Confirm all three intro slides use identical hero, stage, sheet, headline, description, and action slots.
10. Complete purpose, name, genre, all three persona branch variants, building, notification actions, annual paywall trial, weekly no-trial option, close confirmation, one-time offer, email, OTP, success, and Home handoff.
11. Check keyboard-open states, narrow width, and at least one native phone build before release.
12. Leave the 390 x 844 preview visible for product review.

## Source-of-Truth Map

| File or directory | Authority |
| --- | --- |
| `DESIGN.md` | Canonical visual, motion, and onboarding product contract |
| `src/components/BrandWordmark.tsx` | Only approved Katha AI wordmark implementation |
| `src/theme/theme.ts` | App-wide baseline colors, spacing, radii, and font-family names |
| `src/screens/KathaOnboarding.jsx` | Intro geometry, assets, copy, and animation timelines |
| `src/screens/KathaOnboardingFlowV2.jsx` | Question sequence, branches, notification education, paywall, offer, and success UI |
| `src/screens/KathaOnboardingComplete.jsx` | Production intro-to-flow composition |
| `App.tsx` | Font loading and app-level onboarding entry |
| `assets/fonts` | Approved bundled type assets |
| `assets/covers` | Approved intro and story cover imagery |
| `assets/avatars` | Approved social-proof people imagery |
| `BUILD_LOG.md` | Approved shipped-state history, verification record, and remaining integration work |
| `CLAUDE.md` | Engineering workflow and repository boundaries |

## Drift Prevention

- Change shared identity once in `BrandWordmark`, never per screen.
- Promote repeated visual values into `src/theme/theme.ts` when more than one product area uses them.
- Keep local onboarding constants only when they are tied to the exact 390 x 844 composition or animation story.
- Update this file in the same change as any approved token, geometry, animation, screen-order, or branch change.
- Compare implementation values against this document during review. If they disagree, resolve the disagreement explicitly rather than adding another source of truth.
- Never substitute placeholder covers, synthetic avatars, fallback fonts, or improvised logos when bundled assets exist.
- Preserve explicit callbacks for Supabase, Adapty, purchases, restore, OTP, notifications, and Home handoff.
