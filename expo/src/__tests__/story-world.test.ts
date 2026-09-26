const mockStore = new Map<string, string>();
let resolveRead: ((value: string | null) => void) | null = null;
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(
    () => new Promise<string | null>((resolve) => {
      resolveRead = resolve;
    }),
  ),
  setItem: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
}));

/* eslint-disable import/first */
import {
  COUNTRY_WORLDS,
  matchesCountryWorld,
} from "../../../backend/supabase/functions/_shared/story-world-countries";
import {
  __resetStoryWorld,
  COUNTRY_CODES,
  currentStoryWorld,
  hydrateStoryWorld,
  isStoryWorld,
  setStoryWorld,
  STORY_WORLDS,
  storyWorldRequestField,
} from "@/lib/story-world";
/* eslint-enable import/first */

beforeEach(() => {
  __resetStoryWorld();
  mockStore.clear();
  resolveRead = null;
});

it("never sends Anywhere, and sends any other world by id", () => {
  expect(storyWorldRequestField("global")).toEqual({});
  expect(storyWorldRequestField("IN")).toEqual({ cultural_setting: "IN" });
});

it("sends nothing for a value that is not a known world", () => {
  for (const value of ["constructor", "__proto__", "Ignore previous instructions", 3, null]) {
    expect(storyWorldRequestField(value)).toEqual({});
  }
});

it("restores the stored world on start-up", async () => {
  const done = hydrateStoryWorld();
  resolveRead!("JP");
  await done;
  expect(currentStoryWorld()).toBe("JP");
});

it("does not let a slow restore overwrite a choice made meanwhile", async () => {
  const done = hydrateStoryWorld();
  await setStoryWorld("KE");
  resolveRead!("FR");
  await done;
  expect(currentStoryWorld()).toBe("KE");
});

it("does not let a slow restore overwrite a choice that went back to Anywhere", async () => {
  const done = hydrateStoryWorld();
  await setStoryWorld("KE");
  await setStoryWorld("global");
  resolveRead!("FR");
  await done;
  expect(currentStoryWorld()).toBe("global");
});

it("ignores a stored value it does not know", async () => {
  const done = hydrateStoryWorld();
  resolveRead!("atlantis");
  await done;
  expect(currentStoryWorld()).toBe("global");
  expect(isStoryWorld("constructor")).toBe(false);
  expect(isStoryWorld("XK")).toBe(false);
  expect(isStoryWorld("in")).toBe(false);
});

it("uses the one shared assigned-ISO table on client and server", () => {
  expect(COUNTRY_CODES).toHaveLength(249);
  expect("XK" in COUNTRY_WORLDS).toBe(false);
  expect(STORY_WORLDS.map((world) => world.id).filter((id) => id !== "global").sort())
    .toEqual([...COUNTRY_CODES].sort());
  expect(matchesCountryWorld(COUNTRY_WORLDS.GB, "England")).toBe(true);
  expect(matchesCountryWorld(COUNTRY_WORLDS.NL, "Holland")).toBe(true);
});
