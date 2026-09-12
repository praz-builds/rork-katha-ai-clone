/**
 * The offline store must never run in a shipped build.
 *
 * `saveCharacterToLibrary` falls back to AsyncStorage when
 * `isSupabaseConfigured` is false. That exists for the offline walkthrough and
 * for Jest. In a release build the same condition means the bundle shipped
 * without `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` -- and then the onboarding
 * character appears to save, survives the session, and exists nowhere the
 * account can reach. Nothing errors, so nothing is ever reported.
 *
 * Loud beats lost: report it and throw. The fallback stays for `__DEV__`.
 */

const mockCaptureError = jest.fn();
const mockSetItem = jest.fn((..._args: unknown[]) => Promise.resolve());

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: { from: jest.fn(), auth: {}, functions: { invoke: jest.fn() } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: async () => null }));
jest.mock("@/lib/analytics", () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: (...args: unknown[]) => mockSetItem(...args),
  removeItem: jest.fn(() => Promise.resolve()),
}));

/* eslint-disable import/first */
import { saveCharacterToLibrary } from "@/lib/saved-characters";
/* eslint-enable import/first */

const realDev = __DEV__;

afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = realDev;
  mockCaptureError.mockReset();
  mockSetItem.mockClear();
});

it("keeps the local store in development", async () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;

  await expect(saveCharacterToLibrary({ name: "Naina" })).resolves.toMatchObject(
    { name: "Naina" },
  );
  expect(mockSetItem).toHaveBeenCalled();
  expect(mockCaptureError).not.toHaveBeenCalled();
});

it("refuses it, loudly, in a build that should have had a backend", async () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

  await expect(saveCharacterToLibrary({ name: "Naina" })).rejects.toThrow(
    /Saving is unavailable/,
  );
  // Nothing was written to the device: a save that cannot reach the account
  // must not look like it worked.
  expect(mockSetItem).not.toHaveBeenCalled();
  expect(mockCaptureError).toHaveBeenCalledWith(
    expect.objectContaining({
      severity: "critical",
      errorCode: "supabase_unconfigured_in_release",
    }),
  );
});
