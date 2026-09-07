/**
 * The reader's steer reaches the request, and does not outlive it.
 *
 * `continue-story` has accepted `next_instruction` — and `story-prompts.ts` has
 * rendered it with a precedence rule that beats the plan — for as long as the
 * endpoint has existed. The client never sent it, so the whole feature was one
 * unpassed argument away from working and nothing failed to say so.
 *
 * These tests hold the two halves of that argument that a type signature cannot
 * check: blank must collapse to `undefined` rather than `""`, because an empty
 * string still renders the reader-direction block in the prompt and tells the
 * model a steer exists when none does; and a used direction must be cleared,
 * because a direction that survives keeps steering chapters the reader never
 * aimed it at, invisibly.
 */

/* eslint-disable import/first */
import React from "react";
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

// Chapter 1 goes through the real streaming path, because that is the cheapest
// way to reach the editor in the state a reader reaches it in. Only the
// continuation call is stubbed, since its arguments are the subject here.
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    continueStoryStreaming: (...args: unknown[]) =>
      mockContinueStoryStreaming(...args),
    createGenerationRequestId: () => "continuation-direction-request",
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
  'event: done\ndata: {"story":{"id":"story-1","title":"The Quiet Door","author_id":"author-1","primary_genre":"adventure","story_mode":"standalone","themes":["doors"],"word_count":9,"status":"complete"},"chapter":{"id":"chapter-1","chapter_number":1,"title":"Chapter 1","content":"The door was not there yesterday.\\n\\nShe pushed it open."}}\n\n';

function completedStream(frame: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

/** Drives Create through chapter 1 and leaves the screen in the editor. */
async function renderAtEditor() {
  mockExpoFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: completedStream(CHAPTER_ONE_SSE),
    json: async () => ({}),
  });

  const view = await render(
    <CreateStudioScreen
      credits={12}
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
  // The setup screen's Create button now opens the pre-generation review
  // screen; its own Create button is the one that actually fires generation.
  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: /create/i }));
  });
  await view.findByTestId("continue-chapter-button");
  return view;
}

beforeEach(() => {
  mockExpoFetch.mockReset();
  mockInferStoryBrief.mockReset().mockResolvedValue({
    genres: ["adventure"],
    whereAndWhen: "A quiet library, present day",
    characters: [],
    suggestedMoments: [],
  });
  mockContinueStoryStreaming.mockReset().mockResolvedValue({
    model: "test-model",
    chapter: {
      id: "chapter-2",
      chapterNumber: 2,
      title: "Chapter 2",
      paragraphs: ["The stairs went down further than the building was tall."],
      isPublished: false,
    },
  });
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
});

describe("What happens next?", () => {
  it("sends no direction at all when the box is left blank", async () => {
    const view = await renderAtEditor();

    await act(async () => {
      fireEvent.press(view.getByTestId("continue-chapter-button"));
    });

    await waitFor(() => expect(mockContinueStoryStreaming).toHaveBeenCalled());
    const args = mockContinueStoryStreaming.mock.calls[0];
    // Position 5 is `nextInstruction`. `undefined`, not `""` — an empty string
    // is a direction as far as the prompt builder is concerned.
    expect(args[5]).toBeUndefined();
  });

  it("trims a typed direction and forwards it", async () => {
    const view = await renderAtEditor();

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("next-instruction-input"),
        "   She finds her brother on the other side.   ",
      );
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("continue-chapter-button"));
    });

    await waitFor(() => expect(mockContinueStoryStreaming).toHaveBeenCalled());
    expect(mockContinueStoryStreaming.mock.calls[0][5]).toBe(
      "She finds her brother on the other side.",
    );
  });

  it("clears the box once the chapter it steered has been written", async () => {
    const view = await renderAtEditor();

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("next-instruction-input"),
        "She finds her brother on the other side.",
      );
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("continue-chapter-button"));
    });

    // Chapter 3 of a 3-chapter plan is still to come, so the box is back — and
    // it must be back empty, or chapter 3 inherits chapter 2's direction.
    const input = await view.findByTestId("next-instruction-input");
    await waitFor(() => expect(input.props.value).toBe(""));
  });

  it("keeps the direction when the continuation fails before any prose", async () => {
    // The reader typed it, we lost it. Making them retype it would charge them
    // for our failure in the only currency they have here.
    mockContinueStoryStreaming.mockRejectedValueOnce(new Error("offline"));
    const view = await renderAtEditor();

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId("next-instruction-input"),
        "She finds her brother on the other side.",
      );
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("continue-chapter-button"));
    });

    const input = await view.findByTestId("next-instruction-input");
    expect(input.props.value).toBe("She finds her brother on the other side.");
  });
});
