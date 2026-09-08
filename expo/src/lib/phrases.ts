/**
 * The client half of phrase capture and practice.
 *
 * Katha is becoming a language-learning surface: a reader taps a word or a
 * sentence in a story and it becomes something they practise later. The
 * backend contract (`save-phrase`, `unsave-phrase`, `phrases`,
 * `record-practice`) lives on a branch that has not merged into this one, so
 * every network call here is guarded the way `getLibrary` in `lib/api.ts`
 * guards a call that might not have anything to answer it: never throw,
 * never surface an error to the reader, fall back to a safe local result.
 *
 * WHAT "GUARDED" MEANS HERE, PRECISELY. A missing endpoint (`isSupabaseConfigured`
 * false, or the function 404s because it has not been deployed yet) is treated
 * as UNAVAILABLE, not FAILED: the local record this module just wrote stands,
 * and the caller's optimistic UI stays as it is. A REACHABLE function that
 * comes back with a real error is a genuine FAILURE: the local write this
 * module just made is rolled back and the caller is told so, so its own
 * optimistic UI can roll back too. That distinction is what lets this feature
 * work fully offline today and fail safely once the backend lands, without a
 * second code path for either case.
 *
 * Local persistence is the source of truth for the UI. It is written FIRST and
 * synced best-effort second, so a reader on a plane keeps every phrase they
 * saved, and the Practice surface in Library always has something to show
 * even when the sync never lands.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type SavedPhrase = {
  id: string;
  phrase: string;
  sentence: string;
  storyId: string;
  storyTitle: string;
  chapterId: string;
  createdAt: string;
  /** ISO timestamp. Due for practice once this has passed. */
  dueAt: string;
  /** How many practice rounds this phrase has been through, for the interval bump. */
  reviewCount: number;
  /**
   * ISO timestamp of the last time the server confirmed this phrase, if ever.
   *
   * Absent means the row is the reader's unsent work and must survive a refresh
   * that does not mention it. Present means the server knew about it once, so
   * its absence from a later complete answer means it was deleted elsewhere and
   * must NOT be resurrected. Without this discriminator the two cases are
   * indistinguishable and one of them is always handled wrongly.
   */
  syncedAt?: string;
};

export type PracticeOutcome = "know" | "again";

/**
 * The wire vocabulary is `again | hard | good | easy` -- `record-practice`'s
 * `OUTCOMES` set and the `record_phrase_practice` SQL function's check
 * constraint (migration `00047`) both already agree on exactly those four
 * values, and the SQL function's spaced-repetition math is keyed off them.
 * That is canonical; this two-button UI is a simplified front end for it, not
 * a second vocabulary the server is expected to learn. `again` already lines
 * up; `know` maps to `good`, the ordinary "I got this" answer -- `hard` and
 * `easy` stay reachable for a future finer-grained UI without another server
 * change. Sending `outcome` unmapped, as this used to, is a value the
 * server's `OUTCOMES` set and SQL check constraint both always rejected.
 */
const PRACTICE_OUTCOME_WIRE_VALUE: Record<PracticeOutcome, "again" | "good"> = {
  again: "again",
  know: "good",
};

const STORE_KEY = "katha.phrases.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

type Store = { phrases: SavedPhrase[] };

