/**
 * The app root must mount a `SafeAreaProvider`.
 *
 * Every screen that reads `useSafeAreaInsets` depends on it, and the hook
 * throws rather than degrading, so the symptom of a missing provider is a blank
 * white screen with nothing in the Metro log. See `safe-area-contract.test.tsx`
 * for the mechanism.
 */
import React from "react";
import { render } from "@testing-library/react-native";

const mockMountedProvider = jest.fn();

jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    ...actual,
    SafeAreaProvider: (props: Record<string, unknown>) => {
      mockMountedProvider();
      return ReactModule.createElement(actual.SafeAreaProvider, props);
    },
  };
});

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
  getLibrary: () => Promise.resolve({ stories: [], source: "mock" }),
  getFeed: () => Promise.resolve({ stories: [], source: "mock" }),
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

it("mounts a SafeAreaProvider above every screen", async () => {
  await render(<App />);
  // The provider is a composite that renders no identifiable host element, so
  // the assertion is that App mounted it at all. Without it, every screen
  // reading insets renders blank with nothing in the Metro log.
  expect(mockMountedProvider).toHaveBeenCalled();
});
