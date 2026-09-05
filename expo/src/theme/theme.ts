import type { Genre } from "@/types/domain";

/**
 * Neutral ramp and semantic colour.
 *
 * THE GROUND / SURFACE CONTRAST RULE. `surface` is pure white and is the card.
 * `bg` is the ground the card sits on. The card is read as raised by the gap
 * between the two plus `shadows.card`/`shadows.raised`, NOT by a border. That
 * only works if the gap is large enough to survive a dim screen, so the ramp is
 * tuned to a measured target: relative luminance L(surface) - L(bg) >= 0.10
 * (a WCAG contrast ratio of about 1.12). The old `bg` of #FAF7F2 gave 0.067
 * (1.069), which is under the perceptual floor for a large flat field: the card
 * and the page read as the same colour, so every card needed a border to exist.
 * `theme.test.ts` computes the delta from the hex and fails below 0.10.
 *
 * WHY THE RAMP IS DESATURATED RATHER THAN BLUED. The ground had to cool without
 * going neutral grey, because `colors.sepia` (#F4E8D0, hsl 40deg 62% 89%) is a
 * strongly warm full-bleed reader ground and `genreGradients` were picked
 * against warm neutrals. Warmth here is carried by SATURATION, not by hue, so
 * the whole ramp keeps its amber hue angle (40-48deg, the same family as
 * `sepia`) and drops saturation by roughly two thirds (44% -> 14% at `bg`).
 * That reads cooler and lighter without a blue cast. A genuinely cool ground
 * (B > R) was rejected: it turns `sepia` into a yellow stain on the screen the
 * reader moves to. Every step keeps R > G > B, the same warm-neutral ordering
 * `strong` uses.
 *
 * ORDERING. surface > bg > surface2 > track > canvas > border > borderStrong,
 * by luminance, and `theme.test.ts` enforces it. The steps below `bg` are the
 * same steps as before, shifted down with it, so `surface2` stays a recessed
 * inset fill and does not flip to reading as raised.
 */
export const colors = {
  /** The ground. Cards and fields lift off this; see the contrast rule above. */
  bg: "#F3F2EF",
  canvas: "#EBEAE7",
  /** Pure white. Cards and text fields. Never tinted, never given a border. */
  surface: "#FFFFFF",
  /** Recessed inset fill on top of `surface`: segmented tracks, avatars, option panels. */
  surface2: "#EEEDEA",
  border: "#E7E6E2",
  borderStrong: "#D7D5D0",
  ink: "#0F0E0C",
  muted: "#6B6560",
  /**
   * Icon ink. Sits between `muted` (#6B6560) and `ink` (#0F0E0C): an icon is a
   * glyph with far less stroke area than a word, so at `muted` it reads as
   * disabled, and at full `ink` it out-shouts the title beside it. #3A3632 is
   * the midpoint of the two on the same warm neutral ramp (R > G > B by the
   * same 4-step delta the rest of the greys use), roughly 10.7:1 on `bg`.
   * Use for icons and icon-button glyphs. Never for body text.
   */
  strong: "#3A3632",
  /**
   * Divider hairline. Deliberately lighter than `border` (#E7E6E2) because a
   * divider must read as a seam in one surface, not as the edge of a box. At
   * `border` weight a full-bleed 1px line looks like an unclosed frame; #EDECE9
   * carries about a third of that separation, enough to part two rows on
   * `surface`/`surface2` and no more. Use for 1px dividers only, and never
   * substitute `border` for it.
   */
  track: "#EDECE9",
  tertiary: "#9C9691",
  accent: "#FF6B1A",
  accentPressed: "#E85610",
  accentSoft: "#FFEFE2",
  heart: "#E85D5D",
  info: "#4A78C2",
  premium: "#C44536",
  success: "#12B5A5",
  sepia: "#F4E8D0",
  sepiaText: "#4A3B2A",
  sepiaHeading: "#33291f",
  sepiaBody: "#4a3f35",
  sepiaMuted: "#8b7d6b",
  sepiaSecondary: "#6a5c4c",
  sepiaAccent: "#A64C1C",
  sepiaButton: "#ec6f2c",
  sepiaPlaceholder: "#e7dcc6",
  sepiaToggleTrack: "#e7ddca"
} as const;

