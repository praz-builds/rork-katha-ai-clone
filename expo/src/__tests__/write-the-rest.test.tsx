/**
 * "Write the rest" is a loop over the single-chapter path, and these are the
 * ways that promise can be broken silently.
 *
 * §10.2: "It is not a second mode — each chapter is still its own request, its
 * own reservation and its own credit." Everything asserted here is a
 * consequence of that sentence. A run that retried a failure would charge twice
 * for one chapter. A run that started without quoting itself would spend a
 * balance the writer never agreed to. A Stop that abandoned the chapter in
 * flight would take a credit for prose nobody sees. A run that reused the
 * reader's one-chapter steer would invisibly aim it at six more. And a run
 * whose quote bills for something nothing charges refuses chapters the writer
 * can afford.
 *
 * There is no resume suite. Resume is not implemented — see the unmount
 * teardown in `CreateStudioScreen` and §10.2 — and the tests that used to be
 * here only passed because they generated the story inside the same mount,
 * which is the one situation the shipped app never reaches.
 */

/* eslint-disable import/first */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockInferStoryBrief = jest.fn();
const mockContinueStoryStreaming = jest.fn();
const mockLoadDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockClearDraft = jest.fn();
const mockExpoFetch = jest.fn();

jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  pushPermissionGranted: jest.fn().mockResolvedValue(false),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
      }),
    },
  },
}));

// Chapter 1 goes through the real streaming path — it is the cheapest way to
// reach the editor in the state a writer reaches it in. Only the continuation
// is stubbed, because the run is nothing but a sequence of those.
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    continueStoryStreaming: (...args: unknown[]) =>
      mockContinueStoryStreaming(...args),
    createGenerationRequestId: () => "write-the-rest-request",
  };
});

jest.mock("@/lib/draft-storage", () => ({
  loadDraft: () => mockLoadDraft(),
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  clearDraft: () => mockClearDraft(),
}));

jest.mock("@/components/GeneratingOverlay", () => () => null);

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) =>
      R.createElement(Text, null, `${credits} credits`),
    PrimaryButton: (
      { children, onPress }: { children: React.ReactNode; onPress: () => void },
    ) =>
      R.createElement(
        Pressable,
        { accessibilityRole: "button", onPress },
        R.createElement(Text, null, children),
      ),
  };
});

import CreateStudioScreen from "@/screens/CreateStudioScreen";
/* eslint-enable import/first */

const CHAPTER_ONE_SSE =
  'event: done\ndata: {"story":{"id":"story-1","title":"The Quiet Door","author_id":"author-1","primary_genre":"adventure","story_mode":"series","themes":["doors"],"word_count":9,"status":"complete"},"chapter":{"id":"chapter-1","chapter_number":1,"title":"Chapter 1","content":"The door was not there yesterday.\\n\\nShe pushed it open."}}\n\n';

function completedStream(frame: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function chapterPayload(n: number) {
  return {
    model: "test-model",
    chapter: {
      id: `chapter-${n}`,
      storyId: "story-1",
      chapterNumber: n,
      title: `Chapter ${n}`,
      paragraphs: [`Chapter ${n} went down further than the building was tall.`],
      isPublished: false,
    },
  };
}

/**
 * Drive Create to an editor holding three chapters of a seven-chapter plan.
 *
 * Three is the floor §10.2 sets for the offer, and seven is the smallest
 * planned length that leaves anything for a run to do — a three-chapter story
 * reaches the floor and the ceiling in the same breath, which is exactly why
 * the control must not appear on one.
 */
async function renderAtThreeChapters(creditsAtRunTime = 12) {
  mockExpoFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: completedStream(CHAPTER_ONE_SSE),
    json: async () => ({}),
  });

  const onCreditUsed = jest.fn();
  // Starting a story needs 3 credits, so the setup always runs on a balance
  // that can afford it. The balance the *run* is quoted against is applied
  // afterwards by a re-render, which is also how it moves in the real app: the
  // parent owns it and hands it down.
  const props = {
    initialDraft: { plannedChapterCount: 7 as const },
    onCreditUsed,
    onPublished: jest.fn(),
    onBack: jest.fn(),
  };
  const view = await render(
    <CreateStudioScreen credits={Math.max(3, creditsAtRunTime)} {...props} />,
  );

  await fireEvent.changeText(
    view.getByLabelText("Story idea"),
    "A child finds a door in an old library that was not there yesterday.",
  );
  await view.findByRole("button", { name: "Add a character" });

  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: /create/i }));
  });
  await view.findByTestId("continue-chapter-button");

  // Two ordinary single-chapter Continues. The run must be reachable only from
  // a story the writer has already paid for one chapter at a time.
  for (const n of [2, 3]) {
    mockContinueStoryStreaming.mockResolvedValueOnce(chapterPayload(n));
    await act(async () => {
      fireEvent.press(view.getByTestId("continue-chapter-button"));
    });
    await view.findByTestId("continue-chapter-button");
  }

  if (creditsAtRunTime < 3) {
    await act(async () => {
      view.rerender(
        <CreateStudioScreen credits={creditsAtRunTime} {...props} />,
      );
    });
  }

  // Everything before this point is setup spend: 3 to create the story, then
  // 1 for each of the two single-chapter Continues.
  const spendBeforeRun = onCreditUsed.mock.calls.length;
  return { view, onCreditUsed, spendBeforeRun };
}

