/**
 * Elevation.
 *
 * These are CSS `box-shadow` strings consumed through the `boxShadow` style
 * property, which RN 0.76+ / Expo SDK 54 support in `StyleSheet`. See
 * `CreateBriefFlow.tsx` for precedent.
 *
 * Every value is LAYERED: a tight, near-opaque contact shadow that anchors the
 * element to the surface below it, plus a wider, softer ambient shadow that
 * carries the sense of height. A single shadow cannot do both, which is why one
 * layer reads as a grey smudge under the box instead of as depth.
 *
 * These replace borders. Do not put a border on an elevated surface: pick the
 * elevation, and let the shadow draw the edge. `colors.border` is for the flat,
 * unelevated case; `colors.track` is for 1px dividers.
 *
 * Radius pairs with elevation: `card` -> `radius.md`, `raised`/`overlay` ->
 * `radius.lg` or `radius.xl`. See the doc comment on `radius` in ./theme.ts.
 */
export const shadows = {
  /** Flat in-flow surfaces: rows, list cards, anything that sits ON the page. */
  card: '0 1px 1px rgba(15, 14, 12, 0.06), 0 2px 6px rgba(15, 14, 12, 0.04)',
  /** Lifted surfaces: option cards, selected states, the create CTA. */
  raised: '0 1px 2px rgba(15, 14, 12, 0.08), 0 6px 16px rgba(15, 14, 12, 0.08)',
  /** Floats over content: sheets, popovers, toasts, modals. */
  overlay: '0 2px 4px rgba(15, 14, 12, 0.10), 0 12px 32px rgba(15, 14, 12, 0.16)',
  /**
   * Character onboarding (W3 to W7) hand-off values. Scoped to those screens.
   *
   * The hand-off draws each of these as one layer. The system rule that every
   * shadow carries a contact layer as well as an ambient one still applies,
   * so each gets the faintest possible contact line in front of the signed
   * value: 1px at 4%, invisible next to the reference and enough to keep the
   * depth model honest.
   */
  /**
   * NO LONGER DRAWN. The onboarding CTA is the app's `Button` now, and it
   * carries `primaryCta` like every other button (see DESIGN_SYSTEM.md §6.1).
   *
   * Kept rather than deleted because the rest of this onboarding group is
   * still in use and the value is the hand-off's; if the onboarding screens
   * ever want a warmer glow under the button again, it should be this one
   * rather than a fourth number.
   */
  onboardingCta: '0 1px 1px rgba(15, 14, 12, 0.04), 0 16px 30px -12px rgba(255, 107, 26, 0.55)',
  onboardingCard: '0 1px 1px rgba(30, 26, 22, 0.04), 0 24px 40px -22px rgba(30, 26, 22, 0.5)',
  onboardingHeroCard: '0 1px 1px rgba(30, 26, 22, 0.04), 0 32px 50px -20px rgba(30, 26, 22, 0.6)',
  onboardingPortrait: '0 1px 1px rgba(30, 26, 22, 0.04), 0 40px 60px -28px rgba(30, 26, 22, 0.6)',
  onboardingChip: '0 1px 1px rgba(30, 26, 22, 0.04), 0 20px 34px -18px rgba(30, 26, 22, 0.35)',
  onboardingFieldFocus: '0 1px 1px rgba(15, 14, 12, 0.04), 0 8px 22px -14px rgba(255, 107, 26, 0.5)',

  /**
   * The 38-46px circular ICON button (back control, close, and friends). Not
   * the full-width primary CTA, which stays a flat accent pill.
   *
   * "No flat fills" is satisfied WITHOUT a gradient library: the first layer is
   * an `inset` white highlight pushed 6px down from the top edge and pulled in
   * by its spread, so it lights the top of the plate and fades out before the
   * bottom. On a solid `colors.surface` fill that reads as a soft top-lit
   * sphere, i.e. the inset highlight does the lifting, not a gradient. The
   * second inset is the answering shade at the bottom lip; layers three and
   * four are the usual contact + ambient drop shadow.
   *
   * Recipe: backgroundColor `colors.surface`, width = height = a `controls.*`
   * size, borderRadius = size / 2, no borderWidth, glyph in `colors.strong`.
   */
  iconButton: [
    'inset 0 6px 6px -4px rgba(255, 255, 255, 0.95)',
    'inset 0 -2px 3px -1px rgba(15, 14, 12, 0.05)',
    '0 1px 2px rgba(15, 14, 12, 0.08)',
    '0 4px 10px rgba(15, 14, 12, 0.08)',
  ].join(', '),

  /**
   * Pressed state for the same button. The highlight and the ambient shadow
   * both collapse so the plate reads as pushed into the page. Swap on
   * `onPressIn`/`onPressOut`; do not animate the colour instead.
   */
  iconButtonPressed: [
    'inset 0 2px 4px -1px rgba(15, 14, 12, 0.10)',
    'inset 0 1px 2px rgba(255, 255, 255, 0.60)',
    '0 1px 1px rgba(15, 14, 12, 0.06)',
  ].join(', '),

  primaryCta:
    '0 1px 2px rgba(255, 107, 26, 0.24), 0 12px 26px rgba(255, 107, 26, 0.22)',
  formField:
    '0 1px 1px rgba(15, 14, 12, 0.05), 0 5px 14px rgba(15, 14, 12, 0.06)',
  iconCta:
    '0 1px 1px rgba(15, 14, 12, 0.05), 0 5px 14px rgba(255, 107, 26, 0.10)',
} as const;
