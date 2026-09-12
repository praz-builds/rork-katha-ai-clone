/**
 * The six onboarding glyph marks.
 *
 * These replace the earlier row icons: an `accentSoft` square with an Ionicons
 * outline glyph in `accent`, six times over, on two consecutive screens. The
 * product owner read the result as "boring orange icons", and he was right for
 * a structural reason rather than a taste one: an icon font gives you one
 * stroke weight, one tone and one silhouette vocabulary, so six rows drawn from
 * it differ only by which pictogram sits in the same orange box. The card reads
 * as a list of identical tiles.
 *
 * So these are drawn by hand in `react-native-svg` instead, to a fixed design
 * language:
 *
 * - **24x24 viewBox**, rendered at 22 inside a 40 tile, with a 3 to 4 unit
 *   optical margin so nothing touches the tile's rounded corners.
 * - **Two tones only.** A soft fill (a theme colour at a low `fillOpacity`, so
 *   it sits *on* the tile ground rather than fighting it) and a `colors.ink`
 *   stroke at 1.75 with round caps and joins. No gradients, no shadows: at
 *   22pt a gradient is one muddy tone and a shadow is a smudge.
 * - **The tint rotates per row.** `colors.accentSoft` (warm), `colors.sepia`
 *   (parchment) and `colors.sepiaPlaceholder` (the deeper parchment) take
 *   turns, and W6 takes them in a different order from W4, so neither card is
 *   a column of orange squares and the two cards do not rhyme with each other.
 *   Each glyph carries its intended ground as a `tint` property, so a screen
 *   rendering `<GlyphTile glyph={GlyphTheName} />` gets the rotation without
 *   having to know about it; passing `tint` explicitly still wins.
 *
 * Why `ink` for the stroke rather than `colors.strong`, which DESIGN_SYSTEM.md
 * section 7 mandates for icons: section 7 governs Ionicons glyphs sitting on
 * `bg` or `surface`, where `strong` keeps a mark from out-shouting the title
 * beside it. These marks sit on a saturated tint, where `strong` loses about a
 * third of its contrast and the line goes soft. `ink` on a tint lands at
 * roughly the same apparent weight `strong` has on white. These are drawings,
 * not icon-set members, and section 7.1 records the exception.
 */
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors, radius } from "@/theme";

export type GlyphProps = { size?: number };
export type GlyphComponent = ((props: GlyphProps) => React.JSX.Element) & {
  /** The tile ground this mark was drawn against. `GlyphTile` uses it as the default `tint`. */
  tint?: string;
};

/** The nominal drawing size: the glyph inside a 40 tile. */
const GLYPH_SIZE = 22;
/** The tile the glyph was designed inside. `GlyphTile`'s `size` scales against this. */
const TILE_SIZE = 40;

const STROKE = colors.ink;
const STROKE_WIDTH = 1.75;

/**
 * The three fills, one per tint. Each is a theme colour held at a low opacity
 * so it reads as a deeper shade of its own ground rather than as a second
 * colour dropped on top of it, which is what keeps the mark to two tones.
 */
const FILL_ON_ACCENT = { fill: colors.accent, fillOpacity: 0.22 };
const FILL_ON_SEPIA = { fill: colors.sepiaAccent, fillOpacity: 0.2 };
const FILL_ON_PARCHMENT = { fill: colors.chromeStar, fillOpacity: 0.35 };

