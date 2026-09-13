/**
 * What App.tsx does with the answer onboarding gives it.
 *
 * The failures this exists to catch are all wiring, and none of them are
 * visible from inside any one screen: a writer who finishes the character flow
 * and lands on Home instead of in Create (with the character they just made
 * left behind), a reader dropped into the Create studio, and the welcome
 * credits flight playing on every launch instead of once per install.
 *
 * The screens themselves are stood in for deliberately. `CharacterOnboarding`,
 * `OnboardingPaywall` and `WelcomeCreditsFlight` all have their own suites; what
 * is under test here is the route between them, so each stand-in is a button
 * that fires the callback App handed it.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const mockHasPlayed = jest.fn(async () => false);
const mockMarkPlayed = jest.fn(async () => undefined);

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: null,
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
jest.mock("@/lib/saved-characters", () => ({
  saveCharacterToLibrary: jest.fn(async () => null),
}));
jest.mock("@/lib/notifications", () => ({
  setupAndroidChannel: jest.fn(),
  syncPushToken: jest.fn(),
  enableNotifications: jest.fn(async () => false),
}));
jest.mock("@/lib/welcome-flight", () => ({
  hasPlayedWelcomeFlight: () => mockHasPlayed(),
  markWelcomeFlightPlayed: () => mockMarkPlayed(),
}));
jest.mock("@/lib/api", () => ({
  getLibrary: () => Promise.resolve({ stories: [], source: "mock" }),
  getFeed: () => Promise.resolve({ stories: [], source: "mock" }),
  fetchCreatedShelf: () => Promise.resolve({ ok: false, stories: [] }),
  generateStory: jest.fn(),
  generateCharacterImage: jest.fn(async () => ({ imageUrl: null })),
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

/** The questionnaire, reduced to the one thing App cares about: its exit. */
jest.mock("@/screens/KathaOnboardingComplete", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: (
      { onCharacterPath }: {
        onCharacterPath: (payload: unknown) => void;
      },
    ) =>
      React.createElement(
        React.Fragment,
        null,
        ["write", "read"].map((purpose) =>
          React.createElement(
            Pressable,
            {
              key: purpose,
              accessibilityRole: "button",
              accessibilityLabel: `finish questions as ${purpose}`,
              onPress: () =>
                onCharacterPath({
                  purpose,
                  initialGenre: "mystery",
                  onboarding: {
                    name: "Nikita",
                    genres: ["Mystery", "Fantasy", "Adventure"],
                    otherGenre: "",
                    refine: "novel",
                    moment: "chapters",
                  },
                }),
            },
            React.createElement(Text, null, `finish as ${purpose}`),
          )
        ),
      ),
  };
});

/** The character flow, reduced to "here is the character you asked for". */
jest.mock("@/screens/CharacterOnboarding", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: (
      { purpose, initialGenre, entryContext, onDone }: {
        purpose: string;
        initialGenre?: string;
        entryContext?: { name: string };
        onDone: (result: unknown) => void;
      },
    ) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          Text,
          null,
          `character flow: ${purpose} / ${initialGenre ?? "none"} / ${
            entryContext?.name ?? "anonymous"
          }`,
        ),
        ...[false, true].map((bought) =>
          React.createElement(
            Pressable,
            {
              key: String(bought),
              accessibilityRole: "button",
              accessibilityLabel: bought
                ? "finish character subscribed"
                : "finish character",
              onPress: () =>
                onDone({
                  purpose,
                  character: {
                    name: "Ilya",
                    appearance: "A tired detective in a wet coat",
                    portraitUrl: "https://example.test/ilya.png",
                    savedCharacterId: "saved-1",
                  },
                  primaryGenre: initialGenre ?? "mystery",
                  email: "nikita@example.test",
                  subscribed: bought,
                  // Undefined when they did not buy: App supplies the free
                  // grant itself, which is the behaviour under test below.
                  purchasedCredits: bought ? 50 : undefined,
                  notificationsEnabled: false,
                }),
            },
            React.createElement(
              Text,
              null,
              bought ? "finish character subscribed" : "finish character",
            ),
          )
        ),
      ),
  };
});

/** Home, reduced to the number the flight is about. */
jest.mock("@/screens/HomeScreen", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ credits }: { credits: number }) =>
      React.createElement(Text, null, `home credits ${credits}`),
  };
});

/** The Create studio, reduced to the lead it was handed. */
jest.mock("@/screens/CreateStudioScreen", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ initialDraft }: { initialDraft?: Record<string, never> }) => {
      const draft = initialDraft as
        | {
          primaryGenre?: string;
          characters?: {
            name: string;
            isHero: boolean;
            portraitStatus?: string;
          }[];
        }
        | undefined;
      const lead = draft?.characters?.find((character) => character.isHero);
      return React.createElement(
        Text,
        null,
        `create studio: ${draft?.primaryGenre ?? "none"} / ${
          lead?.name ?? "no lead"
        } / ${lead?.portraitStatus ?? "no portrait"}`,
      );
    },
  };
});

