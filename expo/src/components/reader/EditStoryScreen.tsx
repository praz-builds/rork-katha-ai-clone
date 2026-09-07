import { useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import {
  ChevronLeft,
  RotateCcw,
  Search,
  Wand2,
  X,
} from "lucide-react-native";
import { colors, fonts, radius, spacing } from "@/theme";
import { useChapterEditor } from "@/components/reader/useChapterEditor";
import type { Chapter, Story } from "@/types/domain";

export type EditStoryScreenProps = {
  story: Story;
  chapter: Chapter;
  /** Open with the AI prompt bar already showing - the `onReimagine` entry point. */
  initialWandOpen?: boolean;
  /** Fires once, when the editor is dismissed, with whatever text is on screen. */
  onClose: (content: string) => void;
};

/** Which `\n\n`-separated paragraph an offset into the joined text falls inside. */
function paragraphIndexAtOffset(text: string, offset: number): number {
  const paragraphs = text.split("\n\n");
  let cursor = 0;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const end = cursor + paragraphs[index].length;
    if (offset <= end) return index;
    cursor = end + 2; // the "\n\n" separator
  }
  return Math.max(0, paragraphs.length - 1);
}

function findMatches(text: string, query: string): { start: number; end: number }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const matches: { start: number; end: number }[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    matches.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
}

/**
 * The full-screen chapter editor opened from `ReaderChrome`'s `onEdit` and
 * `onReimagine`.
 *
 * Version history is not a feature here: `useChapterEditor` holds exactly one
 * prior version in memory, and closing this screen drops it for good. There
 * is nothing to load back from a server on reopen beyond the chapter's
 * current saved content.
 */
