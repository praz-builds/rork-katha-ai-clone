import { useEffect, useMemo, useState } from "react";
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

import { colors, radius, shadows, spacing, type } from "@/theme";
import { Button } from "@/components/Button";
import { CREATION_LANGUAGES, type CreationLanguage } from "@/types/domain";
import {
  MAX_PHRASE_INPUT_LENGTH,
  parsePhraseInput,
  type ParsedPhraseInput,
} from "@/lib/phrases";

/**
 * The bottom sheet behind Notes' "Add phrases" button.
 *
 * A reader who is learning a language keeps their list somewhere already: a
 * notebook, a notes app, a column in a spreadsheet. The field takes all of it
 * at once and splits on commas and line breaks, because that is what a paste
 * from any of those looks like, and it says out loud what it made of the
 * paste before anything is saved. Counting the phrases in front of them is
 * the only way "I pasted forty and it saved eleven" gets noticed here rather
 * than three weeks later.
 */
export default function AddPhrasesSheet({
  visible,
  onClose,
  existingPhrases,
  onSave,
  defaultLanguage = "English",
}: {
  visible: boolean;
  onClose: () => void;
  /**
   * Everything already saved, so the sheet can say what a paste adds.
   *
   * Carries the language with each one, because "already saved" is a
   * per-language judgement: the same words in Spanish and in Portuguese are
   * two things to practise, and storage keeps them as two records. Marking
   * the second a duplicate here would hide the fix behind the UI.
   */
  existingPhrases: readonly { phrase: string; language?: string }[];
  /**
   * Persist the parsed phrases. Rejecting, or resolving `false`, means nothing
   * was written and the sheet stays open saying so.
   */
  onSave: (
    phrases: string[],
    language: CreationLanguage,
  ) => Promise<boolean | void> | boolean | void;
  defaultLanguage?: CreationLanguage;
}) {
  const [language, setLanguage] = useState<CreationLanguage>(defaultLanguage);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText("");
      setBusy(false);
      setError(null);
      setLanguage(defaultLanguage);
    }
  }, [visible, defaultLanguage]);

  const alreadySaved = useMemo(
    () =>
      existingPhrases
        .filter((entry) => (entry.language ?? language) === language)
        .map((entry) => entry.phrase),
    [existingPhrases, language],
  );

  const parsed: ParsedPhraseInput = useMemo(
    () => parsePhraseInput(text, alreadySaved),
    [text, alreadySaved],
  );

  const overLimit = text.length > MAX_PHRASE_INPUT_LENGTH;
  const canSave = !busy && !overLimit && parsed.phrases.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSave(parsed.phrases, language);
      if (result === false) {
        setError("Those phrases did not save. Check your connection and try again.");
        return;
      }
      onClose();
    } catch {
      setError("Those phrases did not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Add phrases</Text>
            <Text style={styles.subtitle}>
              Anything you want to meet again in a story.
            </Text>

            <Text style={styles.fieldLabel}>Language</Text>
            <View style={styles.languageRow}>
              {CREATION_LANGUAGES.map((option) => {
                const selected = option === language;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setLanguage(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option}
                    testID={`add-phrases-language-${option}`}
                    style={[styles.languageChip, selected && styles.languageChipSelected]}
                  >
                    <Text
                      style={[
                        styles.languageChipLabel,
                        selected && styles.languageChipLabelSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Phrases</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.fieldScroll}>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                textAlignVertical="top"
                accessibilityLabel="Phrases to add"
                testID="add-phrases-field"
                placeholder={
                  "Add as many as you like, separated by commas or line breaks.\n\nbite the bullet, under the weather\nonce in a blue moon"
                }
                placeholderTextColor={colors.tertiary}
                style={[styles.field, overLimit && styles.fieldOverLimit]}
              />
            </ScrollView>

            <View style={styles.meterRow}>
              <Text style={styles.meterHint} testID="add-phrases-summary">
                {summarise(parsed, overLimit)}
              </Text>
              <Text
                style={[styles.counter, overLimit && styles.counterOverLimit]}
                testID="add-phrases-counter"
              >
                {text.length} / {MAX_PHRASE_INPUT_LENGTH}
              </Text>
            </View>

            {error ? (
              <Text style={styles.error} testID="add-phrases-error">
                {error}
              </Text>
            ) : null}

            <Button
              label={busy ? "Saving" : "Save"}
              accessibilityLabel="Save phrases"
              onPress={handleSave}
              disabled={!canSave}
              loading={busy}
              testID="add-phrases-save"
              style={styles.primaryButton}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** What the field made of what was typed, said before anything is written. */
function summarise(parsed: ParsedPhraseInput, overLimit: boolean): string {
  if (overLimit) {
    return `That is over the ${MAX_PHRASE_INPUT_LENGTH} character limit. Trim it and the rest will save.`;
  }
  const parts: string[] = [];
  if (parsed.phrases.length > 0) {
    parts.push(
      parsed.phrases.length === 1 ? "1 phrase ready" : `${parsed.phrases.length} phrases ready`,
    );
  }
  if (parsed.duplicates > 0) {
    parts.push(
      parsed.duplicates === 1
        ? "1 already saved"
        : `${parsed.duplicates} already saved`,
    );
  }
  if (parsed.tooLong > 0) {
    parts.push(parsed.tooLong === 1 ? "1 too long" : `${parsed.tooLong} too long`);
  }
  if (parts.length === 0) return "Separate them with commas or line breaks.";
  return parts.join(" · ");
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  sheetWrap: { width: "100%" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    boxShadow: shadows.overlay,
    gap: spacing.related,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  title: { ...type.headline, color: colors.ink },
  subtitle: {
    ...type.subhead,
    color: colors.muted,
    marginBottom: spacing.related,
  },
  fieldLabel: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.ink,
    marginTop: spacing.sm,
  },
  languageRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  languageChip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageChipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  languageChipLabel: { ...type.subhead, color: colors.muted, fontWeight: "700" },
  languageChipLabelSelected: { color: colors.accent },
  fieldScroll: { maxHeight: 190 },
  field: {
    ...type.body,
    color: colors.ink,
    minHeight: 148,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  fieldOverLimit: { borderColor: colors.premium },
  meterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  meterHint: { ...type.caption, color: colors.muted, flex: 1 },
  counter: { ...type.caption, color: colors.tertiary },
  counterOverLimit: { color: colors.premium, fontWeight: "700" },
  error: { ...type.caption, color: colors.premium },
  /** Layout only; the recipe is `Button`'s. */
  primaryButton: { marginTop: spacing.related },
});
