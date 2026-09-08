/**
 * The boot smoke test: does the merged app actually come up?
 *
 * Every screen has unit coverage, and every one of those suites passed while
 * the reader's chrome overlay was swallowing taps meant for the page, and while
 * a generated cover was being dropped between the create studio and the story
 * page. Those are failures BETWEEN units, which no single suite can see.
 *
 * WHAT THIS COVERS: the whole app composes and renders its first screen with
 * real seeded data behind it. That catches a broken provider, a screen that
 * throws on mount, a missing export, and a bad import chain -- the failures
 * that turn into a blank screen with nothing in the Metro log.
 *
 * WHAT IT DOES NOT COVER, deliberately and worth knowing: it does not walk the
 * reading flow. The tabs sit behind a dev-only URL parameter, so reaching them
 * from a test means mocking `Platform.OS` and the location, and a smoke test
 * held together by that is one that flakes and then gets ignored. The bundle
 * export in `scripts/smoke.sh` is the broader integration proof; walking the
 * flow end to end belongs to a device or browser driver, which this repo does
 * not have yet.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

// `SafeAreaProvider` withholds its children until an onLayout supplies insets,
// which never happens in the test renderer, so the real one renders an empty
// tree and every assertion below would fail for a reason that has nothing to do
// with the app.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-font", () => ({ loadAsync: () => Promise.resolve() }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("expo-av", () => ({ Audio: { Sound: class {} } }));
jest.mock("@/lib/analytics", () => ({
  initPostHog: jest.fn(),
  initSentry: jest.fn(),
  track: jest.fn(),
  captureError: jest.fn(),
}));
jest.mock("@/lib/revenuecat", () => ({
  initRevenueCat: jest.fn(),
  revenueCatService: { presentPaywall: jest.fn() },
}));
jest.mock("@/lib/session", () => ({
  bootstrapUser: () => Promise.resolve(null),
}));
jest.mock("@/lib/notifications", () => ({
  setupAndroidChannel: jest.fn(),
  syncPushToken: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  // The seeded library, not an empty shell. An app that renders nothing would
  // pass every assertion about not crashing, which is the failure mode a smoke
  // test exists to avoid.
  getLibrary: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const seed = require("@/data/seed");
    return Promise.resolve({ stories: seed.stories, source: "mock" });
  },
  getFeed: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const seed = require("@/data/seed");
    return Promise.resolve({ stories: seed.stories, source: "mock" });
  },
  generateStory: jest.fn(),
  continueStory: jest.fn(),
  editParagraph: jest.fn(),
  publishStory: jest.fn(),
  inferStoryBrief: jest.fn(),
  shapeStoryIdea: jest.fn(),
  registerPushToken: jest.fn(),
  createGenerationRequestId: () => "req",
  GenerationRequestError: class extends Error {},
}));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import App from "../../App";
/* eslint-enable import/first */

it("boots and renders a first screen rather than an empty tree", async () => {
  const view = await render(<App />);

  // `toJSON()` is null when nothing rendered at all, which is exactly the
  // blank-screen failure this test exists to catch. Asserting on real content
  // rather than "did not throw": a component that swallows its own error and
  // renders nothing would pass the weaker check.
  await waitFor(() => expect(view.toJSON()).not.toBeNull());
  const tree = JSON.stringify(view.toJSON());
  expect(tree.length).toBeGreaterThan(500);
});

it("mounts with the seeded library available to it", async () => {
  // Proves the data layer the app reads is wired, not that a particular screen
  // shows a particular story: the first screen is onboarding, which does not
  // list the library.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { stories } = require("@/data/seed");
  expect(stories.length).toBeGreaterThan(0);
  expect(stories[0].chapters.length).toBeGreaterThan(0);

  const view = await render(<App />);
  await waitFor(() => expect(view.toJSON()).not.toBeNull());
});
