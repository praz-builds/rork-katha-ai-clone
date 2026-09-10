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
   * Days until the next review, mirroring `phrase_practice.interval_days`.
   *
   * The server runs SM-2 and is the only authority on when a phrase comes back;
   * these two fields exist so the local optimistic estimate is computed with
   * the same formula rather than a second, incompatible one. Both are absent
   * until the phrase has been practised once, and both default to the column
   * defaults (0 days, ease 2.50) so a fresh phrase estimates the way the server
   * would.
   */
  intervalDays?: number;
  /** SM-2 ease factor, mirroring `phrase_practice.ease`. Clamped to [1.30, 3.50]. */
  ease?: number;
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
  /**
   * The language the reader is learning this phrase in.
   *
   * `saved_phrases.language` exists (00047, default `'English'`, and part of
   * the `(user_id, language, phrase_key)` uniqueness key), so the same phrase
   * can be saved once per language. `save-phrase` does not accept the field
   * yet, so today this is a local record only; see `saveManualPhrases`.
   */
  language?: string;
  /**
   * Where the phrase came from.
   *
   * `reader` means it was tapped out of a story and carries a real story,
   * chapter and sentence. `manual` means it was typed into Library's Notes
   * tab, so it has no story behind it and cannot be sent to `save-phrase`,
   * which requires a `storyId` and `chapterId` that resolve to real rows.
   */
  origin?: "reader" | "manual";
};

/** The Notes field accepts this many characters in one go. */
export const MAX_PHRASE_INPUT_LENGTH = 1000;

/**
 * One phrase may be this long, matching `saved_phrases_phrase_present` in
 * migration 00047. A longer entry is dropped rather than truncated: half a
 * sentence the reader did not ask for is worse than being told it was skipped.
 */
export const MAX_PHRASE_LENGTH = 160;

export type ParsedPhraseInput = {
  /** The phrases worth saving, in the order they were typed. */
  phrases: string[];
  /** How many were dropped for already existing, or for repeating within the input. */
  duplicates: number;
  /** How many were dropped for exceeding `MAX_PHRASE_LENGTH`. */
  tooLong: number;
  /** The raw text is longer than `MAX_PHRASE_INPUT_LENGTH`. Nothing is parsed. */
  overLimit: boolean;
};

/**
 * Turn one blob of typed text into individual phrases.
 *
 * Readers paste. They paste a comma-separated line from a notebook, a column
 * copied out of a spreadsheet with a newline between every entry, and often
 * both at once with trailing commas and blank lines throughout. All three
 * separators mean the same thing here, so all three are treated the same way,
 * and the result is deduped against what they have already saved so pasting
 * the same list twice does not double it.
 */
