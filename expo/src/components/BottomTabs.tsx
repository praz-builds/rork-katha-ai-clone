import { Pressable, StyleSheet, Text, View } from "react-native";
import { Bookmark, Compass, Home, Plus, User } from "lucide-react-native";
import { colors, fonts, spacing } from "@/theme";
import type { TabKey } from "@/types/domain";

/* ─────────────────────────────── Shared Components ─────────────────────────────── */

export default function BottomTabs(
  { selected, onSelect }: { selected: TabKey; onSelect: (tab: TabKey) => void },
) {
  const tabs: {
    key: TabKey;
    label: string;
    Icon: typeof Home;
    raised?: boolean;
  }[] = [
    { key: "home", label: "Home", Icon: Home },
    { key: "explore", label: "Explore", Icon: Compass },
    { key: "create", label: "", Icon: Plus, raised: true },
    { key: "library", label: "Library", Icon: Bookmark },
    { key: "profile", label: "You", Icon: User },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map(({ key, label, Icon, raised }) => {
        const active = selected === key;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            accessibilityLabel={raised ? "Create story" : label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={styles.tabItem}
          >
            <View
              style={[
                raised ? styles.raisedTab : styles.flatTab,
                active && !raised && styles.flatTabActive,
              ]}
            >
              <Icon
                size={raised ? 26 : 20}
                color={raised
                  ? colors.surface
                  : active
                  ? colors.accent
                  : colors.tertiary}
              />
            </View>
            {!raised && label
              ? (
                <Text
                  style={[styles.tabLabel, active && styles.tabLabelActive]}
                >
                  {label}
                </Text>
              )
              : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    minHeight: 76,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    shadowColor: "#3D2D1B",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
  },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  flatTab: {
    width: 38,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  flatTabActive: { backgroundColor: colors.accentSoft },
  raisedTab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -26,
  },
  tabLabel: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    // 11 is the ramp's floor (`type.micro`). At 10 a tab label was below the
    // size iOS treats as legible and shrank further under a fontScale of 0.85.
    fontSize: 11,
    fontWeight: "800",
  },
  tabLabelActive: { color: colors.accent },

  /* ── Legacy / onboarding (kept for reference screens) ── */
});
