import { useState } from "react";
import {
  ActivityIndicator,
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
import { AlertTriangle, Check, X } from "lucide-react-native";
import { deleteAccount } from "@/lib/profile";
import { colors, fonts, profileHeading, radius, spacing } from "@/theme";

/**
 * Deleting an account, in three deliberate steps.
 *
 * WHY THREE. Account deletion is the one irreversible thing a reader can do to
 * themselves, and the standard single "Are you sure?" alert is not friction —
 * it is a speed bump people learn to tap through. So: say why, then read what
 * actually happens, then type the word. Each step is a different KIND of
 * check, which is what makes them add up:
 *
 *   1. REASON — asks for intent before permission. It is also the only chance
 *      anyone gets to tell us why, and it is stored with no user id attached,
 *      so it is feedback rather than a record about a person.
 *   2. CONSEQUENCES — the specific, itemised truth, including the part people
 *      do not expect: published stories STAY, under an anonymous byline,
 *      because readers who saved them should not lose them. Somebody deleting
 *      an account to erase their writing needs to know that before, not after.
 *   3. TYPING "DELETE" — a motor action a misplaced thumb cannot produce.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not try to talk anybody out of
 * it. There is no "are you sure? you'll lose your 12 day streak!", no discount
 * offer, no guilt. Somebody who has typed the word has decided, and a product
 * that argues at that point has stopped respecting the decision it just asked
 * them to make.
 */

type Step = "reason" | "confirm";

const REASONS: { key: string; label: string }[] = [
  { key: "not_reading", label: "I'm not reading enough to keep it" },
  { key: "too_expensive", label: "It costs too much" },
  { key: "not_useful", label: "The stories aren't what I hoped for" },
  { key: "privacy", label: "I don't want my data stored" },
  { key: "another_account", label: "I'm starting again with a new account" },
  { key: "other", label: "Something else" },
];

const CONFIRM_WORD = "DELETE";

export default function DeleteAccountSheet({
  visible,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called after the account is gone, so the app can return to a signed-out state. */
  onDeleted: (storiesKept: number) => void;
}) {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const reset = () => {
    setStep("reason");
    setReason(null);
    setDetail("");
    setTyped("");
    setBusy(false);
    setFailed(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const run = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setFailed(false);
    const result = await deleteAccount(reason ?? "unspecified", detail);
    setBusy(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    const kept = result.storiesKept;
    reset();
    onDeleted(kept);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {step === "reason" ? "Delete account" : "This cannot be undone"}
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={8}
            style={styles.closeButton}
          >
            <X size={22} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {step === "reason"
            ? (
              <>
                <Text style={styles.lead}>
                  Before you go — what made you decide? It helps us, and it is
                  stored without anything that says who wrote it.
                </Text>
                <View style={styles.reasons}>
                  {REASONS.map(({ key, label }) => {
                    const selected = reason === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setReason(key)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        testID={`delete-reason-${key}`}
                        style={({ pressed }) => [
                          styles.reasonRow,
                          selected && styles.reasonRowSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.radio,
                            selected && styles.radioSelected,
                          ]}
                        >
                          {selected && (
                            <Check
                              size={12}
                              color={colors.surface}
                              strokeWidth={3}
                            />
                          )}
                        </View>
                        <Text style={styles.reasonLabel}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  value={detail}
                  onChangeText={setDetail}
                  placeholder="Anything else? (optional)"
                  placeholderTextColor={colors.tertiary}
                  multiline
                  maxLength={500}
                  style={styles.detailInput}
                  testID="delete-detail"
                />

                <Pressable
                  onPress={() => setStep("confirm")}
                  disabled={!reason}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !reason }}
                  testID="delete-continue"
                  style={({ pressed }) => [
                    styles.continueButton,
                    !reason && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.continueLabel}>Continue</Text>
                </Pressable>

                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  style={styles.keepButton}
                >
                  <Text style={styles.keepLabel}>Keep my account</Text>
                </Pressable>
              </>
            )
            : (
              <>
                <View style={styles.warningCard}>
                  <AlertTriangle size={20} color={colors.danger} />
                  <Text style={styles.warningText}>
                    Deleting your account is permanent. There is no way to get
                    it back.
                  </Text>
                </View>

                <Text style={styles.sectionLabel}>What is deleted</Text>
                <View style={styles.list}>
                  {[
                    "Your name, handle, picture and bio",
                    "Your unpublished drafts",
                    "Your library and reading history",
                    "Your streak, and everyone you follow",
                  ].map((line) => (
                    <Text key={line} style={styles.listItem}>
                      • {line}
                    </Text>
                  ))}
                </View>

                {/* The part people do not expect, said before they act rather
                    than discovered afterwards. */}
                <Text style={styles.sectionLabel}>What stays</Text>
                <View style={styles.list}>
                  <Text style={styles.listItem}>
                    • Stories you published, and comments you left, stay
                    readable — but with your name removed. Readers who saved
                    one of your stories keep it.
                  </Text>
                  <Text style={styles.listItem}>
                    • Your purchase history, because it is a financial record.
                  </Text>
                </View>

                <Text style={styles.sectionLabel}>
                  Type {CONFIRM_WORD} to confirm
                </Text>
                <TextInput
                  value={typed}
                  onChangeText={(next) => {
                    setTyped(next);
                    setFailed(false);
                  }}
                  placeholder={CONFIRM_WORD}
                  placeholderTextColor={colors.tertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.confirmInput}
                  testID="delete-confirm-input"
                />

                {failed && (
                  <Text style={styles.error} testID="delete-error">
                    That did not go through. Nothing has been deleted — check
                    your connection and try again.
                  </Text>
                )}

                <Pressable
                  onPress={run}
                  disabled={!confirmed || busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !confirmed || busy }}
                  testID="delete-confirm"
                  style={({ pressed }) => [
                    styles.deleteButton,
                    (!confirmed || busy) && styles.buttonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {busy
                    ? <ActivityIndicator color={colors.surface} />
                    : (
                      <Text style={styles.deleteLabel}>
                        Delete my account
                      </Text>
                    )}
                </Pressable>

                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  style={styles.keepButton}
                >
                  <Text style={styles.keepLabel}>Keep my account</Text>
                </Pressable>
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
  headerTitle: { ...profileHeading, color: colors.ink, fontSize: 24 },
  closeButton: { padding: 4 },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  lead: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  reasons: { gap: spacing.sm },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonRowSelected: { borderColor: colors.accent },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  reasonLabel: { flex: 1, fontFamily: fonts.ui, color: colors.ink, fontSize: 15 },
  detailInput: {
    marginTop: spacing.lg,
    minHeight: 88,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 15,
    textAlignVertical: "top",
  },
  continueButton: {
    marginTop: spacing.xl,
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  continueLabel: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 16,
  },
  keepButton: {
    marginTop: spacing.md,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  keepLabel: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
    fontSize: 15,
  },
  buttonDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
    marginBottom: spacing.lg,
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  list: { gap: 6 },
  listItem: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  confirmInput: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 16,
    letterSpacing: 2,
  },
  error: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  deleteButton: {
    marginTop: spacing.xl,
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteLabel: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 16,
  },
});
