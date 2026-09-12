import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CheckSquare, Repeat, Sparkles, Square, X } from "lucide-react-native";

import { Portrait, SavedCharactersPicker } from "@/components/create/SavedCharactersPicker";
import { reimagineQuote, useIsSubscribed } from "@/lib/entitlements";
import {
  detectChapterCharacters,
  replacementFromSaved,
  type CharacterReplacement,
  type ReimagineRequest,
} from "@/lib/reimagine-client";
import { colors, radius, spacing, type } from "@/theme";
import type { Chapter, SavedCharacter, Story } from "@/types/domain";

export const MAX_REIMAGINE_PROMPT_CHARS = 500;
const COUNTER_FROM = 400;

export type ReimagineSheetProps = {
  visible: boolean;
  story: Story;
  chapter: Chapter;
  /** Whether the reader owns the story. A non-author rewrites into a private copy. */
  isAuthor: boolean;
  /** Restores a prompt after a failed run, so the writer does not retype it. */
  initialPrompt?: string;
  /** A failure from the previous run to show above the composer. */
  errorMessage?: string | null;
  /**
   * How many reimagines this chapter has already had, for the quoted price.
   *
   * Defaults to 0, which quotes the first-use price. The reader does not track
   * this yet: the per-chapter count belongs in the credit ledger beside the
   * charge, so the server can refuse a second free run that two devices asked
   * for at once. Until that lands the sheet quotes optimistically and the
   * server is still the thing that charges. FOLLOW-UP: ledger enforcement.
   */
  reimaginesUsedOnChapter?: number;
  onClose: () => void;
  /** Fired with the assembled request; the caller starts the run and closes the sheet. */
  onSubmit: (request: ReimagineRequest) => void;
  /** Test seam for the picker's library read. */
  loadSavedCharacters?: () => Promise<SavedCharacter[]>;
};

/**
 * Reimagine: re-prompt one whole chapter, optionally swapping who is in it.
 *
 * Chapter-level by design (spec §4). The writer sees the characters the
 * story's roster puts on this page, can replace any of them with a saved
 * character or a new one, can ask for that swap to run through every chapter
 * (a name substitution plus a roster update, never a regeneration of the
 * whole book), and can describe what should change. Any one of those is
 * enough to submit; with none of them there is nothing to ask for and the
 * button stays off.
 *
 * A reader who does not own the story gets the same sheet with one
 * difference in wording: the rewrite lands in a private copy in their
 * library, and the original is never touched.
 */
