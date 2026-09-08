/**
 * Local-only behaviour: no Supabase project configured, exactly the state
 * this branch ships in before `codex/phrase-pillar-backend` merges. Every
 * save must still work, persist, and read back - see `lib/phrases.ts`'s
 * module doc comment for why "unavailable" is not "failed".
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isPhraseSaved,
  listDuePhrases,
  listSavedPhrases,
  recordPracticeOutcome,
  savePhrase,
  unsavePhrase,
} from "@/lib/phrases";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(async () => {
  await storage.clear();
});

const INPUT = {
  phrase: "lighthouse",
  sentence: "The old lighthouse stood alone.",
  storyId: "story-1",
  storyTitle: "The Last Lighthouse",
  chapterId: "chapter-1",
};

describe("phrases (no backend configured)", () => {
  it("starts empty", async () => {
    expect(await listSavedPhrases()).toEqual([]);
  });

  it("saves a phrase locally and reads it back", async () => {
    const saved = await savePhrase(INPUT);
    expect(saved).not.toBeNull();
    expect(saved?.phrase).toBe("lighthouse");
    expect(saved?.sentence).toBe(INPUT.sentence);
    expect(saved?.storyTitle).toBe(INPUT.storyTitle);

    const all = await listSavedPhrases();
    expect(all).toHaveLength(1);
    expect(all[0].phrase).toBe("lighthouse");
  });

  it("does not duplicate the same phrase saved twice in the same story", async () => {
    const first = await savePhrase(INPUT);
    const second = await savePhrase(INPUT);
    expect(second?.id).toBe(first?.id);

    const all = await listSavedPhrases();
    expect(all).toHaveLength(1);
  });

  it("treats the same word text as a different phrase in a different story", async () => {
    await savePhrase(INPUT);
    await savePhrase({ ...INPUT, storyId: "story-2", storyTitle: "Another Story" });

    const all = await listSavedPhrases();
    expect(all).toHaveLength(2);
  });

  it("is newly due immediately after saving", async () => {
    await savePhrase(INPUT);
    const due = await listDuePhrases();
    expect(due).toHaveLength(1);
    expect(due[0].phrase).toBe("lighthouse");
  });

  it("unsaves a phrase", async () => {
    const saved = await savePhrase(INPUT);
    const ok = await unsavePhrase(saved!.id);
    expect(ok).toBe(true);
    expect(await listSavedPhrases()).toEqual([]);
  });

  it("unsaving something never saved is a harmless no-op", async () => {
    expect(await unsavePhrase("does-not-exist")).toBe(true);
  });

  it("finds a saved phrase case-insensitively", async () => {
    const saved = await savePhrase(INPUT);
    const found = isPhraseSaved([saved!], INPUT.storyId, "LIGHTHOUSE");
    expect(found?.id).toBe(saved!.id);
  });

  it("pushes a correct answer's due date into the future and clears it on a wrong one", async () => {
    const saved = await savePhrase(INPUT);
    await recordPracticeOutcome(saved!.id, "know");

    const [afterKnow] = await listSavedPhrases();
    expect(Date.parse(afterKnow.dueAt)).toBeGreaterThan(Date.now());
    expect(afterKnow.reviewCount).toBe(1);

    await recordPracticeOutcome(saved!.id, "again");
    const [afterAgain] = await listSavedPhrases();
    expect(afterAgain.reviewCount).toBe(0);
    expect(Date.parse(afterAgain.dueAt)).toBeLessThanOrEqual(Date.now());
  });
});