/** The flight, reduced to "I was mounted, and here is a landing". */
jest.mock("@/components/onboarding/WelcomeCreditsFlight", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    bumpCredits: jest.fn(),
    WelcomeCreditsFlight: (
      { coins, amount, onLanded, onDone }: {
        coins?: number;
        amount: number;
        onLanded: (shown: number) => void;
        onDone: () => void;
      },
    ) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          Text,
          null,
          `flight of ${amount} in ${coins ?? 3} coins`,
        ),
        React.createElement(
          Pressable,
          {
            accessibilityRole: "button",
            accessibilityLabel: "land a coin",
            // The real component does this arithmetic; the stand-in only has
            // to hand App the kind of number it will be handed.
            onPress: () => onLanded(Math.round(amount / (coins ?? 3))),
          },
          React.createElement(Text, null, "land"),
        ),
        React.createElement(
          Pressable,
          {
            accessibilityRole: "button",
            accessibilityLabel: "land the last coin",
            onPress: () => onLanded(amount),
          },
          React.createElement(Text, null, "land last"),
        ),
        React.createElement(
          Pressable,
          {
            accessibilityRole: "button",
            accessibilityLabel: "end flight",
            onPress: onDone,
          },
          React.createElement(Text, null, "end"),
        ),
      ),
  };
});

/* eslint-disable import/first */
import App from "../../App";
/* eslint-enable import/first */

beforeEach(() => {
  mockHasPlayed.mockReset();
  mockHasPlayed.mockResolvedValue(false);
  mockMarkPlayed.mockReset();
  mockMarkPlayed.mockResolvedValue(undefined);
});

describe("onboarding hand-off", () => {
  it("carries the questionnaire's answers into the character flow", async () => {
    const view = await render(<App />);
    await fireEvent.press(
      await view.findByLabelText("finish questions as write"),
    );

    expect(
      await view.findByText("character flow: write / mystery / Nikita"),
    ).toBeTruthy();
  });

  it("lands a writer in Create with their character as the lead", async () => {
    const view = await render(<App />);
    await fireEvent.press(
      await view.findByLabelText("finish questions as write"),
    );
    await fireEvent.press(await view.findByLabelText("finish character"));

    // The portrait was made in onboarding, so the studio opens with it ready
    // rather than asking for it a second time at a credit.
    expect(
      await view.findByText("create studio: mystery / Ilya / ready"),
    ).toBeTruthy();
  });

  it("lands a reader on Home, not in the Create studio", async () => {
    const view = await render(<App />);
    await fireEvent.press(
      await view.findByLabelText("finish questions as read"),
    );
    await fireEvent.press(await view.findByLabelText("finish character"));

    expect(await view.findByText(/^home credits/)).toBeTruthy();
    expect(view.queryByText(/^create studio/)).toBeNull();
  });

  it("plays the welcome flight once, ticking Home's balance as coins land", async () => {
    const view = await render(<App />);
    await fireEvent.press(
      await view.findByLabelText("finish questions as read"),
    );
    await fireEvent.press(await view.findByLabelText("finish character"));

    expect(await view.findByText("flight of 3 in 3 coins")).toBeTruthy();
    // Zero until a coin lands: the flight is what delivers the three, and a
    // pill that already reads 3 has nothing for the coins to arrive at.
    expect(view.getByText("home credits 0")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("land a coin"));
    expect(view.getByText("home credits 1")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("end flight"));
    await waitFor(() => expect(mockMarkPlayed).toHaveBeenCalledTimes(1));
    expect(view.queryByText("flight of 3 in 3 coins")).toBeNull();
    // And back to the real balance, whatever it is, rather than stuck on the
    // number the animation happened to stop at.
    expect(view.queryByText("home credits 1")).toBeNull();
  });

  it("counts up to the plan's credits when they subscribed on the way through", async () => {
    const view = await render(<App />);
    await fireEvent.press(
      await view.findByLabelText("finish questions as read"),
    );
    await fireEvent.press(
      await view.findByLabelText("finish character subscribed"),
    );

    // Still three coins, fifty credits. Celebrating the free grant of three at
    // somebody who paid for fifty a minute earlier reads as the purchase not
    // having registered.
    expect(await view.findByText("flight of 50 in 3 coins")).toBeTruthy();
    await fireEvent.press(view.getByLabelText("land a coin"));
    expect(view.getByText("home credits 17")).toBeTruthy();
    await fireEvent.press(view.getByLabelText("land the last coin"));
    expect(view.getByText("home credits 50")).toBeTruthy();
  });

  it("never replays the flight on an install that has already seen it", async () => {
    mockHasPlayed.mockResolvedValue(true);

    const view = await render(<App />);
    await fireEvent.press(
      await view.findByLabelText("finish questions as read"),
    );
    await fireEvent.press(await view.findByLabelText("finish character"));

    await view.findByText(/^home credits/);
    expect(view.queryByText("flight of 3 in 3 coins")).toBeNull();
    expect(mockMarkPlayed).not.toHaveBeenCalled();
  });
});
