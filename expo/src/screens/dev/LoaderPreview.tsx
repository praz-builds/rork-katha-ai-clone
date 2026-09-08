import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CraftingLoader } from "@/components/create/CraftingLoader";
import { KathaMark } from "@/components/brand/KathaMark";
import { LaunchScreen } from "@/components/brand/LaunchScreen";
import GeneratingOverlay from "@/components/GeneratingOverlay";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Dev-only harness for the brand mark and the wait it lives in.
 *
 * Reached at `localhost:8090/?preview=loader`. It exists because the crafting
 * loader is otherwise several screens deep inside the writer flow and only
 * appears while a generation is genuinely in flight — which is exactly when you
 * cannot stop and look at it. Judging a 1.2s animation by triggering a real
 * story generation is not a review loop anyone repeats.
 *
 * Guarded by `__DEV__` and the web check at the App.tsx call site, so it cannot
 * reach a shipped build.
 */

const SPEEDS = [
  { label: "0.5x", ms: 2400 },
  { label: "1x", ms: 1200 },
  { label: "2x", ms: 600 },
] as const;

export default function LoaderPreview() {
  const [replay, setReplay] = useState(0);
  const [speed, setSpeed] = useState<number>(1200);
  const [loop, setLoop] = useState(true);

  const again = useCallback(() => setReplay((n) => n + 1), []);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="loader-preview"
    >
      <Text style={styles.title}>Katha mark — loading states</Text>
      <Text style={styles.note}>
        Dev preview. Not reachable in a shipped build.
      </Text>

      <View style={styles.controls}>
        <Pressable style={styles.button} onPress={again}>
          <Text style={styles.buttonText}>Replay</Text>
        </Pressable>
        <Pressable
          style={[styles.button, loop && styles.buttonOn]}
          onPress={() => setLoop((v) => !v)}
        >
          <Text style={[styles.buttonText, loop && styles.buttonTextOn]}>
            Loop {loop ? "on" : "off"}
          </Text>
        </Pressable>
        {SPEEDS.map((s) => (
          <Pressable
            key={s.label}
            style={[styles.button, speed === s.ms && styles.buttonOn]}
            onPress={() => setSpeed(s.ms)}
          >
            <Text
              style={[styles.buttonText, speed === s.ms && styles.buttonTextOn]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Section label="1 — Launch (orange, texture, white mark)">
        <View style={styles.phone}>
          <LaunchScreen key={`launch-${replay}`} />
        </View>
      </Section>

      <Section label="2 — Story generation (light, mark loops, stage label)">
        <View style={styles.phone}>
          <CraftingLoader key={`loader-${replay}`} autoCycle />
        </View>
      </Section>

      <Section label="3 — Create Studio (light, mark loops, genre phrase)">
        <View style={styles.phone}>
          <GeneratingOverlay key={`gen-${replay}`} genre="romance" />
        </View>
      </Section>

      <Section label="4 — The mark alone, at the sizes it ships in">
        <View style={styles.row}>
          {[
            { size: 72, caption: "72 — centred in a wait screen" },
            { size: 96, caption: "96 — splash / empty state" },
            { size: 160, caption: "160 — hero" },
          ].map((v) => (
            <View key={v.size} style={styles.swatch}>
              <View style={styles.swatchBox}>
                <KathaMark
                  key={`mark-${v.size}-${replay}-${speed}-${loop}`}
                  size={v.size}
                  drawDuration={speed}
                  loop={loop}
                />
              </View>
              <Text style={styles.caption}>{v.caption}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section label="5 — On the orange, as it appears on the icon">
        <View style={[styles.row, styles.onAccent]}>
          <KathaMark
            key={`mark-inv-${replay}-${speed}-${loop}`}
            size={120}
            drawDuration={speed}
            loop={loop}
            color={colors.surface}
          />
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  note: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
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
  phone: {
    width: 390,
    height: 560,
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: spacing.xl,
  },
  swatch: { alignItems: "center" },
  swatchBox: {
    height: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  caption: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  onAccent: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.xl,
    justifyContent: "center",
  },
});
