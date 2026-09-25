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
  fetchReaderPreferences,
  homePlaceProblem,
  MAX_SPOKEN_LANGUAGES,
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
  expect(readerPreferencesSummary({ spokenLanguages: [], homePlace: null }))
    .toBe("Add the languages you speak and your city");
  expect(readerPreferencesSummary({ spokenLanguages: ["hi", "en"], homePlace: "Pune" }))
    .toBe("Hindi, English · Pune");
  expect(readerPreferencesSummary({ spokenLanguages: [], homePlace: "Lagos" }))
    .toBe("Lagos");
});

it("saves through the profile function and reports a failed write as null", async () => {
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["ta"], homePlace: "Chennai" },
    error: null,
  });
  await expect(
    saveReaderPreferences({ spokenLanguages: ["ta"], homePlace: " Chennai " }),
  ).resolves.toEqual({ spokenLanguages: ["ta"], homePlace: "Chennai" });
  expect(mockInvoke).toHaveBeenCalledWith("profile", {
    body: { action: "set_preferences", spokenLanguages: ["ta"], homePlace: "Chennai" },
  });

  mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("offline") });
  await expect(
    saveReaderPreferences({ spokenLanguages: [], homePlace: null }),
  ).resolves.toBeNull();
});

it("reads the saved preferences, dropping ids this build does not know", async () => {
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["hi", "zz"], homePlace: "Pune" },
    error: null,
  });
  await expect(fetchReaderPreferences()).resolves.toEqual({
    spokenLanguages: ["hi"],
    homePlace: "Pune",
  });
});
