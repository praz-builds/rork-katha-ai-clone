import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, ChevronLeft } from "lucide-react-native";
import {
  fetchNarrationVoices,
  type NarrationVoice,
  preferredVoiceId,
  setPreferredVoiceId,
} from "@/lib/voices";
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
 * NO PREVIEW BUTTONS. The registry carries a `preview_url` for every voice and
 * not one of those objects exists in storage — `seed-voice-previews` has never
 * run — so a play button here would be a button that always fails. It is left
 * out rather than shipped broken, and it goes in the moment the previews are
 * generated.
 */
export default function VoicesScreen({ onBack }: { onBack: () => void }) {
  const [voices, setVoices] = useState<NarrationVoice[] | null | undefined>(
    undefined,
  );
  const [selected, setSelected] = useState<string | null>(null);

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
    <SafeAreaView style={styles.flex}>
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
                return (
                  <Pressable
                    key={voice.id}
                    onPress={() => choose(voice.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={voice.displayName}
                    testID={`voice-${voice.id}`}
                    style={({ pressed }) => [
                      styles.row,
                      index < voices.length - 1 && styles.rowDivider,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{voice.displayName}</Text>
                      <Text style={styles.rowSubtitle}>
                        {describe(voice)}
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
                );
              })}
            </View>
          )}
      </ScrollView>
    </SafeAreaView>
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
      padding: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
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
