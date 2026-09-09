import { useCallback, useEffect, useRef, useState } from "react";
import { saveChapter } from "@/lib/chapter-save";
import { queueChapterSave } from "@/lib/chapter-save-queue";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type UseChapterEditorParams = {
  storyId: string;
  chapterId: string;
  chapterNumber: number;
  /** The chapter's current content, `paragraphs.join("\n\n")`. */
  initialContent: string;
  /** The chapter's current title. Empty string for a standalone story. */
  initialTitle: string;
  /** Whether the chapter is already public, so a save states its own visibility explicitly rather than guessing it. */
  isPublished: boolean;
};

export type UseChapterEditorResult = {
  text: string;
  /** The chapter title as the writer has it. Wire to the heading `TextInput`. */
  title: string;
  setTitle: (next: string) => void;
  /** Wire to the editable `TextInput`'s `onChangeText`. Nothing is sent until `save`. */
  setText: (next: string) => void;
  /** True when the text on screen differs from what the server holds. */
  dirty: boolean;
  status: SaveStatus;
  error: string | null;
  /**
   * Persist the text on screen. Resolves `true` when there was nothing to
   * send or the send succeeded, `false` on failure - the text is left exactly
   * as it was either way, so the writer can retry or discard.
   */
  save: () => Promise<boolean>;
  /**
   * Accept the edit locally and hand the writer their page back NOW, with the
   * request running in the background (`lib/chapter-save-queue.ts`).
   *
   * Returns the text and title to show, or `null` when the edit is not
   * acceptable at all -- today only an empty chapter, which is refused here
   * rather than after a round trip because it needs no server to know it is
   * wrong. A rejection sets `status` to `error` and leaves every character in
   * the field.
   *
   * This does NOT report whether the write succeeded, because it cannot: the
   * request has not finished. Whoever hosts the reader subscribes to the queue
   * and shows a failure there if one comes back.
   */
  commit: () => { content: string; title: string } | null;
  /** The last chapter text this hook confirmed was persisted to the server. */
  getLastSavedText: () => string;
  /** The last chapter title this hook confirmed the reader should show. */
  getLastSavedTitle: () => string;
};

/**
 * The notepad's core: the whole chapter as one string, saved on demand.
 *
 * This replaced an autosaving editor with a one-step AI revert. The notepad
 * is deliberately plainer - editing words is the one thing it does - and a
 * Save button is the honest shape for that: the writer decides when their
 * change is a change, and a failed save is a thing they see rather than a
 * banner that races their typing.
 */
export function useChapterEditor({
  storyId,
  chapterId,
  chapterNumber,
  initialContent,
  initialTitle,
  isPublished,
}: UseChapterEditorParams): UseChapterEditorResult {
  const [text, setTextState] = useState(initialContent);
  const [savedText, setSavedText] = useState(initialContent);
  const [title, setTitleState] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Readable from inside the async save without the closure going stale.
  const textRef = useRef(initialContent);
  const savedTextRef = useRef(initialContent);
  const titleRef = useRef(initialTitle);
  const savedTitleRef = useRef(initialTitle);
  const inFlight = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setText = useCallback((next: string) => {
    textRef.current = next;
    setTextState(next);
    // A new keystroke after a save (or a failed one) is a new edit; the
    // status describes the text on screen, not the last request.
    setStatus((current) => (current === "saving" ? current : "idle"));
  }, []);

  const setTitle = useCallback((next: string) => {
    titleRef.current = next;
    setTitleState(next);
    setStatus((current) => (current === "saving" ? current : "idle"));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    const content = textRef.current;
    const heading = titleRef.current;
    if (content === savedTextRef.current && heading === savedTitleRef.current) {
      return true;
    }
    if (!content.trim()) {
      setStatus("error");
      setError("A chapter can't be empty. Add some text, or discard your changes.");
      return false;
    }
    inFlight.current = true;
    setStatus("saving");
    setError(null);
    try {
      // One call, whichever backend path is actually available. See
      // `src/lib/chapter-save.ts` for why there are two.
      await saveChapter({
        storyId,
        chapterId,
        chapterNumber,
        body: content,
        title: heading.trim() || undefined,
        isPublished,
      });
      savedTextRef.current = content;
      savedTitleRef.current = heading;
      if (mountedRef.current) {
        setSavedText(content);
        setSavedTitle(heading);
        setStatus("saved");
      }
      return true;
    } catch (caught) {
      if (mountedRef.current) {
        setStatus("error");
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : "Could not save your edit. Please try again.",
        );
      }
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [chapterId, chapterNumber, isPublished, storyId]);

  const commit = useCallback((): { content: string; title: string } | null => {
    const content = textRef.current;
    const heading = titleRef.current;
    if (!content.trim()) {
      setStatus("error");
      setError("A chapter can't be empty. Add some text, or discard your changes.");
      return null;
    }
    // Nothing changed: no request, and nothing for the reader to re-paginate.
    if (content === savedTextRef.current && heading === savedTitleRef.current) {
      return { content, title: heading };
    }
    savedTextRef.current = content;
    savedTitleRef.current = heading;
    setSavedText(content);
    setSavedTitle(heading);
    setStatus("saved");
    setError(null);
    queueChapterSave({
      storyId,
      chapterId,
      chapterNumber,
      body: content,
      title: heading.trim() || undefined,
      isPublished,
    });
    return { content, title: heading };
  }, [chapterId, chapterNumber, isPublished, storyId]);

  const getLastSavedText = useCallback(() => savedTextRef.current, []);
  const getLastSavedTitle = useCallback(() => savedTitleRef.current, []);

  return {
    text,
    setText,
    title,
    setTitle,
    dirty: text !== savedText || title !== savedTitle,
    status,
    error,
    save,
    commit,
    getLastSavedText,
    getLastSavedTitle,
  };
}
