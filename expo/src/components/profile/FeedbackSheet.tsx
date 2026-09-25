import { useCallback, useEffect, useRef, useState } from "react";
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
import { Check, X } from "lucide-react-native";
import { Button } from "@/components/Button";
import i18n from "@/i18n";
import {
  APP_FEEDBACK_CATEGORIES,
  APP_FEEDBACK_MAX_LENGTH,
  type AppFeedbackCategory,
  createAppFeedbackRequestId,
  sendAppFeedback,
} from "@/lib/app-feedback";
import { colors, fonts, radius, spacing } from "@/theme";

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`profile.feedbackSheet.${key}`, options);

type Status = "idle" | "sending" | "sent" | "failed" | "rate_limited";

/**
 * "Send feedback", from Profile.
 *
 * One message, an optional "about" chip, and Send. The app version, platform
 * and the screen it was opened from travel with it; the person never types
 * them.
 *
 * HONEST STATES. "Thank you" appears only when the server said the message was
 * filed. A failure says so and KEEPS the text: nobody should have to retype a
 * paragraph because a train went into a tunnel. The request id is made once
 * per message and reused by "Try again", so a retry after a dropped response
 * is replayed by the server rather than filed twice. The rate limit gets its
 * own line, because "check your connection" is the wrong advice to somebody
 * whose connection is fine.
 */
export default function FeedbackSheet({
  visible,
  onClose,
  screen,
}: {
  visible: boolean;
  onClose: () => void;
  /** Where the sheet was opened from, sent as context. */
  screen: string;
}) {
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<AppFeedbackCategory | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const requestIdRef = useRef<string | null>(null);

  const close = useCallback(() => {
    // A message that went through starts the next one clean. One that did
    // not is kept, id and all, in case they reopen to try again.
    if (status === "sent") {
      setMessage("");
      setCategory(null);
      requestIdRef.current = null;
    }
    if (status !== "sending") setStatus("idle");
    onClose();
  }, [onClose, status]);

  // Closing mid-send keeps "sending", and the answer can land while the sheet
  // is hidden. Opening again must start a new message, not show "Thank you"
  // for one the person has forgotten.
  useEffect(() => {
    if (!visible || status !== "sent") return;
    setMessage("");
    setCategory(null);
    requestIdRef.current = null;
    setStatus("idle");
    // Only on opening: `status` changing while open is the sheet's own flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && status !== "sending";

  const send = useCallback(async () => {
    if (!canSend) return;
    requestIdRef.current ??= createAppFeedbackRequestId();
    setStatus("sending");
    const result = await sendAppFeedback({
      requestId: requestIdRef.current,
      message: trimmed,
      category: category ?? "other",
      screen,
    });
    setStatus(result.ok ? "sent" : result.reason);
  }, [canSend, category, screen, trimmed]);

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
          <Text style={styles.title}>
            {status === "sent" ? t("sentTitle") : t("title")}
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={t("close")}
            hitSlop={8}
            style={styles.close}
            testID="feedback-close"
          >
            <X size={20} color={colors.ink} />
          </Pressable>
        </View>

        {status === "sent"
          ? (
            <View style={styles.body} testID="feedback-sent">
              <View style={styles.sentMark}>
                <Check size={22} color={colors.surface} strokeWidth={3} />
              </View>
              <Text style={styles.lead}>{t("sentBody")}</Text>
              <Button label={t("done")} onPress={close} testID="feedback-done" />
            </View>
          )
          : (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.lead}>{t("lead")}</Text>

              <Text style={styles.label}>{t("about")}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {APP_FEEDBACK_CATEGORIES.map((key) => {
                  const selected = category === key;
                  return (
                    <Pressable
                      key={key}
                      // A second tap clears it: the category is optional.
                      onPress={() => {
                        setCategory(selected ? null : key);
                        // Like an edited message, a new category is a new
                        // request: reusing the id would replay the old one.
                        requestIdRef.current = null;
                        if (status === "failed" || status === "rate_limited") setStatus("idle");
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      testID={`feedback-category-${key}`}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                        {t(`categories.${key}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={message}
                onChangeText={(next) => {
                  setMessage(next);
                  // An edited message is a new message. Reusing the id would
                  // let the server replay the old text if the first attempt
                  // had in fact landed, and the edit would be silently lost.
                  requestIdRef.current = null;
                  if (status === "failed" || status === "rate_limited") setStatus("idle");
                }}
                placeholder={t("placeholder")}
                placeholderTextColor={colors.tertiary}
                accessibilityLabel={t("messageLabel")}
                multiline
                maxLength={APP_FEEDBACK_MAX_LENGTH}
                textAlignVertical="top"
                style={styles.input}
                testID="feedback-message"
              />
              <Text style={styles.count}>
                {t("counter", { length: message.length, max: APP_FEEDBACK_MAX_LENGTH })}
              </Text>

              {status === "failed" || status === "rate_limited"
                ? (
                  <Text style={styles.error} testID="feedback-error" accessibilityLiveRegion="polite">
                    {status === "failed" ? t("failed") : t("rateLimited")}
                  </Text>
                )
                : null}

              <Button
                label={status === "sending" ? t("sending") : t("send")}
                onPress={() => void send()}
                disabled={trimmed.length === 0}
                loading={status === "sending"}
                testID="feedback-send"
                style={styles.send}
              />
            </ScrollView>
          )}
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: spacing.md,
  },
  // DESIGN.md "Genre Chip": 11 / 16 padding, radius 22, border 1.5.
  chip: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipLabel: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 14 },
  chipLabelSelected: { color: colors.accent },
  input: {
    minHeight: 160,
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
  },
  count: {
    alignSelf: "flex-end",
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 12,
  },
  error: {
    fontFamily: fonts.ui,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  /** Layout only; the recipe is `Button`'s. */
  send: { marginTop: spacing.md },
  sentMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
});
