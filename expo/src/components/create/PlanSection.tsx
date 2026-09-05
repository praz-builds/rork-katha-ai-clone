import { useCallback, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Check, Edit3, RotateCcw } from "lucide-react-native";
import { colors, fonts, radius, spacing, type } from "@/theme";

/**
 * The approved chapter plan.
 *
 * Called **Chapters**, never "Arc": `source-of-truth/STORY_GENERATION_FLOW.md`
 * section 1 bans `Arc` from the interface along with Premise, Plot, Topic,
 * Setting, Seed and Prompt, because craft jargon in an input label teaches
 * nothing and two of those words also name things Katha produces.
 *
 * Editing a beat is free, instant, and local. Regenerating a single beat is
 * deliberately not offered: it would cost a model call per tap and, worse, a
 * beat rewritten alone stops setting up the one after it. `Try another` swaps
 * the whole plan for the next precomputed variant instead, and disappears when
 * the last one is showing - no disabled state, no counter, no "that's all".
 */

type Props = {
  beats: string[];
  onChange: (beats: string[]) => void;
  /**
   * Advance to the next precomputed variant. Omit it, or the caller runs out,
   * and the control is simply not rendered.
   */
  onTryAnother?: () => void;
  /** Read-only on the review screen, where a row jumps back instead. */
  editable?: boolean;
  heading?: string;
};

export function PlanSection({
  beats,
  onChange,
  onTryAnother,
  editable = true,
  heading = "CHAPTERS",
}: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [buffer, setBuffer] = useState("");
  /**
   * What is being edited, readable synchronously.
   *
   * Tapping beat 2 while beat 1 is open fires `startEditing(2)` and then beat
   * 1's `onBlur`, and the blur handler is the one bound at the last render. A
   * commit that reads `editingIndex` and `buffer` out of state therefore writes
   * beat 1's text into whichever row state has already moved to. The ref
   * carries both together so a commit can only ever land where it came from.
   */
  const editing = useRef<{ index: number; value: string } | null>(null);
  const previousBeats = useRef(beats);

  const startEditing = useCallback((index: number) => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    // Flush the open row before moving, so switching rows saves rather than
    // discards - the user did type it.
    commitRef.current?.();
    const value = beats[index] ?? "";
    editing.current = { index, value };
    setBuffer(value);
    setEditingIndex(index);
  }, [beats]);

  const changeBuffer = useCallback((value: string) => {
    if (editing.current) editing.current.value = value;
    setBuffer(value);
  }, []);

  const commit = useCallback(() => {
    const open = editing.current;
    if (!open) return;
    editing.current = null;
    const next = open.value.trim();
    // An emptied beat keeps what was there. A blank chapter brief is worse than
    // the guess it replaced, and a user who wanted the beat gone would remove
    // the chapter, not the line describing it.
    if (next && next !== beats[open.index]) {
      onChange(
        beats.map((beat, index) => index === open.index ? next : beat),
      );
    }
    setEditingIndex(null);
  }, [beats, onChange]);

  // `startEditing` has to flush the open row, and `commit` has to know the
  // current beats, so one of them must reach the other through a ref.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const tryAnother = useCallback(() => {
    if (!onTryAnother) return;
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    previousBeats.current = beats;
    onTryAnother();
    AccessibilityInfo.announceForAccessibility?.("Showing another shape.");
  }, [beats, onTryAnother]);

  if (!beats.length) return null;

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>{heading}</Text>

      {beats.map((beat, index) => {
        const isEditing = editingIndex === index;
        return (
          <View key={index} style={styles.row}>
            <Text style={styles.number}>{index + 1}</Text>
            {isEditing
              ? (
                <>
                  <TextInput
                    value={buffer}
                    onChangeText={changeBuffer}
                    onBlur={commit}
                    onSubmitEditing={commit}
                    autoFocus
                    multiline
                    maxLength={200}
                    accessibilityLabel={`Chapter ${index + 1}`}
                    style={styles.input}
                    placeholderTextColor={colors.tertiary}
                    returnKeyType="done"
                    blurOnSubmit
                  />
                  <Pressable
                    onPress={commit}
                    accessibilityRole="button"
                    accessibilityLabel={`Save chapter ${index + 1}`}
                    hitSlop={12}
                    style={styles.action}
                  >
                    <Check size={16} color={colors.success} />
                  </Pressable>
                </>
              )
              : (
                <Pressable
                  onPress={editable ? () => startEditing(index) : undefined}
                  disabled={!editable}
                  accessibilityRole={editable ? "button" : "text"}
                  accessibilityLabel={editable
                    ? `Chapter ${index + 1}. ${beat}. Tap to edit.`
                    : `Chapter ${index + 1}. ${beat}`}
                  style={styles.beatPress}
                >
                  <Text style={styles.beat}>{beat}</Text>
                  {editable
                    ? <Edit3 size={14} color={colors.tertiary} />
                    : null}
                </Pressable>
              )}
          </View>
        );
      })}

      {onTryAnother
        ? (
          <Pressable
            onPress={tryAnother}
            accessibilityRole="button"
            accessibilityLabel="Try another shape"
            hitSlop={16}
            style={styles.tryAnother}
          >
            <RotateCcw size={14} color={colors.muted} />
            <Text style={styles.tryAnotherText}>Try another</Text>
          </Pressable>
        )
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: spacing.xl,
  },
  heading: {
    ...type.caption,
    color: colors.tertiary,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  number: {
    ...type.caption,
    fontFamily: fonts.brand,
    color: colors.accent,
    width: 18,
    lineHeight: 20,
  },
  beatPress: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    // A tap target the width of the row, so a one-word beat is as easy to
    // reach as a long one.
    minHeight: 24,
  },
  beat: {
    ...type.body,
    color: colors.ink,
    flex: 1,
  },
  input: {
    ...type.body,
    color: colors.ink,
    flex: 1,
    padding: 0,
    // Multiline inputs collapse to one line on Android without this.
    minHeight: 24,
    textAlignVertical: "top",
  },
  action: {
    paddingLeft: spacing.sm,
  },
  tryAnother: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: spacing.md,
  },
  tryAnotherText: {
    ...type.subhead,
    color: colors.muted,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});

