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
 * above until this is rolled out deliberately. See
 * `source-of-truth/DESIGN_SYSTEM.md` for the migration boundary.
 *
 * ONE RAMP, FOUR LEVELS, ONE RATIO. 28 / 21 / 16 / 12. Every adjacent pair is
 * a step of about 1.3x (28/21 = 1.333, 21/16 = 1.313, 16/12 = 1.333), which is
 * a musical fourth and the smallest step that still reads as a different level
 * rather than as a rendering accident. The floor is 1.25 and `theme.test.ts`
 * enforces it, so nobody can slip a fifth size in between two of these.
 *
 * WHY THE RAMP WAS RETUNED. The previous scale was 22 title, an unused 19
 * sectionHeader, and 14.5 body, with screens reaching for `type.caption` (12,
 * uppercase) for their section eyebrows. That made the label that HEADS a group
 * the smallest text in the group and smaller than the body copy underneath it,
 * so "The parts you already have in mind." read as one heading followed by an
 * undifferentiated field of near-identical text. There was a 10pt cliff from
 * title to section head and nothing in between. Both ends were wrong, so both
 * ends moved.
 *
 * WHY THE TITLE IS 28. Measured, not guessed, against the 390pt frame: content
 * width is 390 minus two `spacing.xxxl` gutters = 326pt. Advance widths taken
 * from `assets/fonts/InterTight-SemiBold.ttf` for every `title` string in the
 * writer flow:
 *
 *   - at 22 the longest heading, "The parts you already have in mind.", sets
 *     325.5pt against 326pt of column. It fits on one line by half a point,
 *     which is not a heading size, it is a coincidence one word of copy away
 *     from breaking.
 *   - at 28 the two longest headings ("The parts you already have in mind." at
 *     414pt, "Save your story before we shape it." at 411pt) wrap to exactly
 *     two lines, and the short ones ("What's your story about?", "Check your
 *     inbox", "Welcome to Katha.") stay on one. Nothing in the flow reaches
 *     three lines and nothing clips.
 *   - at 34, the old `type.largeTitle`, even "What's your story about?" wraps.
 *     That is the overcorrection this replaces.
 *
 * WHY THE SECTION HEAD IS 21. Uppercase carries more visual mass than sentence
 * case at the same nominal size, because every letter is a cap. The measure
 * that matters is therefore cap height against the title, not fontSize against
 * fontSize. Inter Tight has a cap height of 0.7275em and an x-height of
 * 0.5459em, so an uppercase eyebrow at 21 stands 15.3pt tall and the title's
 * lowercase at 28 stands 15.3pt tall: THE EYEBROW'S CAPS LAND EXACTLY ON THE
 * TITLE'S X-HEIGHT. It reads as a clear second level (75% of the title's own
 * cap height) without competing with it. This is what the earlier pass could
 * not get: 19 under a 22 title put the eyebrow at 86% of the title's caps,
 * which is why it was abandoned and the eyebrows were left at 12. Widening the
 * title is what makes the section head usable.
 *
 * WHY BODY IS 16. 14.5 sat 1.5pt from the `type.body` (16) used by the flow's
 * input fields, which is below the threshold where a size difference reads as
 * intent; it read as a mistake. At 16 the helper line and the field text are
 * deliberately the same size and colour separates them, which is the rule this
 * system already states for labels and values.
 *
 * WHY CAPTION IS 12. It is the aside level: legal lines, counters, the
 * "optional" marker. It matches `type.caption` so a shared component does not
 * change size when a surface migrates. It is the FLOOR, not the eyebrow: a
 * label that heads a group is `sectionHeader`, never this.
 *
 * SEMIBOLD IS A FAMILY, NOT A WEIGHT. Inter Tight is registered as two static
 * instances (`InterTight` = 400, `InterTightSemiBold` = 600). React Native
 * cannot synthesise 600 from the 400 file, so `fontWeight: '600'` on
 * `fonts.tight` silently renders regular on iOS. `title` and `sectionHeader`
 * therefore name `fonts.tightSemiBold` directly. `fontWeight` is carried only
 * as a hint for the web bundle, which can pick the right registered face; it is
 * never what makes the weight happen.
 *
 * TRACKING DIRECTION - the one apparent contradiction in the spec, resolved.
 * The spec closes with "negative tracking on every heading" but specifies the
 * section header at positive tracking. Both are correct because they are two
 * different treatments:
 *
 * - `title` is sentence case. Large sentence-case type has too much air between
 *   letters at its optical size, so it gets NEGATIVE tracking to close up. At
 *   28 that is -0.9, which is -0.032em: the same em-relative tightness the old
 *   22/-0.7 carried, so the title got bigger without getting looser.
 * - `sectionHeader` is the UPPERCASE eyebrow. Uppercase letterforms have no
 *   descender interlock and jam together, so they get POSITIVE tracking. At 21
 *   that is +0.7, again 0.033em, the same rule `ONBOARDING_FLOW.md` section 1
 *   states as "uppercase eyebrows at 0.08em", tuned for a size that is now a
 *   section head rather than a 12pt label.
 * - `body` and `caption` are neither. They sit at or just above zero and never
 *   go negative: tracking in at a small optical size closes the counters and
 *   costs legibility. The negative/positive rule governs the two heading
 *   levels.
 *
 * So: negative on the sentence-case heading, positive on the uppercase one. If
 * you render `sectionHeader` in sentence case you have picked the wrong token,
 * use `title`.
 *
 * LINE HEIGHT MOVES WITH SIZE. Headings are set tight (about 1.21 to 1.24)
 * because they wrap to two lines and want to read as one block. Body and
 * caption are set looser (about 1.31 to 1.33) because they are read as
 * paragraphs. A size may never be changed without its line height.
 *
 * PAIRS WITH THE SPACING RHYTHM. Size alone does not produce hierarchy. Use
 * `spacing.related` inside a group and `spacing.betweenGroups` between groups;
 * see the doc comment on `spacing` in ./theme.ts.
 */
export const onboardingType = {
  /** Screen title. Sentence case, one per screen. 28/34, semibold family, -0.9 (-0.032em). */
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fonts.tightSemiBold,
    fontWeight: '600' as const,
    letterSpacing: -0.9,
  },
  /** Uppercase section head above a group. 21/26, semibold family, +0.7 (0.033em). */
  sectionHeader: {
    fontSize: 21,
    lineHeight: 26,
    fontFamily: fonts.tightSemiBold,
    fontWeight: '600' as const,
    letterSpacing: 0.7,
  },
  /** Body copy, supporting lines, option-card text. 16/21, regular family. */
  body: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fonts.tight,
    fontWeight: '400' as const,
    letterSpacing: 0.2,
  },
  /** Asides: legal lines, counters, "optional" markers. 12/16, regular family. Never an eyebrow. */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.tight,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
} as const satisfies Record<string, TextStyle>;

/**
 * The onboarding ramp in descending order, exported so `theme.test.ts` can
 * assert the ratio between adjacent steps without restating the ramp.
 */
export const onboardingRamp = ['title', 'sectionHeader', 'body', 'caption'] as const;

/** The minimum ratio between two adjacent steps of `onboardingType`. Below this the step stops reading as a level. */
export const ONBOARDING_RAMP_MIN_STEP = 1.25;
