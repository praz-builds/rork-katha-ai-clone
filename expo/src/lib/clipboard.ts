/**
 * Copying text, on all three platforms this app builds for.
 *
 * `expo-clipboard` is the native path. It is loaded through a guarded dynamic
 * require rather than a top-level import for the same reason
 * `firebase-analytics.ts` does it: a jest run and an Expo web bundle both
 * resolve this module, and neither has the native module linked. A hard import
 * would take the whole reader down with it.
 *
 * Web goes to the browser's own clipboard API, which is what
 * `StoryDetailScreen`'s share already uses.
 *
 * The return value is honest. `false` means the text is NOT on the clipboard,
 * and the caller must not tell the reader it is.
 */
import { Platform } from "react-native";

type ClipboardModule = { setStringAsync: (text: string) => Promise<boolean> };

let cached: ClipboardModule | null | undefined;

function nativeClipboard(): ClipboardModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-clipboard") as Partial<ClipboardModule>;
    cached = typeof mod?.setStringAsync === "function"
      ? (mod as ClipboardModule)
      : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function copyText(text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (Platform.OS === "web") {
    try {
      await navigator.clipboard.writeText(trimmed);
      return true;
    } catch {
      // A browser can refuse this outright (no secure context, no user
      // gesture). Nothing else to try, and nothing was copied.
      return false;
    }
  }

  const mod = nativeClipboard();
  if (!mod) return false;
  try {
    await mod.setStringAsync(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Test seam. Resets the memoised module lookup. */
export function __resetClipboardForTests(): void {
  cached = undefined;
}
