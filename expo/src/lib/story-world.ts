import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

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
 * in Chicago for somebody who prefers South Asian stories.
 *
 * Device-local, like the listening preferences in `listen-prefs.ts`: it costs
 * nothing to re-pick and it needs no column. `global` is the default and is
 * never sent -- it means "infer from the brief", which is how every story was
 * written before the preference existed.
 */
export const STORY_WORLDS = [
  { id: "global", label: "Anywhere", hint: "Katha follows each story's own cues" },
  { id: "south_asian", label: "South Asian", hint: "India, Pakistan, Bangladesh, Sri Lanka, Nepal" },
  { id: "east_asian", label: "East Asian", hint: "China, Japan, Korea, Taiwan" },
  { id: "southeast_asian", label: "Southeast Asian", hint: "Indonesia, the Philippines, Vietnam, Thailand, Malaysia" },
  { id: "middle_eastern", label: "Middle Eastern & North African", hint: "From Morocco to the Gulf" },
  { id: "african", label: "African", hint: "Sub-Saharan Africa" },
  { id: "latin_american", label: "Latin American", hint: "Mexico to Argentina" },
  { id: "caribbean", label: "Caribbean", hint: "The islands and their diaspora" },
  { id: "european", label: "European", hint: "From Lisbon to Warsaw" },
  { id: "north_american", label: "North American", hint: "The United States and Canada" },
  { id: "oceanian", label: "Oceanian", hint: "Australia, New Zealand, the Pacific Islands" },
] as const;

export type StoryWorld = (typeof STORY_WORLDS)[number]["id"];

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
  world: StoryWorld = current,
): { cultural_setting: Exclude<StoryWorld, "global"> } | Record<string, never> {
  return world === "global" ? {} : { cultural_setting: world };
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
