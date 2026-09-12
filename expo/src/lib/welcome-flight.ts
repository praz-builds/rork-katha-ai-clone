import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Has the welcome credits flight already played on this device?
 *
 * The flight is a once-per-install moment: three coins leave the welcome
 * screen and land in Home's credits pill, which is how the reader learns where
 * their balance lives. Played a second time it is not a lesson, it is an
 * animation standing between the reader and the app they just paid for.
 *
 * Device-local on purpose. The flight teaches the location of a control in
 * THIS install's UI, so it has nothing to say to a second device, and putting
 * it on the profile row would mean a network round trip in front of a 400ms
 * animation.
 *
 * `v1` is in the key because the flight's meaning is tied to where the pill
 * sits. If the header ever moves, the replacement flight wants a fresh key
 * rather than a silent no-op for every existing install.
 */
const WELCOME_FLIGHT_KEY = "katha.welcome-flight.v1";

/**
 * Defaults to `false` on any storage failure, which means "play it".
 *
 * The wrong answer to guess is `true`: that silently deletes the one moment
 * that shows the reader where credits live, and nothing downstream can tell
 * that it was a storage error rather than a repeat launch. Replaying a 400ms
 * animation is the cheap mistake.
 */
export async function hasPlayedWelcomeFlight(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WELCOME_FLIGHT_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markWelcomeFlightPlayed(): Promise<void> {
  try {
    await AsyncStorage.setItem(WELCOME_FLIGHT_KEY, "1");
  } catch {
    // Best effort. A write that fails costs one repeat of the flight, never a
    // blocked hand-off into Home.
  }
}