export function EditStoryScreen({
  story,
  chapter,
  initialWandOpen = false,
  onClose,
}: EditStoryScreenProps) {
  const reducedMotion = useReducedMotion();
  const initialContent = useMemo(
    () => chapter.paragraphs.join("\n\n"),
    [chapter.paragraphs],
  );
  const editor = useChapterEditor({
    storyId: story.id,
    chapterId: chapter.id,
    initialContent,
    isPublished: chapter.isPublished,
  });

  const [wandOpen, setWandOpen] = useState(initialWandOpen);
  const [prompt, setPrompt] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  const selectionRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);

  const matches = useMemo(
    () => findMatches(editor.text, searchQuery),
    [editor.text, searchQuery],
  );

  const jumpToMatch = useCallback((direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (activeMatch + direction + matches.length) % matches.length;
    setActiveMatch(next);
    const match = matches[next];
    inputRef.current?.setNativeProps({ selection: match });
    inputRef.current?.focus();
  }, [activeMatch, matches]);

  const handleSubmitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const paragraphIndex = paragraphIndexAtOffset(
      editor.text,
      selectionRef.current.start,
    );
    editor.regenerate(paragraphIndex, trimmed);
  }, [editor, prompt]);

  const handleClose = useCallback(() => {
    onClose(editor.text);
  }, [editor.text, onClose]);

  return (
    <Modal
      visible
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={handleClose}
      presentationStyle="fullScreen"
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close editor"
            hitSlop={8}
            style={styles.iconButton}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>Edit Story</Text>
          <View style={styles.headerActions}>
            {editor.canRevert ? (
              <Pressable
                onPress={editor.revert}
                accessibilityRole="button"
                accessibilityLabel="Revert to previous version"
                hitSlop={8}
                style={styles.iconButton}
              >
                <RotateCcw size={20} color={colors.strong} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setWandOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={wandOpen ? "Close AI rewrite" : "Rewrite with AI"}
              hitSlop={8}
              style={styles.iconButton}
            >
              {wandOpen ? <X size={20} color={colors.ink} /> : <Wand2 size={20} color={colors.strong} />}
            </Pressable>
            <Pressable
              onPress={() => setSearchOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? "Close search" : "Search chapter"}
              hitSlop={8}
              style={styles.iconButton}
            >
              {searchOpen ? <X size={20} color={colors.ink} /> : <Search size={20} color={colors.strong} />}
            </Pressable>
          </View>
        </View>

        {wandOpen ? (
          <View style={styles.promptBar}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Tell the AI what to change in this passage"
              placeholderTextColor={colors.tertiary}
              accessibilityLabel="AI rewrite prompt"
              style={styles.promptInput}
              multiline
              editable={editor.regenerateStatus !== "regenerating"}
            />
            <Pressable
              onPress={handleSubmitPrompt}
              accessibilityRole="button"
              accessibilityLabel="Rewrite with AI"
              hitSlop={8}
              disabled={editor.regenerateStatus === "regenerating" || !prompt.trim()}
              style={[
                styles.promptSubmit,
                (editor.regenerateStatus === "regenerating" || !prompt.trim()) &&
                  styles.promptSubmitDisabled,
              ]}
            >
              <Wand2 size={18} color={colors.surface} />
            </Pressable>
          </View>
        ) : null}
        {editor.regenerateStatus === "error" ? (
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>
              {editor.regenerateError ?? "Could not regenerate that passage."}
            </Text>
            <Pressable
              onPress={editor.retryRegenerate}
              accessibilityRole="button"
              accessibilityLabel="Retry AI rewrite"
              style={styles.statusRetry}
            >
              <Text style={styles.statusRetryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {searchOpen ? (
          <View style={styles.findBar}>
            <TextInput
              value={searchQuery}
              onChangeText={(next) => {
                setSearchQuery(next);
                setActiveMatch(0);
              }}
              placeholder="Find in chapter"
              placeholderTextColor={colors.tertiary}
              accessibilityLabel="Find in chapter"
              style={styles.findInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.findCount}>
              {searchQuery.trim()
                ? `${matches.length === 0 ? 0 : activeMatch + 1} of ${matches.length}`
                : "Find"}
            </Text>
            <Pressable
              onPress={() => jumpToMatch(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous match"
              hitSlop={8}
              style={styles.findButton}
            >
              <ChevronLeft size={18} color={colors.strong} />
            </Pressable>
            <Pressable
              onPress={() => jumpToMatch(1)}
              accessibilityRole="button"
              accessibilityLabel="Next match"
              hitSlop={8}
              style={styles.findButton}
            >
              <ChevronLeft size={18} color={colors.strong} style={{ transform: [{ rotate: "180deg" }] }} />
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.storyTitle} numberOfLines={2}>{story.title}</Text>
          <TextInput
            ref={inputRef}
            value={editor.text}
            onChangeText={editor.onChangeText}
            onSelectionChange={(event) => {
              selectionRef.current = event.nativeEvent.selection;
            }}
            multiline
            accessibilityLabel="Chapter text"
            style={styles.chapterInput}
            textAlignVertical="top"
          />
        </ScrollView>

        {editor.saveStatus === "saving" ? (
          <View style={styles.saveBanner}>
            <Text style={styles.saveBannerText}>Saving...</Text>
          </View>
        ) : editor.saveStatus === "error" ? (
          <View style={[styles.saveBanner, styles.saveBannerError]}>
            <Text style={styles.saveBannerText}>
              {editor.saveError ?? "Could not save your edit."}
            </Text>
            <Pressable
              onPress={editor.retrySave}
              accessibilityRole="button"
              accessibilityLabel="Retry save"
              style={styles.statusRetry}
            >
              <Text style={styles.statusRetryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
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
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  promptBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  promptInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.ink,
    letterSpacing: 0,
  },
  promptSubmit: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  promptSubmitDisabled: {
    backgroundColor: colors.tertiary,
  },
  findBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 50,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  findInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.ink,
    letterSpacing: 0,
  },
  findCount: {
    minWidth: 48,
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.muted,
    textAlign: "right",
    letterSpacing: 0,
  },
  findButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  statusBannerText: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.ink,
    letterSpacing: 0,
  },
  statusRetry: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  statusRetryText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "700",
    color: colors.accent,
    letterSpacing: 0,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  storyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    color: colors.ink,
    letterSpacing: 0,
  },
  chapterInput: {
    minHeight: 400,
    fontFamily: fonts.reader,
    fontSize: 18,
    lineHeight: 28,
    color: colors.ink,
    letterSpacing: 0,
  },
  saveBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  saveBannerError: {
    backgroundColor: colors.accentSoft,
  },
  saveBannerText: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.ink,
    letterSpacing: 0,
  },
});
