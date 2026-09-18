/**
 * The offline generation path keeps a chosen title.
 *
 * With Supabase unconfigured, `generateStory` never builds a request body and
 * `localGeneratedStory` makes the story on the device. It used to invent a
 * title unconditionally, so the same titled draft came back under a different
 * name depending on which path ran.
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: { auth: { getSession: jest.fn() } },
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

/* eslint-disable import/first */
import { generateStory } from "@/lib/api";
import type { CreateDraft } from "@/types/domain";
/* eslint-enable import/first */

const draft: CreateDraft = {
  primaryGenre: "fantasy",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "Two rival cartographers map the same valley and find it moves",
  language: "English",
  characters: [],
};

async function generateOffline(input: CreateDraft) {
  const pending = generateStory(input, "req-local");
  await jest.runAllTimersAsync();
  return await pending;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("uses the draft's title, trimmed, when there is one", async () => {
  const story = await generateOffline({ ...draft, title: "  The Moving Valley " });
  expect(story.title).toBe("The Moving Valley");
});

it("still names an untitled or blank-titled draft itself", async () => {
  for (const title of [undefined, "   "]) {
    const story = await generateOffline({ ...draft, title });
    expect(story.title.trim()).not.toBe("");
  }
});