/**
 * Preset craft directions that write into the free-text Writing style field.
 *
 * A separate point-of-view selector was proposed and cut in
 * `STORY_GENERATION_FLOW.md` section 9: it duplicates this field exactly, since
 * "first person, present tense" is precisely what the box is for. These chips
 * give the one-tap control the selector promised without adding a second
 * taxonomy, a second enum, or a second prompt layer.
 */
export const WRITING_STYLE_PRESETS = [
  "First person",
  "Present tense",
  "Shakespearean",
  "Hardboiled",
  "Lyrical",
  "Dry and funny",
] as const;

export function WritingStyleChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);

  const toggle = useCallback((preset: string) => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    const has = parts.some(
      (part) => part.toLowerCase() === preset.toLowerCase(),
    );
    const next = has
      ? parts.filter((part) => part.toLowerCase() !== preset.toLowerCase())
      : [...parts, preset];
    onChange(next.join(", "));
  }, [onChange, parts]);

  return (
    <View style={styles.chipRow}>
      {WRITING_STYLE_PRESETS.map((preset) => {
        const selected = parts.some(
          (part) => part.toLowerCase() === preset.toLowerCase(),
        );
        return (
          <Pressable
            key={preset}
            onPress={() => toggle(preset)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={preset}
            style={[chipStyles.chip, selected && chipStyles.chipActive]}
          >
            <Text
              style={[chipStyles.text, selected && chipStyles.textActive]}
            >
              {preset}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  text: {
    ...type.subhead,
    color: colors.muted,
  },
  textActive: {
    color: colors.accent,
  },
});

export default PlanSection;
