import { Linking, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal-links";
import { colors } from "@/theme";

/**
 * "By continuing you agree to our Terms and Privacy Policy." with both nouns
 * as real links (`source-of-truth/ONBOARDING_FLOW.md`, the W5 Terms row).
 *
 * Nested `Text` links rather than buttons: they sit inside the sentence, and a
 * screen reader announces each as a link with its own name. Neither advances
 * the flow -- they open the page in the system browser and nothing else. The
 * email step and the character flow's consent line both render this, so the
 * two cannot drift apart again.
 */
export function LegalConsentLine({ style }: { style?: StyleProp<TextStyle> }) {
  const open = (url: string) => {
    Linking.openURL(url).catch(() => {
      // No browser to hand it to. The same pages are linked from You.
    });
  };
  return (
    <Text style={style}>
      By continuing you agree to our{" "}
      <Text
        accessibilityRole="link"
        accessibilityLabel="Terms of Use"
        onPress={() => open(TERMS_URL)}
        style={styles.link}
      >
        Terms
      </Text>{" "}
      and{" "}
      <Text
        accessibilityRole="link"
        accessibilityLabel="Privacy Policy"
        onPress={() => open(PRIVACY_URL)}
        style={styles.link}
      >
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  // Ink and an underline, not the accent: orange on the onboarding cream is
  // under 3:1, and these are the two words on the screen with legal weight.
  link: {
    color: colors.strong,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
