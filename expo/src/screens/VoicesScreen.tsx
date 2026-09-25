import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronLeft, Play, Square } from "lucide-react-native";
import {
  fetchNarrationVoices,
  type NarrationVoice,
  preferredVoiceId,
  setPreferredVoiceId,
} from "@/lib/voices";
import { useVoicePreview, type VoicePreviewStatus } from "@/lib/voice-preview";
import { colors, fonts, radius, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * Audiobook voices — which voice chapters are read in.
 *
 * THE LIST COMES FROM THE SERVER, and that is the whole point of the screen
 * existing rather than reusing the bundled catalogue in `src/data/voices.ts`.
 * That catalogue names eight voices; the database has six, and four of the
 * bundled names (luna, zara, ravi, leo) have never existed. A picker built
 * from the file would offer voices that answer `400 Unknown voice_id` the
 * moment somebody pressed Listen.
 *
 * A SAMPLE BESIDE EVERY VOICE THAT HAS ONE. The registry's `preview_url` is
 * played as-is by `useVoicePreview` (`src/lib/voice-preview.ts`): one static
 * file, no provider call, nothing charged. The play control is its own
 * button, not part of the row, because hearing a voice is not choosing it --
 * only a press on the row itself saves the preference. A sample that cannot be
 * fetched says so on its row and can be tried again; as of 2026-09-25 that is
 * every sample in production, because `seed-voice-previews` has not been run
 * there, and the error is the honest answer until it is.
 */
export default function VoicesScreen({ onBack }: { onBack: () => void }) {
  const [voices, setVoices] = useState<NarrationVoice[] | null | undefined>(
    undefined,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const preview = useVoicePreview();

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchNarrationVoices(), preferredVoiceId()]).then(
      ([list, preferred]) => {
        if (!alive) return;
        setVoices(list);
        setSelected(preferred ?? list?.[0]?.id ?? null);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const choose = (id: string) => {
    setSelected(id);
    void setPreferredVoiceId(id);
  };

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.pagePad}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={styles.backButton}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>Audiobook voices</Text>
        </View>

        <Text style={styles.lead}>
          The voice new chapters are read in. Chapters you have already had read
          to you keep the voice they were made with.
        </Text>

        {voices === undefined
          ? <ActivityIndicator style={styles.spinner} color={colors.accent} />
          : voices === null
          ? (
            <Text style={styles.unavailable} testID="voices-unavailable">
              The voice list could not be loaded just now.
            </Text>
          )
          : voices.length === 0
          ? (
            <Text style={styles.unavailable} testID="voices-empty">
              No voices are available right now.
            </Text>
          )
          : (
            <View style={styles.list}>
              {voices.map((voice, index) => {
                const active = selected === voice.id;
                const sample: VoicePreviewStatus =
                  preview.state.voiceId === voice.id
                    ? preview.state.status
                    : "idle";
                return (
                  <View
                    key={voice.id}
                    style={[
                      styles.row,
                      index < voices.length - 1 && styles.rowDivider,
                    ]}
                  >
                    <Pressable
                      onPress={() => choose(voice.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={voice.displayName}
                      testID={`voice-${voice.id}`}
                      style={({ pressed }) => [
                        styles.choice,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle}>{voice.displayName}</Text>
                        <Text style={styles.rowSubtitle}>
                          {sample === "error"
                            ? "Sample unavailable right now"
                            : describe(voice)}
                        </Text>
                      </View>
                      {active && (
                        <View style={styles.tick}>
                          <Check
                            size={13}
                            color={colors.surface}
                            strokeWidth={3}
                          />
                        </View>
                      )}
                    </Pressable>
                    {voice.previewUrl
                      ? (
                        <PreviewButton
                          name={voice.displayName}
                          status={sample}
                          testID={`voice-preview-${voice.id}`}
                          onPress={() =>
                            preview.toggle(voice.id, voice.previewUrl)}
                        />
                      )
                      : null}
                  </View>
                );
              })}
            </View>
          )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Play, stop, or a spinner while the sample loads. 44pt, its own target, and
 * it names the voice in every state so a screen reader hears whose sample.
 */
function PreviewButton({
  name,
  status,
  testID,
  onPress,
}: {
  name: string;
  status: VoicePreviewStatus;
  testID: string;
  onPress: () => void;
}) {
  const label = status === "loading"
    ? `Loading ${name} sample. Tap to cancel`
    : status === "playing"
    ? `Stop ${name} sample`
    : status === "error"
    ? `${name} sample unavailable. Try again`
    : `Play ${name} sample`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: status === "loading" }}
      hitSlop={4}
      testID={testID}
      style={({ pressed }) => [
        styles.previewButton,
        status === "playing" && styles.previewButtonActive,
        pressed && styles.pressed,
      ]}
    >
      {status === "loading"
        ? <ActivityIndicator size="small" color={colors.accent} />
        : status === "playing"
        ? <Square size={14} color={colors.accent} fill={colors.accent} />
        : <Play size={16} color={colors.strong} />}
    </Pressable>
  );
}

/** "English · Female" — the two facts a reader picks on, and nothing invented. */
function describe(voice: NarrationVoice): string {
  const language = voice.language === "en"
    ? "English"
    : voice.language === "es"
    ? "Spanish"
    : voice.language.toUpperCase();
  const gender = voice.gender === "female"
    ? "Female"
    : voice.gender === "male"
    ? "Male"
    : "";
  return [language, gender].filter(Boolean).join(" · ");
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -8,
    },
    title: { fontFamily: fonts.display, color: colors.ink, fontSize: 26 },
    lead: {
      marginBottom: spacing.lg,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 14,
      lineHeight: 21,
    },
    spinner: { marginTop: spacing.xl },
    unavailable: {
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    list: {
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      paddingRight: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    choice: {
      flex: 1,
      padding: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    previewButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bg,
    },
    previewButtonActive: { backgroundColor: colors.accentSoft },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
    rowText: { flex: 1 },
    rowTitle: {
      fontFamily: fonts.ui,
      color: colors.ink,
      fontWeight: "700",
      fontSize: 16,
    },
    rowSubtitle: {
      marginTop: 2,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontSize: 13,
    },
    tick: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { opacity: 0.85 },
  }),
};