function localId(): string {
  return `phrase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeKey(storyId: string, phrase: string): string {
  return `${storyId}::${phrase.trim().toLowerCase()}`;
}

async function readStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return { phrases: [] };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [] };
  } catch {
    return { phrases: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort local cache. A write failure here must never surface to
    // the reader mid-story; the in-memory result already returned stands for
    // this session even if it does not survive a restart.
  }
}

/**
 * Serialises the read-modify-write cycle every mutation performs.
 *
 * Saving, unsaving and recording practice each read the whole store, change one
 * entry and write it all back. Two of those overlapping meant the second read
 * saw the state from before the first write landed, so a save could erase a
 * save. Tapping two words quickly is enough to hit it, which is exactly what
 * reading with phrase capture on looks like.
 *
 * The chain swallows failures rather than rejecting: one bad mutation must not
 * strand every later one behind it.
 */
let storeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(mutate: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(mutate, mutate);
  storeQueue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Call an unshipped edge function without ever throwing.
 *
 * Mirrors the guard `getLibrary` and `fetchCoverState` already use in
 * `lib/api.ts`: no configured Supabase project, or an unreachable/undeployed
 * function, resolves to `{ ok: false, unavailable: true }` rather than an
 * exception. A function that IS deployed but declines the request resolves to
 * `{ ok: false, unavailable: false }`, which callers here treat as a real
 * failure worth rolling back for.
 */
async function invokeGuarded<T>(
  name: string,
  init: { method: "GET" } | { method?: "POST"; body: Record<string, unknown> },
): Promise<{ ok: true; data: T } | { ok: false; unavailable: boolean }> {
  if (!isSupabaseConfigured) return { ok: false, unavailable: true };

  try {
    await bootstrapUser();
  } catch {
    // Not `unavailable`. Unavailable means "this endpoint is not deployed yet",
    // and the caller keeps its optimistic local write on that basis. A
    // configured backend that cannot authenticate is a real failure, and
    // reporting it as unavailable made a save look like it had succeeded
    // locally when the server had rejected the caller outright.
    return { ok: false, unavailable: false };
  }

  try {
    const { data, error } = await supabase.functions.invoke(
      name,
      init.method === "GET" ? { method: "GET" } : { body: init.body },
    );
    if (error) {
      const status = (error as { context?: { status?: number } })?.context?.status;
      return { ok: false, unavailable: status === 404 };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, unavailable: true };
  }
}

/**
 * One row as `phrases` actually returns it.
 *
 * The endpoint selects database columns, so the wire shape is snake_case:
 * `phrase_text`, `story_id`, `saved_at`. The client models a phrase in
 * camelCase. Nothing translated between them, so every remote row failed the
 * shape check and was discarded -- the sync has never worked, silently, because
 * discarding everything looks exactly like the server having nothing.
 */
type RemotePhraseRow = {
  id?: unknown;
  phrase_text?: unknown;
  story_id?: unknown;
  chapter_id?: unknown;
  sentence?: unknown;
  saved_at?: unknown;
  language?: unknown;
};

/** Map a wire row to the client's shape, or null when it is not usable. */
function fromRemoteRow(row: RemotePhraseRow): SavedPhrase | null {
  const phrase = typeof row.phrase_text === "string" ? row.phrase_text : null;
  const storyId = typeof row.story_id === "string" ? row.story_id : null;
  const id = typeof row.id === "string" ? row.id : null;
  if (!phrase || !storyId || !id) return null;

  const savedAt = typeof row.saved_at === "string"
    ? row.saved_at
    : new Date().toISOString();
  return {
    id,
    phrase,
    sentence: typeof row.sentence === "string" ? row.sentence : phrase,
    storyId,
    // Straight from the server, so by definition synced.
    syncedAt: savedAt,
    // The wire row carries no story title; the local cache is the only place it
    // exists, so a merged entry keeps whatever the local copy knew.
    storyTitle: "",
    chapterId: typeof row.chapter_id === "string" ? row.chapter_id : "",
    createdAt: savedAt,
    dueAt: savedAt,
    reviewCount: 0,
  };
}

/** All saved phrases, newest first. Local cache, refreshed from the server when it answers. */
export async function listSavedPhrases(): Promise<SavedPhrase[]> {
  const store = await readStore();
  const result = await invokeGuarded<{ phrases?: RemotePhraseRow[] }>("phrases", { method: "GET" });
  if (result.ok && Array.isArray(result.data?.phrases)) {
    const remote = result.data.phrases
      .map(fromRemoteRow)
      .filter((entry): entry is SavedPhrase => entry !== null);
    const merged = mergeSavedPhrases(store.phrases, remote);
    await writeStore({ phrases: merged });
    return sortByCreatedAtDesc(merged);
  }
  return sortByCreatedAtDesc(store.phrases);
}

/** The subset due for practice right now. */
export async function listDuePhrases(): Promise<SavedPhrase[]> {
  const all = await listSavedPhrases();
  const now = Date.now();
  return all.filter((entry) => Date.parse(entry.dueAt) <= now);
}

export function isPhraseSaved(
  phrases: readonly SavedPhrase[],
  storyId: string,
  phrase: string,
): SavedPhrase | undefined {
  const key = dedupeKey(storyId, phrase);
  return phrases.find((entry) => dedupeKey(entry.storyId, entry.phrase) === key);
}

/**
 * Save a phrase or sentence.
 *
 * Writes local storage first, then attempts to sync. Returns the saved
 * record on success (whether or not the sync landed) and `null` only when a
 * reachable server explicitly declined the save - the one case that must roll
 * the caller's optimistic UI back.
 */
async function savePhraseImpl(input: {
  phrase: string;
  sentence: string;
  storyId: string;
  storyTitle: string;
  chapterId: string;
}): Promise<SavedPhrase | null> {
  const phrase = input.phrase.trim();
  const sentence = input.sentence.trim() || phrase;
  if (!phrase) return null;

  const store = await readStore();
  const key = dedupeKey(input.storyId, phrase);
  const existing = store.phrases.find((entry) => dedupeKey(entry.storyId, entry.phrase) === key);
  if (existing) return existing;

  const now = new Date();
  const record: SavedPhrase = {
    id: localId(),
    phrase,
    sentence,
    storyId: input.storyId,
    storyTitle: input.storyTitle,
    chapterId: input.chapterId,
    createdAt: now.toISOString(),
    dueAt: now.toISOString(),
    reviewCount: 0,
  };

  const nextStore: Store = { phrases: [record, ...store.phrases] };
  await writeStore(nextStore);

  const result = await invokeGuarded<{ phrase_id?: string }>("save-phrase", {
    body: { phrase, storyId: input.storyId, chapterId: input.chapterId, sentence },
  });

  if (result.ok) {
    const serverId = typeof result.data?.phrase_id === "string" ? result.data.phrase_id : record.id;
    const synced = { ...record, id: serverId };
    await writeStore({ phrases: [synced, ...store.phrases] });
    return synced;
  }

  if (result.unavailable) {
    // The backend has not landed yet. The local save stands - see the module
    // doc comment for why that is the correct behaviour, not a shortcut.
    return record;
  }

  // A reachable server said no. Undo the local write and report failure.
  await writeStore(store);
  return null;
}

/**
 * Unsave a phrase. Removes it locally first; restores it if a reachable
 * server refuses the request, returning `false` so the caller can roll its
 * own optimistic UI back too.
 */
async function unsavePhraseImpl(phraseId: string): Promise<boolean> {
  const store = await readStore();
  const removed = store.phrases.find((entry) => entry.id === phraseId);
  if (!removed) return true;

  const nextPhrases = store.phrases.filter((entry) => entry.id !== phraseId);
  await writeStore({ phrases: nextPhrases });

  const result = await invokeGuarded("unsave-phrase", { body: { phraseId } });

  if (result.ok || result.unavailable) return true;

  // Reachable server declined. Restore the phrase and tell the caller.
  await writeStore(store);
  return false;
}

/**
 * Record a practice outcome and bump the local spaced-repetition schedule.
 *
 * A wrong answer resets the phrase to due-now; a right answer doubles the
 * interval since the last one (starting at a day), capped at a month, so a
 * phrase a reader keeps getting right is asked about less and less often. The
 * network call is fire-and-forget best-effort - a missing or failing server
 * never blocks the local schedule from moving on, and this function is called
 * exactly once per answer regardless of how the call resolves.
 */
async function recordPracticeOutcomeImpl(
  phraseId: string,
  outcome: PracticeOutcome,
): Promise<void> {
  const store = await readStore();
  const index = store.phrases.findIndex((entry) => entry.id === phraseId);
  if (index >= 0) {
    const current = store.phrases[index];
    const reviewCount = outcome === "know" ? current.reviewCount + 1 : 0;
    const intervalDays = outcome === "know"
      ? Math.min(30, Math.max(1, current.reviewCount === 0 ? 1 : 2 ** current.reviewCount))
      : 0;
    const dueAt = new Date(Date.now() + intervalDays * DAY_MS).toISOString();
    const nextPhrases = [...store.phrases];
    nextPhrases[index] = { ...current, reviewCount, dueAt };
    await writeStore({ phrases: nextPhrases });
  }

  await invokeGuarded("record-practice", {
    body: { phraseId, outcome: PRACTICE_OUTCOME_WIRE_VALUE[outcome] },
  });
}

function sortByCreatedAtDesc(phrases: readonly SavedPhrase[]): SavedPhrase[] {
  return [...phrases].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}


/*
 * Public mutation entry points.
 *
 * Each one funnels through `serialize` so the read-modify-write cycle inside
 * cannot interleave with another. Tapping two words in quick succession used to
 * lose one of them: both reads saw the store before either write landed, and
 * the second write overwrote the first with a snapshot that never contained it.
 */

export function savePhrase(
  input: Parameters<typeof savePhraseImpl>[0],
): Promise<SavedPhrase | null> {
  return serialize(() => savePhraseImpl(input));
}

export function unsavePhrase(phraseId: string): Promise<boolean> {
  return serialize(() => unsavePhraseImpl(phraseId));
}

export function recordPracticeOutcome(
  ...args: Parameters<typeof recordPracticeOutcomeImpl>
): ReturnType<typeof recordPracticeOutcomeImpl> {
  return serialize(() => recordPracticeOutcomeImpl(...args));
}

/**
 * Union a remote phrase list onto the local cache rather than replacing it.
 *
 * The remote answer is the source of truth for what it contains, but an
 * empty or partial list is not proof the reader has nothing saved - it may
 * mean the sync of a locally-saved phrase has not landed yet (the "backend
 * not deployed" and "offline write, sync pending" cases `invokeGuarded`'s
 * doc comment describes), or the server call itself only returned a subset.
 * Replacing the cache with that answer permanently hid every phrase saved
 * locally that the server had not got, including ones with no way back
 * short of saving them again. Keeping local-only entries around instead
 * costs nothing: the next successful sync reconciles them the normal way,
 * the same `savePhrase` sync path already does for a single fresh save.
 */
function mergeSavedPhrases(
  local: readonly SavedPhrase[],
  remote: readonly SavedPhrase[],
): SavedPhrase[] {
  const validRemote = remote.filter(
    (entry): entry is SavedPhrase =>
      Boolean(entry) && typeof entry.phrase === "string" && typeof entry.storyId === "string",
  );
  const remoteKeys = new Set(
    validRemote.map((entry) => dedupeKey(entry.storyId, entry.phrase)),
  );
  // Only local entries the server has not seen are kept, and only while they
  // are still unsynced. Keeping every local-only row unconditionally meant a
  // phrase deleted on another device came back on the next refresh: the server
  // had correctly stopped returning it, and this treated its absence as "not
  // synced yet" rather than "deleted".
  //
  // `syncedAt` is the discriminator. A row that has never synced is the
  // reader's unsent work and must survive; a row that HAS synced and is now
  // absent from a complete server answer was deleted elsewhere.
  const localOnly = local.filter((entry) =>
    !remoteKeys.has(dedupeKey(entry.storyId, entry.phrase)) && !entry.syncedAt
  );
  return [...validRemote, ...localOnly];
}
