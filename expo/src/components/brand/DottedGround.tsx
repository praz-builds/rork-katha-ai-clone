import { useId } from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

/**
 * The dotted paper the brand surfaces sit on.
 *
 * One tiled SVG pattern rather than a grid of views. A 32pt grid across a tall
 * phone is several hundred nodes if each dot is its own element, on screens
 * whose whole job is to stay smooth.
 *
 * The three surfaces that use it (launch, crafting, generating) share the dot
 * geometry so they read as one place at different moments; only the tone
 * changes, which is why colour and opacity are props rather than baked in.
 */

/**
 * The reference's `radial-gradient(circle, #E4D8C4 1px, ...)` on light ground.
 * No theme token carries it — it is a texture tone, not a surface — so it is
 * named here rather than snapped to the nearest neutral.
 */
export const GROUND_DOT = "#E4D8C4";

/** Reference spacing. Shared by every surface so the grids line up. */
const DOT_SPACING = 32;

type Props = {
  /** Defaults to the reference tone, which is tuned for light ground. */
  color?: string;
  opacity?: number;
};

export function DottedGround({ color = GROUND_DOT, opacity = 0.5 }: Props) {
  // Each mount owns its pattern id. Two grounds alive at once — an overlay
  // above a screen that already has one — would otherwise both resolve
  // `url(#katha-dots)` to whichever was defined last, and one would silently
  // take the other's tone.
  const patternId = `katha-dots-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    // `width`/`height` are set as PROPS, not only through the style. Without
    // them the Svg takes its intrinsic size, and the Rect's "100%" resolves
    // against that rather than against the filled box — which tiled the grain
    // across the top quarter of the screen and left the rest flat.
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      pointerEvents="none"
    >
      <Defs>
        <Pattern
          id={patternId}
          width={DOT_SPACING}
          height={DOT_SPACING}
          patternUnits="userSpaceOnUse"
        >
          <Circle cx={1.5} cy={1.5} r={1} fill={color} fillOpacity={opacity} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}

export default DottedGround;
