import { useCallback, useEffect, useRef, useState } from "react";
import { editParagraph, publishStory } from "@/lib/api";

export type SaveStatus = "idle" | "saving" | "error";
export type RegenerateStatus = "idle" | "regenerating" | "error";

export type UseChapterEditorParams = {
  storyId: string;
  chapterId: string;
  /** The chapter's current content, `paragraphs.join("\n\n")`. */
  initialContent: string;
  /** Whether the chapter is already public, so a save states its own visibility explicitly rather than guessing it. */
  isPublished: boolean;
  /** How long to hold before sending a manual edit, in ms. Exposed for tests. */
  debounceMs?: number;
};

export type UseChapterEditorResult = {
  text: string;
  /** Wire to the editable `TextInput`'s `onChangeText`. Debounces the save. */
  onChangeText: (next: string) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Re-sends the last edit that failed to save. No-op if nothing is pending. */
  retrySave: () => void;
  /** True once exactly one prior version is being held, in memory only. */
  canRevert: boolean;
  /** Takes the text back to the immediately previous version (n-1) and discards it. */
  revert: () => void;
  regenerateStatus: RegenerateStatus;
  regenerateError: string | null;
  /**
   * Ask the AI to rewrite one paragraph from a prompt.
   *
   * `paragraphIndex` is which `\n\n`-separated paragraph of the current text
   * is being rewritten. A request already in flight makes a second call here
   * a no-op, so a double tap on the wand cannot fire twice.
   */
  regenerate: (paragraphIndex: number, prompt: string) => void;
  /** Re-sends the last regeneration request that failed. No-op if there was none. */
  retryRegenerate: () => void;
};

const DEFAULT_DEBOUNCE_MS = 900;

/**
 * The reader-edit core: a manual text edit that autosaves, and a one-step
 * AI regeneration with an ephemeral revert.
 *
 * This is deliberately not a version stack. Exactly one prior version is held
 * in memory (`previousText`) and it is replaced, not pushed, on every new
 * regeneration - see `STORY_GENERATION_FLOW.md`'s reader-edit note. Nothing
 * here is persisted beyond the chapter's current content; closing the editor
 * loses the one held revert step, by design.
 */
export function useChapterEditor({
  storyId,
  chapterId,
  initialContent,
  isPublished,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseChapterEditorParams): UseChapterEditorResult {
  const [text, setText] = useState(initialContent);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [regenerateStatus, setRegenerateStatus] = useState<RegenerateStatus>(
    "idle",
  );
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [previousText, setPreviousText] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveText = useRef<string | null>(null);
  const regenerateInFlight = useRef(false);
  const lastPrompt = useRef<{ paragraphIndex: number; prompt: string } | null>(
    null,
  );

  useEffect(() => {
    // Reasserted on every mount, not just declared once at `useRef(true)`.
    // React's development/test double-invoke of effects runs this mount,
    // then its cleanup, then this mount again - and without resetting it
    // here, that first simulated cleanup leaves `mountedRef` false forever,
    // silently dropping every `runSave`/`regenerate` completion afterward.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const runSave = useCallback(async (content: string) => {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      // `publishStory` is the one call in `src/lib/api.ts` that persists hand
      // edits to a chapter's content, so this reuses it exactly as Create
      // Studio does at publish time rather than adding a second save path.
      // Visibility is always stated, matching that call's own contract.
      await publishStory(storyId, {
        chapters: [{ id: chapterId, content }],
        visibility: isPublished ? "public" : "private",
      });
      if (!mountedRef.current) return;
      pendingSaveText.current = null;
      setSaveStatus("idle");
    } catch (error) {
      if (!mountedRef.current) return;
      // The text stays exactly as the reader left it. Only the save state
      // changes, so a retry can re-send the same content without them typing
      // anything again.
      pendingSaveText.current = content;
      setSaveStatus("error");
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save your edit. Please try again.",
      );
    }
  }, [chapterId, isPublished, storyId]);

  const scheduleSave = useCallback((content: string) => {
    pendingSaveText.current = content;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      const pending = pendingSaveText.current;
      if (pending !== null) void runSave(pending);
    }, debounceMs);
  }, [debounceMs, runSave]);

  const onChangeText = useCallback((next: string) => {
    setText(next);
    scheduleSave(next);
  }, [scheduleSave]);

  const retrySave = useCallback(() => {
    const pending = pendingSaveText.current;
    if (pending === null) return;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    void runSave(pending);
  }, [runSave]);

  const regenerate = useCallback((paragraphIndex: number, prompt: string) => {
    // A double tap fires this twice before the first request has a chance to
    // resolve. The ref, not state, is what stops the second one: state would
    // not have re-rendered in time to block it.
    if (regenerateInFlight.current) return;
    regenerateInFlight.current = true;
    lastPrompt.current = { paragraphIndex, prompt };
    setRegenerateStatus("regenerating");
    setRegenerateError(null);

    const snapshot = text;

    void (async () => {
      try {
        const paragraphs = snapshot.split("\n\n");
        const updated = await editParagraph(
          storyId,
          chapterId,
          paragraphIndex,
          "custom",
          { customNote: prompt },
        );
        if (!mountedRef.current) return;
        const nextParagraphs = [...paragraphs];
        nextParagraphs[paragraphIndex] = updated;
        // Exactly one prior version is held, and this replaces whatever was
        // held before - it is never pushed onto a stack.
        setPreviousText(snapshot);
        setText(nextParagraphs.join("\n\n"));
        setRegenerateStatus("idle");
      } catch (error) {
        if (!mountedRef.current) return;
        // The passage on screen is left exactly as it was; nothing here ever
        // touches `text` on failure.
        setRegenerateStatus("error");
        setRegenerateError(
          error instanceof Error
            ? error.message
            : "Could not regenerate that passage. Please try again.",
        );
      } finally {
        regenerateInFlight.current = false;
      }
    })();
  }, [chapterId, storyId, text]);

  const retryRegenerate = useCallback(() => {
    const last = lastPrompt.current;
    if (!last) return;
    regenerate(last.paragraphIndex, last.prompt);
  }, [regenerate]);

  const revert = useCallback(() => {
    if (previousText === null) return;
    setText(previousText);
    setPreviousText(null);
  }, [previousText]);

  return {
    text,
    onChangeText,
    saveStatus,
    saveError,
    retrySave,
    canRevert: previousText !== null,
    revert,
    regenerateStatus,
    regenerateError,
    regenerate,
    retryRegenerate,
  };
}
