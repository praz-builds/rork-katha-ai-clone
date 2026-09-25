/**
 * Until the whole app reads the locale files, a Portuguese or Spanish phone
 * still gets English, so the You tab is never half translated.
 */
jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "pt" }] }));

/* eslint-disable import/first */
import i18n, { FOLLOW_DEVICE_LOCALE } from "@/i18n";
/* eslint-enable import/first */

it("stays English on a Portuguese phone while the app is not fully wired", () => {
  expect(FOLLOW_DEVICE_LOCALE).toBe(false);
  expect(i18n.language).toBe("en");
});
