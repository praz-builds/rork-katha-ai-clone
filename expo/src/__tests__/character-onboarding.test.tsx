import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const mockGenerateCharacterImage = jest.fn();
const mockSendEmailCode = jest.fn();
const mockVerifyEmailCode = jest.fn();
const mockSaveCharacterToLibrary = jest.fn();
const mockEnableNotifications = jest.fn();

let mockRequestIdSeq = 0;
let reduceMotion = false;

// The error classes are declared INSIDE the factory, not above it. A class
// declared at the top of this file is still in its temporal dead zone when the
// factory runs (imports are hoisted above it), so the export would be
// `undefined` and every `instanceof` against it would throw.
jest.mock("@/lib/api", () => {
  class CharacterPortraitRateLimitError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CharacterPortraitRateLimitError";
    }
  }
  class CharacterPortraitGuestCapError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CharacterPortraitGuestCapError";
    }
  }
  return {
    generateCharacterImage: (...args: unknown[]) =>
      mockGenerateCharacterImage(...args),
    createGenerationRequestId: () => `generation-${++mockRequestIdSeq}`,
    CharacterPortraitRateLimitError,
    CharacterPortraitGuestCapError,
  };
});

jest.mock("@/lib/session", () => ({
  sendEmailCode: (...args: unknown[]) => mockSendEmailCode(...args),
  verifyEmailCode: (...args: unknown[]) => mockVerifyEmailCode(...args),
}));

jest.mock("@/lib/saved-characters", () => ({
  saveCharacterToLibrary: (...args: unknown[]) =>
    mockSaveCharacterToLibrary(...args),
}));

jest.mock("@/lib/notifications", () => ({
  enableNotifications: () => mockEnableNotifications(),
}));

// The same passthrough mock the other animation suites use. `useAnimatedStyle`
// evaluates its factory at render, so an entrance's CURRENT values are readable
// straight off the rendered style - which is how the reduced-motion assertion
// below can tell "already final" from "about to animate".
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Text } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    default: {
      View,
      Text,
      createAnimatedComponent: (component: unknown) => component,
    },
    Easing: {
      bezier: () => passthrough,
      linear: passthrough,
      inOut: () => passthrough,
      out: () => passthrough,
      quad: passthrough,
      cubic: passthrough,
    },
    interpolate: (
      value: number,
      input: readonly number[],
      output: readonly number[],
    ) => {
      const span = input[1] - input[0];
      const ratio = span === 0 ? 0 : (value - input[0]) / span;
      return output[0] + (output[1] - output[0]) * ratio;
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withDelay: (_delay: number, value: unknown) => value,
    withRepeat: jest.fn((value: unknown) => value),
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withSpring: jest.fn(passthrough),
    withTiming: jest.fn(passthrough),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

// The gradients are ground and scan-band colour, not behaviour.
jest.mock("expo-linear-gradient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return { LinearGradient: (props: object) => React.createElement(View, props) };
});

// The flow draws its glyphs through `@/theme`'s named icon set, which is backed
// by Ionicons. The font is irrelevant to every assertion here, and rendering it
// pulls a native font module into the test environment.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

