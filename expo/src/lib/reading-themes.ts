/**
 * Reading modes: the colour of the page a story is read on.
 *
 * Its own module rather than a block inside `ReaderScreen.tsx` because this is
 * data, and the screen is not importable from a test without dragging in
 * `expo-av` and a native audio module. A contrast gate that cannot be run is
 * not a gate.
 */
import { colors } from "@/theme";

export type ReadingThemeName = "sepia" | "paper" | "night";

export type ReaderTheme = {
  name: ReadingThemeName;
  label: string;
  background: string;
  text: string;
  muted: string;
  divider: string;
  /**
   * Behind a search match. Paired with `text`, which is drawn on top of it, so
   * it must clear AA against `text` -- not against the page.
   *
   * This used to be `colors.accentSoft` on every theme, hardcoded in the
   * reader. On the Night page that put #F2EEE8 text on a #FFEFE2 highlight:
   * 1.03:1, so the word a reader had just searched for vanished at the moment
   * it was found.
   */
  highlight: string;
  /** Behind the match the reader is currently on. */
  activeHighlight: string;
  /** Drawn on `activeHighlight`; must clear AA against it. */
  activeHighlightText: string;
  /**
   * The app's own surfaces at the end of a chapter: the author card and the
   * comments. They are deliberately NOT the page -- the book ends where these
   * begin -- so they are drawn as cards lifted off it, in the app's UI colours
   * rather than the page's ink. `field` is the recessed fill of the comment
   * box inside that card. `text` and `muted` must clear AA against both.
   */
  social: {
    surface: string;
    field: string;
    text: string;
    muted: string;
  };
};

/** Paper and Sepia share the app's light card: white, lifted by `shadows.card`. */
const LIGHT_SOCIAL = {
  surface: colors.surface,
  field: colors.surface2,
  text: colors.ink,
  muted: colors.muted,
} as const;

/**
 * The reading modes, and why there are three of them.
 *
 * There is no API for this and nothing to fetch: a reading mode is a pair of
 * colours and a promise about legibility. So the set is ours, but the shape of
 * it is not invented -- Kindle, Apple Books and Kobo all offer a warm page, a
 * neutral page and a dark one, and a reader arriving from any of them finds
 * what they already use.
 *
 * Those three, and no more. Cool-blue and green pages exist in the bigger
 * libraries, which cover every kind of book; this app has one kind of content,
 * and a row of five swatches asks a reader to make a decision they did not come
 * here to make.
 *
 * Two rules hold every entry, both enforced by `reading-themes.test.ts` rather
 * than trusted:
 *
 * 1. **Body text clears WCAG AAA (7:1) against its own background.** AA (4.5:1)
 *    is the legal floor and is aimed at interface text read in glances. This
 *    app asks someone to hold their eyes on prose for half an hour, which is a
 *    different demand.
 * 2. **No pure black on pure white.** 21:1 is the maximum contrast and the
 *    wrong choice: it produces the strongest halation, the trailing ghost that
 *    smears a line as the page moves, which is uncomfortable for most readers
 *    and painful for readers with astigmatism. Every mode below reaches AAA
 *    with an off-white and a deep grey instead of with the extremes.
 *
 * `muted` is held to AA rather than AAA on purpose: it is used for page
 * furniture -- page numbers, captions -- not for prose, and holding secondary
 * text to the same bar as body text collapses the visual hierarchy that makes
 * a page readable in the first place.
 *
 * Sepia is the default. That is a product decision (2026-09-09): a near-white
 * page reads as a document, and the warm page is what makes this feel like a
 * book rather than a text box. A stored preference always wins over it.
 */
export const READER_THEMES: Record<ReadingThemeName, ReaderTheme> = {
  paper: {
    name: "paper",
    label: "Paper",
    // Off-white, never #FFFFFF. See rule 2 above.
    background: "#FAF7F2",
    text: "#1F1B16",
    muted: "#6B6259",
    divider: "#E2DAD0",
    highlight: "#FFE3C7",
    activeHighlight: "#B44708",
    activeHighlightText: "#FFF7F0",
    social: LIGHT_SOCIAL,
  },
  sepia: {
    name: "sepia",
    label: "Sepia",
    background: colors.sepia,
    text: colors.sepiaText,
    // `sepiaSecondary` (5.33:1), not `sepiaMuted` (3.30:1). The muted token
    // fails AA against this page, which the contrast gate caught -- in the
    // DEFAULT reading mode, where it had been shipping. The token itself is
    // left alone because other surfaces use it against other backgrounds;
    // what was wrong was pairing it with this one.
    muted: colors.sepiaSecondary,
    divider: colors.sepiaPlaceholder,
    highlight: "#F2D9A8",
    activeHighlight: "#8A3A0B",
    activeHighlightText: "#FFF6EC",
    social: LIGHT_SOCIAL,
  },
  night: {
    name: "night",
    label: "Night",
    // Deep warm grey, not black, and off-white, not white -- the pairing the
    // long-form reading guidance recommends over maximum contrast.
    background: "#171512",
    text: "#F2EEE8",
    muted: "#B8AEA3",
    divider: "#3A3632",
    highlight: "#4A3524",
    activeHighlight: "#E58A45",
    activeHighlightText: "#1A1208",
    // One step up from the Night page, the way a dark app lifts a card: a
    // lighter surface, not a border.
    social: {
      surface: "#24211D",
      field: "#302C28",
      text: "#F2EEE8",
      muted: "#B8AEA3",
    },
  },
};

/**
 * The order the picker shows them, and the default is first.
 *
 * Three, not five. Kindle and Apple Books each offer four light options plus
 * dark, but they are general-purpose libraries covering every kind of book and
 * every lighting condition; this is one app with one kind of content, and a
 * row of five swatches asks a reader to make a decision they did not come here
 * to make. Warm, neutral, dark covers the actual reasons someone changes this:
 * the page is too glaring, the page is too yellow, or it is night.
 *
 * Sepia leads because it is the default (product decision, 2026-09-09): a
 * near-white page reads as a document, and the warm page is what makes this
 * feel like a book. A stored preference always wins over it.
 */
export const READING_THEME_ORDER: readonly ReadingThemeName[] = [
  "sepia",
  "paper",
  "night",
];
