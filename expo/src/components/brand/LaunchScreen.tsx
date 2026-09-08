import { StyleSheet, View } from "react-native";
import { DottedGround } from "@/components/brand/DottedGround";
import { KathaMark } from "@/components/brand/KathaMark";
import { colors } from "@/theme";

/**
 * The first frame of the app, held while the brand faces load.
 *
 * The one orange surface in the product. Everything after it is the light
 * ground, so this reads as a brand moment rather than as a screen with
 * something on it.
 *
 * No text of any kind, and not for want of something to say: this screen is
 * blocking on the fonts, so any word set here would render in a substitute
 * face — the wrong wordmark on the one surface that is only a wordmark. The
 * mark is SVG geometry, not a glyph, which is why it can be drawn now at all.
 *
 * It loops because the wait is not a known length. A mark that draws once and
 * then holds turns a slow cold start into a screen that looks stuck.
 */

/**
 * White dots on saturated orange carry further than the reference's warm dots
 * on paper, so this sits below the loaders' 0.5 — at that strength the grid
 * reads as polka dots and competes with the mark.
 *
 * It does not sit anywhere near as low as it first shipped, though. At 0.06 the
 * texture was invisible on every screen it was checked on, which is not
 * restraint, it is a layer that costs a render and buys nothing. 0.16 is the
 * point where the grain is legible as grain without resolving into dots you
 * could count.
 */
const LAUNCH_DOT_OPACITY = 0.16;

export function LaunchScreen() {
  return (
    <View style={styles.root}>
      <DottedGround color={colors.surface} opacity={LAUNCH_DOT_OPACITY} />
      <KathaMark size={96} color={colors.surface} loop />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default LaunchScreen;
