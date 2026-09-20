import { memo } from "react";
import { Text } from "react-native";
import { colors, fonts } from "@/theme";

/**
 * `selecting` is a word lit by a live long-press-and-drag selection. It is a
 * separate state from `saved` rather than a variant of it because the two mean
 * opposite things to the reader: `saved` is a fact about their library,
 * `selecting` is a transient range that disappears the moment they tap away.
 * A selection that borrowed the saved highlight would read as "these words are
 * now in your library", which they are not until Save phrase is tapped.
 */
export type TappableWordState = "idle" | "saved" | "pending" | "selecting";

export type TappableWordProps = {
  word: string;
  state: TappableWordState;
  onPress: () => void;
  onLongPress: () => void;
  /** Test-only hook. React Native gives it no runtime behaviour. */
  testID?: string;
  /**
   * Put this word in the accessibility tree as a button.
   *
   * OFF BY DEFAULT, and that default is the accessible choice for ordinary
   * reading: a screen reader that stops on every word turns a chapter into a
   * word list. It is turned ON only inside the reader's explicit "Save a
   * phrase" mode, where stopping per word IS the task -- the reader has asked
   * to choose the first and last word of a phrase, and a gesture they cannot
   * perform is the only other way to do it. See `PhraseCaptureReader`.
   */
  accessible?: boolean;
  /** Only meaningful with `accessible`. What a double-tap will do to this word. */
  accessibilityHint?: string;
};

/**
 * One word of story prose, made tappable.
 *
 * Nested `<Text onPress>` rather than a `Pressable` because this renders
 * inside the reader's flowing paragraph `Text` - React Native only keeps
 * inline text layout for nested `Text`, not for View-based touchables, and
 * breaking that flow is exactly the pagination/line-wrap regression this
 * feature must not cause.
 *
 * ACCESSIBILITY: deliberately `accessible={false}`. A screen-reader user gets
 * the full sentence read fluently by the ancestor paragraph `Text`
 * (`ReaderScreen`'s default behaviour, unchanged) rather than one VoiceOver
 * stop per word - the caller only renders this component at all once it has
 * confirmed no screen reader is running. See `PhraseCaptureReader`.
 *
 * HIT TARGET: `Text` does not support `hitSlop`, so a single short word
 * cannot reach the 44x44 minimum the rest of the app holds to without
 * distorting the paragraph's line spacing. The padding below is the
 * practical ceiling for an inline word - the real safety net is that saving
 * is reversible (tap again to unsave) and forgiving of an imprecise first tap.
 */
function TappableWordComponent({
  word,
  state,
  onPress,
  onLongPress,
  testID,
  accessible = false,
  accessibilityHint,
}: TappableWordProps) {
  return (
    <Text
      testID={testID}
      accessible={accessible}
      accessibilityRole={accessible ? "button" : undefined}
      accessibilityLabel={accessible ? word : undefined}
      accessibilityHint={accessible ? accessibilityHint : undefined}
      suppressHighlighting
      onPress={state === "pending" ? undefined : onPress}
      onLongPress={state === "pending" ? undefined : onLongPress}
      style={[
        styles.word,
        state === "saved" && styles.saved,
        state === "pending" && styles.pending,
        state === "selecting" && styles.selecting,
      ]}
    >
      {word}
    </Text>
  );
}

export const TappableWord = memo(TappableWordComponent);

const styles = {
  word: {
    fontFamily: fonts.reader,
    letterSpacing: 0,
    // No padding. Pagination measures how much text fits a page BEFORE these
    // render, so per-word padding silently added height and horizontal width
    // that the page-fitting calculation never accounted for -- pushing the last
    // line of a page past its frame. A word is already a large enough target at
    // reading sizes, and an accidental tap is reversible: tapping again unsaves.
  },
  saved: {
    color: colors.accentPressed,
    backgroundColor: colors.accentSoft,
  },
  pending: {
    opacity: 0.55,
  },
  /**
   * The live selection. `selectionTint` is a neutral slate wash rather than the
   * accent: it has to sit legibly on Sepia, Paper AND Night, and it must not be
   * confused with the accent-orange saved highlight one line above it.
   * Background only -- the ink stays the reading theme's, so the words carry on
   * being readable while the range is being dragged.
   */
  selecting: {
    backgroundColor: colors.selectionTint,
  },
} as const;
