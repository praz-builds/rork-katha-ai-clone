/**
 * The onboarding glyph set.
 *
 * These are drawings, so there is nothing here about what they look like. What
 * is worth holding is the contract the two cards depend on: every mark is an
 * `Svg` on the same 24x24 grid (so the stroke weights agree across rows), every
 * mark actually draws something, the tile paints the tint it is given, and the
 * six are six distinct components on three different grounds rather than one
 * placeholder aliased six times in one orange square, which is exactly what the
 * stub they replaced would have shipped unnoticed.
 *
 * The assertions read the rendered tree rather than the source, because
 * `react-native-svg` compiles its props on the way down: a colour arrives as a
 * packed integer and `strokeLinecap="round"` arrives as `1`. `colorOf` and
 * `ROUND_CAPS` below accept that encoding AND the plain string a renderer that
 * passes props through leaves behind, so the test names the token rather than
 * one renderer's magic number.
 */
import { render } from "@testing-library/react-native";
import { processColor, StyleSheet } from "react-native";

import {
  GlyphClothingAndCarry,
  GlyphFaceAndBuild,
  GlyphLeadsStories,
  GlyphSameFace,
  GlyphSavedCast,
  GlyphTheName,
  GlyphTile,
} from "@/components/onboarding/glyphs";
import type { GlyphComponent } from "@/components/onboarding/glyphs";
import { colors, radius } from "@/theme";

type Node = { type: string; props: Record<string, unknown>; children?: unknown };

/** Every node in a rendered tree, depth first. */
function flatten(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const typed = node as Node;
  if (typeof typed.type === "string") out.push(typed);
  flatten(typed.children, out);
  return out;
}

const nodesOf = async (element: React.JSX.Element) => flatten((await render(element)).toJSON());
const byType = (nodes: Node[], type: string) => nodes.filter((node) => node.type === type);
/**
 * The colour as the host view holds it.
 *
 * `react-native-svg` packs a colour into an integer on the way down, but a
 * renderer that hands the prop through untouched leaves the string it was
 * written as. Both are read here, so the assertion stays about the token
 * rather than about which encoding the renderer happened to use.
 */
const colorOf = (value: unknown) =>
  typeof value === "string"
    ? processColor(value)
    : (value as { payload?: number } | null)?.payload;

/**
 * `react-native-svg` maps the `strokeLinecap` enum before it reaches the host
 * view; an untouched prop is still the word. Either spelling is round.
 */
const ROUND_CAPS: unknown[] = [1, "round"];

const W4: [string, GlyphComponent][] = [
  ["GlyphFaceAndBuild", GlyphFaceAndBuild],
  ["GlyphClothingAndCarry", GlyphClothingAndCarry],
  ["GlyphTheName", GlyphTheName],
];
const W6: [string, GlyphComponent][] = [
  ["GlyphLeadsStories", GlyphLeadsStories],
  ["GlyphSameFace", GlyphSameFace],
  ["GlyphSavedCast", GlyphSavedCast],
];
const ALL = [...W4, ...W6];

describe("onboarding glyphs", () => {
  it.each(ALL)("%s draws on a 24x24 grid at the size it is given", async (_name, Glyph) => {
    const nodes = await nodesOf(<Glyph size={22} />);

    const [svg] = byType(nodes, "RNSVGSvgView");
    expect(svg).toBeDefined();
    expect(svg.props.vbWidth).toBe(24);
    expect(svg.props.vbHeight).toBe(24);
    expect(svg.props.width).toBe(22);
    expect(svg.props.height).toBe(22);
    expect(byType(nodes, "RNSVGPath").length).toBeGreaterThan(0);
  });

  it.each(ALL)("%s strokes in ink at 1.75 with round caps", async (_name, Glyph) => {
    const nodes = await nodesOf(<Glyph />);

    const stroked = nodes.filter((node) => node.type.startsWith("RNSVG") && node.props.stroke);
    expect(stroked.length).toBeGreaterThan(0);
    for (const node of stroked) {
      expect(colorOf(node.props.stroke)).toBe(processColor(colors.ink));
      expect(node.props.strokeWidth).toBe(1.75);
      expect(ROUND_CAPS).toContain(node.props.strokeLinecap);
    }
  });

  it("is six distinct components, none reused across the two cards", () => {
    const unique = new Set(ALL.map(([, Glyph]) => Glyph));
    expect(unique.size).toBe(6);
  });

  it("does not put every row on the same orange tint", () => {
    // The rotation is the whole point of the redraw: three grounds, each card
    // using all three, and the two cards not taking them in the same order.
    const w4 = W4.map(([, Glyph]) => Glyph.tint);
    const w6 = W6.map(([, Glyph]) => Glyph.tint);

    expect(new Set(w4).size).toBe(3);
    expect(new Set(w6).size).toBe(3);
    expect(w6).not.toEqual(w4);
    for (const tint of [...w4, ...w6]) {
      expect([colors.accentSoft, colors.sepia, colors.sepiaPlaceholder]).toContain(tint);
    }
  });
});

describe("GlyphTile", () => {
  const tileOf = async (element: React.JSX.Element) => {
    const nodes = await nodesOf(element);
    const tile = StyleSheet.flatten(byType(nodes, "View")[0]?.props.style) as {
      width?: number;
      height?: number;
      borderRadius?: number;
      backgroundColor?: string;
    };
    return { tile, svg: byType(nodes, "RNSVGSvgView")[0] };
  };

  it("is a 40x40 plate at radius.md carrying the glyph's own tint", async () => {
    const { tile, svg } = await tileOf(<GlyphTile glyph={GlyphSavedCast} />);

    expect(tile.width).toBe(40);
    expect(tile.height).toBe(40);
    expect(tile.borderRadius).toBe(radius.md);
    expect(tile.backgroundColor).toBe(GlyphSavedCast.tint);
    expect(svg.props.width).toBe(22);
  });

  it("applies an explicit tint over the glyph's default", async () => {
    const { tile } = await tileOf(<GlyphTile glyph={GlyphSavedCast} tint={colors.accentSoft} />);

    expect(tile.backgroundColor).toBe(colors.accentSoft);
  });

  it("scales the glyph with the tile", async () => {
    const { tile, svg } = await tileOf(<GlyphTile glyph={GlyphFaceAndBuild} size={60} />);

    expect(tile.width).toBe(60);
    expect(svg.props.width).toBe(33);
  });
});
