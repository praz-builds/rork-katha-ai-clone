import { useCallback, useEffect, useRef, useState } from "react";
import { publishStory } from "@/lib/api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type UseChapterEditorParams = {
  storyId: string;
  chapterId: string;
  /** The chapter's current content, `paragraphs.join("\n\n")`. */
  initialContent: string;
  /** Whether the chapter is already public, so a save states its own visibility explicitly rather than guessing it. */
  isPublished: boolean;
};

export type UseChapterEditorResult = {
  text: string;
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
  /** The last chapter text this hook confirmed was persisted to the server. */
  getLastSavedText: () => string;
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
  initialContent,
  isPublished,
}: UseChapterEditorParams): UseChapterEditorResult {
  const [text, setTextState] = useState(initialContent);
  const [savedText, setSavedText] = useState(initialContent);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Readable from inside the async save without the closure going stale.
  const textRef = useRef(initialContent);
  const savedTextRef = useRef(initialContent);
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

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    const content = textRef.current;
    if (content === savedTextRef.current) return true;
    if (!content.trim()) {
      setStatus("error");
      setError("A chapter can't be empty. Add some text, or discard your changes.");
      return false;
    }
    inFlight.current = true;
    setStatus("saving");
    setError(null);
    try {
      // `publishStory` is the one call in `src/lib/api.ts` that persists hand
      // edits to a chapter's content, so this reuses it rather than adding a
      // second save path. Visibility is always stated, matching that call's
      // own contract: a public story stays public, a private one private.
      await publishStory(storyId, {
        chapters: [{ id: chapterId, content }],
        visibility: isPublished ? "public" : "private",
      });
      savedTextRef.current = content;
      if (mountedRef.current) {
        setSavedText(content);
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
  }, [chapterId, isPublished, storyId]);

  const getLastSavedText = useCallback(() => savedTextRef.current, []);

  return {
    text,
    setText,
    dirty: text !== savedText,
    status,
    error,
    save,
    getLastSavedText,
  };
}
