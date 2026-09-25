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
  expect(storyWorldRequestField("caribbean")).toEqual({ cultural_setting: "caribbean" });
});

it("restores the stored world on start-up", async () => {
  const done = hydrateStoryWorld();
  resolveRead!("east_asian");
  await done;
  expect(currentStoryWorld()).toBe("east_asian");
});

it("does not let a slow restore overwrite a choice made meanwhile", async () => {
  const done = hydrateStoryWorld();
  await setStoryWorld("african");
  resolveRead!("european");
  await done;
  expect(currentStoryWorld()).toBe("african");
});

it("does not let a slow restore overwrite a choice that went back to Anywhere", async () => {
  const done = hydrateStoryWorld();
  await setStoryWorld("african");
  await setStoryWorld("global");
  resolveRead!("european");
  await done;
  expect(currentStoryWorld()).toBe("global");
});

it("ignores a stored value it does not know", async () => {
  const done = hydrateStoryWorld();
  resolveRead!("atlantis");
  await done;
  expect(currentStoryWorld()).toBe("global");
  expect(isStoryWorld("constructor")).toBe(false);
});

it("offers exactly the ids the server accepts, plus the client-only default", () => {
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
  const block = source.match(/export const CULTURAL_SETTINGS = \{([\s\S]*?)\} as const;/);
  expect(block).not.toBeNull();
  const serverIds = [...block![1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  expect(serverIds.length).toBeGreaterThan(0);
  expect(STORY_WORLDS.map((world) => world.id).filter((id) => id !== "global").sort())
    .toEqual([...serverIds].sort());
});
