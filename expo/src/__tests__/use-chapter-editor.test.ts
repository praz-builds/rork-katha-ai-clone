import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useChapterEditor } from "@/components/reader/useChapterEditor";

const mockEditParagraph = jest.fn();
const mockPublishStory = jest.fn();

jest.mock("@/lib/api", () => ({
  editParagraph: (...args: unknown[]) => mockEditParagraph(...args),
  publishStory: (...args: unknown[]) => mockPublishStory(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPublishStory.mockResolvedValue(undefined);
});

const baseParams = {
  storyId: "story-1",
  chapterId: "chapter-1",
  isPublished: true,
  // Long enough that the assertions below run well before it would have
  // fired on its own - these tests exist to prove the save happens without
  // waiting for the debounce, not because it eventually would.
  debounceMs: 5000,
};

it("flushes an edit typed just before closing instead of dropping it (findings 1 and 2)", async () => {
  const { result, unmount } = await renderHook(() =>
    useChapterEditor({ ...baseParams, initialContent: "Original text." }),
  );

  await act(async () => {
    result.current.onChangeText("Edited a moment before closing.");
  });

  // The debounce (5s) has not fired yet, and nothing has reached the server.
  expect(mockPublishStory).not.toHaveBeenCalled();

  // Unmounting - what closing the editor does - must flush the pending
  // save rather than cancel it via the debounce timer's clearTimeout.
  unmount();

  await waitFor(() => expect(mockPublishStory).toHaveBeenCalledTimes(1));
  expect(mockPublishStory).toHaveBeenCalledWith("story-1", {
    chapters: [{ id: "chapter-1", content: "Edited a moment before closing." }],
    visibility: "public",
  });
});

it("does not let an older in-flight save strand a newer edit (finding 3)", async () => {
  let resolveFirstSave: (() => void) | undefined;
  mockPublishStory.mockImplementationOnce(
    () => new Promise<void>((resolve) => { resolveFirstSave = resolve; }),
  );

  const { result } = await renderHook(() =>
    useChapterEditor({ ...baseParams, initialContent: "Original text.", debounceMs: 10 }),
  );

  // First edit: its debounce fires and the save starts, but does not
  // resolve yet.
  await act(async () => {
    result.current.onChangeText("First edit.");
  });
  await waitFor(() => expect(mockPublishStory).toHaveBeenCalledTimes(1));

  // A second, newer edit arrives while the first save is still in flight.
  await act(async () => {
    result.current.onChangeText("Second, newer edit.");
  });

  // The first save now resolves. Before the fix this unconditionally
  // cleared `pendingSaveText`, so the second edit's own debounced save
  // would find nothing to send and the newer text would never reach the
  // server.
  await act(async () => {
    resolveFirstSave?.();
    await Promise.resolve();
  });

  await waitFor(() => expect(mockPublishStory).toHaveBeenCalledTimes(2));
  expect(mockPublishStory).toHaveBeenLastCalledWith("story-1", {
    chapters: [{ id: "chapter-1", content: "Second, newer edit." }],
    visibility: "public",
  });
});

it("treats an empty AI rewrite as a failure and leaves the paragraph unchanged (finding 4)", async () => {
  mockEditParagraph.mockResolvedValueOnce("   ");

  const { result } = await renderHook(() =>
    useChapterEditor({ ...baseParams, initialContent: "The original paragraph." }),
  );

  await act(async () => {
    result.current.regenerate(0, "make it sadder");
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(result.current.regenerateStatus).toBe("error"));
  expect(result.current.text).toBe("The original paragraph.");
  expect(result.current.canRevert).toBe(false);
  expect(result.current.regenerateError).toBeTruthy();
});

it("persists a revert of a persisted rewrite instead of only changing local state (finding 5)", async () => {
  mockEditParagraph.mockResolvedValueOnce("A rewritten paragraph.");

  const { result } = await renderHook(() =>
    useChapterEditor({ ...baseParams, initialContent: "The original paragraph.", debounceMs: 10 }),
  );

  await act(async () => {
    result.current.regenerate(0, "make it sadder");
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.text).toBe("A rewritten paragraph."));
  expect(result.current.canRevert).toBe(true);

  // The rewrite above was already persisted server-side by `edit-story`
  // itself - `publishStory` was never called for it, matching that call
  // path. The revert must send its own save.
  expect(mockPublishStory).not.toHaveBeenCalled();

  await act(async () => {
    result.current.revert();
  });

  expect(result.current.text).toBe("The original paragraph.");

  await waitFor(() => expect(mockPublishStory).toHaveBeenCalledTimes(1));
  expect(mockPublishStory).toHaveBeenCalledWith("story-1", {
    chapters: [{ id: "chapter-1", content: "The original paragraph." }],
    visibility: "public",
  });
});

it("does not silently discard a failed save when the editor closes (finding 7)", async () => {
  mockPublishStory.mockRejectedValueOnce(new Error("network down"));

  const { result } = await renderHook(() =>
    useChapterEditor({ ...baseParams, initialContent: "Original text.", debounceMs: 10 }),
  );

  await act(async () => {
    result.current.onChangeText("A change that will fail to save.");
  });
  await waitFor(() => expect(result.current.saveStatus).toBe("error"));

  // A caller closing the editor must flush before it goes away, and must
  // learn whether that flush actually succeeded rather than assuming so.
  let flushed: boolean | undefined;
  mockPublishStory.mockRejectedValueOnce(new Error("still down"));
  await act(async () => {
    flushed = await result.current.flushPendingSave();
  });

  expect(flushed).toBe(false);
  // The honest fallback - what the server actually holds - is still the
  // original text, not the never-saved edit.
  expect(result.current.getLastSavedText()).toBe("Original text.");
});



// A manual edit made WHILE a rewrite is in flight must survive its arrival.
//
// `regenerate` captured the text when it started and rebuilt the chapter from
// that snapshot when it resolved, so anything typed during the wait was
// silently discarded the moment the rewrite came back. The writer watched their
// own sentence disappear with no reason to connect it to the wand.
it("keeps an edit typed while a rewrite is in flight", async () => {
  let resolveRewrite: ((value: string) => void) | undefined;
  mockEditParagraph.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveRewrite = resolve;
      }),
  );

  const { result } = await renderHook(() =>
    useChapterEditor({
      ...baseParams,
      initialContent: "First paragraph.\n\nSecond paragraph.",
    })
  );

  await act(async () => {
    result.current.regenerate(0, "make it colder");
  });

  // The writer keeps working while the model thinks.
  await act(async () => {
    result.current.onChangeText(
      "First paragraph.\n\nSecond paragraph, edited.",
    );
  });

  await act(async () => {
    resolveRewrite?.("A colder first paragraph.");
    await Promise.resolve();
  });

  // Both survive: the rewrite landed on paragraph one, the manual edit on two.
  await waitFor(() =>
    expect(result.current.text).toContain("A colder first paragraph.")
  );
  expect(result.current.text).toContain("Second paragraph, edited.");
});
