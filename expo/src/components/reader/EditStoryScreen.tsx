import { useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { ChevronLeft } from "lucide-react-native";
import { colors, fonts, radius, spacing, type } from "@/theme";
import { useChapterEditor } from "@/components/reader/useChapterEditor";
import type { Chapter, Story } from "@/types/domain";

export type EditStoryScreenProps = {
  story: Story;
  chapter: Chapter;
  /**
   * Fires once, when the editor is dismissed. Carries the saved chapter when
   * the writer saved, and `null` when they left without changing anything or
   * discarded what they had typed - so the reader never shows text nobody
   * asked it to keep.
   */
  onClose: (saved: SavedChapterEdit | null) => void;
};

export type SavedChapterEdit = {
  content: string;
  title: string;
};

/**
 * The notepad. The whole chapter as one editable text, vertical, with Save.
 *
 * This deliberately does nothing else. There is no find bar, no AI rewrite
 * prompt, no per-paragraph action - rewriting a chapter with a prompt is
 * Reimagine's job, reached from the same chrome, and an editor that also
 * offered it read as two half-features in one screen. Here the writer goes to
 * a line, changes a word, and saves.
 *
 * SAVE IS OPTIMISTIC, AND THERE IS NO DWELL. Save used to await the round trip
 * with every control disabled and then hold a `motion.slow * 3` "Saved" state
 * before closing -- roughly 1.2 seconds of ceremony on top of a 2-3 second
 * request, to confirm something the writer had just typed and could see. The
 * edit is now accepted locally and the reader comes straight back with the new
 * text on the page; the request runs in `lib/chapter-save-queue.ts` and only
 * speaks up if it FAILS, in the reader, with a Retry that still holds the text.
 */
export function EditStoryScreen({
  story,
  chapter,
  onClose,
}: EditStoryScreenProps) {
  const reducedMotion = useReducedMotion();
  const initialContent = useMemo(
    () => chapter.paragraphs.join("\n\n"),
    [chapter.paragraphs],
  );
  const isStandalone = story.storyMode === "standalone";
  const editor = useChapterEditor({
    storyId: story.id,
    chapterId: chapter.id,
    chapterNumber: chapter.chapterNumber,
    initialContent,
    initialTitle: chapter.title ?? "",
    isPublished: chapter.isPublished,
  });
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [focusedField, setFocusedField] = useState<"title" | "body" | null>(null);
  // One close per tap, however fast the second tap lands. `commit` is
  // synchronous now, so a double tap would otherwise queue the same save twice
  // and call `onClose` twice.
  const closedRef = useRef(false);

  const handleSave = useCallback(() => {
    if (closedRef.current) return;
    const committed = editor.commit();
    // `null` is a local refusal (an empty chapter). The editor stays open with
    // the reason in its banner and every character still in the field.
    if (!committed) return;
    closedRef.current = true;
    onClose(committed);
  }, [editor, onClose]);

  const handleBack = useCallback(() => {
    if (closedRef.current) return;
    if (editor.dirty) {
      // Asked inline rather than with `Alert.alert`, which is a no-op on the
      // web build - a discard prompt that never appears would trap the writer
      // in the editor with no way out but saving.
      setConfirmingDiscard(true);
      return;
    }
    onClose(null);
  }, [editor.dirty, onClose]);

  // There is no "Saving" and no "Saved" in this header any more. A label that
  // says "Saved" the moment the button is tapped would be claiming a write
  // succeeded before it had been attempted -- and the screen it would say it on
  // is already gone. The reader shows the truth if the queued write fails.
  const saveDisabled = !editor.dirty;

  return (
    <Modal
      visible
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={handleBack}
      presentationStyle="fullScreen"
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={styles.iconButton}
            testID="edit-chapter-back"
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>Edit chapter</Text>
          <Pressable
            onPress={handleSave}
            disabled={saveDisabled}
            accessibilityRole="button"
            accessibilityLabel="Save chapter"
            accessibilityState={{ disabled: saveDisabled }}
            hitSlop={8}
            style={styles.saveButton}
            testID="edit-chapter-save"
          >
            <Text style={[styles.saveText, saveDisabled && styles.saveTextDisabled]}>
              Save
            </Text>
          </Pressable>
        </View>

        {confirmingDiscard ? (
          <View style={styles.discardBar} accessibilityRole="alert">
            <Text style={styles.discardText}>Discard changes?</Text>
            <View style={styles.discardActions}>
              <Pressable
                onPress={() => setConfirmingDiscard(false)}
                accessibilityRole="button"
                accessibilityLabel="Keep editing"
                style={styles.discardAction}
              >
                <Text style={styles.discardKeep}>Keep editing</Text>
              </Pressable>
              <Pressable
                onPress={() => onClose(null)}
                accessibilityRole="button"
                accessibilityLabel="Discard changes"
                style={styles.discardAction}
              >
                <Text style={styles.discardConfirm}>Discard</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* The only failure this screen can still report is one it decided
          * itself, with no server involved: an empty chapter. A network refusal
          * arrives after the writer is back in the reader, so the reader is
          * where it is shown -- there is no Retry here because there is nothing
          * in flight to retry. */}
        {editor.status === "error" && editor.error ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText} testID="edit-chapter-error">{editor.error}</Text>
          </View>
        ) : null}

        <View style={styles.body}>
          <Text style={styles.storyTitle} numberOfLines={1}>{story.title}</Text>
          {/* A standalone story has one title and it is the story's, so there
            * is nothing to edit here. A chapter of a series has its own, and it
            * is edited in place: a heading that looked like a heading and could
            * not be corrected was the single most-reported thing about the old
            * editor. */}
          {isStandalone ? null : (
            <TextInput
              value={editor.title}
              onChangeText={editor.setTitle}
              placeholder="Chapter title"
              placeholderTextColor={colors.tertiary}
              onFocus={() => setFocusedField("title")}
              onBlur={() => setFocusedField(null)}
              accessibilityLabel="Chapter title"
              style={[
                styles.chapterTitle,
                focusedField === "title" && styles.fieldFocused,
              ]}
              maxLength={120}
              testID="edit-chapter-title"
            />
          )}
          {/*
            A QUIET FIELD.

            The whole text area used to be framed, and a frame in the app's
            accent is the loudest thing a screen can do to a rectangle that
            holds nothing but the writer's own prose. The field is now the same
            paper the rest of the app uses -- `colors.surface` inside a hairline
            `colors.border` -- and focus is a single step of border weight
            (`borderStrong`), not a colour change. `outlineWidth: 0` is
            there because the web build otherwise draws the browser's own focus
            ring on top of all of this.
          */}
          <TextInput
            value={editor.text}
            onChangeText={editor.setText}
            multiline
            scrollEnabled
            autoCorrect
            onFocus={() => setFocusedField("body")}
            onBlur={() => setFocusedField(null)}
            accessibilityLabel="Chapter text"
            style={[
              styles.chapterInput,
              focusedField === "body" && styles.fieldFocused,
            ]}
            textAlignVertical="top"
            keyboardType="default"
            testID="edit-chapter-body"
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...type.headline,
    flex: 1,
    textAlign: "center",
    color: colors.ink,
    letterSpacing: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButton: {
    minWidth: 64,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  saveText: {
    ...type.headline,
    color: colors.accent,
    letterSpacing: 0,
  },
  saveTextDisabled: {
    color: colors.tertiary,
  },
  saveTextDone: {
    color: colors.success,
  },
  discardBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.accentSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  discardText: {
    ...type.headline,
    color: colors.ink,
    letterSpacing: 0,
  },
  discardActions: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  discardAction: {
    minHeight: 44,
    justifyContent: "center",
  },
  discardKeep: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: 0,
  },
  discardConfirm: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.heart,
    letterSpacing: 0,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  errorText: {
    ...type.subhead,
    flex: 1,
    color: colors.ink,
    letterSpacing: 0,
  },
  retry: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  retryText: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.accent,
    letterSpacing: 0,
  },
  body: {
    flex: 1,
    // The ground, so the field can be `colors.surface` and read as a field.
    // The whole screen used to be `colors.surface`, which leaves a text area
    // nothing to lift off and is the reason it needed a frame to exist.
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  storyTitle: {
    ...type.caption,
    color: colors.muted,
    letterSpacing: 0,
  },
  chapterTitle: {
    ...type.subhead,
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    color: colors.ink,
    letterSpacing: 0,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    outlineWidth: 0,
  },
  chapterInput: {
    flex: 1,
    fontFamily: fonts.reader,
    fontSize: 18,
    lineHeight: 30,
    color: colors.ink,
    letterSpacing: 0,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    outlineWidth: 0,
  },
  /**
   * Focus, one step of weight and nothing else.
   *
   * `borderStrong` (#D7D5D0) over `border` (#E7E6E2) is a visible-but-quiet
   * change on the same neutral ramp. It is deliberately NOT the accent: an
   * accent frame around a field the writer is typing in competes with the
   * prose, which is the whole complaint.
   */
  fieldFocused: {
    borderColor: colors.borderStrong,
  },
});
