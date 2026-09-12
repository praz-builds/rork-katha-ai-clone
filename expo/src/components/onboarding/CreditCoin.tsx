/**
 * The credit coin: the currency's face wherever a credit appears as an OBJECT.
 *
 * What consumer apps actually do, looked at before drawing this (Duolingo's
 * gems, Headspace's flat brand marks, Notion and Canva credit marks, and the
 * gold of Clash Royale and Coin Master):
 *
 * 1. The mark is almost never one flat disc. It is a **rim tone and a face
 *    tone** of the same hue, and that single split is what supplies mass.
 * 2. The rim is **thicker at the bottom**: the face sits a little high in the
 *    rim, so the edge you see under it reads as the coin's thickness. This is
 *    the cheapest possible "top-lit" cue and it survives at icon size.
 * 3. There is **one highlight**, a crescent hugging the upper-left of the face,
 *    at partial opacity. Never a gradient: at 20pt a gradient resolves to one
 *    muddy tone, and every app that ships a small currency mark flattens it.
 * 4. The face carries **an emblem** (Duolingo's facet, a game's crown or star).
 *    The emblem is the brand, not the coin; the coin is just where it lives.
 * 5. Colour does the identifying, not detail: no milled edge, no numerals, no
 *    inner ring. Duolingo's gem is legible at 16pt because it is three shapes.
 *
 * So: three flat tones, four shapes. Rim, face, crescent, spark. The spark is
 * the same four-point sparkle Home's credits pill carries, which is what makes
 * `WelcomeCreditsFlight` read as coins landing ON that pill rather than as
 * coins vanishing near it.
 */
import Svg, { Circle, Path } from "react-native-svg";

import { colors } from "@/theme";

/**
 * The rim: `colors.chromeStar` `#F5B324` at 80% value, channel for channel
 * (`0xF5,0xB3,0x24` x 0.8). Scaling all three channels keeps the hue and the
 * saturation exactly, so this is the same gold with the light taken off it
 * rather than a second colour in the palette.
 *
 * It is a constant here and not a token because it is not a colour anything
 * else may use: it exists to be the shaded side of one object. A token would
 * invite it onto text and borders, where an 80%-value amber fails contrast.
 */
const COIN_RIM = "#C48F1D";

/** The face sits 0.4 units high in the rim, which is what thickens the bottom edge. */
const FACE_CY = 11.6;

export type CreditCoinProps = {
  /** Drawn size in points. Must read at 20 and at 52. */
  size?: number;
};

export function CreditCoin({ size = 24 }: CreditCoinProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* The rim. r=11 leaves a 1-unit margin so a caller may put a contact
          shadow on a same-sized round wrapper without the shadow cutting the
          edge of the drawing. */}
      <Circle cx={12} cy={12} r={11} fill={COIN_RIM} />
      <Circle cx={12} cy={FACE_CY} r={8.6} fill={colors.chromeStar} />
      {/* The crescent, drawn as a filled band between two arcs rather than as a
          stroke: a stroked highlight has caps that read as two dots when the
          coin is scaled down to the flight's landing size. */}
      <Path
        d="M4.74 10.84 A7.3 7.3 0 0 1 10.98 4.37 L11.19 5.86 A5.8 5.8 0 0 0 6.23 10.99 Z"
        fill={colors.surface}
        fillOpacity={0.5}
      />
      {/* The Katha spark, centred on the face. Solid ink: it is the emblem, and
          an outlined emblem at 20pt is a grey smudge in the middle of the
          coin. */}
      <Path
        d="M12 7 C12.5 9.8 13.8 11.1 16.6 11.6 C13.8 12.1 12.5 13.4 12 16.2 C11.5 13.4 10.2 12.1 7.4 11.6 C10.2 11.1 11.5 9.8 12 7 Z"
        fill={colors.ink}
      />
    </Svg>
  );
}

export default CreditCoin;
