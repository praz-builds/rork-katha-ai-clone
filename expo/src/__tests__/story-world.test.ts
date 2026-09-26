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

it("offers exactly the assigned ISO codes the server accepts, plus the client-only default", () => {
  // Read from the backend source rather than copied, so the two lists cannot
  // drift: an id the server does not know is silently dropped there.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as { readFileSync: (file: string, encoding: "utf8") => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as { join: (...parts: string[]) => string };
  const source = fs.readFileSync(
    path.join(__dirname, "../../../backend/supabase/functions/_shared/types.ts"),
    "utf8",
  );
  const block = source.match(/export const CULTURAL_COUNTRY_CODES = \[([\s\S]*?)\] as const;/);
  expect(block).not.toBeNull();
  const serverIds = [...block![1].matchAll(/"([A-Z]{2})"/g)].map((m) => m[1]);
  expect(serverIds).toHaveLength(249);
  expect(COUNTRY_CODES).toHaveLength(249);
  expect(STORY_WORLDS.map((world) => world.id).filter((id) => id !== "global").sort())
    .toEqual([...serverIds].sort());
});
