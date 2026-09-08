import React from "react";
import { Alert } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { EditStoryScreen } from "@/components/reader/EditStoryScreen";
import type { Chapter, Story } from "@/types/domain";

const mockEditParagraph = jest.fn();
const mockPublishStory = jest.fn();

jest.mock("@/lib/api", () => ({
  editParagraph: (...args: unknown[]) => mockEditParagraph(...args),
  publishStory: (...args: unknown[]) => mockPublishStory(...args),
}));

/**
 * A single-paragraph chapter, on purpose: the AI wand targets whichever
 * paragraph the cursor sits in, and `fireEvent.changeText` does not move a
 * real cursor. With exactly one paragraph, "wherever the cursor is" and
 * "paragraph 0" are the same place, so these tests do not need to fake a
 * selection event to know what they are asserting on.
 */
const chapter: Chapter = {
  id: "chapter-1",
  storyId: "story-1",
  title: "Chapter One",
  paragraphs: ["The lighthouse keeper climbed the stairs one last time."],
  chapterNumber: 1,
  isPublished: true,
};

const story: Story = {
  id: "story-1",
  title: "The Last Lighthouse Keeper",
  authorId: "me",
  genre: "mystery",
  synopsis: "A keeper faces one final night.",
  chapters: [chapter],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockPublishStory.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

async function openWand(view: Awaited<ReturnType<typeof render>>, prompt: string) {
  // Idempotent: the wand sheet may already be open from an earlier call in
  // the same test (regenerating a second time does not close it), and its
  // header toggle relabels to "Close AI rewrite" once it is.
  if (!view.queryByLabelText("AI rewrite prompt")) {
    await act(async () => {
      await fireEvent.press(view.getByLabelText("Rewrite with AI"));
    });
  }
  await act(async () => {
    fireEvent.changeText(view.getByLabelText("AI rewrite prompt"), prompt);
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText("Rewrite with AI"));
  });
}

it("fires exactly one AI rewrite request on a double tap of the wand", async () => {
  let resolveEdit: ((value: string) => void) | undefined;
  mockEditParagraph.mockImplementationOnce(
    () => new Promise((resolve) => { resolveEdit = resolve; })
  );

  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Rewrite with AI"));
  });
  await act(async () => {
    fireEvent.changeText(
      view.getByLabelText("AI rewrite prompt"),
      "make this sadder",
    );
  });

  const submit = view.getByLabelText("Rewrite with AI");
  await act(async () => {
    fireEvent.press(submit);
    fireEvent.press(submit);
  });

  expect(mockEditParagraph).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveEdit?.("A sadder opening line.");
    await Promise.resolve();
  });

  expect(mockEditParagraph).toHaveBeenCalledTimes(1);
});

it("hands the current text back to onClose", async () => {
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  const input = view.getByLabelText("Chapter text");
  await act(async () => {
    fireEvent.changeText(input, "A hand-edited opening.");
  });

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Close editor"));
  });

  await waitFor(() => expect(onClose).toHaveBeenCalledWith("A hand-edited opening."));
});

it("debounces a manual edit into a single save request", async () => {
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );
  const input = view.getByLabelText("Chapter text");

  await act(async () => {
    fireEvent.changeText(input, "F");
    fireEvent.changeText(input, "Fi");
    fireEvent.changeText(input, "Fir");
    fireEvent.changeText(input, "First rewritten sentence.");
  });

  await waitFor(() => expect(mockPublishStory).toHaveBeenCalledTimes(1));
  expect(mockPublishStory).toHaveBeenCalledWith("story-1", {
    chapters: [{ id: "chapter-1", content: "First rewritten sentence." }],
    visibility: "public",
  });
});

it("does not offer revert before any regeneration has happened", async () => {
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  expect(view.queryByLabelText("Revert to previous version")).toBeNull();
});

it("restores the previous text exactly after one regeneration", async () => {
  mockEditParagraph.mockResolvedValueOnce("The keeper climbed the stairs, afraid, one last time.");

  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );
  const input = view.getByLabelText("Chapter text");
  const original = input.props.value;

  await openWand(view, "make it more afraid");

  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(
      "The keeper climbed the stairs, afraid, one last time.",
    )
  );
  await waitFor(() => expect(view.getByLabelText("Revert to previous version")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Revert to previous version"));
  });

  expect(view.getByLabelText("Chapter text").props.value).toBe(original);
  expect(view.queryByLabelText("Revert to previous version")).toBeNull();
});

