/**
 * The remote phrase sync had never worked.
 *
 * `phrases` selects database columns, so the wire shape is snake_case
 * (`phrase_text`, `story_id`, `saved_at`), and the client models a phrase in
 * camelCase. Nothing translated between them, so every remote row failed the
 * shape check and was discarded.
 *
 * That failed silently in the worst way: discarding everything looks exactly
 * like the server having nothing, so the reader saw their local cache and no
 * error, forever.
 */
const store: Record<string, string> = {};
const mockInvoke = jest.fn();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: jest.fn(async () => {}),
}));

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
  isSupabaseConfigured: true,
}));

jest.mock("@/lib/session", () => ({ bootstrapUser: () => Promise.resolve({ id: "u1" }) }));

import { listSavedPhrases } from "@/lib/phrases";

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  jest.clearAllMocks();
});

const wireRow = {
  id: "server-1",
  phrase_text: "hang in there",
  story_id: "story-1",
  chapter_id: "chapter-1",
  sentence: "Hang in there, she said.",
  saved_at: "2026-09-01T00:00:00.000Z",
  language: "English",
};

it("reads a phrase the server actually returned", async () => {
  mockInvoke.mockResolvedValue({ data: { phrases: [wireRow] }, error: null });

  const phrases = await listSavedPhrases();

  expect(phrases.map((entry) => entry.phrase)).toContain("hang in there");
  expect(phrases[0].storyId).toBe("story-1");
});

it("does not resurrect a phrase deleted on another device", async () => {
  // First refresh: the server knows about it, so it is stored as synced.
  mockInvoke.mockResolvedValue({ data: { phrases: [wireRow] }, error: null });
  await listSavedPhrases();

  // Second refresh: the server no longer returns it, because it was deleted
  // elsewhere. Keeping every local-only row would bring it back forever.
  mockInvoke.mockResolvedValue({ data: { phrases: [] }, error: null });
  const after = await listSavedPhrases();

  expect(after.map((entry) => entry.phrase)).not.toContain("hang in there");
});

it("keeps a locally saved phrase the server has not seen yet", async () => {
  // A row that never synced is the reader's unsent work and must survive a
  // refresh that does not mention it.
  store["katha.phrases.v1"] = JSON.stringify({
    phrases: [{
      id: "local-1",
      phrase: "call it a day",
      sentence: "Let us call it a day.",
      storyId: "story-2",
      storyTitle: "A Story",
      chapterId: "chapter-1",
      createdAt: "2026-09-02T00:00:00.000Z",
      dueAt: "2026-09-02T00:00:00.000Z",
      reviewCount: 0,
    }],
  });
  mockInvoke.mockResolvedValue({ data: { phrases: [] }, error: null });

  const after = await listSavedPhrases();
  expect(after.map((entry) => entry.phrase)).toContain("call it a day");
});
