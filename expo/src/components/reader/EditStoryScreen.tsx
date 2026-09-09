import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { colors, fonts, motion, radius, spacing, type } from "@/theme";
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

/** How long "Saved" stays in the header before the editor closes itself. */
const SAVED_DWELL_MS = motion.slow * 3;

/**
 * The notepad. The whole chapter as one editable text, vertical, with Save.
 *
 * This deliberately does nothing else. There is no find bar, no AI rewrite
 * prompt, no per-paragraph action - rewriting a chapter with a prompt is
 * Reimagine's job, reached from the same chrome, and an editor that also
 * offered it read as two half-features in one screen. Here the writer goes to
 * a line, changes a word, and saves.
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const handleSave = useCallback(async () => {
    const saved = await editor.save();
    if (!saved) return;
    // "Saved" is shown where the button was, then the reader gets their page
    // back on its own. A second tap on Save during the dwell is harmless: the
    // text is already the saved text, so `save` resolves without a request.
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      onClose({
        content: editor.getLastSavedText(),
        title: editor.getLastSavedTitle(),
      });
    }, SAVED_DWELL_MS);
  }, [editor, onClose]);

  const handleBack = useCallback(() => {
    if (editor.status === "saving") return;
    if (editor.dirty) {
      // Asked inline rather than with `Alert.alert`, which is a no-op on the
      // web build - a discard prompt that never appears would trap the writer
      // in the editor with no way out but saving.
      setConfirmingDiscard(true);
      return;
    }
    onClose(null);
  }, [editor.dirty, editor.status, onClose]);

  const saveLabel = editor.status === "saving"
    ? "Saving"
    : editor.status === "saved" && !editor.dirty
    ? "Saved"
    : "Save";
  const saveDisabled = !editor.dirty || editor.status === "saving";

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
            accessibilityState={{ disabled: saveDisabled, busy: editor.status === "saving" }}
            hitSlop={8}
            style={styles.saveButton}
            testID="edit-chapter-save"
          >
            <Text
              style={[
                styles.saveText,
                saveDisabled && styles.saveTextDisabled,
                editor.status === "saved" && !editor.dirty && styles.saveTextDone,
              ]}
            >
              {saveLabel}
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

        {editor.status === "error" ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              {editor.error ?? "Could not save your edit."}
            </Text>
            <Pressable
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel="Retry save"
              style={styles.retry}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
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
              editable={editor.status !== "saving"}
              accessibilityLabel="Chapter title"
              style={styles.chapterTitle}
              maxLength={120}
              testID="edit-chapter-title"
            />
          )}
          <TextInput
            value={editor.text}
            onChangeText={editor.setText}
            multiline
            scrollEnabled
            autoCorrect
            editable={editor.status !== "saving"}
            accessibilityLabel="Chapter text"
            style={styles.chapterInput}
            textAlignVertical="top"
            keyboardType="default"
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
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
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
    marginBottom: spacing.sm,
  },
  chapterInput: {
    flex: 1,
    fontFamily: fonts.reader,
    fontSize: 18,
    lineHeight: 30,
    color: colors.ink,
    letterSpacing: 0,
    paddingBottom: spacing.xxxl,
  },
});