// The paywall and the welcome screen are owned by other files. Standing them in
// keeps this a test of the flow that routes to them rather than of their copy.
// The paywall decides its own headline from `purpose` now, so the stand-in
// reports the props this screen is contractually required to hand it.
jest.mock("@/components/onboarding/OnboardingPaywall", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    // Both exits are rendered because both of them now carry the notification
    // ask: a stand-in with only a close would let a regression on the purchase
    // path through.
    OnboardingPaywall: (
      { purpose, characterName, onDismiss, onSubscribed }: {
        purpose: string;
        characterName: string;
        onDismiss: () => void;
        onSubscribed: (grant: { credits: number; plan: string }) => void;
      },
    ) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Text, null, `Paywall ${purpose} ${characterName}`),
        React.createElement(Pressable, {
          accessibilityRole: "button",
          accessibilityLabel: "Dismiss paywall",
          onPress: onDismiss,
        }),
        React.createElement(Pressable, {
          accessibilityRole: "button",
          accessibilityLabel: "Subscribe",
          // The real paywall reports what was bought; the result carries the
          // grant out of the flow so the welcome screen can count up to it.
          onPress: () => onSubscribed({ credits: 50, plan: "yearly" }),
        }),
      ),
  };
});
jest.mock("@/components/onboarding/WelcomeScreen", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require("react-native");
  return {
    // The real screen auto-advances after the coins settle; the stand-in makes
    // that hand-off pressable so the result it produces can be asserted.
    WelcomeScreen: ({ onOpen }: { onOpen: () => void }) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Text, null, "Welcome"),
        React.createElement(Pressable, {
          accessibilityRole: "button",
          accessibilityLabel: "Open Katha",
          onPress: onOpen,
        }),
      ),
  };
});

/* eslint-disable import/first */
import CharacterOnboarding, {
  PORTRAIT_WAIT_CAPTION,
} from "@/screens/CharacterOnboarding";
import type { OnboardingPurpose } from "@/screens/CharacterOnboarding";
/* eslint-enable import/first */

const NAME = "Aarav";
const APPEARANCE = "Denim shirt, sleeves rolled, tired eyes that miss nothing";
const PORTRAIT = "https://cdn.example.com/aarav.png";
const EMAIL = "priya@example.com";

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestIdSeq = 0;
  reduceMotion = false;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(reduceMotion));
  mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT });
  mockSendEmailCode.mockResolvedValue(undefined);
  mockVerifyEmailCode.mockResolvedValue(undefined);
  mockSaveCharacterToLibrary.mockResolvedValue({ id: "saved-1" });
  mockEnableNotifications.mockResolvedValue(true);
});

/**
 * RNTL 14 makes `render` and `fireEvent` async: every call has to be awaited or
 * the assertion runs against the previous frame.
 */
type View = Awaited<ReturnType<typeof render>>;

async function mount(
  purpose: OnboardingPurpose = "write",
  onDone = jest.fn(),
  entryContext?: { name: string; genreInterests: string[] },
): Promise<View> {
  return await render(
    <CharacterOnboarding
      purpose={purpose}
      initialGenre="mystery"
      entryContext={entryContext}
      onDone={onDone}
    />,
  );
}

/** W3 into W4, with the sheet filled in. Two fields, and that is the sheet. */
async function fillSheet(view: View, appearance = APPEARANCE) {
  await fireEvent.press(view.getByLabelText("Create my character"));
  await fireEvent.changeText(view.getByLabelText("Name"), NAME);
  await fireEvent.changeText(view.getByLabelText("Appearance"), appearance);
}

/** The body of every portrait request, in order. */
function portraitCalls(): Record<string, unknown>[] {
  return mockGenerateCharacterImage.mock.calls.map(([input]) =>
    input as Record<string, unknown>
  );
}

/**
 * W4's CTA (which saves and draws), then W5's (which only sends the code).
 */
async function submitSave(view: View) {
  await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));
  await fireEvent.changeText(view.getByLabelText("Email address"), EMAIL);
  await fireEvent.press(view.getByLabelText("Email me a code"));
  await view.findByLabelText("Verification code");
}

async function verify(view: View) {
  await fireEvent.changeText(view.getByLabelText("Verification code"), "123456");
  await fireEvent.press(view.getByLabelText("Verify and continue"));
}

/** The requestId every portrait call was fired with, in order. */
function requestIds(): string[] {
  return mockGenerateCharacterImage.mock.calls.map(
    ([input]) => (input as { requestId: string }).requestId,
  );
}

