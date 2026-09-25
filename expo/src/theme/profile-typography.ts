import type { TextStyle } from "react-native";
import { fonts } from "./theme";

/**
 * Profile is product UI, not reader/story prose. Every Profile, public-profile,
 * Journey, and Profile-owned sheet heading or metric uses this one approved
 * UI treatment. Keeping it here makes the no-display-font contract executable
 * without relying on Node-only source-file reads in the Expo test runtime.
 */
export const profileHeading = {
  fontFamily: fonts.ui,
  fontWeight: "700",
} as const satisfies TextStyle;