export function ReimagineSheet({
  visible,
  story,
  chapter,
  isAuthor,
  initialPrompt = "",
  errorMessage = null,
  reimaginesUsedOnChapter = 0,
  onClose,
  onSubmit,
  loadSavedCharacters,
}: ReimagineSheetProps) {
  const insets = useSafeAreaInsets();
  const subscribed = useIsSubscribed();
  // The price the paywall promised, computed from the same module rather than
  // written here: "1 credit" was a literal, and it was wrong for every
  // subscriber and for the first reimagine of every chapter.
  const quote = reimagineQuote({ subscribed, usedOnChapter: reimaginesUsedOnChapter });
  const isStandalone = story.storyMode === "standalone" ||
    (!story.storyMode && !story.plannedChapterCount && story.chapters.length <= 1);
  const detected = useMemo(() => detectChapterCharacters(story, chapter), [story, chapter]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [replacements, setReplacements] = useState<Record<string, CharacterReplacement>>({});
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  // A fresh open starts from the prompt the caller handed in (a restored one
  // after a failure, or nothing) and no replacements.
  useEffect(() => {
    if (visible) {
      setPrompt(initialPrompt);
      setReplacements({});
      setPickingFor(null);
    }
  }, [visible, initialPrompt]);

  const replacementList = useMemo(() => Object.values(replacements), [replacements]);
  const canSubmit = prompt.trim().length > 0 || replacementList.length > 0;

  const chooseReplacement = useCallback((saved: SavedCharacter) => {
    if (!pickingFor) return;
    const fromName = pickingFor;
    setReplacements((previous) => ({
      ...previous,
      [fromName]: replacementFromSaved(
        fromName,
        saved,
        previous[fromName]?.applyToAllChapters ?? false,
      ),
    }));
    setPickingFor(null);
  }, [pickingFor]);

  const clearReplacement = useCallback((fromName: string) => {
    setReplacements((previous) => {
      const next = { ...previous };
      delete next[fromName];
      return next;
    });
  }, []);

  const toggleApplyToAll = useCallback((fromName: string) => {
    setReplacements((previous) => {
      const current = previous[fromName];
      if (!current) return previous;
      return {
        ...previous,
        [fromName]: { ...current, applyToAllChapters: !current.applyToAllChapters },
      };
    });
  }, []);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      storyId: story.id,
      chapterNumber: chapter.chapterNumber,
      prompt: prompt.trim(),
      replacements: replacementList,
    });
  }, [canSubmit, chapter.chapterNumber, onSubmit, prompt, replacementList, story.id]);

  const subtitle = !isAuthor
    ? "Makes a private copy in your library"
    : isStandalone
    ? "Rewrites the whole story"
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
                <Text style={styles.title}>Reimagine this chapter</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close reimagine"
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

              <Text style={styles.sectionLabel}>Characters in this chapter</Text>
              {detected.length === 0 ? (
                <Text style={styles.emptyLine}>No named characters found</Text>
              ) : (
                detected.map((character) => {
                  const replacement = replacements[character.name];
                  return (
                    <View key={character.name} style={styles.characterBlock}>
                      <View style={styles.characterRow}>
                        <Portrait name={character.name} uri={character.portraitUrl} size={40} />
                        <View style={styles.characterCopy}>
                          <Text style={styles.characterName}>{character.name}</Text>
                          {replacement ? (
                            <Text style={styles.replacedWith}>{`→ ${replacement.to.name}`}</Text>
                          ) : character.appearance ? (
                            <Text numberOfLines={1} style={styles.characterDetail}>{character.appearance}</Text>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => setPickingFor(character.name)}
                          accessibilityRole="button"
                          accessibilityLabel={replacement
                            ? `Change replacement for ${character.name}`
                            : `Replace ${character.name}`}
                          style={styles.replacePill}
                        >
                          <Repeat size={16} color={colors.accent} />
                          <Text style={styles.replacePillLabel}>{replacement ? "Change" : "Replace"}</Text>
                        </Pressable>
                        {replacement ? (
                          <Pressable
                            onPress={() => clearReplacement(character.name)}
                            accessibilityRole="button"
                            accessibilityLabel={`Keep ${character.name}`}
                            hitSlop={8}
                            style={styles.clearButton}
                          >
                            <X size={16} color={colors.muted} />
                          </Pressable>
                        ) : null}
                      </View>
                      {replacement && !isStandalone ? (
                        <Pressable
                          onPress={() => toggleApplyToAll(character.name)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: replacement.applyToAllChapters }}
                          accessibilityLabel={`Apply ${replacement.to.name} to all chapters`}
                          style={styles.checkRow}
                        >
                          {replacement.applyToAllChapters
                            ? <CheckSquare size={20} color={colors.accent} />
                            : <Square size={20} color={colors.accent} />}
                          <View style={styles.checkCopy}>
                            <Text style={styles.checkLabel}>Apply to all chapters</Text>
                            <Text style={styles.checkHint}>
                              Renames them everywhere in this story and in every chapter after this one.
                            </Text>
                          </View>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })
              )}

              <Text style={[styles.sectionLabel, styles.sectionGap]}>What should change?</Text>
              <TextInput
                value={prompt}
                onChangeText={(value) => setPrompt(value.slice(0, MAX_REIMAGINE_PROMPT_CHARS))}
                placeholder="Tell Katha how to rewrite this chapter. Leave it blank to keep the plot and just swap characters."
                placeholderTextColor={colors.tertiary}
                multiline
                textAlignVertical="top"
                maxLength={MAX_REIMAGINE_PROMPT_CHARS}
                accessibilityLabel="What should change"
                style={styles.promptInput}
              />
              {prompt.length >= COUNTER_FROM ? (
                <Text style={styles.counter}>{prompt.length}/{MAX_REIMAGINE_PROMPT_CHARS}</Text>
              ) : null}
            </ScrollView>

            <View style={styles.footer}>
              <Text style={styles.price}>Reimagine · {quote.label}</Text>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit }}
                accessibilityLabel={isAuthor ? "Reimagine chapter" : "Reimagine in my copy"}
                style={[styles.submit, !canSubmit && styles.submitDisabled]}
              >
                <Sparkles size={18} color={colors.surface} />
                <Text style={styles.submitLabel}>
                  {isAuthor ? "Reimagine chapter" : "Reimagine in my copy"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      <SavedCharactersPicker
        visible={pickingFor !== null}
        onSelect={chooseReplacement}
        onClose={() => setPickingFor(null)}
        loadCharacters={loadSavedCharacters}
      />
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
    height: "88%",
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
    flex: 1,
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
  sectionGap: {
    marginTop: spacing.betweenGroups,
  },
  emptyLine: {
    ...type.subhead,
    color: colors.muted,
    paddingVertical: spacing.sm,
  },
  characterBlock: {
    gap: 2,
  },
  characterRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  characterCopy: {
    flex: 1,
    gap: 2,
  },
  characterName: {
    ...type.headline,
    color: colors.ink,
  },
  characterDetail: {
    ...type.subhead,
    color: colors.muted,
  },
  replacedWith: {
    ...type.subhead,
    color: colors.accent,
  },
  replacePill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  replacePillLabel: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.accent,
  },
  clearButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingLeft: 52,
    paddingBottom: spacing.sm,
  },
  checkCopy: {
    flex: 1,
    gap: 2,
  },
  checkLabel: {
    ...type.subhead,
    color: colors.ink,
    fontWeight: "600",
  },
  checkHint: {
    ...type.caption,
    color: colors.muted,
  },
  promptInput: {
    minHeight: 96,
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
