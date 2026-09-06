import { TextStyle } from 'react-native';
import { fonts } from './theme';

export const type = {
  largeTitle: {
    fontSize: 34,
    fontFamily: fonts.display,
    fontWeight: '700' as const,
  },
  title: {
    fontSize: 24,
    fontFamily: fonts.display,
    fontWeight: '600' as const,
  },
  headline: {
    fontSize: 18,
    fontFamily: fonts.ui,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 16,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
  },
  subhead: {
    fontSize: 14,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
  },
  reader: {
    fontSize: 18,
    fontFamily: fonts.reader,
    fontWeight: '400' as const,
    lineHeight: 30,
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Onboarding type scale.
 *
 * SCOPE: the onboarding flow only. Every other surface keeps the `type` export
 * above until this is rolled out deliberately.
 *
 * ## The ramp: 28 / 16 / 14.5 / 12, plus one eyebrow that is not a ramp step
 *
 * ONE BIG HEADING PER SCREEN, AND ONLY ONE. The previous pass promoted the
 * section labels on the details screen to 21pt on the theory that a label
 * heading a group must outrank the group. On the screen that produced five
 * near-title headings stacked down one scroll, and the screen lost its
 * hierarchy rather than gaining it: when everything is a heading, the actual
 * heading is not one. `title` is the only large size in the flow. A group
 * label is an EYEBROW, which is a treatment, not a level.
 *
 * WHY THE EYEBROW IS 12 AGAIN. Hierarchy is carried by four signals, not one:
 * size, case, weight and colour. The eyebrow is uppercase, semibold, tracked
 * +1 (0.083em) and set in `colors.tertiary`, against helper copy that is
 * sentence case, regular, barely tracked and `colors.muted`. It reads as a
 * label at a glance without being large, which is how a grouped-list section
 * header works on iOS and how the approved Katha screens were drawn. Being
 * smaller than the copy beneath it is not the defect the previous comment here
 * claimed: an eyebrow is a signpost, and a signpost is not the biggest thing
 * on the road.
 *
 * WHY `helper` EXISTS, AND WHY IT IS 14.5. Secondary copy - the line under a
 * title, the line under an eyebrow - was set at `body` (16), the same size as
 * the text a user types into the field below it. That put the supporting
 * sentence at equal weight with the content, and at 390pt it made supporting
 * copy the widest, loudest block on the screen. Secondary text must be smaller
 * than the text in the field it supports. 14.5/18 at +0.3 is the size the
 * design spec names for supporting copy, and 16 - 14.5 is a step the eye reads
 * as deliberate because the two are also different colours.
 *
 * WHY THE TITLE IS 28. Measured against the 390pt frame: content width is 390
 * minus two `spacing.xxxl` gutters = 326pt. At 28 the two longest headings in
 * the flow wrap to exactly two lines and the short ones stay on one; at 34
 * (the old `type.largeTitle`) even "What's your story about?" wraps. Unchanged
 * from the previous pass, which got this level right.
 *
 * WHY CAPTION IS 12. The aside level: legal lines, counters, the "(optional)"
 * marker. It shares the eyebrow's size on purpose - they are the same tier of
 * the page - and is separated from it by family, case and tracking rather than
 * by a fifth size nobody could pick out of a lineup.
 *
 * BODY IS THE PRODUCT UI FACE. The onboarding experiment briefly used Inter
 * Tight for body and inputs while the rest of the app used Hanken Grotesk.
 * That is what made the prompt card, free-text box, OTP, and app UI read as
 * different products. Onboarding now uses Hanken for every body/input/metadata
 * level and reserves Bricolage for the one screen title.
 *
 * TRACKING. Negative on the sentence-case heading, because large sentence-case
 * type has too much air between letters at its optical size (-0.9 at 28 is
 * -0.032em). Positive on the uppercase eyebrow, because caps have no descender
 * interlock and jam together (+1 at 12 is 0.083em, the "0.08em on uppercase
 * eyebrows" rule in `ONBOARDING_FLOW.md` section 1). Body-weight levels sit at
 * or just above zero and never go negative.
 *
 * LINE HEIGHT MOVES WITH SIZE. A size may never be changed without its line
 * height; the pairs below are single values.
 *
 * PAIRS WITH THE SPACING RHYTHM. Size alone does not produce hierarchy. Use
 * `spacing.related` inside a group and `spacing.betweenGroups` between groups;
 * see the doc comment on `spacing` in ./theme.ts.
 */
export const onboardingType = {
  /** The one screen title. Sentence case, one per screen. 28/34, semibold family, -0.9 (-0.032em). */
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fonts.display,
    fontWeight: '800' as const,
    letterSpacing: 0,
  },
  /**
   * The uppercase eyebrow above a group. 12/16, semibold family, +1 (0.083em).
   *
   * A TREATMENT, NOT A RAMP STEP: it is deliberately smaller than the copy it
   * heads and is told apart by case, weight, tracking and colour. Render it
   * uppercase, always. If the string is sentence case the token is wrong.
   */
  sectionHeader: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.ui,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  /** Content: what the user types, what the story says, option-card text. 16/21, regular family. */
  body: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  /** Secondary copy: the line under a title or an eyebrow. 14.5/18, regular family. Always smaller than `body`. */
  helper: {
    fontSize: 14.5,
    lineHeight: 18,
    fontFamily: fonts.ui,
    fontWeight: '500' as const,
    letterSpacing: 0,
  },
  /** Asides: legal lines, counters, "(optional)" markers. 12/16, regular family. */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
} as const satisfies Record<string, TextStyle>;

/**
 * The SIZE ramp, largest first. `sectionHeader` is not in it: it is an eyebrow
 * treatment that shares `caption`'s size, and putting it in a size ordering
 * would assert a level it does not occupy. Exported so `theme.test.ts` can
 * check the ordering without restating it.
 */
export const onboardingRamp = ['title', 'body', 'helper', 'caption'] as const;