/** A continuation whose resolution the test controls. */
function deferContinuations() {
  const pending: {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  mockContinueStoryStreaming.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return pending;
}

beforeEach(() => {
  mockExpoFetch.mockReset();
  mockInferStoryBrief.mockReset().mockResolvedValue({
    genres: ["adventure"],
    whereAndWhen: "A quiet library, present day",
    characters: [],
    suggestedMoments: [],
  });
  mockContinueStoryStreaming.mockReset();
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Write the rest — when it is offered", () => {
  it("is offered from chapter 3 of a seven-chapter plan", async () => {
    const { view } = await renderAtThreeChapters();
    expect(view.getByTestId("write-the-rest-button")).toBeTruthy();
  });

  it("is not offered at chapter 1", async () => {
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: completedStream(CHAPTER_ONE_SSE),
      json: async () => ({}),
    });
    const view = await render(
      <CreateStudioScreen
        credits={12}
        initialDraft={{ plannedChapterCount: 7 }}
        onCreditUsed={jest.fn()}
        onPublished={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await fireEvent.changeText(
      view.getByLabelText("Story idea"),
      "A child finds a door in an old library that was not there yesterday.",
    );
    await view.findByRole("button", { name: "Add a character" });
    await act(async () => {
      fireEvent.press(view.getByRole("button", { name: /create/i }));
    });
    await view.findByTestId("continue-chapter-button");

    expect(view.queryByTestId("write-the-rest-button")).toBeNull();
  });
});

describe("Write the rest — the itemised confirm", () => {
  it("quotes one credit per chapter and spends nothing while it is open", async () => {
    const { view, onCreditUsed, spendBeforeRun } =
      await renderAtThreeChapters();

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });

    const sheet = await view.findByTestId("write-the-rest-confirm");
    expect(sheet).toBeTruthy();
    // 4 chapters remain of 7, at the one credit `continue-story` actually
    // charges for each.
    expect(view.getByText("Chapters 4 to 7")).toBeTruthy();
    expect(view.getByText("Chapter text · 1 credit each")).toBeTruthy();
    expect(view.getByTestId("write-the-rest-total").props.children.join(""))
      .toBe("4 credits");

    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(2);
    expect(onCreditUsed).toHaveBeenCalledTimes(spendBeforeRun);
  });

  it("does not bill for chapter art, because nothing charges for it", async () => {
    // The regression this exists to stop: `chapter_art` is an enum value on
    // `generation_operations.kind` and nothing else — no caller reserves it and
    // `continue-story` never reads `illustrate_chapters` — so an illustrated
    // run costs exactly what an unillustrated one costs. Quoting 2 credits a
    // chapter would not only overstate the bill, it would offer half a run the
    // writer's 8 credits cover in full.
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: completedStream(CHAPTER_ONE_SSE),
      json: async () => ({}),
    });
    const view = await render(
      <CreateStudioScreen
        credits={8}
        initialDraft={{ plannedChapterCount: 7, illustrateChapters: true }}
        onCreditUsed={jest.fn()}
        onPublished={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await fireEvent.changeText(
      view.getByLabelText("Story idea"),
      "A child finds a door in an old library that was not there yesterday.",
    );
    await view.findByRole("button", { name: "Add a character" });
    await act(async () => {
      fireEvent.press(view.getByRole("button", { name: /create/i }));
    });
    await view.findByTestId("continue-chapter-button");
    for (const n of [2, 3]) {
      mockContinueStoryStreaming.mockResolvedValueOnce(chapterPayload(n));
      await act(async () => {
        fireEvent.press(view.getByTestId("continue-chapter-button"));
      });
      await view.findByTestId("continue-chapter-button");
    }

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");

    expect(view.queryByText(/Chapter art/)).toBeNull();
    expect(view.getByTestId("write-the-rest-total").props.children.join(""))
      .toBe("4 credits");
    // The whole remainder is on offer, not half of it, and there is no
    // shortfall to report.
    expect(view.queryByTestId("write-the-rest-shortfall")).toBeNull();
    expect(view.getByLabelText("Write 4 chapters for 4 credits")).toBeTruthy();
  });

  it("reports a short balance before any spend, and offers what it covers", async () => {
    // 3 credits against a 4-credit run. §"You pay as each chapter is written"
    // makes the honest answer "it will write three of the four", not a refusal
    // — but it has to be said out loud, in advance, and the button has to agree
    // with it.
    const { view } = await renderAtThreeChapters(3);

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");

    const shortfall = view.getByTestId("write-the-rest-shortfall");
    expect(shortfall.props.children).toContain(
      "You have 3 credits and this run needs 4. It will write 3 of the 4 chapters and stop there. You keep every chapter it writes.",
    );
    expect(
      view.getByLabelText("Write 3 chapters for 3 credits"),
    ).toBeTruthy();
    // Nothing has been requested.
    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(2);
  });

  it("offers no run at all when the balance cannot reach one chapter", async () => {
    const { view } = await renderAtThreeChapters(0);

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");

    expect(view.queryByTestId("write-the-rest-confirm-button")).toBeNull();
    expect(
      view.getByTestId("write-the-rest-shortfall").props.children,
    ).toContain(
      "You have 0 credits, and one more chapter needs 1. Nothing has been spent.",
    );
  });
});