/**
 * Spacing scale.
 *
 * `xs`-`huge` are raw sizes on the 4pt grid: they say how big a gap is, not what
 * it means. `related` and `betweenGroups` are the semantic pair, and they exist
 * because grouping was being lost to a uniform gap.
 *
 * THEY ARE ONE RHYTHM AND ARE ALWAYS USED TOGETHER. `related` (8) is the gap
 * INSIDE a group. `betweenGroups` (24) is the gap BETWEEN one group and the
 * next. Neither number means anything on its own: hierarchy is the CONTRAST
 * between them, and 24 against 8 is a ratio of 3:1, which is unmistakable at a
 * glance. Reaching for a raw size on either side of that pair is what produced
 * screens with no spacing discipline, where an eyebrow sat as far from the
 * field it heads as it did from the previous section and the reader could not
 * tell which one it belonged to.
 *
 * Rule for `related` (8pt, the value of `sm`):
 * Use `spacing.related` between two elements that are ONE thing - a label and the
 * control it labels, a section heading and the content it heads, a helper line and
 * the field it explains. Use `spacing.betweenGroups` (24) between one such group and
 * the next. The contrast is what makes a group read as a group: if the gap inside a
 * group equals the gap between groups, the reader sees N separate items instead of
 * one unit, and the heading floats away from what it heads.
 *
 * A SCREEN TITLE AND THE SENTENCE UNDER IT ARE ONE GROUP. This is the case that
 * keeps getting missed, because the title and its sub are siblings in the same
 * container and inherit whatever uniform gap that container sets. They are not
 * two items: the sub is the second line of the title. Put `spacing.related`
 * between them, then `spacing.betweenGroups` BELOW the pair, before content
 * begins. If the title and the sub are further apart than the sub
 * is from the first card, the reader attaches the sentence to the card instead
 * of to the heading, and the screen loses its opening statement.
 *
 * Known consumers: the screen title / sub pair at the top of every writer
 * onboarding screen, the section label / helper line / input triples in that
 * flow, and the feed - a section heading sitting above its list of stories
 * should hug that list, with the larger gap saved for the next section.
 *
 * Why 8 and not 4 or 6: 4 collides (helper text and an input field visually touch,
 * and it is indistinguishable from line-height slack), and 6 is off the 4pt grid.
 * 8 is a third of the 24pt section rhythm and a clear step down from the 12pt
 * inter-element gap - visibly tighter, still a gap. `related` must always stay
 * strictly below `md`; theme.test.ts enforces that.
 *
 * Rule for `betweenGroups` (24pt, the value of `xxl`):
 * Use it for the gap between one `related` group and the next, and for the gap
 * below a screen title and its sub before content begins. It is the other half
 * of `related`: if you used `related` inside a group, this is what goes around
 * it. A `sectionHeader` must be visibly closer to the content under it than to
 * the section above it, or it stops reading as a head at all.
 *
 * Why 24 and not 12, 16 or 20: the invariant is that the between-groups gap is
 * clearly larger than `related`, not marginally larger. At 12 the ratio is 1.5
 * and at 16 it is 2, and neither survives a screen where the group's own
 * internal leading already eats several points; the eyebrow floats and the
 * screen reads as one flat list. 24 gives 3:1, sits on the 4pt grid, and is
 * already the number DESIGN_SYSTEM.md section 8.1 names for the gap below the
 * title/sub pair, so one token covers both cases instead of two near-identical
 * numbers nobody can choose between. `betweenGroups` must always stay at least
 * twice `related`; theme.test.ts enforces that.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  /** Semantic: gap inside a group of related elements (label -> control, heading -> content). See the doc comment above. */
  related: 8,
  /** Semantic: gap between one such group and the next, and below a title/sub pair. The other half of `related`. */
  betweenGroups: 24
} as const;

/**
 * Corner radius.
 *
 * The onboarding spec asks for "12-18px depending on depth". That range maps
 * onto the existing scale, and no near-duplicate values are added for it:
 *
 * - the 12 end (flat, in-flow surfaces: rows, inline cards, the icon-button
 *   plate before it goes circular) is `md` (14)
 * - the 18 end (surfaces that lift off the page: option cards, panels, sheets,
 *   anything carrying `shadows.raised` or `shadows.overlay`) is `lg` (18)
 *
 * The rule an engineer can follow: deeper shadow, larger radius. `sm` (8) stays
 * for chips-in-a-field and other sub-component detail; `xl` (24) for panels;
 * `pill` for the full-width primary CTA and for chips.
 *
 * THE CARD-AND-FIELD RULE (onboarding). The white card treatment wants a
 * noticeably rounder corner than a flat row does, and the answer is a rule
 * rather than a sixth token: a white `colors.surface` card or a text field
 * sitting on `colors.bg` MOVES UP ONE STEP, from `md` to `lg`. `md` stays for
 * detail inside a card, `sm` for sub-component detail. Nothing above `lg` moves,
 * so panels and sheets stay at `xl` and option cards, already at `lg`, are
 * unchanged; ONBOARDING_FLOW.md section 1 still holds exactly as written. A
 * value between `lg` and `xl` was considered and rejected: it would sit 3pt from
 * one neighbour and 3pt from the other, which nobody can pick correctly twice.
 */
