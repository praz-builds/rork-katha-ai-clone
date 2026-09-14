import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bookmark, Compass, Home, Plus, User } from "lucide-react-native";
import { colors, radius, shadows, spacing } from "@/theme";
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
export const TAB_BAR_HEIGHT = 64;
/** Between the bar's bottom edge and the safe-area inset. */
const TAB_BAR_GAP = spacing.md;
/** The Create button. A touch larger than the pill so it reads as the object in front. */
const CREATE_SIZE = 60;
/** The selected tab's disc. */
const ACTIVE_DISC = 44;
/** The room a screen's last row needs above the bar, on the largest bottom inset. */
const LARGEST_BOTTOM_INSET = 34;

/**
 * How much a scrolling screen must pad its bottom so the bar covers nothing.
 *
 * The bar's height, its gap, the largest home-indicator inset any supported
 * phone has, and one step of air. A constant on purpose: every tabbed screen
 * sets this in a `StyleSheet`, where a hook cannot go, and a padding a few
 * points generous on a phone with no inset costs nothing a person can see.
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
      style={[styles.dock, { bottom: TAB_BAR_GAP + insets.bottom }]}
    >
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
                  strokeWidth={active ? 2.4 : 2}
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
        hitSlop={4}
        style={({ pressed }) => [styles.create, pressed && styles.createPressed]}
      >
        <Plus size={28} strokeWidth={2.6} color={colors.surface} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
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
    width: ACTIVE_DISC,
    height: ACTIVE_DISC,
    borderRadius: ACTIVE_DISC / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  discActive: { backgroundColor: colors.accentSoft },
  create: {
    width: CREATE_SIZE,
    height: CREATE_SIZE,
    borderRadius: CREATE_SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.primaryCta,
  },
  createPressed: { backgroundColor: colors.accentPressed },
});
