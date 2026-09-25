import { useEffect, useRef, useState } from "react";
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
import { X } from "lucide-react-native";
import { Button } from "@/components/Button";
import {
  homePlaceProblem,
  MAX_SPOKEN_LANGUAGES,
  type ReaderPreferences,
  saveReaderPreferences,
  SPOKEN_LANGUAGES,
  toggleSpokenLanguage,
} from "@/lib/reader-preferences";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Languages and home: the cultural context new stories are written with.
 *
 * Two questions -- which languages do you speak, and where do you live -- and
 * one Save. Nothing is written until Save, because the city is typed and a
 * half-typed city saved on every keystroke would be a stream of places the
 * reader never meant.
 *
 * The lead says the one thing that has to be trusted for this to be safe to
 * set: it does NOT change the language stories are written in. A reader who
 * adds Hindi and then gets a chapter in Hindi they cannot read would never
 * touch this again.
 */
const CONNECTION_FAILURE =
  "That did not save. Check your connection and try again.";

export default function ReaderContextSheet({
  visible,
  value,
  status,
  onRetry,
  onSaved,
  onClose,
}: {
  visible: boolean;
  value: ReaderPreferences;
  /**
   * Whether `value` is the saved one. Save replaces both fields, so the form
   * is not shown until it is: editing an empty stand-in after a failed read
   * would erase what the reader had saved.
   */
  status: "loading" | "ready" | "failed";
  onRetry: () => void;
  onSaved: (next: ReaderPreferences) => void;
  onClose: () => void;
}) {
  const [languages, setLanguages] = useState(value.spokenLanguages);
  const [place, setPlace] = useState(value.homePlace ?? "");
  const [saving, setSaving] = useState(false);
  /**
   * Why the last save did not happen: the server's own reason for a refusal,
   * or the connection line when nothing came back. Null when it did not fail.
   */
  const [failed, setFailed] = useState<string | null>(null);

  // Each opening starts from what is saved, not from an abandoned edit --
  // seeded once per opening, when the saved value is known, so a read that
  // lands while the sheet is open cannot overwrite what is being typed.
  const seeded = useRef(false);
  // Which opening a save belongs to. A save outlives a close-and-reopen; when
  // it lands it still reports what the server stored (that is the truth
  // either way), but it may not close, or mark failed, an opening that did
  // not start it.
  const opening = useRef(0);
  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      opening.current += 1;
      return;
    }
    if (status !== "ready" || seeded.current) return;
    seeded.current = true;
    setLanguages(value.spokenLanguages);
    setPlace(value.homePlace ?? "");
    setFailed(null);
  }, [status, value, visible]);

  const placeProblem = homePlaceProblem(place);
  const atCap = languages.length >= MAX_SPOKEN_LANGUAGES;

  const save = async () => {
    if (placeProblem || saving) return;
    const startedIn = opening.current;
    setSaving(true);
    setFailed(null);
    const result = await saveReaderPreferences({
      spokenLanguages: languages,
      homePlace: place.trim() ? place : null,
    });
    setSaving(false);
    const current = startedIn === opening.current;
    // Another account's answer: report it to nobody, and close a sheet that
    // was showing the previous account's values.
    if ("stale" in result) {
      if (current) onClose();
      return;
    }
    if (!("saved" in result)) {
      if (current) {
        setFailed(
          "refused" in result ? result.refused : CONNECTION_FAILURE,
        );
      }
      return;
    }
    onSaved(result.saved);
    if (current) onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Languages and home
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            style={styles.close}
            testID="reader-context-close"
          >
            <X size={20} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          testID="reader-context-sheet"
        >
          <Text style={styles.lead}>
            New stories draw on these for names, places, food and everyday
            detail. Stories are still written in the language you choose in
            Create. Your idea always wins.
          </Text>

          {status !== "ready"
            ? (
              <View style={styles.pending} testID="reader-context-pending">
                <Text
                  style={status === "failed" ? styles.error : styles.hint}
                  accessibilityLiveRegion="polite"
                >
                  {status === "failed"
                    ? "Your saved languages and city could not be loaded, so they cannot be changed yet."
                    : "Loading what you saved…"}
                </Text>
                {status === "failed"
                  ? (
                    <Button
                      label="Try again"
                      onPress={onRetry}
                      testID="reader-context-retry"
                      style={styles.save}
                    />
                  )
                  : null}
              </View>
            )
            : (
              <>
              <Text style={styles.label}>Languages you speak</Text>
              <Text style={styles.hint}>
                Pick up to {MAX_SPOKEN_LANGUAGES}.
              </Text>
              <View style={styles.chips}>
                {SPOKEN_LANGUAGES.map((language) => {
                  const selected = languages.includes(language.id);
                  const blocked = !selected && atCap;
                  return (
                    <Pressable
                      key={language.id}
                      onPress={() => {
                        setLanguages((current) =>
                          toggleSpokenLanguage(current, language.id)
                        );
                        // A refusal is usually about a chip ("remove the one
                        // you added last"): acting on it clears it, as typing
                        // in the city field does.
                        if (failed) setFailed(null);
                      }}
                      disabled={blocked}
                      accessibilityRole="checkbox"
                      accessibilityLabel={language.label}
                      accessibilityState={{ checked: selected, disabled: blocked }}
                      style={[
                        styles.chip,
                        selected && styles.chipSelected,
                        blocked && styles.chipBlocked,
                      ]}
                      testID={`reader-context-language-${language.id}`}
                    >
                      <Text style={styles.chipLabel}>{language.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Your city</Text>
              <TextInput
                value={place}
                onChangeText={(next) => {
                  setPlace(next);
                  if (failed) setFailed(null);
                }}
                placeholder="e.g. Pune, Lagos or São Paulo"
                placeholderTextColor={colors.tertiary}
                accessibilityLabel="Your city"
                autoCapitalize="words"
                autoCorrect={false}
                textContentType="addressCity"
                autoComplete="off"
                style={[styles.input, placeProblem && styles.inputError]}
                testID="reader-context-place"
              />
              <Text style={styles.hint}>
                Optional. A city or a region, never a street address. Stories you
                publish may reflect it.
              </Text>
              {placeProblem
                ? (
                  <Text
                    style={styles.error}
                    accessibilityLiveRegion="polite"
                    testID="reader-context-place-error"
                  >
                    {placeProblem}
                  </Text>
                )
                : null}

              {failed
                ? (
                  <Text
                    style={styles.error}
                    accessibilityLiveRegion="polite"
                    testID="reader-context-error"
                  >
                    {failed}
                  </Text>
                )
                : null}

              <Button
                label={saving ? "Saving" : "Save"}
                onPress={() => void save()}
                disabled={Boolean(placeProblem)}
                loading={saving}
                testID="reader-context-save"
                style={styles.save}
              />
              </>
            )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 24 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.related,
  },
  pending: { gap: spacing.related },
  lead: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
  },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13, lineHeight: 18 },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: spacing.md,
  },
  // DESIGN.md "Genre Chip", as in FeedbackSheet.
  chip: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  // Faded, not hidden: the full list stays readable at the cap.
  chipBlocked: { opacity: 0.45 },
  // Ink in both states: the border and fill carry the selection, and orange
  // text on the soft fill is under 4.5:1 at this size.
  chipLabel: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 14 },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
  error: {
    fontFamily: fonts.ui,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  /** Layout only; the recipe is `Button`'s. */
  save: { marginTop: spacing.md },
});
