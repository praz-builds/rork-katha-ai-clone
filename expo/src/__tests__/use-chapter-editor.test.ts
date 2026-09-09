/**
 * The notepad's core.
 *
 * This hook used to be an autosaving editor with a debounce, an in-flight
 * guard, a one-step AI revert and a paragraph-regenerate call. All of that is
 * gone: Edit is a plain text field over the whole chapter with a Save button,
 * and rewriting a chapter with a prompt is Reimagine's job.
 *
 * So what is worth pinning here is small and load-bearing: nothing is sent
 * until Save is pressed, Save sends exactly what is on screen (title included),
 * a failure leaves the writer's words exactly where they left them, and an
 * empty chapter is refused rather than saved.
 */

import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useChapterEditor } from "@/components/reader/useChapterEditor";

const mockSaveChapter = jest.fn();

jest.mock("@/lib/chapter-save", () => ({
  saveChapter: (...args: unknown[]) => mockSaveChapter(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveChapter.mockResolvedValue({ titleSaved: true });
});

const baseParams = {
  storyId: "story-1",
  chapterId: "chapter-1",
  chapterNumber: 3,
  initialContent: "Original text.",
  initialTitle: "The Letter",
  isPublished: true,
};

it("sends nothing until Save is pressed", async () => {
  const { result } = await renderHook(() => useChapterEditor(baseParams));

  await act(async () => {
    result.current.setText("Edited, but not saved.");
  });

  expect(mockSaveChapter).not.toHaveBeenCalled();
  expect(result.current.dirty).toBe(true);
});

it("saves the text and the title exactly as they are on screen", async () => {
  const { result } = await renderHook(() => useChapterEditor(baseParams));

  await act(async () => {
    result.current.setText("The keeper climbed the stairs one last time.");
    result.current.setTitle("The Last Climb");
  });
  await act(async () => {
    await result.current.save();
  });

  expect(mockSaveChapter).toHaveBeenCalledTimes(1);
  expect(mockSaveChapter).toHaveBeenCalledWith({
    storyId: "story-1",
    chapterId: "chapter-1",
    chapterNumber: 3,
    body: "The keeper climbed the stairs one last time.",
    title: "The Last Climb",
    isPublished: true,
  });
  await waitFor(() => expect(result.current.status).toBe("saved"));
  expect(result.current.dirty).toBe(false);
  expect(result.current.getLastSavedText()).toBe(
    "The keeper climbed the stairs one last time.",
  );
  expect(result.current.getLastSavedTitle()).toBe("The Last Climb");
});

it("treats a title-only change as a change", async () => {
  const { result } = await renderHook(() => useChapterEditor(baseParams));

  expect(result.current.dirty).toBe(false);
  await act(async () => {
    result.current.setTitle("A Better Name");
  });
  expect(result.current.dirty).toBe(true);

  await act(async () => {
    await result.current.save();
  });
  expect(mockSaveChapter).toHaveBeenCalledTimes(1);
});

it("sends nothing at all when nothing changed", async () => {
  const { result } = await renderHook(() => useChapterEditor(baseParams));

  let saved = false;
  await act(async () => {
    saved = await result.current.save();
  });

  expect(saved).toBe(true);
  expect(mockSaveChapter).not.toHaveBeenCalled();
});

it("refuses to save an empty chapter, and says why", async () => {
  const { result } = await renderHook(() => useChapterEditor(baseParams));

  await act(async () => {
    result.current.setText("   ");
  });
  let saved = true;
  await act(async () => {
    saved = await result.current.save();
  });

  expect(saved).toBe(false);
  expect(mockSaveChapter).not.toHaveBeenCalled();
  expect(result.current.status).toBe("error");
  expect(result.current.error).toMatch(/can't be empty/i);
  // The words stay in the field. Erasing what somebody typed because the
  // server would not take it is the one unrecoverable thing an editor can do.
  expect(result.current.text).toBe("   ");
});

it("keeps the writer's words on a failed save, and lets them retry", async () => {
  mockSaveChapter.mockRejectedValueOnce(new Error("The network went away."));
  const { result } = await renderHook(() => useChapterEditor(baseParams));

  await act(async () => {
    result.current.setText("Worth keeping.");
  });
  let saved = true;
  await act(async () => {
    saved = await result.current.save();
  });

  expect(saved).toBe(false);
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("The network went away.");
  expect(result.current.text).toBe("Worth keeping.");
  expect(result.current.dirty).toBe(true);

  await act(async () => {
    saved = await result.current.save();
  });
  expect(saved).toBe(true);
  expect(mockSaveChapter).toHaveBeenCalledTimes(2);
});

it("states the story's visibility on every save rather than letting the server guess", async () => {
  const { result } = await renderHook(() =>
    useChapterEditor({ ...baseParams, isPublished: false })
  );

  await act(async () => {
    result.current.setText("A private draft.");
  });
  await act(async () => {
    await result.current.save();
  });

  expect(mockSaveChapter).toHaveBeenCalledWith(
    expect.objectContaining({ isPublished: false }),
  );
});
