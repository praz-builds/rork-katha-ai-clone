import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * How this device listens.
 *
 * Device-local for the same reason every other listening preference is
 * (`preferredVoiceId` in `lib/voices.ts`, which this follows): it is a fact
 * about how this phone is being listened to, not about the person, and it costs
 * nothing to re-pick. Do not give it a database column.
 */

const AUTO_ADVANCE_KEY = "katha.autoplay.v1";

/**
 * Whether finishing a chapter starts the next one.
 *
 * On by default: an audiobook that stops dead at every chapter is the odd
 * behaviour, not the safe one, and the reader who wants it off has a switch
 * beside the speed control. The default is what applies until the stored value
 * resolves, so the first chapter of a session never stalls on a storage read.
 */
export const AUTO_ADVANCE_DEFAULT = true;

export async function autoAdvanceEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(AUTO_ADVANCE_KEY);
    if (value === "on") return true;
    if (value === "off") return false;
    return AUTO_ADVANCE_DEFAULT;
  } catch {
    return AUTO_ADVANCE_DEFAULT;
  }
}

export async function setAutoAdvanceEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTO_ADVANCE_KEY, enabled ? "on" : "off");
  } catch {
    // A preference that cannot be saved is re-picked next time. Nothing else
    // depends on it.
  }
}
