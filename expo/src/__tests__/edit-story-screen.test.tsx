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
import type { Chapter, Story } from "@/types/domain";

const mockSaveChapter = jest.fn();

jest.mock("@/lib/chapter-save", () => ({
  saveChapter: (...args: unknown[]) => mockSaveChapter(...args),
}));

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
  mockSaveChapter.mockResolvedValue({ titleSaved: true });
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

it("saves the chapter and hands the saved text back to the reader", async () => {
  jest.useFakeTimers();
  const onClose = jest.fn();
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={onClose} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "One line, rewritten by hand.");
    fireEvent.changeText(view.getByLabelText("Chapter title"), "The Last Climb");
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("edit-chapter-save"));
  });

  await waitFor(() => expect(mockSaveChapter).toHaveBeenCalledTimes(1));
  expect(mockSaveChapter).toHaveBeenCalledWith(
    expect.objectContaining({
      storyId: "story-1",
      chapterId: "chapter-1",
      body: "One line, rewritten by hand.",
      title: "The Last Climb",
    }),
  );

  // "Saved" sits where the button was, then the editor closes itself.
  await waitFor(() => expect(view.getByText("Saved")).toBeTruthy());
  await act(async () => {
    jest.runAllTimers();
  });
  expect(onClose).toHaveBeenCalledWith({
    content: "One line, rewritten by hand.",
    title: "The Last Climb",
  });
  jest.useRealTimers();
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

it("keeps the words on screen when the save fails, and offers a retry", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("Could not reach the server."));
  const view = await render(
    <EditStoryScreen story={story} chapter={chapter} onClose={jest.fn()} />,
  );

  await act(async () => {
    fireEvent.changeText(view.getByLabelText("Chapter text"), "Worth keeping.");
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("edit-chapter-save"));
  });

  await waitFor(() => expect(view.getByText("Could not reach the server.")).toBeTruthy());
  expect(view.getByLabelText("Chapter text").props.value).toBe("Worth keeping.");

  mockSaveChapter.mockResolvedValueOnce({ titleSaved: true });
  await act(async () => {
    fireEvent.press(view.getByLabelText("Retry save"));
  });
  await waitFor(() => expect(mockSaveChapter).toHaveBeenCalledTimes(2));
});

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
