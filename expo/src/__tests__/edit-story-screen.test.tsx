/**
 * Edit is a notepad.
 *
 * It used to be a small word processor reached from the reader's chrome: a wand
 * bar that rewrote whichever paragraph the cursor sat in, a find bar, a
 * one-step revert of the last AI rewrite, and an autosave that raced the
 * writer's typing. Product replaced all of it with one text field, one title
 * field and a Save button - rewriting a chapter with a prompt is Reimagine's
 * job, reached from the same chrome.
 *
 * These tests pin what a notepad has to get right: the words are the writer's
 * until they press Save, leaving with unsaved changes asks first, and a failed
 * save never eats what they typed.
 */

import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { EditStoryScreen } from "@/components/reader/EditStoryScreen";
import { __resetChapterSaveQueue } from "@/lib/chapter-save-queue";
import type { Chapter, Story } from "@/types/domain";

const mockSaveChapter = jest.fn();

// The queue is real. It is what makes Save optimistic, so faking it away would
// leave these tests asserting against a version of the screen that does not
// ship. Only the network primitive under it is replaced.
jest.mock("@/lib/chapter-save", () => {
  const actual = jest.requireActual("@/lib/chapter-save");
  return { ...actual, saveChapter: (...args: unknown[]) => mockSaveChapter(...args) };
});

const chapter: Chapter = {
  id: "chapter-1",
  storyId: "story-1",
  title: "Chapter One",
  paragraphs: [
    "The lighthouse keeper climbed the stairs one last time.",
    "The lamp had not been lit in a year.",
  ],
  chapterNumber: 1,
  isPublished: true,
};

const story: Story = {
  id: "story-1",
  title: "The Last Lighthouse Keeper",
  authorId: "me",
  genre: "mystery",
  storyMode: "series",
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
  mockSaveChapter.mockReset();
  mockSaveChapter.mockResolvedValue({ titleSaved: true });
  // The queue is module-level state; a failure left in it would follow the next
  // test into the reader.
  __resetChapterSaveQueue();
});

afterEach(() => {
  cleanup();
});

it("opens on the whole chapter as one editable text, and nothing else", async () => {
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  expect(view.getByLabelText("Chapter text").props.value).toBe(
    chapter.paragraphs.join("\n\n"),
  );
  expect(view.getByLabelText("Chapter title").props.value).toBe("Chapter One");

  // The AI surfaces are gone, not hidden.
  expect(view.queryByLabelText("Rewrite with AI")).toBeNull();
  expect(view.queryByLabelText("AI rewrite prompt")).toBeNull();
  expect(view.queryByLabelText("Find in chapter")).toBeNull();
});

it("keeps Save inert until something has actually changed", async () => {
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  const save = view.getByTestId("edit-chapter-save");
  expect(save.props.accessibilityState.disabled).toBe(true);

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "A new chapter.");
  });

  await waitFor(() =>
    expect(
      view.getByTestId("edit-chapter-save").props.accessibilityState.disabled,
    ).toBe(false)
  );
});

/**
 * The measurement that mattered: Save used to hold the writer here for the
 * whole round trip plus a 1.2-second "Saved" dwell. `onClose` must now fire in
 * the SAME TICK as the tap, with the request still unresolved behind it.
 */
it("returns the reader instantly and persists in the background", async () => {
  const onClose = jest.fn();
  // A save that never settles. If the editor were still waiting on the network
  // this test could not finish.
  mockSaveChapter.mockImplementationOnce(() => new Promise(() => {}));
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "One line, rewritten by hand.");
    fireEvent.changeText(view.getByLabelText("Chapter title"), "The Last Climb");
  });
  fireEvent.press(view.getByTestId("edit-chapter-save"));

  // Synchronously, with no `await` between the tap and this assertion.
  expect(onClose).toHaveBeenCalledWith({
    content: "One line, rewritten by hand.",
    title: "The Last Climb",
  });
  expect(mockSaveChapter).toHaveBeenCalledWith(
    expect.objectContaining({
      storyId: "story-1",
      chapterId: "chapter-1",
      body: "One line, rewritten by hand.",
      title: "The Last Climb",
    }),
  );
});

it("never claims 'Saved' for a write that has not landed", async () => {
  mockSaveChapter.mockImplementationOnce(() => new Promise(() => {}));
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "Still in flight.");
  });
  fireEvent.press(view.getByTestId("edit-chapter-save"));

  expect(view.queryByText("Saved")).toBeNull();
  expect(view.queryByText("Saving")).toBeNull();
});

it("fires one close and one request however fast Save is double-tapped", async () => {
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "Once, please.");
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("edit-chapter-save"));
    fireEvent.press(view.getByTestId("edit-chapter-save"));
  });

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockSaveChapter).toHaveBeenCalledTimes(1);
});

it("refuses an empty chapter locally, without a request and without leaving", async () => {
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "   ");
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("edit-chapter-save"));
  });

  expect(onClose).not.toHaveBeenCalled();
  expect(mockSaveChapter).not.toHaveBeenCalled();
  expect(view.getByTestId("edit-chapter-error")).toBeTruthy();
  // Every character still there.
  expect(view.getByLabelText("Chapter text").props.value).toBe("   ");
});

it("leaves immediately when nothing was typed", async () => {
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  await act(async () => {
    fireEvent.press(view.getByLabelText("Back"));
  });

  expect(onClose).toHaveBeenCalledWith(null);
});

it("asks before discarding unsaved changes, and keeps them if the writer says so", async () => {
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "Half a thought.");
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText("Back"));
  });

  // Asked, and NOT left.
  await waitFor(() => expect(view.getByText("Discard changes?")).toBeTruthy());
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(view.getByLabelText("Keep editing"));
  });
  expect(view.queryByText("Discard changes?")).toBeNull();
  expect(view.getByLabelText("Chapter text").props.value).toBe("Half a thought.");

  await act(async () => {
    fireEvent.press(view.getByLabelText("Back"));
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText("Discard changes"));
  });
  // Null, not the text: a discarded edit must never reach the reader.
  expect(onClose).toHaveBeenCalledWith(null);
});

/*
  A NETWORK FAILURE IS NO LONGER THIS SCREEN'S TO REPORT.

  The editor is gone by the time the request settles, so a refusal surfaces in
  the reader with a Retry that still holds the text. `chapter-save-queue.test.ts`
  covers the queue and `reader-screen-edit.test.tsx` covers the banner; there is
  nothing left here to assert about it, and a test that pretended otherwise
  would be testing a screen that is not on the stack.
*/

it("shows no chapter title field for a standalone story, which has one title", async () => {
  const view = await render(
    <EditStoryScreen
      story={{ ...story, storyMode: "standalone" }}
      chapter={chapter}
      onClose={jest.fn()}
    />,
  );

  expect(view.queryByLabelText("Chapter title")).toBeNull();
  expect(view.getByText(story.title)).toBeTruthy();
});
