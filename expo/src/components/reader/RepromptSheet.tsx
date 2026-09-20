import { useCallback, useEffect, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sparkles, X } from "lucide-react-native";

import { reimagineQuote, useIsSubscribed } from "@/lib/entitlements";
import type { RepromptRequest } from "@/lib/reimagine-client";
import { colors, radius, spacing, type } from "@/theme";
import type { Chapter, Story } from "@/types/domain";

export const MAX_REPROMPT_PROMPT_CHARS = 500;
const COUNTER_FROM = 400;

export type RepromptSheetProps = {
  visible: boolean;
  story: Story;
  chapter: Chapter;
  /** Restores a prompt after a failed run, so the writer does not retype it. */
  initialPrompt?: string;
  /** A failure from the previous run to show above the composer. */
  errorMessage?: string | null;
  /**
   * How many re-prompts this chapter has already had, for the quoted price.
   *
   * Defaults to 0, which quotes the first-use price. The reader does not track
   * this yet: the per-chapter count belongs in the credit ledger beside the
   * charge, so the server can refuse a second free run that two devices asked
   * for at once. Until that lands the sheet quotes optimistically and the
   * server is still the thing that charges. FOLLOW-UP: ledger enforcement.
   */
  repromptsUsedOnChapter?: number;
  onClose: () => void;
  /** Fired with the assembled request; the caller starts the run and closes the sheet. */
  onSubmit: (request: RepromptRequest) => void;
};

/**
 * Re-prompt: the author asks for this chapter to be written again, differently.
 *
 * AUTHOR-ONLY, AND CHARACTERS ARE DELIBERATELY NOT HERE.
 *
 * This sheet used to be Reimagine, and it offered the writer a list of their
 * own cast with a Replace control beside each one. That made no sense for the
 * person who invented them: a writer who wants somebody else in the story
 * says so in the prompt, in their own words, and gets prose actually written
 * for that person -- rather than a find-and-replace that cannot touch a
 * pronoun (see `_shared/character-substitution.ts`) or anything the chapter
 * says about who they are. So the roster is gone and what is left is the one
 * control a writer actually wants: a box, and what should be different.
 *
 * A reader who does not own the story never reaches this sheet. Reimagine
 * takes them somewhere else entirely -- a new story of their own, seeded with
 * this one's premise (`lib/reimagine-seed.ts`).
 *
 * Chapter-scoped, because that is what the endpoint behind it does today: one
 * chapter is rewritten in place and the rest of the story is untouched.
 * Whether re-prompting should ever span a whole story is an open product
 * question and deliberately not answered here.
 */
export function RepromptSheet({
  visible,
  story,
  chapter,
  initialPrompt = "",
  errorMessage = null,
  repromptsUsedOnChapter = 0,
  onClose,
  onSubmit,
}: RepromptSheetProps) {
  const insets = useSafeAreaInsets();
  const subscribed = useIsSubscribed();
  // The price the paywall promised, computed from the same module rather than
  // written here: "1 credit" was a literal, and it was wrong for every
  // subscriber and for the first run on every chapter.
  const quote = reimagineQuote({ subscribed, usedOnChapter: repromptsUsedOnChapter });
  const isStandalone = story.storyMode === "standalone" ||
    (!story.storyMode && !story.plannedChapterCount && story.chapters.length <= 1);
  const [prompt, setPrompt] = useState(initialPrompt);

  // A fresh open starts from the prompt the caller handed in -- a restored one
  // after a failure, or nothing.
  useEffect(() => {
    if (visible) setPrompt(initialPrompt);
  }, [visible, initialPrompt]);

  // There is one control now, so there is one thing to check. The old sheet
  // could submit with an empty prompt because a character swap was also a
  // request; nothing here is a request except the words.
  const canSubmit = prompt.trim().length > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      storyId: story.id,
      chapterNumber: chapter.chapterNumber,
      prompt: prompt.trim(),
    });
  }, [canSubmit, chapter.chapterNumber, onSubmit, prompt, story.id]);

  const subtitle = isStandalone
    ? "Writes this story again, your way"
    : `Chapter ${chapter.chapterNumber} · rewrites this chapter only`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboard}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>
                  {isStandalone ? "Re-prompt this story" : "Re-prompt this chapter"}
                </Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close re-prompt"
                hitSlop={8}
                style={styles.closeButton}
              >
                <X size={18} color={colors.strong} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {errorMessage ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              <Text style={styles.sectionLabel}>What should change?</Text>
              <TextInput
                value={prompt}
                onChangeText={(value) => setPrompt(value.slice(0, MAX_REPROMPT_PROMPT_CHARS))}
                placeholder={isStandalone
                  ? "Tell Katha what to do differently this time."
                  : "Tell Katha what to do differently in this chapter."}
                placeholderTextColor={colors.tertiary}
                multiline
                textAlignVertical="top"
                maxLength={MAX_REPROMPT_PROMPT_CHARS}
                accessibilityLabel="What should change"
                style={styles.promptInput}
                autoFocus
              />
              {prompt.length >= COUNTER_FROM ? (
                <Text style={styles.counter}>
                  {prompt.length}/{MAX_REPROMPT_PROMPT_CHARS}
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.footer}>
              <Text style={styles.price}>Re-prompt · {quote.label}</Text>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit }}
                accessibilityLabel={isStandalone ? "Re-prompt story" : "Re-prompt chapter"}
                style={[styles.submit, !canSubmit && styles.submitDisabled]}
              >
                <Sparkles size={18} color={colors.surface} />
                <Text style={styles.submitLabel}>
                  {isStandalone ? "Re-prompt story" : "Re-prompt chapter"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.scrim,
  },
  keyboard: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    // Shorter than the old sheet, which had to hold a cast list. A sheet that
    // is 88% of the screen with one text box in it reads as a loading state.
    maxHeight: "72%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  subtitle: {
    ...type.subhead,
    color: colors.muted,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  errorBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...type.subhead,
    color: colors.premium,
  },
  sectionLabel: {
    ...type.caption,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: "700",
  },
  promptInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  counter: {
    ...type.caption,
    color: colors.muted,
    textAlign: "right",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  price: {
    ...type.caption,
    color: colors.muted,
  },
  submit: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  submitDisabled: {
    backgroundColor: colors.tertiary,
  },
  submitLabel: {
    ...type.headline,
    color: colors.surface,
  },
});
