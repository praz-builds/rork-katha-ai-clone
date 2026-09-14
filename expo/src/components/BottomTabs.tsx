import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bookmark, Compass, Home, Plus, User } from "lucide-react-native";
import { colors, controls, radius, shadows, spacing } from "@/theme";
import type { TabKey } from "@/types/domain";

/**
 * The floating tab bar: a pill of four tabs, and the Create button beside it.
 *
 * THE CTA IS AT THE END, NOT IN THE MIDDLE. It used to be a raised orange disc
 * breaking the top edge of the bar between Explore and Library, which put the
 * one control that starts something in the row of controls that go somewhere,
 * and made the bar read as five tabs of which one was oddly tall. Now the four
 * places to go are one object and the thing to do is another, sitting to its
 * right where the thumb rests: a button, not a fifth tab.
 *
 * ICONS ONLY. Four glyphs a person learns in a session (home, compass,
 * bookmark, person) do not need a caption under each, and the labels were
 * what made the bar 76 pt tall. Every tab still carries its name for
 * assistive technology, and the selected one is announced as selected.
 *
 * FIXED, AND ABOVE THE HOME INDICATOR. The bar is absolutely positioned over
 * the screen and offset by the bottom safe-area inset, so on an iPhone it
 * floats above the home indicator and on an Android with gesture navigation
 * it sits above the gesture zone, rather than 10 pt from a hardware edge
 * that is not the usable edge. Screens keep their last row clear of it with
 * `TAB_BAR_CLEARANCE`, which is a constant rather than a measurement so a
 * scroll container can pad for it from a `StyleSheet`.
 *
 * NO ANIMATION ON THE SWITCH. A tab changes dozens of times a session, and a
 * slide or a spring on each is a toll (expo-animation, the frequency gate).
 * The selected disc simply is, and a press dims the target for as long as the
 * finger is down.
 *
 * RELATIVE, NOT FIXED, IN WIDTH. The pill takes whatever width the window
 * leaves after the gutters and the button; the four tabs share it equally.
 * On a 360 pt phone each tab is still over 60 pt wide, comfortably above the
 * 44 pt floor.
 */

/** The pill's height, and the height of every tab inside it. */
export const TAB_BAR_HEIGHT = controls.tabBarHeight;
/** Between the bar's bottom edge and the safe-area inset. */
const TAB_BAR_GAP = spacing.md;
/**
 * The largest bottom inset a supported phone reports: Android's three-button
 * navigation bar, at 48. An iPhone's home indicator is 34.
 */
const LARGEST_BOTTOM_INSET = 48;

/**
 * How much a scrolling screen must pad its bottom so the bar covers nothing.
 *
 * The bar's height, its gap, the largest bottom inset any supported phone
 * reports, and one step of air. A constant on purpose: every tabbed screen
 * sets this in a `StyleSheet`, and their test suites render them without a
 * safe-area provider, so a hook there would be a second thing to mock in
 * five places. A padding a few points generous on a phone with a smaller
 * inset costs nothing a person can see.
 */
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_GAP +
  LARGEST_BOTTOM_INSET + spacing.lg;

const TABS: { key: Exclude<TabKey, "create">; label: string; Icon: typeof Home }[] = [
  { key: "home", label: "Home", Icon: Home },
  { key: "explore", label: "Explore", Icon: Compass },
  { key: "library", label: "Library", Icon: Bookmark },
  { key: "profile", label: "You", Icon: User },
];

export default function BottomTabs(
  { selected, onSelect }: { selected: TabKey; onSelect: (tab: TabKey) => void },
) {
  const insets = useSafeAreaInsets();
  return (
    // `box-none`: the dock spans the screen's width and must not eat taps in
    // the gap between the pill and the button, or above either.
    <View
      pointerEvents="box-none"
      testID="tab-bar-dock"
      style={[styles.dock, { bottom: TAB_BAR_GAP + insets.bottom }]}
    >
      {/* Bounded on a tablet or a web window: four tabs spread across 1000pt
          are four tabs a thumb cannot reach and an eye cannot group. */}
      <View pointerEvents="box-none" style={styles.row}>
        <View style={styles.bar} accessibilityRole="tablist">
          {TABS.map(({ key, label, Icon }) => {
            const active = selected === key;
            return (
              <Pressable
                key={key}
                onPress={() => onSelect(key)}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              >
                <View style={[styles.disc, active && styles.discActive]}>
                  <Icon
                    size={22}
                    strokeWidth={active
                      ? controls.iconButtonStrokeStrong
                      : controls.iconButtonStroke}
                    color={active ? colors.accent : colors.strong}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => onSelect("create")}
          accessibilityRole="button"
          accessibilityLabel="Create story"
          style={({ pressed }) => [styles.create, pressed && styles.createPressed]}
        >
          <Plus
            size={28}
            strokeWidth={controls.iconButtonStrokeStrong}
            color={colors.surface}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
  },
  row: {
    width: "100%",
    maxWidth: controls.tabBarMaxWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  /*
    An elevated surface, so the shadow draws the edge and there is no border
    (see `shadows`). `overlay` because the bar floats over content, and a
    `card` shadow under a pill that scrolls past text reads as a smudge.
  */
  bar: {
    flex: 1,
    height: TAB_BAR_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    boxShadow: shadows.overlay,
  },
  tab: {
    flex: 1,
    height: TAB_BAR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  disc: {
    width: controls.tabBarActiveDisc,
    height: controls.tabBarActiveDisc,
    borderRadius: controls.tabBarActiveDisc / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  discActive: { backgroundColor: colors.accentSoft },
  create: {
    width: controls.tabBarCreate,
    height: controls.tabBarCreate,
    borderRadius: controls.tabBarCreate / 2,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.primaryCta,
  },
  createPressed: { backgroundColor: colors.accentPressed },
});