/** Every mark shares one stroke; only the fill and the paths change. */
const strokeProps = {
  stroke: STROKE,
  strokeWidth: STROKE_WIDTH,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Frame({ size = GLYPH_SIZE, children }: { size?: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

/* ------------------------------------------------------------------ W4 ---- */

/**
 * W4 row 1, "Face and build" / "The portrait, from your first line".
 *
 * The row is about the drawing itself, so the metaphor is the drawing itself:
 * a head and shoulders inside a rounded frame, the frame carrying the fill and
 * the figure carrying the stroke. That split is deliberate. The tinted frame is
 * the picture Katha will hand back; the inked figure is the person the reader
 * described. At 22pt the two shapes are the only two shapes, a circle over an
 * arc inside a square, which is the most legible thing a portrait can reduce
 * to. Its sibling on W6 ("Same face, every time") uses the same frame idea, so
 * this one stays strictly singular: one frame, centred, no offset, no
 * duplication. Seen next to each other, one says "a portrait" and the other
 * says "the same portrait twice".
 */
export const GlyphFaceAndBuild: GlyphComponent = function GlyphFaceAndBuild({ size = GLYPH_SIZE }) {
  return (
    <Frame size={size}>
      <Rect x={3.4} y={3} width={17.2} height={18} rx={5} {...FILL_ON_ACCENT} {...strokeProps} />
      <Circle cx={12} cy={10} r={3.1} {...strokeProps} />
      <Path d="M7 19.4C7.7 16.2 9.6 14.6 12 14.6C14.4 14.6 16.3 16.2 17 19.4" {...strokeProps} />
    </Frame>
  );
};
GlyphFaceAndBuild.tint = colors.accentSoft;

/**
 * W4 row 2, "Clothes and props" / "What they carry into every chapter".
 *
 * A hanger with a tag on it. The hanger is the one object that means "an outfit
 * that exists before anyone is wearing it", which is exactly what this row
 * promises: the coat and the sword are recorded once and follow the character
 * into chapters nobody has written yet. The tag is the "props" half, and it is
 * also what stops the mark reading as a plain triangle at small size. The wide
 * horizontal base and the small hook above it give a silhouette nothing else in
 * the set has, so this row is identifiable at a glance even before the shapes
 * resolve. Nothing on W6 is object-shaped, so there is no sibling to separate
 * from; it only has to not collide with the frames and the book.
 */
export const GlyphClothingAndCarry: GlyphComponent = function GlyphClothingAndCarry({
  size = GLYPH_SIZE,
}) {
  return (
    <Frame size={size}>
      <Path d="M12 8.4C12 6.6 14.5 6.6 14.5 4.9C14.5 3.2 12 3.2 12 4.9" {...strokeProps} />
      <Path
        d="M12 8.4L4.4 14.1C3.6 14.7 4 16 5 16H19C20 16 20.4 14.7 19.6 14.1L12 8.4Z"
        {...FILL_ON_SEPIA}
        {...strokeProps}
      />
      <Path d="M16.8 16V17.6" {...strokeProps} />
      <Rect
        x={14.2}
        y={17.4}
        width={5.6}
        height={4}
        rx={1.3}
        {...FILL_ON_SEPIA}
        {...strokeProps}
      />
    </Frame>
  );
};
GlyphClothingAndCarry.tint = colors.sepia;

/**
 * W4 row 3, "The name" / "How every story speaks to them".
 *
 * A name plate with a hand-written line on it and a full stop after it. Not a
 * pencil: a pencil means "edit this", which is the wrong promise, and
 * `IconPencil` already carries that meaning elsewhere in onboarding. The plate
 * means "this is what you are called", and the handwriting inside it is the
 * story's own voice saying it, which is the distinction the copy is drawing.
 * At 22pt the wave resolves to three bumps rather than letters, which is the
 * point: an unreadable signature reads as "a name" faster than any set of real
 * letterforms would at this size. The dot is a hard little anchor that keeps
 * the line from looking like a stray scribble, and it is the one place in the
 * set with a solid ink fill, so this row has a unique accent.
 */
export const GlyphTheName: GlyphComponent = function GlyphTheName({ size = GLYPH_SIZE }) {
  return (
    <Frame size={size}>
      <Rect
        x={3}
        y={6}
        width={18}
        height={12}
        rx={3.2}
        {...FILL_ON_PARCHMENT}
        {...strokeProps}
      />
      <Path
        d="M6.6 13.6C8 10.7 9.2 10.7 9.6 12.7C10 14.7 11.2 14.7 12.4 11.9C13.2 10.1 14.2 10.7 14.4 13.4"
        {...strokeProps}
      />
      <Circle cx={17.2} cy={13.4} r={0.95} fill={STROKE} />
    </Frame>
  );
};
GlyphTheName.tint = colors.sepiaPlaceholder;

/* ------------------------------------------------------------------ W6 ---- */

/**
 * W6 row 1, "Leads your stories" / "At the centre of what you write". Also the
 * reader variant's "You, in every story": the copy changes, the mark does not,
 * because the claim is identical from either side of the app.
 *
 * An open book with a figure standing on its spine. The book is the story and
 * the figure is literally standing at its centre, which is the sentence drawn
 * rather than illustrated. The two mirrored pages give a symmetric silhouette
 * that survives the drop to 22pt where a spotlight beam would not: a beam is a
 * pale wedge, and a pale wedge on a tint is nothing. Its sibling is W4's
 * portrait frame, and the separation is total, a wide horizontal object versus
 * a tall enclosed one. The figure here is deliberately reduced to head and
 * torso with no frame around it, so it reads as a person *in* a story rather
 * than a picture *of* a person.
 */
export const GlyphLeadsStories: GlyphComponent = function GlyphLeadsStories({
  size = GLYPH_SIZE,
}) {
  return (
    <Frame size={size}>
      <Path
        d="M11.2 10.2C8.8 8.5 6 8.2 3.2 9.2V18.8C6 17.8 8.8 18.1 11.2 19.8V10.2Z"
        {...FILL_ON_PARCHMENT}
        {...strokeProps}
      />
      <Path
        d="M12.8 10.2C15.2 8.5 18 8.2 20.8 9.2V18.8C18 17.8 15.2 18.1 12.8 19.8V10.2Z"
        {...FILL_ON_PARCHMENT}
        {...strokeProps}
      />
      <Circle cx={12} cy={4.4} r={1.9} {...strokeProps} />
      <Path d="M12 6.9V10.6" {...strokeProps} />
    </Frame>
  );
};
GlyphLeadsStories.tint = colors.sepiaPlaceholder;

/**
 * W6 row 2, "Same face, every time" / "Consistent across every chapter and
 * story".
 *
 * Two identical portrait frames, offset, the one behind filled and unstroked,
 * the one in front outlined and carrying the face. Repetition is the whole
 * message, and repetition is the one thing a single pictogram cannot say, so
 * the mark says it structurally instead of with a symbol: the same shape,
 * twice, in register. Dropping the stroke on the back frame is what makes it
 * read as depth rather than as a rectangle glued to another rectangle, and it
 * keeps the mark inside the two-tone rule at a size where a third line would
 * close up. Against W4's "Face and build" the difference is immediate even out
 * of focus: one frame versus two, centred versus offset.
 */
export const GlyphSameFace: GlyphComponent = function GlyphSameFace({ size = GLYPH_SIZE }) {
  return (
    <Frame size={size}>
      <Rect x={6.6} y={3.2} width={14} height={14} rx={4.2} {...FILL_ON_ACCENT} />
      <Rect x={3.4} y={6.8} width={14} height={14} rx={4.2} {...FILL_ON_ACCENT} {...strokeProps} />
      <Circle cx={10.4} cy={12.2} r={2.1} {...strokeProps} />
      <Path d="M7.2 19.2C7.7 17.1 8.9 15.9 10.4 15.9C11.9 15.9 13.1 17.1 13.6 19.2" {...strokeProps} />
    </Frame>
  );
};
GlyphSameFace.tint = colors.accentSoft;

/**
 * W6 row 3, "Saved to your cast" / "Reuse them in any story, any time".
 *
 * A shelf with three standing tokens on it, each token dotted with a head. Not
 * a bookmark: a bookmark means "this one thing, kept", and the row is about a
 * collection you pick from, so the mark has to be plural. Three is the smallest
 * count that reads as a set rather than a pair, and the uneven heights are what
 * make it read as a shelf of characters rather than as a bar chart. The ground
 * line is the only straight horizontal rule in the set, which gives this row a
 * distinct base weight in the column. It shares the book's library idea with
 * W6 row 1 but inverts it: that mark is one story opened, this one is many
 * characters closed and put away, waiting.
 */
export const GlyphSavedCast: GlyphComponent = function GlyphSavedCast({ size = GLYPH_SIZE }) {
  return (
    <Frame size={size}>
      <Rect x={4.6} y={7.8} width={3.9} height={10.6} rx={1.3} {...FILL_ON_SEPIA} {...strokeProps} />
      <Rect x={10.1} y={5.6} width={3.9} height={12.8} rx={1.3} {...FILL_ON_SEPIA} {...strokeProps} />
      <Rect x={15.6} y={9.4} width={3.9} height={9} rx={1.3} {...FILL_ON_SEPIA} {...strokeProps} />
      <Circle cx={6.55} cy={10.4} r={0.75} fill={STROKE} />
      <Circle cx={12.05} cy={8.2} r={0.75} fill={STROKE} />
      <Circle cx={17.55} cy={12} r={0.75} fill={STROKE} />
      <Path d="M3.2 20.4H20.8" {...strokeProps} />
    </Frame>
  );
};
GlyphSavedCast.tint = colors.sepia;

/**
 * The tile a glyph sits on.
 *
 * `tint` is the tile's own soft ground. It defaults to the ground the glyph was
 * drawn against (see the rotation note at the top of this file) rather than to
 * one fixed colour, so a caller that passes only `glyph` still gets the varied
 * card; an explicit `tint` overrides it. `size` scales the tile and the glyph
 * together, keeping the 22-in-40 ratio and the optical margin that goes with
 * it.
 */
export function GlyphTile({
  glyph: Glyph,
  tint,
  size = TILE_SIZE,
  style,
}: {
  glyph: GlyphComponent;
  tint?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ground = tint ?? Glyph.tint ?? colors.accentSoft;
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius.md, backgroundColor: ground },
        style,
      ]}
    >
      <Glyph size={(size * GLYPH_SIZE) / TILE_SIZE} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    justifyContent: "center",
  },
});
