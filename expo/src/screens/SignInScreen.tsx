import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmailCodeAuth } from "@/components/onboarding/EmailCodeAuth";
import { colors } from "@/theme";

/**
 * Sign-in, reached from the profile tab and from every `onRequireSignIn`
 * gate.
 *
 * It used to be the full character flow (`CharacterOnboarding` with
 * `purpose="read"`): bridge, a character sheet, a portrait wait, THEN email
 * and code. Somebody who tapped "Sign in" got walked through making a person
 * before they were ever asked for an address, which is backwards for a
 * returning reader who already has one. This is just the email and the code:
 * `EmailCodeAuth` with no progress row, because a two-step sign-in has
 * nothing worth counting steps against.
 */
export default function SignInScreen({
  onDone,
  onExit,
}: {
  /**
   * The code verified. May return a promise: `EmailCodeAuth` keeps this screen
   * busy until it settles, so the app does not navigate while the account it
   * just signed into is still being rebuilt.
   */
  onDone: () => void | Promise<void>;
  /**
   * Back, from the email step. Omitted when sign-in is the only way forward:
   * after a sign-out or a deletion there is no session behind this screen, so
   * an exit would land on tabs with no identity and mint a guest to fix it --
   * the very thing D1 removes.
   */
  onExit?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <EmailCodeAuth
        headline="Welcome back."
        sub="Enter your email and we'll send a code."
        onBack={onExit}
        onVerified={() => onDone()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
