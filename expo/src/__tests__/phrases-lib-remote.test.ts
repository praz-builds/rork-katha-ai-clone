/**
 * The reachable-backend paths of `lib/phrases.ts`.
 *
 * `phrases-lib.test.ts` covers what happens with no Supabase project
 * configured at all - the state this branch actually ships in. This file
 * covers the OTHER two outcomes a configured project can hand back: a real
 * success, and a real, reachable rejection. Only the second of those two is
 * allowed to undo the local write `savePhrase`/`unsavePhrase` already made.
 */
jest.mock("@react-native-async-storage/async-storage", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@react-native-async-storage/async-storage/jest/async-storage-mock");
});

const mockInvoke = jest.fn();
const mockBootstrapUser = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.mock("@/lib/session", () => ({
  bootstrapUser: (...args: unknown[]) => mockBootstrapUser(...args),
}));

/* eslint-disable import/first */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  listSavedPhrases,
  recordPracticeOutcome,
  savePhrase,
  unsavePhrase,
} from "@/lib/phrases";
/* eslint-enable import/first */

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const INPUT = {
  phrase: "lighthouse",
  sentence: "The old lighthouse stood alone.",
  storyId: "story-1",
  storyTitle: "The Last Lighthouse",
  chapterId: "chapter-1",
};

function httpError(status: number) {
  return { context: { status } };
}

beforeEach(async () => {
  await storage.clear();
  mockInvoke.mockReset();
  // Default every call the test does not explicitly queue a response for -
  // most usefully `listSavedPhrases`' own background "phrases" refetch - to
  // "not deployed yet", so a test asserting on ONE call's outcome is not
  // derailed by an incidental second one.
  mockInvoke.mockResolvedValue({ data: null, error: httpError(404) });
  mockBootstrapUser.mockReset().mockResolvedValue({
    userId: "user-1",
    balance: 0,
    isAnonymous: true,
    welcomeGranted: false,
    rateLimited: false,
  });
});

describe("savePhrase against a reachable backend", () => {
  it("adopts the server's phrase id on success", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { phrase_id: "server-1" }, error: null });

    const saved = await savePhrase(INPUT);

    expect(saved?.id).toBe("server-1");
    expect(mockInvoke).toHaveBeenCalledWith("save-phrase", {
      body: {
        phrase: "lighthouse",
        storyId: "story-1",
        chapterId: "chapter-1",
        sentence: INPUT.sentence,
      },
    });
  });

  it("rolls the local write back when a reachable server declines the save", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(422) });

    const saved = await savePhrase(INPUT);

    expect(saved).toBeNull();
    expect(await listSavedPhrases()).toEqual([]);
  });

  it("keeps the local write when the function has not been deployed yet (404)", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(404) });

    const saved = await savePhrase(INPUT);

    expect(saved).not.toBeNull();
    expect(saved?.phrase).toBe("lighthouse");
  });
});

describe("listSavedPhrases against a reachable backend", () => {
  /**
   * A row shaped the way `phrases` ACTUALLY returns one.
   *
   * This fixture used to be camelCase, matching the client's model rather than
   * the wire. That is why the contract mismatch survived: the endpoint selects
   * database columns and returns `phrase_text` and `story_id`, so every real
   * response was discarded while this test passed against a shape the server
   * never sends.
   */
  function remotePhrase(overrides: Partial<Record<string, unknown>> = {}) {
    const now = new Date().toISOString();
    return {
      id: "remote-1",
      phrase_text: "harbor",
      sentence: "The harbor was quiet.",
      story_id: "story-9",
      chapter_id: "chapter-9",
      language: "English",
      saved_at: now,
      ...overrides,
    };
  }

  it("does not let an empty remote list hide a phrase saved locally that the server has not got", async () => {
    // Saved while the backend was unreachable (404) - local-only, never synced.
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(404) });
    const saved = await savePhrase(INPUT);
    expect(saved).not.toBeNull();

    // Now the backend IS reachable, but it knows nothing about this phrase.
    mockInvoke.mockResolvedValueOnce({ data: { phrases: [] }, error: null });
    const all = await listSavedPhrases();

    expect(all.map((entry) => entry.id)).toContain(saved!.id);
  });

  it("does not let a partial remote list drop a locally saved phrase it omits", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(404) });
    const saved = await savePhrase(INPUT);
    expect(saved).not.toBeNull();

    // The server answers with a phrase saved on another device, but not the
    // one this device saved locally and never synced.
    mockInvoke.mockResolvedValueOnce({
      data: { phrases: [remotePhrase()] },
      error: null,
    });
    const all = await listSavedPhrases();

    const ids = all.map((entry) => entry.id);
    expect(ids).toContain(saved!.id);
    expect(ids).toContain("remote-1");
  });

  it("still adopts a phrase the remote list has that the local cache does not", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { phrases: [remotePhrase()] },
      error: null,
    });

    const all = await listSavedPhrases();

    expect(all.map((entry) => entry.id)).toEqual(["remote-1"]);
  });
});

describe("unsavePhrase against a reachable backend", () => {
  async function seedSavedPhrase() {
    mockInvoke.mockResolvedValueOnce({ data: { phrase_id: "server-1" }, error: null });
    return (await savePhrase(INPUT))!;
  }

  it("stays removed on success", async () => {
    const saved = await seedSavedPhrase();
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });

    expect(await unsavePhrase(saved.id)).toBe(true);
    expect(await listSavedPhrases()).toEqual([]);
  });

  it("restores the phrase when a reachable server refuses the unsave", async () => {
    const saved = await seedSavedPhrase();
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(500) });

    const ok = await unsavePhrase(saved.id);

    expect(ok).toBe(false);
    const all = await listSavedPhrases();
    expect(all.map((entry) => entry.id)).toContain(saved.id);
  });
});

describe("recordPracticeOutcome", () => {
  it("sends exactly one request per answer, success or not", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { phrase_id: "server-1" }, error: null });
    const saved = await savePhrase(INPUT);
    mockInvoke.mockClear();

    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(500) });
    await recordPracticeOutcome(saved!.id, "know");

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("record-practice", {
      body: { phraseId: saved!.id, outcome: "good" },
    });
  });

  // `record-practice`'s OUTCOMES set (and the `record_phrase_practice` SQL
  // check constraint behind it) only ever accepted
  // again/hard/good/easy - the wire value this call used to send, "know",
  // was rejected on every single successful practice answer. This is the
  // regression test for that: the literal outcome value the real client puts
  // on the wire must be one the server actually accepts.
  it("maps the two-button UI vocabulary onto the server's accepted outcome values", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { phrase_id: "server-1" }, error: null });
    const saved = await savePhrase(INPUT);
    mockInvoke.mockClear();

    const SERVER_OUTCOMES = new Set(["again", "hard", "good", "easy"]);

    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    await recordPracticeOutcome(saved!.id, "know");
    const knowCall = mockInvoke.mock.calls.at(-1)!;
    expect(knowCall[0]).toBe("record-practice");
    const knowOutcome = (knowCall[1] as { body: { outcome: string } }).body.outcome;
    expect(SERVER_OUTCOMES.has(knowOutcome)).toBe(true);

    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    await recordPracticeOutcome(saved!.id, "again");
    const againCall = mockInvoke.mock.calls.at(-1)!;
    const againOutcome = (againCall[1] as { body: { outcome: string } }).body.outcome;
    expect(SERVER_OUTCOMES.has(againOutcome)).toBe(true);
    expect(againOutcome).toBe("again");
  });
});