describe("Write the rest — the run", () => {
  it("stops after the chapter in flight and keeps every chapter written", async () => {
    const { view } = await renderAtThreeChapters();
    const pending = deferContinuations();

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-confirm-button"));
    });

    await view.findByTestId("write-the-rest-run-bar");
    expect(view.getByText("Chapter 4 of 7")).toBeTruthy();

    // Stop while chapter 4 is being written. It must not be abandoned: the
    // reservation is already made and the prose is already being paid for.
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-stop"));
    });
    expect(view.getByText(/Stopping when this chapter is finished/)).toBeTruthy();

    await act(async () => {
      pending[0].resolve(chapterPayload(4));
    });

    await waitFor(() =>
      expect(view.queryByTestId("write-the-rest-run-bar")).toBeNull()
    );
    // Two setup continues plus exactly one from the run. Chapters 5, 6 and 7
    // were never requested and never charged.
    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(3);
    expect(view.getByTestId("write-the-rest-notice").props.children).toContain(
      "Stopped. 1 chapter was written and kept. Continue whenever you want the next one.",
    );
    // The chapter that was in flight is in the story, not half-saved.
    expect(view.getByText(/Chapter 4 went down further/)).toBeTruthy();
  });

  it("writes chapter after chapter to the target, then settles in the editor", async () => {
    const { view, onCreditUsed, spendBeforeRun } =
      await renderAtThreeChapters();
    for (const n of [4, 5, 6, 7]) {
      mockContinueStoryStreaming.mockResolvedValueOnce(chapterPayload(n));
    }

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-confirm-button"));
    });

    await waitFor(() =>
      expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(6)
    );
    await waitFor(() =>
      expect(view.queryByTestId("write-the-rest-run-bar")).toBeNull()
    );
    // Six chapters, six credits, six separate requests — one per chapter, which
    // is the whole of §10.2's "not a second mode".
    expect(onCreditUsed.mock.calls.slice(spendBeforeRun)).toEqual([
      [1],
      [1],
      [1],
      [1],
    ]);
    // The plan is full, so neither Continue nor another run is on offer.
    expect(view.queryByTestId("write-the-rest-button")).toBeNull();
    expect(view.queryByTestId("continue-chapter-button")).toBeNull();
  });

  it("halts on the first failure and never retries it", async () => {
    const { view } = await renderAtThreeChapters();
    const pending = deferContinuations();

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-confirm-button"));
    });
    await view.findByTestId("write-the-rest-run-bar");

    await act(async () => {
      pending[0].reject(new Error("the model went away"));
    });

    await waitFor(() =>
      expect(view.queryByTestId("write-the-rest-run-bar")).toBeNull()
    );
    // One attempt. A retry inside the loop would spend a second credit on the
    // chapter the single-chapter path has already refunded.
    expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(3);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Write the rest stopped",
      expect.stringContaining("the model went away"),
    );
    // Everything written before the failure is still here.
    expect(view.getByText(/Chapter 3 went down further/)).toBeTruthy();
    expect(view.getByTestId("write-the-rest-button")).toBeTruthy();
  });
});