it("after a second regeneration, revert goes back only one step and the older version is gone", async () => {
  mockEditParagraph.mockResolvedValueOnce("Version two of the opening line.");
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  await openWand(view, "first rewrite");
  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(
      "Version two of the opening line.",
    )
  );

  mockEditParagraph.mockResolvedValueOnce("Version three of the opening line.");
  await openWand(view, "second rewrite");
  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(
      "Version three of the opening line.",
    )
  );

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Revert to previous version"));
  });

  // Back only to the version right before the SECOND regeneration - the
  // original text from before the first regeneration is gone for good.
  expect(view.getByLabelText("Chapter text").props.value).toBe(
    "Version two of the opening line.",
  );
  expect(view.queryByLabelText("Revert to previous version")).toBeNull();
});

it("keeps the current text and offers a retry when a regeneration fails", async () => {
  mockEditParagraph.mockRejectedValueOnce(new Error("the model timed out"));
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );
  const original = view.getByLabelText("Chapter text").props.value;

  await openWand(view, "darker tone");

  await waitFor(() => expect(view.getByLabelText("Retry AI rewrite")).toBeTruthy());
  expect(view.getByLabelText("Chapter text").props.value).toBe(original);
  expect(view.queryByLabelText("Revert to previous version")).toBeNull();

  mockEditParagraph.mockResolvedValueOnce("A darker opening line.");
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Retry AI rewrite"));
  });

  await waitFor(() =>
    expect(view.getByLabelText("Chapter text").props.value).toBe(
      "A darker opening line.",
    )
  );
  expect(mockEditParagraph).toHaveBeenCalledTimes(2);
});

it("keeps the reader's text and offers a retry when a save fails", async () => {
  mockPublishStory.mockRejectedValueOnce(new Error("network down"));
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );
  const input = view.getByLabelText("Chapter text");

  await act(async () => {
    fireEvent.changeText(input, "A change that will fail to save.");
  });

  await waitFor(() => expect(view.getByLabelText("Retry save")).toBeTruthy());
  expect(view.getByLabelText("Chapter text").props.value).toBe(
    "A change that will fail to save.",
  );

  mockPublishStory.mockResolvedValueOnce(undefined);
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Retry save"));
  });

  await waitFor(() => expect(view.queryByLabelText("Retry save")).toBeNull());
  expect(mockPublishStory).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText("Chapter text").props.value).toBe(
    "A change that will fail to save.",
  );
});

it("saves an edit typed immediately before closing instead of losing it (findings 1 and 2)", async () => {
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );
  const input = view.getByLabelText("Chapter text");

  // Typed, then closed straight away - well inside the default 900ms
  // debounce, so the timer has not fired yet.
  await act(async () => {
    fireEvent.changeText(input, "Typed a moment before closing.");
  });
  await act(async () => {
    await fireEvent.press(view.getByLabelText("Close editor"));
  });

  await waitFor(() => expect(mockPublishStory).toHaveBeenCalledTimes(1));
  expect(mockPublishStory).toHaveBeenCalledWith("story-1", {
    chapters: [{ id: "chapter-1", content: "Typed a moment before closing." }],
    visibility: "public",
  });
  expect(onClose).toHaveBeenCalledWith("Typed a moment before closing.");
});

it("does not vanish a failed save on close - it asks before discarding it (finding 7)", async () => {
  const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockPublishStory.mockRejectedValue(new Error("network down"));

  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );
  const input = view.getByLabelText("Chapter text");

  await act(async () => {
    fireEvent.changeText(input, "A change that will never save.");
  });
  await waitFor(() => expect(view.getByLabelText("Retry save")).toBeTruthy());

  await act(async () => {
    await fireEvent.press(view.getByLabelText("Close editor"));
  });

  // The close is intercepted, not silently allowed through: the editor is
  // still on screen and the writer was asked, rather than told nothing.
  expect(onClose).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledWith(
    "Couldn't save your edit",
    expect.stringContaining("couldn't be saved"),
    expect.arrayContaining([
      expect.objectContaining({ text: "Keep Editing" }),
      expect.objectContaining({ text: "Discard & Close" }),
    ]),
  );

  // Choosing to discard closes with the last text the server actually has -
  // the chapter's original content - never the unsaved edit, so the reader
  // screen is never handed text as if it had been saved when it had not.
  const [, , buttons] = alertSpy.mock.calls[0];
  const discard = buttons?.find((button) => button.text === "Discard & Close");
  await act(async () => {
    discard?.onPress?.();
  });

  expect(onClose).toHaveBeenCalledWith(
    "The lighthouse keeper climbed the stairs one last time.",
  );

  alertSpy.mockRestore();
});
