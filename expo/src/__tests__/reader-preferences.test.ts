/**
 * Global preferences: languages and home (2026-09-25).
 *
 * The ids are a closed list held in three places -- this client, the edge
 * function's `SPOKEN_LANGUAGES` and the migration's CHECK -- and a mismatch
 * fails quietly: a language the client offers and the server refuses is a
 * Save that never works. The backend test pins the migration against the
 * function; this pins the client against the function.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const mockInvoke = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn(() => Promise.resolve()) }));

/* eslint-disable import/first */
import {
  cachedReaderPreferences,
  clearReaderPreferencesCache,
  fetchReaderPreferences,
  homePlaceProblem,
  MAX_SPOKEN_LANGUAGES,
  REFUSAL_COPY,
  readerPreferencesSummary,
  saveReaderPreferences,
  SPOKEN_LANGUAGES,
  toggleSpokenLanguage,
} from "@/lib/reader-preferences";
/* eslint-enable import/first */

beforeEach(() => mockInvoke.mockReset());

it("offers exactly the server's languages, in its order", () => {
  const source = readFileSync(
    resolve(
      __dirname,
      "../../../backend/supabase/functions/_shared/reader-preferences.ts",
    ),
    "utf8",
  );
  const block = source.match(/export const SPOKEN_LANGUAGES = \{([\s\S]*?)\} as const/);
  expect(block).not.toBeNull();
  const serverIds = [...block![1].matchAll(/^\s+([a-z]+):/gm)].map((m) => m[1]);
  expect(SPOKEN_LANGUAGES.map((l) => l.id)).toEqual(serverIds);
});

it("toggles in tap order and refuses a pick past the cap rather than dropping one", () => {
  let picked = toggleSpokenLanguage([], "hi");
  picked = toggleSpokenLanguage(picked, "en");
  picked = toggleSpokenLanguage(picked, "mr");
  expect(picked).toEqual(["hi", "en", "mr"]);
  expect(MAX_SPOKEN_LANGUAGES).toBe(3);
  expect(toggleSpokenLanguage(picked, "ta")).toEqual(["hi", "en", "mr"]);
  expect(toggleSpokenLanguage(picked, "en")).toEqual(["hi", "mr"]);
});

it("accepts a city in any script and says why it refuses one", () => {
  expect(homePlaceProblem("")).toBeNull();
  expect(homePlaceProblem("São Paulo")).toBeNull();
  expect(homePlaceProblem("पुणे")).toBeNull();
  expect(homePlaceProblem("St. John's")).toBeNull();
  expect(homePlaceProblem("a".repeat(61))).toMatch(/60/);
  expect(homePlaceProblem("Pune <script>")).toMatch(/letters/);
});

it("summarises the row in the reader's own terms", () => {
  expect(readerPreferencesSummary({ spokenLanguages: [], unrecognisedLanguages: [], homePlace: null }))
    .toBe("Add the languages you speak and your city");
  expect(readerPreferencesSummary({ spokenLanguages: ["hi", "en"], unrecognisedLanguages: [], homePlace: "Pune" }))
    .toBe("Hindi, English · Pune");
  expect(readerPreferencesSummary({ spokenLanguages: [], unrecognisedLanguages: [], homePlace: "Lagos" }))
    .toBe("Lagos");
});

it("saves through the profile function, and tells a refusal from a failure", async () => {
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["ta"], homePlace: "Chennai" },
    error: null,
  });
  await expect(
    saveReaderPreferences({ spokenLanguages: ["ta"], unrecognisedLanguages: [], homePlace: " Chennai " }),
  ).resolves.toEqual({ saved: { spokenLanguages: ["ta"], unrecognisedLanguages: [], homePlace: "Chennai" } });
  expect(mockInvoke).toHaveBeenCalledWith("profile", {
    body: { action: "set_preferences", spokenLanguages: ["ta"], homePlace: "Chennai" },
  });

  mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("offline") });
  await expect(
    saveReaderPreferences({ spokenLanguages: [], unrecognisedLanguages: [], homePlace: null }),
  ).resolves.toEqual({ failed: true });

  // A client one language ahead of the deployed function: reader copy keyed
  // off the server's code, never its developer message.
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: Object.assign(new Error("fn"), {
      context: {
        status: 400,
        json: () =>
          Promise.resolve({
            error: "spokenLanguages has an unknown language",
            reason: "unknown_language",
          }),
      },
    }),
  });
  const unknown = await saveReaderPreferences({ spokenLanguages: ["en"], unrecognisedLanguages: [], homePlace: null });
  expect(unknown).toEqual({
    refused:
      "One of these languages is not available yet. Remove the one you added last and try again.",
  });
  expect(JSON.stringify(unknown)).not.toContain("spokenLanguages");

  // The tombstone's 404 says so; a gateway 404 without a reason does not.
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: Object.assign(new Error("fn"), {
      context: {
        status: 404,
        json: () => Promise.resolve({ error: "Not found", reason: "account_deleted" }),
      },
    }),
  });
  expect(
    await saveReaderPreferences({ spokenLanguages: ["en"], unrecognisedLanguages: [], homePlace: null }),
  ).toEqual({ refused: "This account has been deleted, so nothing can be saved to it." });
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: Object.assign(new Error("fn"), {
      context: { status: 404, json: () => Promise.resolve({ message: "Function not found" }) },
    }),
  });
  expect(
    await saveReaderPreferences({ spokenLanguages: ["en"], unrecognisedLanguages: [], homePlace: null }),
  ).toEqual({ failed: true });
});

