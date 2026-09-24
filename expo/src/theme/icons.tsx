import type { ComponentProps, ComponentType } from "react";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "./theme";

/**
 * The onboarding icon set.
 *
 * SCOPE: the onboarding flow only. This module is the ONLY sanctioned place in
 * onboarding that imports `@expo/vector-icons`. A screen imports named
 * components from here (or from the `@/theme` barrel) and never reaches for a
 * raw glyph name, so the glyph, its optical size and its default colour stay one
 * decision in one file. Every other surface (`App.tsx`, `CreateStudioScreen`,
 * the components under `src/components/`) is still on `lucide-react-native` and
 * stays there until it is migrated deliberately.
 *
 * WHY IONICONS AND NOT SF SYMBOLS. The line style being matched is Apple's, and
 * SF Symbols would be the literal answer, but `expo-symbols` renders nothing on
 * Android and nothing in a web bundle: the glyph is supplied by the OS. Product
 * review happens in the Expo web preview, so SF Symbols would review as blank
 * boxes. Ionicons is drawn in the same Apple line idiom, ships as a font inside
 * `@expo/vector-icons` (already a dependency), and renders identically on iOS,
 * Android and web.
 *
 * WHY THE OUTLINE VARIANTS. Ionicons ships each glyph as `-outline` (thin,
 * open), plain (solid or heavy), and `-sharp` (squared terminals). `-outline`
 * is the Apple line style, so it is the default here. Two glyphs deliberately
 * do NOT use it, and each says why at its definition.
 *
 * OPTICAL SIZE. Ionicons and lucide do not agree on what a "16pt icon" is.
 * Lucide draws on a 24-unit box with a 2-unit margin, so the mark fills about
 * 83% of the nominal size. Ionicons draws on a 512-unit box with much more
 * padding, so at the same nominal size the mark lands visibly smaller and the
 * stroke lands lighter. `OPTICAL_SCALE` compensates: the size a caller passes is
 * the size the OLD lucide glyph occupied, and is scaled up before it reaches
 * Ionicons. That means call sites keep the numbers they already have (16 stays
 * 16) and still match what shipped.
 */

/**
 * Multiplier from a lucide-equivalent nominal size to the Ionicons size that
 * renders at the same optical weight. 1.125 was picked so the common sizes land
 * on whole points: 14 -> 16, 16 -> 18, 20 -> 23, 22 -> 25.
 */
export const OPTICAL_SCALE = 1.125;

/** Convert a lucide-equivalent nominal size to the Ionicons size to render. */
export function opticalSize(size: number): number {
  return Math.round(size * OPTICAL_SCALE);
}

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface IconProps {
  /**
   * Nominal size in points, expressed the way lucide expressed it. Scaled by
   * `OPTICAL_SCALE` before it reaches Ionicons.
   */
  size?: number;
  /** Defaults to `colors.strong`, the icon ink token. */
  color?: string;
}

export type IconComponent = ComponentType<IconProps>;

function icon(
  displayName: string,
  name: IoniconName,
  defaultSize: number,
): IconComponent {
  function Icon({ size = defaultSize, color = colors.strong }: IconProps) {
    return <Ionicons name={name} size={opticalSize(size)} color={color} />;
  }
  Icon.displayName = displayName;
  return Icon;
}

/**
 * Back control in a screen header.
 *
 * `chevron-back-outline`, not `arrow-back-outline`. Apple's back affordance is a
 * chevron, and the arrow reads as "undo" beside a title. Default 20 matches the
 * lucide `ArrowLeft` that shipped in the header.
 */
export const IconBack = icon("IconBack", "chevron-back-outline", 20);

/**
 * Dismiss a screen or a sheet. Default 22, matching the lucide `X` in the top
 * bar of the auth and offer screens.
 */
export const IconClose = icon("IconClose", "close-outline", 22);

/**
 * Remove one item: the X inside a chip or a filled row.
 *
 * DELIBERATELY NOT THE OUTLINE VARIANT. At 14pt `close-outline` is a hairline
 * cross that disappears against a tinted chip, and it is a destructive control,
 * so it has to stay findable. Plain `close` is the same mark with a heavier
 * stroke and holds at chip size.
 */
export const IconRemove = icon("IconRemove", "close", 14);

/** Add: the plus on "add a moment" and "add a character" affordances. */
export const IconAdd = icon("IconAdd", "add", 18);

/**
 * Affirmative check: a selected option, a satisfied requirement, a success row.
 *
 * DELIBERATELY NOT THE OUTLINE VARIANT. `checkmark-outline` and `checkmark` are
 * the same open path in Ionicons, but `checkmark` carries the heavier stroke,
 * and a check at 16pt in `colors.success` needs it to register as a state and
 * not as a stray tick. Use `IconCheckCircle` when the check needs its own
 * container.
 */
export const IconCheck = icon("IconCheck", "checkmark", 16);

/** Check inside a ring, for a standalone confirmation mark. */
export const IconCheckCircle = icon(
  "IconCheckCircle",
  "checkmark-circle-outline",
  20,
);

/** Disclosure caret on a collapsed group or a menu trigger. */
export const IconChevronDown = icon(
  "IconChevronDown",
  "chevron-down-outline",
  16,
);

/** Forward disclosure on a row that pushes a screen. */
export const IconChevronForward = icon(
  "IconChevronForward",
  "chevron-forward-outline",
  16,
);

/**
 * A person who has no portrait yet.
 *
 * The character onboarding draws a portrait card before the image exists, and
 * again whenever the offline path hands back a `draft-character://` URL that no
 * `<Image>` can load. Without a glyph the card is an empty grey rectangle, which
 * reads as a broken image rather than as a frame waiting to be filled.
 */
export const IconPerson = icon("IconPerson", "person-outline", 28);

/**
 * A shelf, a library, a cast you can come back to.
 *
 * The Meet screen's "Saved to your cast" row is the one promise in onboarding
 * about the character OUTLASTING this session, and the other glyphs here are
 * all about the moment (a person, a spark, a pencil). A book is the only mark
 * in the set that reads as "kept somewhere".
 */
export const IconBook = icon("IconBook", "book-outline", 18);

export const IconPencil = icon("IconPencil", "pencil-outline", 18);
export const IconRefresh = icon("IconRefresh", "refresh-outline", 18);
export const IconPalette = icon("IconPalette", "color-palette-outline", 18);
export const IconTrash = icon("IconTrash", "trash-outline", 18);

/** Voices: the audio entitlement row on the paywall. */
export const IconMic = icon("IconMic", "mic-outline", 18);

/** A document you can take away: the PDF export entitlement row. */
export const IconDocument = icon("IconDocument", "document-text-outline", 18);
