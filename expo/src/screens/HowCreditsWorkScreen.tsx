import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import HowCreditsWork from "@/components/credits/HowCreditsWork";
import { colors, profileHeading, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * How credits work — the prices, and nothing to buy.
 *
 * WHY IT IS ITS OWN SCREEN. Profile had two rows pointing at one destination:
 * "Credits · Get more" and "How credits work" both opened `CreditsScreen`, at
 * the top, which leads with Paid options. Somebody who tapped the row that
 * promises an explanation was answering a question by being shown a shop.
 * Two intents, two screens.
 *
 * WHY IT IS THIS THIN. `components/credits/HowCreditsWork` is already the
 * whole content, lifted verbatim from `source-of-truth/CREDITS_AND_PRICING.md`
 * §1 and rendered identically wherever it appears. The screen is a header and
 * that component; if a price is wrong the document is what changes, then that
 * component, never this file.
 *
 * NOTHING TO BUY HERE, DELIBERATELY. There is no packs sheet, no plan card and
 * no balance pill. The reader who wants to spend arrives from the other row,
 * and the Get credits screen keeps a link back to this one so the explanation
 * stays one tap from the purchase rather than inlined above it.
 */
export default function HowCreditsWorkScreen({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.pagePad}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={styles.backButton}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>How credits work</Text>
        </View>

        <View testID="how-credits-work-screen">
          <HowCreditsWork />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    // Overrides `sharedStyles.backButton`, which is the wide pill used on
    // pages that have no title beside it. Here it is a bare chevron sitting
    // to the left of the heading, as on Audiobook voices and Get credits.
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -8,
    },
    title: { ...profileHeading, color: colors.ink, fontSize: 26 },
  }),
};