describe("Write the rest — the reader's steer", () => {
  it("does not send What happens next? and does not consume it", async () => {
    const { view } = await renderAtThreeChapters();

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("next-instruction-input"),
        "She finds her brother on the other side.",
      );
    });

    mockContinueStoryStreaming.mockResolvedValueOnce(chapterPayload(4));
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");
    // The sheet says which of the two behaviours this is, rather than leaving
    // the reader to infer it from a chapter that ignored them.
    expect(
      view.getByText(/steers a single chapter, so a run does not use it/),
    ).toBeTruthy();

    mockContinueStoryStreaming.mockReset();
    for (const n of [4, 5, 6, 7]) {
      mockContinueStoryStreaming.mockResolvedValueOnce(chapterPayload(n));
    }
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-confirm-button"));
    });
    await waitFor(() =>
      expect(mockContinueStoryStreaming).toHaveBeenCalledTimes(4)
    );

    // Position 5 is `nextInstruction`. Not once, not on the first chapter.
    for (const call of mockContinueStoryStreaming.mock.calls) {
      expect(call[5]).toBeUndefined();
    }
  });

  it("leaves the typed direction in the box for the next single Continue", async () => {
    const { view } = await renderAtThreeChapters();

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("next-instruction-input"),
        "She finds her brother on the other side.",
      );
    });

    const pending = deferContinuations();
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-confirm-button"));
    });
    await view.findByTestId("write-the-rest-run-bar");
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-stop"));
    });
    await act(async () => {
      pending[0].resolve(chapterPayload(4));
    });

    const input = await view.findByTestId("next-instruction-input");
    expect(input.props.value).toBe("She finds her brother on the other side.");
  });
});

describe("Write the rest — what the run says when it is over", () => {
  it("reports a run that halted on the final chapter of the plan", async () => {
    // The notice used to live inside the Continue block, which hides itself
    // once the plan is full — so the one ending that most needs explaining, the
    // run that stopped *on* the last chapter, said nothing at all. Here the
    // Stop is pressed while chapter 7 of 7 is in flight: the chapter lands, the
    // plan fills, Continue and the run offer both disappear, and the notice is
    // the only thing left that can account for what happened.
    const { view } = await renderAtThreeChapters();
    const pending = deferContinuations();

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-button"));
    });
    await view.findByTestId("write-the-rest-confirm");
    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-confirm-button"));
    });
    await view.findByTestId("write-the-rest-run-bar");

    for (const n of [4, 5, 6]) {
      await act(async () => {
        pending[n - 4].resolve(chapterPayload(n));
      });
      await waitFor(() => expect(pending.length).toBe(n - 2));
    }

    await act(async () => {
      fireEvent.press(view.getByTestId("write-the-rest-stop"));
    });
    await act(async () => {
      pending[3].resolve(chapterPayload(7));
    });

    await waitFor(() =>
      expect(view.queryByTestId("write-the-rest-run-bar")).toBeNull()
    );
    expect(view.queryByTestId("continue-chapter-button")).toBeNull();
    expect(view.queryByTestId("write-the-rest-button")).toBeNull();
    expect(view.getByTestId("write-the-rest-notice").props.children).toContain(
      "Stopped. 4 chapters were written and kept. Continue whenever you want the next one.",
    );
  });
});