describe("character onboarding", () => {
  it("walks W3, W4, W5 and the code step, and opens W6 ready when the portrait landed during the wait", async () => {
    const view = await mount();
    view.getByText("Every story needs a lead.");

    await fillSheet(view);
    view.getByText("Craft your lead");

    await submitSave(view);
    // The code screen IS the wait: the request was fired by W5's CTA and has
    // resolved by the time anybody finishes typing six digits.
    await waitFor(() =>
      expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1)
    );
    await verify(view);

    await view.findByText(`Meet ${NAME}.`);
    view.getByLabelText(`Portrait of ${NAME}`);
    view.getByText("YOUR LEAD");
    view.getByLabelText(`Keep ${NAME}`);
  });

  it("opens W6 in its loading state when the portrait has not landed, then flips to ready", async () => {
    let release: (value: { url: string }) => void = () => {};
    mockGenerateCharacterImage.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        release = resolve;
      }),
    );

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);

    await view.findByText(`${NAME} is taking shape.`);
    view.getByText("DRAWING");
    // The wait is a measurement, and the screen renders the one constant that
    // holds it rather than a sentence of its own.
    view.getByText(PORTRAIT_WAIT_CAPTION);
    // Nothing to keep yet, and the button says what it is waiting for.
    expect(
      view.getByLabelText(`Drawing ${NAME}…`).props.accessibilityState.disabled,
    ).toBe(true);

    release({ url: PORTRAIT });
    await view.findByText(`Meet ${NAME}.`);
    expect(view.queryByText(PORTRAIT_WAIT_CAPTION)).toBeNull();
  });

  it("saves and draws on W4's CTA, before the email screen has been seen", async () => {
    const view = await mount();
    await fillSheet(view);

    // Nothing has been spent while the sheet is still being typed.
    expect(mockSaveCharacterToLibrary).not.toHaveBeenCalled();
    expect(mockGenerateCharacterImage).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));

    // The draw and the save are the W4 press, and both of them happen before
    // anybody has been asked for an address: the email leg is the wait.
    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1);
    // Written on the anonymous session, before anybody verified anything.
    // Verification converts that user in place, so the row keeps its owner.
    expect(mockSaveCharacterToLibrary).toHaveBeenCalledWith({
      name: NAME,
      appearance: APPEARANCE,
      portraitUrl: undefined,
    });
    expect(mockSendEmailCode).not.toHaveBeenCalled();

    view.getByText(`Where should we send ${NAME}?`);
  });

  it("sends the code on W5's CTA and draws nothing there", async () => {
    const view = await mount();
    await fillSheet(view);
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));
    mockGenerateCharacterImage.mockClear();
    mockSaveCharacterToLibrary.mockClear();

    await fireEvent.changeText(view.getByLabelText("Email address"), EMAIL);
    await fireEvent.press(view.getByLabelText("Email me a code"));
    await view.findByLabelText("Verification code");

    expect(mockSendEmailCode).toHaveBeenCalledWith(EMAIL);
    // The portrait is already in flight. A second request here would be one of
    // the twelve hourly allowances spent on a screen that draws nothing.
    expect(mockGenerateCharacterImage).not.toHaveBeenCalled();
    expect(mockSaveCharacterToLibrary).not.toHaveBeenCalled();
  });

  it("keeps a send failure on W5 without touching the drawing", async () => {
    mockSendEmailCode.mockRejectedValueOnce(new Error("offline"));
    const view = await mount();
    await fillSheet(view);
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));
    await fireEvent.changeText(view.getByLabelText("Email address"), EMAIL);
    await fireEvent.press(view.getByLabelText("Email me a code"));

    await view.findByText(
      "We could not send that code. Check the address and retry.",
    );
    view.getByLabelText("Email address");
    expect(view.queryByLabelText("Verification code")).toBeNull();
    // The one request W4 fired is the only one: a failed send retries the
    // send, not the portrait.
    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when Back from W5 returns to an unchanged sheet", async () => {
    const view = await mount();
    await fillSheet(view);
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));
    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText("Back"));
    view.getByText("Craft your lead");
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));

    // Walking the same sheet forward a second time is a navigation, not a
    // request.
    view.getByText(`Where should we send ${NAME}?`);
    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1);
    // Counting the FACELESS save only: the second write is the portrait being
    // attached to the row when it lands, which is the same character, not a
    // second one.
    const sheetSaves = mockSaveCharacterToLibrary.mock.calls.filter(
      ([input]) => (input as { portraitUrl?: string }).portraitUrl === undefined,
    );
    expect(sheetSaves).toHaveLength(1);
  });

  it("redraws when Back from W5 returns to a changed sheet, and charges no reimagine for it", async () => {
    const view = await mount();
    await fillSheet(view);
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));

    await fireEvent.press(view.getByLabelText("Back"));
    await fireEvent.changeText(
      view.getByLabelText("Appearance"),
      "A woman in a green coat",
    );
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));

    expect(requestIds()).toHaveLength(2);
    expect(new Set(requestIds()).size).toBe(2);
    expect(portraitCalls()[1]).toMatchObject({
      appearance: "A woman in a green coat",
    });

    // The reimagine budget belongs to the Meet screen's pill and was not
    // spent here: the editor still opens once the face lands.
    await fireEvent.changeText(view.getByLabelText("Email address"), EMAIL);
    await fireEvent.press(view.getByLabelText("Email me a code"));
    await view.findByLabelText("Verification code");
    await verify(view);
    await view.findByText(`Meet ${NAME}.`);
    await fireEvent.press(view.getByLabelText("Reimagine"));
    await view.findByLabelText("Redraw");
  });

  it("keeps the CTA disabled until the name and the appearance are answered, and asks nothing else", async () => {
    const view = await mount();
    await fireEvent.press(view.getByLabelText("Create my character"));

    // What the sheet is for, said above the boxes rather than left to guess.
    view.getByText("KATHA WILL DRAW");
    view.getByText("Face and build");
    view.getByText("Clothes and props");
    view.getByText("The name");

    // THE GENDER ROW IS GONE, and so is the only question in the flow a person
    // could not answer in their own words. An appearance line says it whenever
    // it matters, and says it better.
    expect(view.queryByText("GENDER")).toBeNull();
    for (const label of ["Woman", "Man", "Non-binary", "Prefer not to say"]) {
      expect(view.queryByLabelText(label)).toBeNull();
    }

    expect(
      view.getByLabelText("Bring them to life").props.accessibilityState
        .disabled,
    ).toBe(true);

    await fireEvent.changeText(view.getByLabelText("Name"), NAME);
    // A name alone is not the sheet: the appearance IS the prompt.
    expect(
      view.getByLabelText(`Bring ${NAME} to life`).props.accessibilityState
        .disabled,
    ).toBe(true);

    await fireEvent.changeText(view.getByLabelText("Appearance"), APPEARANCE);
    expect(
      view.getByLabelText(`Bring ${NAME} to life`).props.accessibilityState
        .disabled,
    ).toBe(false);
  });

  it("sends no gender to the endpoint, because there is no longer one to send", async () => {
    const view = await mount();
    await fillSheet(view);
    await submitSave(view);

    await waitFor(() =>
      expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1)
    );
    // Asserted as an absent KEY, not an undefined value: the endpoint's own
    // `gender` parameter was deleted with the row, so a client that started
    // sending one again would be talking to a contract that no longer exists.
    expect(portraitCalls()[0]).not.toHaveProperty("gender");
  });

  it("expands the editor under the portrait, and redraws from the edited sheet", async () => {
    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);
    await view.findByText(`Meet ${NAME}.`);

    // Nothing about the budget is on screen. A counter beside the only button
    // on the aha screen makes people read the number before the face.
    expect(view.queryByText(/free left/)).toBeNull();
    expect(view.queryByLabelText("Edit details")).toBeNull();
    expect(view.queryByText("Edit details")).toBeNull();
    // And the editor is closed until it is asked for.
    expect(view.queryByLabelText("Redraw")).toBeNull();

    // The benefits are what the keep is FOR, under the pill.
    view.getByText("Leads your stories");
    view.getByText("Same face, every time");
    view.getByText("Saved to your cast");

    await fireEvent.press(view.getByLabelText("Reimagine"));
    const editor = await view.findByLabelText("Redraw");
    expect(editor).toBeTruthy();
    // Prefilled: the fix is an edit of what they wrote, not a blank box.
    const appearanceField = view.getAllByLabelText("Appearance")[0];
    expect(appearanceField.props.value).toBe(APPEARANCE);

    await fireEvent.changeText(appearanceField, "A woman in a green coat");
    await fireEvent.press(view.getByLabelText("Redraw"));

    await view.findByText(`Meet ${NAME}.`);
    expect(requestIds()).toHaveLength(2);
    // Every attempt is its own request. A replayed id would be a second paid
    // provider call wearing the first one's name.
    expect(new Set(requestIds()).size).toBe(2);
    expect(portraitCalls()[1]).toMatchObject({
      appearance: "A woman in a green coat",
    });
    expect(portraitCalls()[1]).not.toHaveProperty("gender");
    // Redraw closes the block; the loading state took the screen instead.
    expect(view.queryByLabelText("Redraw")).toBeNull();

    // The one free reimagine is spent, so the pill is the plan's front door
    // rather than a second editor.
    await fireEvent.press(view.getByLabelText("Reimagine"));
    await view.findByText(`Paywall write ${NAME}`);
    expect(requestIds()).toHaveLength(2);
  });

  it("keeps the sheet when Back walks to W4, and draws nothing for an unchanged one", async () => {
    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);
    await view.findByText(`Meet ${NAME}.`);

    await fireEvent.press(view.getByLabelText("Back"));
    expect(view.getByLabelText("Name").props.value).toBe(NAME);
    expect(view.getByLabelText("Appearance").props.value).toBe(APPEARANCE);

    // An unchanged sheet walks forward to the face that is already in hand
    // rather than spending the one free reimagine on a navigation.
    await fireEvent.press(view.getByLabelText(`Bring ${NAME} to life`));
    await view.findByText(`Meet ${NAME}.`);
    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1);
  });

  it("offers Try again inside the card on an ordinary failure", async () => {
    mockGenerateCharacterImage.mockRejectedValueOnce(new Error("no image"));

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);

    await view.findByText(`We couldn't draw ${NAME}. Try again.`);
    await fireEvent.press(view.getByLabelText("Try again"));
    await view.findByText(`Meet ${NAME}.`);
    // A failure produced no face, so it cannot have spent the chance to reject
    // one: the editor still opens rather than the paywall.
    await fireEvent.press(view.getByLabelText("Reimagine"));
    await view.findByLabelText("Redraw");
  });

  it("says wait, with no Try again, when the hourly portrait allowance is spent", async () => {
    const { CharacterPortraitRateLimitError } = jest.requireMock("@/lib/api") as {
      CharacterPortraitRateLimitError: new (message: string) => Error;
    };
    const message =
      "You've made a lot of characters just now. Give it a few minutes.";
    mockGenerateCharacterImage.mockRejectedValue(
      new CharacterPortraitRateLimitError(message),
    );

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);

    // The server's own sentence, verbatim: only it knows what the wait is.
    await view.findByText(message);
    expect(view.queryByText(`We couldn't draw ${NAME}. Try again.`)).toBeNull();
    // No control that is guaranteed to fail on press. Back is the way out.
    expect(view.queryByLabelText("Try again")).toBeNull();
    view.getByLabelText("Back");
  });

  it("says what the guest cap says, with no Try again", async () => {
    const { CharacterPortraitGuestCapError } = jest.requireMock("@/lib/api") as {
      CharacterPortraitGuestCapError: new (message: string) => Error;
    };
    const message = "Sign in to keep making characters.";
    mockGenerateCharacterImage.mockRejectedValue(
      new CharacterPortraitGuestCapError(message),
    );

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);

    await view.findByText(message);
    expect(view.queryByLabelText("Try again")).toBeNull();
  });

  it("voices W3, W4 and W6 for a reader, with the name already known", async () => {
    const reader = await mount("read", jest.fn(), {
      name: "Priya",
      genreInterests: ["mystery"],
    });
    reader.getByText("Priya, what if you were in the story?");
    await fireEvent.press(reader.getByLabelText("Put me in the story"));
    reader.getByText("Craft your character");
    // Their own name, carried from the questionnaire rather than asked twice.
    expect(reader.getByLabelText("Name").props.value).toBe("Priya");

    await fireEvent.changeText(
      reader.getByLabelText("Appearance"),
      "Paint on her hands, her grandmother's coat",
    );
    await fireEvent.press(reader.getByLabelText("Show me"));
    reader.getByText("Where should we send you?");
    await fireEvent.changeText(
      reader.getByLabelText("Email address"),
      EMAIL,
    );
    await fireEvent.press(reader.getByLabelText("Email me a code"));
    await reader.findByLabelText("Verification code");
    await verify(reader);

    await reader.findByText("Hello, Priya.");
    reader.getByText("THIS IS YOU");
    reader.getByLabelText("Keep this me");
    // The reader's first benefit row is about being IN the story, not about
    // directing somebody else through it.
    reader.getByText("You, in every story");
    expect(reader.queryByText("Leads your stories")).toBeNull();
  });

  it("never writes the offline placeholder scheme as a portrait URL", async () => {
    mockGenerateCharacterImage.mockResolvedValue({
      url: "draft-character://generation-1",
    });

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);

    await view.findByText(`Meet ${NAME}.`);
    // A scheme no <Image> can load falls back to the silhouette card.
    expect(view.queryByLabelText(`Portrait of ${NAME}`)).toBeNull();
    view.getByLabelText(`${NAME} has no portrait yet`);
    for (const [input] of mockSaveCharacterToLibrary.mock.calls) {
      expect((input as { portraitUrl?: string }).portraitUrl).toBeUndefined();
    }
  });

  it("continues past a save failure rather than stranding the flow", async () => {
    mockSaveCharacterToLibrary.mockRejectedValue(new Error("offline"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);

    await view.findByText(`Meet ${NAME}.`);
    await fireEvent.press(view.getByLabelText(`Keep ${NAME}`));
    await view.findByText(`Paywall write ${NAME}`);
    warn.mockRestore();
  });

  it("asks for notifications as the paywall closes, either way it closes, and never before", async () => {
    for (const exit of ["Dismiss paywall", "Subscribe"] as const) {
      jest.clearAllMocks();
      mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT });
      mockSendEmailCode.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockResolvedValue(undefined);
      mockSaveCharacterToLibrary.mockResolvedValue({ id: "saved-1" });
      mockEnableNotifications.mockResolvedValue(true);

      const view = await mount();
      await fillSheet(view);
      await submitSave(view);
      await verify(view);
      await view.findByText(`Meet ${NAME}.`);
      await fireEvent.press(view.getByLabelText(`Keep ${NAME}`));
      await view.findByText(`Paywall write ${NAME}`);
      // Nothing has been asked yet: the ask belongs to the paywall closing.
      expect(mockEnableNotifications).not.toHaveBeenCalled();

      await fireEvent.press(view.getByLabelText(exit));
      // Straight to the welcome. The soft pre-prompt screen is gone: it asked
      // permission to ask permission, immediately after a paywall, and people
      // declined both.
      await view.findByText("Welcome");
      expect(mockEnableNotifications).toHaveBeenCalledTimes(1);
      expect(view.queryByText("Want to know when it's ready?")).toBeNull();
      expect(view.queryByLabelText("Notify me")).toBeNull();
    }
  });

  it("carries the plan's credits out of the flow, and nothing when nothing was bought", async () => {
    // The welcome animation counts up to this number. Undefined on the free
    // path rather than 3, because the free grant is the caller's constant and
    // this screen does not get to own a pricing figure.
    for (const exit of ["Subscribe", "Dismiss paywall"] as const) {
      jest.clearAllMocks();
      mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT });
      mockSendEmailCode.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockResolvedValue(undefined);
      mockSaveCharacterToLibrary.mockResolvedValue({ id: "saved-1" });
      mockEnableNotifications.mockResolvedValue(true);

      const onDone = jest.fn();
      const view = await mount("write", onDone);
      await fillSheet(view);
      await submitSave(view);
      await verify(view);
      await view.findByText(`Meet ${NAME}.`);
      await fireEvent.press(view.getByLabelText(`Keep ${NAME}`));
      await view.findByText(`Paywall write ${NAME}`);
      await fireEvent.press(view.getByLabelText(exit));
      await view.findByText("Welcome");
      await fireEvent.press(view.getByLabelText("Open Katha"));

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone.mock.calls[0][0]).toMatchObject({
        subscribed: exit === "Subscribe",
      });
      expect(onDone.mock.calls[0][0].purchasedCredits).toBe(
        exit === "Subscribe" ? 50 : undefined,
      );
    }
  });

  it("reaches the welcome even when the permission module throws", async () => {
    mockEnableNotifications.mockRejectedValue(new Error("no module"));

    const view = await mount();
    await fillSheet(view);
    await submitSave(view);
    await verify(view);
    await view.findByText(`Meet ${NAME}.`);
    await fireEvent.press(view.getByLabelText(`Keep ${NAME}`));
    await view.findByText(`Paywall write ${NAME}`);
    await fireEvent.press(view.getByLabelText("Dismiss paywall"));

    // A permissions module that throws must not strand somebody on a paywall
    // they have already dismissed.
    await view.findByText("Welcome");
  });

  it("renders W3's cards in their final state under reduced motion", async () => {
    reduceMotion = true;
    const reanimated = jest.requireMock("react-native-reanimated") as {
      withTiming: jest.Mock;
      withRepeat: jest.Mock;
    };

    const view = await mount();
    // The first frame mounts before `isReduceMotionEnabled` resolves; that race
    // is documented at `useReduceMotion`. Waiting for the flip is what this
    // asserts against.
    await waitFor(() => expect(reanimated.withTiming).toHaveBeenCalled());
    reanimated.withTiming.mockClear();
    reanimated.withRepeat.mockClear();

    const stage = view.getByLabelText("Three character portraits");
    const cards = stage.children as unknown as { props: { style: unknown } }[];
    for (const card of cards) {
      const flattened = StyleSheet.flatten(card.props.style) as Record<string, unknown>;
      expect(flattened.opacity).toBe(1);
    }
    // The hero holds at 1.08 and the sides are home: nothing is mid-entrance.
    const hero = StyleSheet.flatten(
      cards[cards.length - 1].props.style,
    ) as Record<string, unknown>;
    expect(hero.transform).toEqual([{ scale: 1.08 }]);
    const side = StyleSheet.flatten(cards[0].props.style) as Record<
      string,
      unknown
    >;
    expect(side.transform).toEqual([
      { translateX: 0 },
      { translateY: 0 },
      { rotate: "-8deg" },
      { scale: 1 },
    ]);
    // And nothing was scheduled to get there.
    expect(reanimated.withTiming).not.toHaveBeenCalled();
    expect(reanimated.withRepeat).not.toHaveBeenCalled();
  });

  it("leaves the flow from W3's Back control", async () => {
    const onExit = jest.fn();
    const view = await render(
      <CharacterOnboarding
        purpose="both"
        initialGenre="mystery"
        onDone={jest.fn()}
        onExit={onExit}
      />,
    );
    await fireEvent.press(view.getByLabelText("Back"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
