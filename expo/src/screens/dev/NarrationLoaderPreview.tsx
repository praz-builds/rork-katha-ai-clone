import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  NARRATION_LOADER_VARIANT_LABELS,
  NARRATION_LOADER_VARIANTS,
  NARRATION_STAGES,
  NarrationLoader,
} from "@/components/reader/NarrationLoader";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Dev-only harness for the narration preparing screen's art.
 *
 * Reached at `localhost:8090/?preview=narration-loader`. It exists so the
 * variants can be compared, and screenshotted, without generating a story and
 * then paying a credit to narrate a chapter of it — which is the only other
 * way to see this component, and is not a review loop anyone repeats.
 *
 * Guarded by `__DEV__` and the web check at the App.tsx call site, so it
 * cannot reach a shipped build.
 */
export default function NarrationLoaderPreview() {
  const [stage, setStage] = useState(0);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="narration-loader-preview"
    >
      <Text style={styles.title}>Narration — preparing states</Text>
      <Text style={styles.note}>
        Dev preview. Not reachable in a shipped build. The stage buttons stand
        in for real pipeline status; in the player these advance when the
        backend actually moves on.
      </Text>

      <View style={styles.controls}>
        {NARRATION_STAGES.map((s, i) => (
          <Pressable
            key={s.id}
            style={[styles.button, stage === i && styles.buttonOn]}
            onPress={() => setStage(i)}
          >
            <Text
              style={[styles.buttonText, stage === i && styles.buttonTextOn]}
            >
              {i + 1}. {s.id}
            </Text>
          </Pressable>
        ))}
      </View>

      {NARRATION_LOADER_VARIANTS.map((variant) => (
        <View key={variant} style={styles.section}>
          <Text style={styles.sectionLabel}>
            {NARRATION_LOADER_VARIANT_LABELS[variant]}
          </Text>
          <View style={styles.panel}>
            {/* Stands in for the cover the player puts above the loader, so
                the composition is judged at the proportions it ships in. */}
            <View style={styles.cover} />
            <NarrationLoader variant={variant} stage={stage} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  note: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.muted,
    marginTop: spacing.xs,
    maxWidth: 520,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  buttonOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonText: { fontFamily: fonts.ui, fontSize: 14, color: colors.ink },
  buttonTextOn: { color: colors.surface },
  section: { marginTop: spacing.xl },
  sectionLabel: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  panel: {
    width: 390,
    maxWidth: "100%",
    paddingVertical: spacing.xxxl,
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  cover: {
    width: 168,
    height: 224,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    marginBottom: spacing.xxxl,
  },
});