export const radius = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999
} as const;

/**
 * Font families, by the name the file is registered under in `App.tsx`.
 *
 * IMPORTANT - Inter Tight ships here as two STATIC instances (400 and 600), not
 * a variable font. React Native cannot synthesise a weight from a static file,
 * so `fontWeight: "600"` on `fonts.tight` does nothing on iOS and fakes an ugly
 * smear on some Android builds. A token that wants semibold MUST name
 * `fonts.tightSemiBold` as its `fontFamily`. This is the single most common way
 * this system breaks; see `onboardingType` in ./typography.ts.
 */
export const fonts = {
  display: "BricolageGrotesque",
  ui: "HankenGrotesk",
  brand: "Baloo2",
  /**
   * The heavy brand face, as its own family.
   *
   * `fontWeight` cannot reach it: `Baloo2.ttf` is a variable font and React
   * Native has no weight-axis control, so asking the base family for 800
   * renders at 400. This names the static instance directly. Its real maximum
   * is 800 - the axis stops there - so a request for 900 was always asking for
   * a weight the font does not contain.
   */
  brandHeavy: "Baloo2-ExtraBold",
  reader: "Literata",
  readerItalic: "LiterataItalic",
  /** Inter Tight 400. Onboarding only. */
  tight: "InterTight",
  /** Inter Tight 600. Onboarding only. Name this family; do not use fontWeight. */
  tightSemiBold: "InterTightSemiBold"
} as const;

/**
 * Control geometry for the circular icon button (back control, close, and the
 * other single-glyph affordances in onboarding). NOT the primary CTA, which
 * stays a full-width pill at `spacing.huge + spacing.sm` with `radius.lg`.
 *
 * The spec's "38-46px circular" is a range because the same control appears at
 * three densities: `iconButtonSm` in a dense row, `iconButton` as the default
 * (use this unless you have a reason), `iconButtonLg` for a lone control on an
 * otherwise empty header. `borderRadius` is always half the size, so the plate
 * is a true circle rather than a squircle.
 *
 * Pair with `shadows.iconButton`. See DESIGN_SYSTEM.md section 6 for the recipe.
 */
export const controls = {
  iconButtonSm: 38,
  iconButton: 42,
  iconButtonLg: 46,
  /** Inset highlight offset used by shadows.iconButton, kept here so a custom size can reuse it. */
  iconButtonHighlightInset: 6
} as const;

export const genreLabels: Record<Genre, string> = {
  romance: "Romance",
  romantasy: "Romantasy",
  darkRomance: "Dark Romance",
  fantasy: "Fantasy",
  scifi: "Sci-Fi",
  thriller: "Thriller",
  mystery: "Mystery",
  horror: "Horror",
  contemporary: "Contemporary",
  historical: "Historical",
  adventure: "Adventure",
  comedy: "Comedy",
  poetry: "Poetry",
};

export const genreGradients: Record<Genre, readonly [string, string, string]> = {
  romance: ["#C45B7B", "#8B2D4B", "#5A1D33"],
  romantasy: ["#8E5BAA", "#5B2D7B", "#3A1D55"],
  darkRomance: ["#8B1A1A", "#5A0D0D", "#2A0505"],
  fantasy: ["#5B8A5B", "#3A6B3A", "#1A4A2A"],
  scifi: ["#4A3A8E", "#2D1A5A", "#1A0D3A"],
  thriller: ["#3A3A3A", "#1A1A1A", "#0D0D0D"],
  mystery: ["#2C3E50", "#1A2A36", "#0D1620"],
  horror: ["#5A1D1D", "#3A0D0D", "#1A0505"],
  contemporary: ["#4A9A9A", "#2D6B6B", "#1A4A4A"],
  historical: ["#8B7355", "#6B5235", "#3A2D1A"],
  adventure: ["#E87B4A", "#C04A2D", "#8B2A1A"],
  comedy: ["#F0C04A", "#D4A02D", "#8B7020"],
  poetry: ["#8E7A9E", "#6B5B8E", "#4A3A6B"],
};
