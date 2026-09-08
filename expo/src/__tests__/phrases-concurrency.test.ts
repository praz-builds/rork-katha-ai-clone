/**
 * Two saves in quick succession must not erase each other.
 *
 * Saving, unsaving and recording practice each read the whole store, change one
 * entry and write it all back. Two of those overlapping meant the second read
 * saw the state from before the first write landed, so a save could silently
 * erase a save. Tapping two words quickly is enough to hit it, which is exactly
 * what reading with phrase capture on looks like.
 *
 * This needs AsyncStorage mocked with real await boundaries: without them the
 * interleaving the bug depends on cannot happen, and the test would pass
 * against the broken code.
 */
const store: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    await Promise.resolve();
    return store[key] ?? null;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    await Promise.resolve();
    store[key] = value;
  }),
  removeItem: jest.fn(async () => {}),
}));

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));

import { listSavedPhrases, savePhrase } from "@/lib/phrases";

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

const base = {
  storyId: "story-1",
  storyTitle: "The Lion of the Hills",
  chapterId: "chapter-1",
};

it("keeps both phrases when two saves overlap", async () => {
  await Promise.all([
    savePhrase({ ...base, phrase: "hang in there", sentence: "Hang in there." }),
    savePhrase({ ...base, phrase: "call it a day", sentence: "Call it a day." }),
  ]);

  const saved = await listSavedPhrases();
  const phrases = saved.map((entry) => entry.phrase).sort();
  expect(phrases).toEqual(["call it a day", "hang in there"]);
});

it("saving the same phrase twice concurrently yields one entry", async () => {
  await Promise.all([
    savePhrase({ ...base, phrase: "hang in there", sentence: "Hang in there." }),
    savePhrase({ ...base, phrase: "hang in there", sentence: "Hang in there." }),
  ]);

  const saved = await listSavedPhrases();
  expect(saved.filter((entry) => entry.phrase === "hang in there")).toHaveLength(1);
});
