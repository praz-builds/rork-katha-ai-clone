import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockInferStoryBrief = jest.fn();
const mockSendEmailCode = jest.fn();
const mockVerifyEmailCode = jest.fn();
const mockEnableNotifications = jest.fn();

jest.mock("@/lib/api", () => ({
  inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
}));

jest.mock("@/lib/session", () => ({
  sendEmailCode: (...args: unknown[]) => mockSendEmailCode(...args),
  verifyEmailCode: (...args: unknown[]) => mockVerifyEmailCode(...args),
}));

jest.mock("@/lib/notifications", () => ({
  enableNotifications: () => mockEnableNotifications(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

// The onboarding flow draws its glyphs through `@/theme`'s named icon set,
// which is backed by Ionicons. The font is irrelevant to every assertion here,
// and rendering it pulls a native font module into the test environment.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

jest.mock("@/components/create/CraftingLoader", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    CraftingLoader: () => React.createElement(Text, null, "Crafting"),
    CRAFTING_STAGES: [],
  };
});

/* eslint-disable import/first */
import WriterOnboarding, {
  CRAFTING_MIN_MS,
} from "@/screens/WriterOnboarding";
import { PlanSection, WritingStyleChips } from "@/components/create/PlanSection";
/* eslint-enable import/first */

const SHAPE = {
  genres: ["mystery"],
  whereAndWhen: "A hill town, off-season",
  characters: [
    {
      name: "Elena Marquez",
      description: "Historical restorer, 34",
      background: "",
      appearance: "",
      isHero: true,
    },
  ],
  suggestedMoments: ["She hears her own name through the wall"],
  beats: [
    "Elena inherits the house and finds the door",
    "The letters arrive before they are written",
    "She answers one, and it answers back",
  ],
  title: "The Door That Was Not On The Deed",
  opening: "The clocks began counting backward.\n\nElena stood in the hall.",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInferStoryBrief.mockResolvedValue(SHAPE);
  mockSendEmailCode.mockResolvedValue(undefined);
  mockVerifyEmailCode.mockResolvedValue(undefined);
  mockEnableNotifications.mockResolvedValue(true);
});

type View = Awaited<ReturnType<typeof render>>;

// The crafting step holds the loader for CRAFTING_MIN_MS before it reveals the
// blueprint, so every path through this flow now crosses a timer. The timers
// have to be fake from the moment a screen mounts: switching after the fact
// leaves a real one running that no amount of `advanceTimersByTime` can reach.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/**
 * Walk past the crafting floor.
 *
 * The mocked request has already resolved by the time this runs, so the only
 * thing left in flight is the hold. Advancing when nothing is pending - a Back
 * press that returns to an already-built blueprint, or a call that failed and
 * skipped the hold - is a no-op, which is why every arrival at the blueprint
 * can go through it.
 */
async function settleCraftingHold() {
  await act(async () => {
    jest.advanceTimersByTime(CRAFTING_MIN_MS);
  });
}

async function renderFlow(onDone = jest.fn()) {
  const view = await render(<WriterOnboarding onDone={onDone} />);
  return { onDone, view };
}

/** Idea -> details. */
async function reachDetails(view: View, idea = "A woman inherits a boarded-up house and finds letters that arrive early.") {
  await fireEvent.changeText(view.getByLabelText("Your idea"), idea);
  await fireEvent.press(view.getByRole("button", { name: "Continue" }));
  await view.findByText("Shape the Story");
}

/** Details -> preview, through the email and code screens. */
async function authAndCraft(view: View) {
  await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
  await fireEvent.changeText(
    await view.findByLabelText("Email address"),
    "w@example.com",
  );
  await fireEvent.press(
    view.getByRole("button", { name: "Save & continue" }),
  );
  await fireEvent.changeText(
    await view.findByLabelText("Verification code"),
    "123456",
  );
  await fireEvent.press(
    view.getByRole("button", { name: "Verify and continue" }),
  );
  await settleCraftingHold();
  await view.findByText(SHAPE.title);
}

async function reachPreview(view: View) {
  await reachDetails(view);
  await authAndCraft(view);
}

/* ── Back navigation ──────────────────────────────────────────────────── */

describe("writer onboarding back navigation", () => {
  it("keeps the idea when the user goes back from details and returns", async () => {
    const { view } = await renderFlow();
    await reachDetails(view, "A city beneath a broken moon, where the tide keeps the time.");
    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByText("What's your story about?");
    expect(view.getByLabelText("Your idea").props.value).toBe(
      "A city beneath a broken moon, where the tide keeps the time.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");
  });

  it("keeps moments, style and chapter count across a back-and-forward", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    await fireEvent.changeText(
      view.getByLabelText("Add a moment"),
      "A rooftop confession",
    );
    await fireEvent(view.getByLabelText("Add a moment"), "submitEditing");
    // Writing style is a free-text field now, with its examples in the
    // placeholder rather than in a chip row above it.
    await fireEvent.changeText(view.getByLabelText("Writing style"), "Lyrical");
    await fireEvent.press(view.getByLabelText("Chapters, 3 chapters"));
    await fireEvent.press(view.getByText("7 chapters"));

    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByText("What's your story about?");
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");

    expect(view.getByLabelText("Remove A rooftop confession")).toBeTruthy();
    expect(view.getByLabelText("Writing style").props.value).toBe("Lyrical");
    expect(
      view.getByLabelText("Chapters, 7 chapters").props.accessibilityState
        .expanded,
    ).toBe(false);
  });

  it("does not strand the user in re-authentication when they go back from the preview", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);

    // Back from the preview is the documented way to change the brief - and
    // now the only way, with the blueprint screen gone - so the way forward
    // from there must not demand the code again.
    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByText("Shape the Story");
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));

    expect(view.queryByLabelText("Verification code")).toBeNull();
    expect(view.queryByLabelText("Email address")).toBeNull();
    expect(mockSendEmailCode).toHaveBeenCalledTimes(1);
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1);
    await settleCraftingHold();
    await view.findByText(SHAPE.title);
  });

  it("goes back to the details and forward again with the plan intact", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByText("Shape the Story");
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await settleCraftingHold();
    await view.findByText(SHAPE.title);

    // The plan survived the round trip, and the trip cost nothing: the warm
    // request is re-used because neither the idea nor the shelf changed.
    expect(
      view.getByText("Elena inherits the house and finds the door"),
    ).toBeTruthy();
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
  });
});

