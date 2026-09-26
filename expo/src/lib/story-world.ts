import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  COUNTRY_CODES,
  COUNTRY_WORLDS,
  type CountryCode,
} from "../../../backend/supabase/functions/_shared/story-world-countries";

/**
 * Story world: the reader's standing cultural preference for new stories.
 *
 * Chosen once on You and sent as `cultural_setting` with every new story. The
 * server maps the id to a fixed phrase (`CULTURAL_SETTINGS` in
 * `backend/supabase/functions/_shared/types.ts`); the two lists must hold the
 * same ids, and an id the server does not know is dropped there, never refused.
 *
 * The brief always wins. A preference only shapes what the idea, the setting
 * and the cast's names leave open, so "a heist in 1920s Chicago" is still set
 * in Chicago for somebody whose default is India.
 *
 * Device-local, like the listening preferences in `listen-prefs.ts`: it costs
 * nothing to re-pick and it needs no column. `global` is the default and is
 * never sent -- it means "infer from the brief", which is how every story was
 * written before the preference existed.
 */
export const STORY_WORLDS: readonly { id: StoryWorld; label: string; hint: string }[] = [
  { id: "global", label: "Anywhere", hint: "Katha follows each story's own cues" },
  ...COUNTRY_CODES.map((id) => ({ id, label: COUNTRY_WORLDS[id].label, hint: "" })),
] as const;

export type StoryWorld = "global" | CountryCode;
export { COUNTRY_CODES };

export const DEFAULT_STORY_WORLD: StoryWorld = "global";

const STORAGE_KEY = "katha.story-world.v1";

const KNOWN: ReadonlySet<string> = new Set(STORY_WORLDS.map((world) => world.id));

export function isStoryWorld(value: unknown): value is StoryWorld {
  return typeof value === "string" && KNOWN.has(value);
}

export function storyWorldLabel(world: StoryWorld): string {
  return STORY_WORLDS.find((entry) => entry.id === world)?.label ?? "Anywhere";
}

let current: StoryWorld = DEFAULT_STORY_WORLD;
let hydrated: Promise<void> | null = null;
/** Set by any explicit choice; a restore never overrides one. */
let chosenThisSession = false;
const listeners = new Set<() => void>();

function publish(next: StoryWorld) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/**
 * Reads the stored preference once. Safe to call repeatedly; App calls it at
 * start-up so a story created before You is ever opened still carries it.
 *
 * A choice made while the read is in flight is not overwritten by it: the
 * stored value only applies if nothing has been chosen yet this session.
 */
export function hydrateStoryWorld(): Promise<void> {
  if (!hydrated) {
    hydrated = AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!chosenThisSession && isStoryWorld(value)) publish(value);
      })
      .catch(() => {
        // Unreadable storage means "no preference", which is the default.
      });
  }
  return hydrated;
}

export function currentStoryWorld(): StoryWorld {
  return current;
}

export async function setStoryWorld(next: StoryWorld): Promise<void> {
  chosenThisSession = true;
  publish(next);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Kept for this session; re-picked next time if the write failed.
  }
}

/**
 * The request field, or nothing. `global` is omitted rather than sent, so a
 * request with no preference is byte-identical to one from before it existed.
 */
export function storyWorldRequestField(
  world: unknown = current,
): { cultural_setting: Exclude<StoryWorld, "global"> } | Record<string, never> {
  // Validated here as well as on the server: this helper promises "a known id
  // or nothing", whatever a caller hands it.
  if (!isStoryWorld(world) || world === "global") return {};
  return { cultural_setting: world };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStoryWorld(): StoryWorld {
  return useSyncExternalStore(subscribe, currentStoryWorld, currentStoryWorld);
}

/** Test seam. */
export function __resetStoryWorld() {
  current = DEFAULT_STORY_WORLD;
  hydrated = null;
  chosenThisSession = false;
  listeners.clear();
}
