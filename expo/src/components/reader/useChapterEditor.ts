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
  /**
   * Cancels any pending debounce and sends whatever has not yet been
   * confirmed saved right now, awaiting the result. Resolves `true` when
   * there was nothing to send or the send succeeded, `false` on failure.
   * Callers that are about to close the editor must await this rather than
   * let an in-flight debounce be silently dropped.
   */
  flushPendingSave: () => Promise<boolean>;
  /** The last chapter text this hook confirmed was persisted to the server. */
  getLastSavedText: () => string;
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
  // The most recent text this hook knows the server actually holds. Used to
  // fall back to honest content when a caller decides to discard a save that
  // never went through, rather than ever presenting unsaved text as saved.
  const lastSavedText = useRef(initialContent);
  const regenerateInFlight = useRef(false);
  const lastPrompt = useRef<{ paragraphIndex: number; prompt: string } | null>(
    null,
  );
  // Holds the latest `runSave` so the mount/unmount effect below can call it
  // from its cleanup without depending on it directly - `runSave` is a new
  // function identity on every render its own deps change, and putting it in
  // that effect's dependency array would re-run the mount/cleanup pair on
  // every such render instead of once per real mount. Assigned during render
  // (not inside an effect) so it is always current by the time cleanup runs.
  const runSaveRef = useRef<(content: string) => Promise<boolean>>(
    () => Promise.resolve(true),
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
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      // Closing must flush a pending debounced edit, not cancel it - the
      // caller may have unmounted this hook without going through
      // `flushPendingSave` first (a hard back-navigation, a parent that
      // stops rendering the editor for some other reason). `runSave` itself
      // guards every state update behind `mountedRef`, so calling it here is
      // safe even though the component is already gone: the network call
      // still reaches the server, only the UI feedback is skipped because
      // there is no UI left to show it to.
      const pending = pendingSaveText.current;
      if (pending !== null) void runSaveRef.current(pending);
    };
  }, []);

  const runSave = useCallback(async (content: string): Promise<boolean> => {
    if (mountedRef.current) {
      setSaveStatus("saving");
      setSaveError(null);
    }
    try {
      // `publishStory` is the one call in `src/lib/api.ts` that persists hand
      // edits to a chapter's content, so this reuses it exactly as Create
      // Studio does at publish time rather than adding a second save path.
      // Visibility is always stated, matching that call's own contract.
      await publishStory(storyId, {
        chapters: [{ id: chapterId, content }],
        visibility: isPublished ? "public" : "private",
      });
      lastSavedText.current = content;
      // Only clear the pending marker if it still points at the content
      // this call just persisted. A newer edit typed while this save was in
      // flight already overwrote it with the newer text, and that edit's
      // own (separately scheduled) save is what must reach the server next
      // - clearing unconditionally here would strand it forever, since its
      // debounce timer reads this same ref and finds nothing to send.
      if (pendingSaveText.current === content) {
        pendingSaveText.current = null;
      }
      if (mountedRef.current) setSaveStatus("idle");
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setSaveStatus("error");
        setSaveError(
          error instanceof Error
            ? error.message
            : "Could not save your edit. Please try again.",
        );
      }
      // The text stays exactly as the reader left it, and `pendingSaveText`
      // is left untouched too: it already holds either this same content
      // (safe to retry) or something newer typed since this call started
      // (which must not be overwritten with the stale content that just
      // failed).
      return false;
    }
  }, [chapterId, isPublished, storyId]);
  runSaveRef.current = runSave;

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

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const pending = pendingSaveText.current;
    if (pending === null) return true;
    return runSave(pending);
  }, [runSave]);

  const getLastSavedText = useCallback(() => lastSavedText.current, []);

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
        // An empty or whitespace-only result is a failed rewrite, not
        // content - the local mock (`localEditParagraph`) always returns
        // "", and a real provider is not guaranteed to reject a blank
        // completion either. Assigning it into the paragraph unconditionally
        // would blank out what the reader wrote, silently.
        if (!updated.trim()) {
          throw new Error(
            "The AI returned an empty rewrite. Please try again.",
          );
        }
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
    const reverted = previousText;
    setText(reverted);
    setPreviousText(null);
    // The AI rewrite this undoes was already persisted server-side by
    // `edit-story` itself (unlike a manual edit, which only ever reaches the
    // server through this hook's own debounced save). Without scheduling a
    // save here, the revert only ever changes what this screen shows - the
    // server keeps the rewritten text forever, and the revert does not
    // actually stick. Routed through the same debounced path as any other
    // edit, per `STORY_GENERATION_FLOW.md`'s reader-edit note.
    scheduleSave(reverted);
  }, [previousText, scheduleSave]);

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
    flushPendingSave,
    getLastSavedText,
  };
}