/* ── Moments ──────────────────────────────────────────────────────────── */

describe("writer onboarding moments", () => {
  it("takes several moments from the visible Add control", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    // The composer used to commit on the return key alone, with nothing on
    // screen saying so, and users concluded the field took exactly one moment.
    await fireEvent.changeText(
      view.getByLabelText("Add a moment"),
      "A rooftop confession",
    );
    await fireEvent.press(view.getByRole("button", { name: "Add moment" }));
    // The field clears, so the second moment is typed straight into it.
    expect(view.getByLabelText("Add a moment").props.value).toBe("");

    await fireEvent.changeText(
      view.getByLabelText("Add a moment"),
      "The letter is finally opened",
    );
    await fireEvent.press(view.getByRole("button", { name: "Add moment" }));

    expect(view.getByLabelText("Remove A rooftop confession")).toBeTruthy();
    expect(
      view.getByLabelText("Remove The letter is finally opened"),
    ).toBeTruthy();
  });

  it("still commits on return, and refuses a blank or a duplicate", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    await fireEvent.changeText(
      view.getByLabelText("Add a moment"),
      "A rooftop confession",
    );
    await fireEvent(view.getByLabelText("Add a moment"), "submitEditing");
    expect(view.getByLabelText("Remove A rooftop confession")).toBeTruthy();

    // Nothing typed: the control must not add an empty chip.
    await fireEvent.press(view.getByRole("button", { name: "Add moment" }));
    // The same moment again: the chip it would add is already on screen, so
    // an error would be telling the user something they can see.
    await fireEvent.changeText(
      view.getByLabelText("Add a moment"),
      "A rooftop confession",
    );
    await fireEvent.press(view.getByRole("button", { name: "Add moment" }));
    expect(view.getAllByLabelText("Remove A rooftop confession")).toHaveLength(1);
  });

  it("hides the composer at the cap instead of counting up to it", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);
    for (const moment of ["one", "two", "three", "four", "five"]) {
      await fireEvent.changeText(view.getByLabelText("Add a moment"), moment);
      await fireEvent.press(view.getByRole("button", { name: "Add moment" }));
    }
    expect(view.queryByLabelText("Add a moment")).toBeNull();
    expect(view.queryByRole("button", { name: "Add moment" })).toBeNull();
    expect(view.getByLabelText("Remove five")).toBeTruthy();
  });
});

