/**
 * The client and the server disagreed about when a phrase was due.
 *
 * `record_phrase_practice` (00047) runs SM-2: an ease factor between 1.30 and
 * 3.50, multiplied into the previous interval. The client ran something else
 * entirely -- 1, 2, 4, 8 ... days, doubling on every `know`, capped at 30 --
 * and then kept its own answer, ignoring the row the server sent back. So the
 * same phrase practised on a phone and on a tablet came due on different days,
 * and the reader had no way to tell which date was real.
 *
 * These tests pin the two halves of the fix: the local estimate uses the
 * server's own formula, and the server's answer replaces it when it arrives.
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

import { listSavedPhrases, recordPracticeOutcome, savePhrase } from "@/lib/phrases";

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  jest.clearAllMocks();
});

async function saveOne() {
  mockInvoke.mockResolvedValue({ data: { phrase_id: "server-1" }, error: null });
  const saved = await savePhrase({
    phrase: "hang in there",
    sentence: "Hang in there, she said.",
    storyId: "story-1",
    storyTitle: "A Story",
    chapterId: "chapter-1",
  });
  if (!saved) throw new Error("save failed");
  return saved;
}

/**
 * Whole days between now and an ISO timestamp, rounded to the nearest day.
 *
 * `+ 0` is not decoration: a due date of "now" is a millisecond or two in the
 * past by the time it is read back, so `Math.round` returns `-0`, and
 * `toBe(0)` fails on `-0` because it compares with `Object.is`. That made this
 * assertion pass alone and fail under the full suite's load, which is the
 * worst kind of test.
 */
function daysFromNow(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / (24 * 60 * 60 * 1000)) + 0;
}

it("adopts the due date the server computed", async () => {
  const saved = await saveOne();
  const serverDue = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
  mockInvoke.mockResolvedValue({
    data: { practice: { due_at: serverDue, interval_days: 6, ease: 2.5 } },
    error: null,
  });

  await recordPracticeOutcome(saved.id, "know");

  mockInvoke.mockResolvedValue({ data: { phrases: [] }, error: null });
  const [phrase] = await listSavedPhrases();
  expect(phrase.dueAt).toBe(serverDue);
  expect(phrase.intervalDays).toBe(6);
});

it("estimates with the server's own formula when the call does not answer", async () => {
  const saved = await saveOne();
  // A 404 is the "endpoint not deployed" case: the optimistic local write is
  // all the reader has, so it had better be the same shape SM-2 would produce.
  mockInvoke.mockResolvedValue({ data: null, error: { context: { status: 404 } } });

  // First `know` on a never-practised phrase: SM-2's `good` arm on
  // interval_days = 0 gives exactly 1 day, not the old doubling ladder.
  await recordPracticeOutcome(saved.id, "know");
  let [phrase] = await readLocal();
  expect(daysFromNow(phrase.dueAt)).toBe(1);
  expect(phrase.ease).toBeCloseTo(2.5);

  // Second `know`: ceil(1 * 2.5) = 3. The old client said 2.
  await recordPracticeOutcome(saved.id, "know");
  [phrase] = await readLocal();
  expect(phrase.intervalDays).toBe(3);
  expect(daysFromNow(phrase.dueAt)).toBe(3);
});

it("an `again` sends the phrase back to due-now and costs ease, as SM-2 does", async () => {
  const saved = await saveOne();
  mockInvoke.mockResolvedValue({ data: null, error: { context: { status: 404 } } });

  await recordPracticeOutcome(saved.id, "know");
  await recordPracticeOutcome(saved.id, "again");

  const [phrase] = await readLocal();
  expect(phrase.intervalDays).toBe(0);
  expect(daysFromNow(phrase.dueAt)).toBe(0);
  expect(phrase.ease).toBeCloseTo(2.2);
  expect(phrase.reviewCount).toBe(0);
});

it("a refresh does not reset a phrase the reader has already practised", async () => {
  // The `phrases` endpoint returns saved phrases, not practice rows, so a
  // remote row carries no schedule at all. Taking it verbatim made every
  // refresh mark every practised phrase due again.
  const saved = await saveOne();
  const serverDue = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString();
  mockInvoke.mockResolvedValue({
    data: { practice: { due_at: serverDue, interval_days: 9, ease: 2.5 } },
    error: null,
  });
  await recordPracticeOutcome(saved.id, "know");

  mockInvoke.mockResolvedValue({
    data: {
      phrases: [{
        id: "server-1",
        phrase_text: "hang in there",
        story_id: "story-1",
        chapter_id: "chapter-1",
        sentence: "Hang in there, she said.",
        saved_at: "2026-09-01T00:00:00.000Z",
      }],
    },
    error: null,
  });
  const [phrase] = await listSavedPhrases();
  expect(phrase.dueAt).toBe(serverDue);
  expect(phrase.storyTitle).toBe("A Story");
});

/** The local cache, read back without letting a sync overwrite it. */
async function readLocal() {
  mockInvoke.mockResolvedValueOnce({ data: null, error: { context: { status: 404 } } });
  return listSavedPhrases();
}