export function parsePhraseInput(
  raw: string,
  existing: readonly string[] = [],
): ParsedPhraseInput {
  if (raw.length > MAX_PHRASE_INPUT_LENGTH) {
    return { phrases: [], duplicates: 0, tooLong: 0, overLimit: true };
  }

  const seen = new Set(existing.map(normalizeForDedupe).filter(Boolean));
  const phrases: string[] = [];
  let duplicates = 0;
  let tooLong = 0;

  for (const candidate of raw.split(/[,\n\r;]+/)) {
    const phrase = candidate.trim().replace(/\s+/g, " ");
    if (!phrase) continue;
    if (phrase.length > MAX_PHRASE_LENGTH) {
      tooLong += 1;
      continue;
    }
    const key = normalizeForDedupe(phrase);
    if (!key || seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    phrases.push(phrase);
  }

  return { phrases, duplicates, tooLong, overLimit: false };
}

function normalizeForDedupe(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

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
const REINFORCEMENT_KEY = "katha.phrases.reinforcement.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether saved phrases should be woven back into new stories.
 *
 * WHAT THIS REACHES TODAY, EXACTLY: the device, and nothing else. Weaving
 * happens in `generate-story`, which calls `fetchPhraseSeeds` on
 * `saved_phrases` for the requesting user and consults no preference at all
 * (`backend/supabase/functions/_shared/phrases.ts`). There is no column to
 * write and no request field the function would read, so the honest thing is
 * to persist the reader's answer, keep it, and record what is missing rather
 * than send a flag into a void and call the feature done.
 *
 * Default on: a reader who has saved phrases while reading has already opted
 * into the behaviour by saving them, and defaulting off would make the
 * feature look broken the first time they looked for it.
 */
export async function isPhraseReinforcementEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(REINFORCEMENT_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export async function setPhraseReinforcementEnabled(
  enabled: boolean,
): Promise<void> {
  try {
    await AsyncStorage.setItem(REINFORCEMENT_KEY, enabled ? "true" : "false");
  } catch {
    // The switch has already moved in the interface for this session. A
    // storage failure costs the preference on next launch, which is not worth
    // interrupting the reader over.
  }
}

type Store = { phrases: SavedPhrase[] };

function localId(): string {
  return `phrase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeKey(storyId: string, phrase: string): string {
  return `${storyId}::${phrase.trim().toLowerCase()}`;
}

/**
 * The dedupe key for a phrase somebody TYPED rather than tapped.
 *
 * A manual phrase has no `storyId`, so `dedupeKey` collapses every one of
 * them onto `"::<text>"` and the language is not part of the identity. That
 * is wrong in the one direction this feature exists for: "gracias" saved
 * while learning Spanish and "gracias" saved while learning Portuguese are
 * two different things to practise, and the second was silently discarded as
 * a duplicate of the first. The language is what distinguishes them, so the
 * language is in the key.
 *
 * Captured phrases keep `dedupeKey`: they are already identified by the
 * story they came out of, which pins the language along with everything else.
 */
function manualDedupeKey(language: string, phrase: string): string {
  return `manual::${language}::${phrase.trim().toLowerCase()}`;
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

  // A manually typed phrase was never sent to `save-phrase` (it has no story
  // to send), so there is nothing on the server to delete. Calling anyway
  // hands `unsave-phrase` a local id it correctly rejects as not a UUID, and
  // the rejection would be read here as "a reachable server said no" - which
  // restores the row and makes the remove button look broken.
  if (removed.origin === "manual") return true;

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
    const nextPhrases = [...store.phrases];
    nextPhrases[index] = estimateNextReview(store.phrases[index], outcome);
    await writeStore({ phrases: nextPhrases });
  }

  const result = await invokeGuarded<{ practice?: RemotePracticeRow }>(
    "record-practice",
    { body: { phraseId, outcome: PRACTICE_OUTCOME_WIRE_VALUE[outcome] } },
  );

  // The server's answer replaces the estimate. `record_phrase_practice` is the
  // only place SM-2 actually runs, and its `due_at` is what every other device
  // will read back from `phrase_practice`; keeping the local guess after the
  // server has spoken is how two devices end up disagreeing about when a phrase
  // is due, with no way to tell which one is right.
  if (!result.ok) return;
  const practice = result.data?.practice;
  if (!practice || typeof practice.due_at !== "string") return;
  const dueAt = new Date(practice.due_at);
  if (Number.isNaN(dueAt.getTime())) return;

  // Re-read rather than reusing `store`: the write above happened, and this
  // function's serialization guarantees no *other* mutation interleaved, but
  // the snapshot in hand is stale by exactly that write.
  const latest = await readStore();
  const settled = latest.phrases.findIndex((entry) => entry.id === phraseId);
  if (settled < 0) return;
  const nextPhrases = [...latest.phrases];
  nextPhrases[settled] = {
    ...nextPhrases[settled],
    dueAt: dueAt.toISOString(),
    intervalDays: typeof practice.interval_days === "number"
      ? practice.interval_days
      : nextPhrases[settled].intervalDays,
    ease: typeof practice.ease === "number"
      ? practice.ease
      : Number(practice.ease) || nextPhrases[settled].ease,
  };
  await writeStore({ phrases: nextPhrases });
}

/** One row as `record-practice` returns it: the `phrase_practice` row itself. */
type RemotePracticeRow = {
  due_at?: unknown;
  interval_days?: unknown;
  /** `numeric(4,2)`, which PostgREST may serialise as a string. */
  ease?: unknown;
};

/** Column defaults from `phrase_practice` (00047), so the estimate starts where the server does. */
const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.5;

/**
 * The local optimistic estimate, using the server's own SM-2 arms.
 *
 * This used to double the interval on every `know` (1, 2, 4, 8 ... capped at
 * 30) while the server ran SM-2 with an ease factor. The two never agreed, so
 * a phrase practised on a phone came due on a different day than the same
 * phrase practised on a tablet, and a refresh could move a due date backwards
 * or forwards for no reason the reader could see.
 *
 * `PracticeOutcome` is a two-button UI ("again" / "know"), which maps onto the
 * server's four-outcome vocabulary as `again` and `good` -- so only those two
 * arms are reproduced here. It stays an estimate: the caller overwrites it with
 * the server's `due_at` the moment the call returns.
 */
function estimateNextReview(
  current: SavedPhrase,
  outcome: PracticeOutcome,
): SavedPhrase {
  const priorInterval = current.intervalDays ?? 0;
  const priorEase = current.ease ?? DEFAULT_EASE;

  // `good` leaves ease untouched; `again` costs 0.30. Mirrors the CASE in
  // `record_phrase_practice`.
  const ease = Math.min(
    MAX_EASE,
    Math.max(MIN_EASE, outcome === "again" ? priorEase - 0.3 : priorEase),
  );
  const intervalDays = outcome === "again"
    ? 0
    : priorInterval === 0
    ? 1
    : Math.ceil(priorInterval * ease);

  return {
    ...current,
    reviewCount: outcome === "know" ? current.reviewCount + 1 : 0,
    intervalDays,
    ease,
    dueAt: new Date(Date.now() + intervalDays * DAY_MS).toISOString(),
  };
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

/**
 * Save phrases typed into Library rather than tapped out of a story.
 *
 * THESE STAY ON THE DEVICE, AND THAT IS NOT AN OVERSIGHT. `save-phrase`
 * requires `storyId` and `chapterId` to be UUIDs that resolve to real rows,
 * and `save_phrase` (00047) re-checks that the chapter belongs to the story
 * before writing. A phrase somebody typed from memory has neither, so there
 * is no request this function could send that the endpoint would accept. It
 * writes locally, marks the record `manual`, and leaves `syncedAt` unset -
 * which `mergeSavedPhrases` already reads as "the reader's unsent work",
 * so a later server refresh lists them alongside the captured ones instead
 * of quietly deleting them.
 *
 * Returns the records it actually wrote, which is the input minus anything
 * already saved. An empty array means everything was already there.
 */
async function saveManualPhrasesImpl(
  phrases: readonly string[],
  language: string,
): Promise<SavedPhrase[]> {
  const store = await readStore();
  // Only manual phrases can collide with a manual phrase, and they collide
  // per language. Captured entries are keyed by their story and are simply
  // not in this namespace.
  const seen = new Set(
    store.phrases
      .filter((entry) => entry.origin === "manual")
      .map((entry) => manualDedupeKey(entry.language ?? "", entry.phrase)),
  );

  const now = new Date();
  const created: SavedPhrase[] = [];
  for (const candidate of phrases) {
    const phrase = candidate.trim();
    if (!phrase || phrase.length > MAX_PHRASE_LENGTH) continue;
    const key = manualDedupeKey(language, phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    created.push({
      id: localId(),
      phrase,
      // No story sentence exists for a typed phrase, and inventing one would
      // put words in the reader's mouth. The phrase stands as its own context.
      sentence: phrase,
      storyId: "",
      storyTitle: "",
      chapterId: "",
      createdAt: now.toISOString(),
      dueAt: now.toISOString(),
      reviewCount: 0,
      language,
      origin: "manual",
    });
  }

  if (created.length === 0) return [];
  await writeStore({ phrases: [...created, ...store.phrases] });
  return created;
}

export function saveManualPhrases(
  phrases: readonly string[],
  language: string,
): Promise<SavedPhrase[]> {
  return serialize(() => saveManualPhrasesImpl(phrases, language));
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

  // The `phrases` endpoint returns saved phrases, not practice rows, so a
  // remote entry carries no schedule and no story title: `fromRemoteRow` fills
  // `dueAt` with `saved_at`, `reviewCount` with 0 and `storyTitle` with "".
  // Taking those verbatim reset every practised phrase to "due now, never
  // reviewed" on each refresh and blanked the title in the practice list. The
  // local cache is the only place either lives, so it wins for those fields
  // while the server still wins for identity and existence.
  const localByKey = new Map(
    local.map((entry) => [dedupeKey(entry.storyId, entry.phrase), entry]),
  );
  const reconciled = validRemote.map((entry) => {
    const previous = localByKey.get(dedupeKey(entry.storyId, entry.phrase));
    if (!previous) return entry;
    return {
      ...entry,
      storyTitle: entry.storyTitle || previous.storyTitle,
      chapterId: entry.chapterId || previous.chapterId,
      dueAt: previous.dueAt,
      reviewCount: previous.reviewCount,
      intervalDays: previous.intervalDays,
      ease: previous.ease,
    };
  });
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
  return [...reconciled, ...localOnly];
}