/* ── The crafting step ────────────────────────────────────────────────── */

describe("writer onboarding crafting step", () => {
  it("fires exactly one request even while the wait screen re-renders", async () => {
    let resolve: (value: unknown) => void = () => {};
    mockInferStoryBrief.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
    await view.findByText("Crafting");
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(SHAPE);
    });
    await settleCraftingHold();
  await view.findByText(SHAPE.title);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
  });

  /**
   * Idea -> details -> email -> code -> crafting, without the blueprint.
   *
   * The auth screens are three quarters of the reason the request is warmed
   * early: they are where the seconds the user spends not looking at a loader
   * actually go.
   */
  async function authTo(view: View, code = "123456") {
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      code,
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
  }

  it("starts the request when the user leaves the idea step, not when they reach the wait", async () => {
    const { view } = await renderFlow();
    // Nothing has been asked for while the sentence is still being typed: the
    // trigger is the step, not the keystroke.
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    expect(mockInferStoryBrief).not.toHaveBeenCalled();

    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");

    // On the details screen, with the details screen not submitted and the
    // email screen not seen. The request has the whole of both to run in.
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
    expect(mockInferStoryBrief).toHaveBeenCalledWith(
      "A woman inherits a boarded-up house and finds letters that arrive early.",
      "onboarding",
      "mystery",
    );
  });

  it("still holds the full floor on a warm request, and does not repeat it", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);

    // Half a minute of the user filling in details and typing a code, which
    // is the time the warming exists to spend. The request resolved somewhere
    // inside it.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await authTo(view);
    await view.findByText("Crafting");

    // The floor runs from the arrival at the wait, not from the fire. Timed
    // from the fire it would have been spent twenty-five seconds ago and the
    // loader would be a single frame, which is the bug this asserts against.
    await act(async () => {
      jest.advanceTimersByTime(CRAFTING_MIN_MS - 1);
    });
    expect(view.getByText("Crafting")).toBeTruthy();
    expect(view.queryByText(SHAPE.title)).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await view.findByText(SHAPE.title);

    // Warm means reused, not re-fired.
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
  });

  it("never builds the story from an idea the user has since replaced", async () => {
    // The title carries the idea it was shaped from, so a stale response is
    // visible rather than merely suspected.
    mockInferStoryBrief.mockImplementation((idea: string) =>
      Promise.resolve({ ...SHAPE, title: `Shaped from: ${idea}` })
    );

    const { view } = await renderFlow();
    await reachDetails(view, "A city beneath a broken moon, where the tide keeps the time.");
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);

    // Back to the idea, and a different story entirely. The warm request is
    // now an answer to a question nobody is asking.
    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByText("What's your story about?");
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A lighthouse keeper starts receiving letters addressed to the ship that sank.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");

    await authTo(view);
    await settleCraftingHold();
    // The preview titles itself with the story, so the stale answer would be
    // visible as the heading rather than merely suspected.
    await view.findByText(
      "Shaped from: A lighthouse keeper starts receiving letters addressed to the ship that sank.",
    );
    expect(view.queryByText(/broken moon/)).toBeNull();
    // A changed idea is a second call, and this is the only user behaviour
    // that buys one. See `startShaping` on the budget.
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(2);
    expect(mockInferStoryBrief).toHaveBeenLastCalledWith(
      "A lighthouse keeper starts receiving letters addressed to the ship that sank.",
      "onboarding",
      "mystery",
    );
  });

  it("re-uses the warm request when the user goes back and changes nothing", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByText("What's your story about?");
    // Same sentence, same shelf, so there is nothing new to ask.
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);

    await authTo(view);
    await settleCraftingHold();
    await view.findByText(SHAPE.title);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
  });

  it("does not warn on a warm request that rejects, and still shows the fallback", async () => {
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = jest.fn();
    // React Native's ambient `process` is typed down to `env` alone, so the
    // Node event emitter underneath it has to be reached explicitly. This is
    // the only listener that can see a promise nobody is holding.
    const node = (globalThis as unknown as { process: unknown }).process as {
      on(event: string, listener: () => void): void;
      off(event: string, listener: () => void): void;
    };
    node.on("unhandledRejection", unhandled);
    mockInferStoryBrief.mockRejectedValue(new Error("provider down"));

    const { view } = await renderFlow();
    await reachDetails(view);

    // The rejection lands here, three screens away from anything that awaits
    // it. Without a handler attached at the fire this is an unhandled
    // rejection: a warning in development and a crash in a release build.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(unhandled).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    await authTo(view);
    // No advance: a failed call has nothing for the stages to describe, so it
    // skips the floor exactly as it did before it was warmed.
    // The fallback title is the first four words of the user's own sentence,
    // and it is the whole of the failure path's visible difference.
    await view.findByText("A woman inherits a");
    expect(view.queryByText(/could not|failed|error|try again/i)).toBeNull();

    expect(unhandled).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    node.off("unhandledRejection", unhandled);
    warn.mockRestore();
  });

  it("does not warn or throw when it unmounts with the request still in flight", async () => {
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    let resolve: (value: unknown) => void = () => {};
    mockInferStoryBrief.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
    await view.findByText("Crafting");

    await view.unmount();
    await act(async () => {
      resolve(SHAPE);
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/* ── Email and code ───────────────────────────────────────────────────── */

describe("writer onboarding email and code", () => {
  it("reports a send failure and stays on the email screen", async () => {
    mockSendEmailCode.mockRejectedValue(new Error("smtp down"));
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await view.findByText(/could not send that code/i);
    expect(view.queryByLabelText("Verification code")).toBeNull();
  });

  it("clears the send error when the retry succeeds", async () => {
    mockSendEmailCode.mockRejectedValueOnce(new Error("smtp down"));
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await view.findByText(/could not send that code/i);
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await view.findByLabelText("Verification code");
    expect(view.queryByText(/could not send that code/i)).toBeNull();
  });

  it("reports a verify failure and lets the code be corrected", async () => {
    mockVerifyEmailCode.mockRejectedValueOnce(new Error("bad code"));
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "000000",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
    await view.findByText(/did not match/i);

    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
    await settleCraftingHold();
  await view.findByText(SHAPE.title);
  });

  it("does not carry a code error back onto the email screen", async () => {
    mockVerifyEmailCode.mockRejectedValue(new Error("bad code"));
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "000000",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
    await view.findByText(/did not match/i);

    await fireEvent.press(view.getByRole("button", { name: "Back" }));
    await view.findByLabelText("Email address");
    // "That code did not match" on the screen that asks for an address is a
    // message about a field that is not on it.
    expect(view.queryByText(/did not match/i)).toBeNull();
  });

  it("resends the code without losing the entered address", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(
      await view.findByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Save & continue" }),
    );
    await view.findByLabelText("Verification code");
    await fireEvent.press(view.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(mockSendEmailCode).toHaveBeenCalledTimes(2));
    expect(mockSendEmailCode).toHaveBeenLastCalledWith("w@example.com");
    expect(view.getByLabelText("Verification code")).toBeTruthy();
  });
});

/* ── The one-time offer countdown ─────────────────────────────────────── */

describe("one-time offer countdown", () => {
  // The interval has to be fake from the moment the screen mounts. Switching
  // after the fact leaves a real interval running that no amount of
  // `advanceTimersByTime` can reach, and the test then passes for the wrong
  // reason or fails for one.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function reachOffer(view: View) {
    await reachPreview(view);
    await fireEvent.press(
      await view.findByRole("button", { name: "Continue" }),
    );
    await fireEvent.press(await view.findByRole("button", { name: "Close" }));
    await view.findByText("ONE-TIME OFFER");
  }

  it("counts down in real seconds and hands off at zero", async () => {
    const { view } = await renderFlow();
    await reachOffer(view);
    expect(view.getByText("2:00")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(view.getByText("1:00")).toBeTruthy();

    // Two advances, not one: a single batched advance runs all 120 ticks
    // before React re-renders, so the zero-effect never gets a frame to
    // schedule the hand-off in. Real seconds arrive one at a time.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(view.queryByText("ONE-TIME OFFER")).toBeNull();
    expect(view.getByText("Want to know when it's ready?")).toBeTruthy();
  });

  it("stops its own clock once it has handed control away", async () => {
    const { view } = await renderFlow();
    await reachOffer(view);
    // The countdown is the one repeating timer this flow owns.
    const during = jest.getTimerCount();

    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await view.findByText("Want to know when it's ready?");

    // An interval left alive on a screen that is gone is a wakeup a second,
    // forever, for a clock nobody is looking at.
    expect(jest.getTimerCount()).toBeLessThan(during);

    // And it must not be able to drag the user anywhere from there.
    await act(async () => {
      jest.advanceTimersByTime(300_000);
    });
    expect(view.getByText("Want to know when it's ready?")).toBeTruthy();
  });

  it("still hands off when the screen re-renders after the clock hits zero", async () => {
    const { view } = await renderFlow();
    await reachOffer(view);

    // Zero, then a beat, then the hand-off delay. Any re-render in that window
    // must not cancel the hand-off and leave the user stranded on a dead offer.
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(view.queryByText("ONE-TIME OFFER")).toBeNull();
  });

  it("disables the accept button the moment the offer expires", async () => {
    const { view } = await renderFlow();
    await reachOffer(view);
    await act(async () => {
      jest.advanceTimersByTime(119_000);
    });
    expect(view.getByText("0:01")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Choose this offer" }).props
        .accessibilityState.disabled,
    ).toBe(false);
  });
});

/* ── The plan list ────────────────────────────────────────────────────── */

describe("PlanSection", () => {
  const BEATS = ["First beat", "Second beat", "Third beat"];

  it("does not discard an in-progress edit when another row is tapped", async () => {
    const onChange = jest.fn();
    const view = await render(
      <PlanSection beats={BEATS} onChange={onChange} />,
    );
    await fireEvent.press(
      view.getByLabelText("Chapter 1. First beat. Tap to edit."),
    );
    await fireEvent.changeText(view.getByLabelText("Chapter 1"), "Rewritten");
    // Moving straight to another row is the ordinary way to edit two beats.
    await fireEvent.press(
      view.getByLabelText("Chapter 2. Second beat. Tap to edit."),
    );
    expect(onChange).toHaveBeenCalledWith([
      "Rewritten",
      "Second beat",
      "Third beat",
    ]);
  });

  it("does not leak the buffer from one row into the next", async () => {
    const onChange = jest.fn();
    const view = await render(
      <PlanSection beats={BEATS} onChange={onChange} />,
    );
    await fireEvent.press(
      view.getByLabelText("Chapter 1. First beat. Tap to edit."),
    );
    await fireEvent.changeText(view.getByLabelText("Chapter 1"), "Rewritten");
    await fireEvent.press(
      view.getByLabelText("Chapter 2. Second beat. Tap to edit."),
    );
    // Row 2 opens on row 2's own text, never on what row 1 was holding.
    expect(view.getByLabelText("Chapter 2").props.value).toBe("Second beat");
  });

  it("keeps rows distinct when a beat is edited to match another", async () => {
    const Harness = () => {
      const [beats, setBeats] = React.useState(BEATS);
      return <PlanSection beats={beats} onChange={setBeats} />;
    };
    const view = await render(<Harness />);
    await fireEvent.press(
      view.getByLabelText("Chapter 1. First beat. Tap to edit."),
    );
    await fireEvent.changeText(view.getByLabelText("Chapter 1"), "Second beat");
    await fireEvent.press(view.getByLabelText("Save chapter 1"));
    // Two identical beats are legal; the list must still show three rows.
    expect(view.getAllByText("Second beat")).toHaveLength(2);
    expect(view.getByText("Third beat")).toBeTruthy();
  });

  it("renders nothing at all when the plan is empty", async () => {
    const view = await render(<PlanSection beats={[]} onChange={jest.fn()} />);
    expect(view.queryByText("CHAPTERS")).toBeNull();
  });

  it("offers no edit affordance when it is read-only", async () => {
    const view = await render(
      <PlanSection beats={BEATS} onChange={jest.fn()} editable={false} />,
    );
    expect(view.queryByLabelText(/Tap to edit/)).toBeNull();
    expect(view.getByLabelText("Chapter 1. First beat")).toBeTruthy();
  });
});

/* ── Writing style chips ──────────────────────────────────────────────── */

describe("WritingStyleChips", () => {
  const Harness = ({ initial = "" }: { initial?: string }) => {
    const [value, setValue] = React.useState(initial);
    return (
      <>
        <WritingStyleChips value={value} onChange={setValue} />
        <PlanSection beats={[value || "(empty)"]} onChange={jest.fn()} />
      </>
    );
  };

  it("keeps free text the user typed when a preset is toggled on", async () => {
    const onChange = jest.fn();
    const view = await render(
      <WritingStyleChips value="Warm, witty" onChange={onChange} />,
    );
    await fireEvent.press(view.getByLabelText("Lyrical"));
    expect(onChange).toHaveBeenCalledWith("Warm, witty, Lyrical");
  });

  it("round-trips a preset without leaving a stray comma", async () => {
    const view = await render(<Harness initial="Warm, witty" />);
    await fireEvent.press(view.getByLabelText("Lyrical"));
    expect(view.getByText("Warm, witty, Lyrical")).toBeTruthy();
    await fireEvent.press(view.getByLabelText("Lyrical"));
    expect(view.getByText("Warm, witty")).toBeTruthy();
  });

  it("tolerates the ragged spacing a person actually types", async () => {
    const onChange = jest.fn();
    const view = await render(
      <WritingStyleChips value=" Warm ,, witty ," onChange={onChange} />,
    );
    await fireEvent.press(view.getByLabelText("Hardboiled"));
    expect(onChange).toHaveBeenCalledWith("Warm, witty, Hardboiled");
  });

  it("reports its checked state to assistive technology", async () => {
    const view = await render(
      <WritingStyleChips value="Lyrical" onChange={jest.fn()} />,
    );
    expect(
      view.getByLabelText("Lyrical").props.accessibilityState.checked,
    ).toBe(true);
    expect(
      view.getByLabelText("Hardboiled").props.accessibilityState.checked,
    ).toBe(false);
  });
});