it("a save that lands after the account changed is reported to nobody", async () => {
  let resolveSave: (value: unknown) => void = () => {};
  mockInvoke.mockReturnValueOnce(new Promise((r) => { resolveSave = r; }));
  const pending = saveReaderPreferences({ spokenLanguages: ["hi"], unrecognisedLanguages: [], homePlace: "Pune" });
  await Promise.resolve();
  clearReaderPreferencesCache();
  resolveSave({ data: { spokenLanguages: ["hi"], homePlace: "Pune" }, error: null });
  await expect(pending).resolves.toEqual({ stale: true });
  expect(cachedReaderPreferences()).toBeNull();
});

it("holds the last value for a return visit, and forgets it when the account changes", async () => {
  clearReaderPreferencesCache();
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["hi"], homePlace: "Pune" },
    error: null,
  });
  await fetchReaderPreferences();
  expect(cachedReaderPreferences()).toEqual({ spokenLanguages: ["hi"], unrecognisedLanguages: [], homePlace: "Pune" });
  mockInvoke.mockClear();
  await expect(fetchReaderPreferences({ maxAgeMs: 60_000 })).resolves.toEqual({
    spokenLanguages: ["hi"],
    unrecognisedLanguages: [],
    homePlace: "Pune",
  });
  expect(mockInvoke).not.toHaveBeenCalled();

  clearReaderPreferencesCache();
  expect(cachedReaderPreferences()).toBeNull();
});

it("drops an in-flight answer when the account changes", async () => {
  clearReaderPreferencesCache();
  let answer: ((value: unknown) => void) | undefined;
  mockInvoke.mockReturnValueOnce(new Promise((resolve) => {
    answer = resolve;
  }));
  const pending = fetchReaderPreferences();
  await Promise.resolve();
  await Promise.resolve();
  // The request belongs to the account that just left. It may finish, but it
  // must neither fill nor return a city into the next Profile session.
  clearReaderPreferencesCache();
  answer!({ data: { spokenLanguages: ["hi"], homePlace: "Pune" }, error: null });
  await expect(pending).resolves.toBeNull();
  expect(cachedReaderPreferences()).toBeNull();
});

it("keeps an id this build does not know apart, rather than dropping it", async () => {
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["hi", "zz"], homePlace: "Pune" },
    error: null,
  });
  await expect(fetchReaderPreferences()).resolves.toEqual({
    spokenLanguages: ["hi"],
    unrecognisedLanguages: ["zz"],
    homePlace: "Pune",
  });
});

it("sends an unknown id back untouched, so a save cannot erase it", async () => {
  // SPOKEN_LANGUAGES is append-only by contract, so a reader can hold a
  // language a older build does not list. The read is lenient; the write used
  // not to be, and Save silently removed it from their account.
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["hi", "zz"], homePlace: "Pune" },
    error: null,
  });
  await saveReaderPreferences({
    spokenLanguages: ["hi"],
    unrecognisedLanguages: ["zz"],
    homePlace: "Pune",
  });
  expect(mockInvoke).toHaveBeenCalledWith("profile", {
    body: {
      action: "set_preferences",
      spokenLanguages: ["hi", "zz"],
      homePlace: "Pune",
    },
  });
});

it("has reader copy for every refusal code the server can send", () => {
  const source = readFileSync(
    resolve(
      __dirname,
      "../../../backend/supabase/functions/_shared/reader-preferences.ts",
    ),
    "utf8",
  );
  const union = source.match(
    /export type PreferencesRefusalReason =([\s\S]*?);/,
  );
  expect(union).not.toBeNull();
  const serverCodes = [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  expect(serverCodes.length).toBeGreaterThan(0);
  expect(Object.keys(REFUSAL_COPY).sort()).toEqual([...serverCodes].sort());
});
