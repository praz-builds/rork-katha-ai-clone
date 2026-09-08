import { memo } from "react";
import { Text } from "react-native";
import { colors, fonts } from "@/theme";

export type TappableWordState = "idle" | "saved" | "pending";

export type TappableWordProps = {
  word: string;
  state: TappableWordState;
  onPress: () => void;
  onLongPress: () => void;
  /** Test-only hook. React Native gives it no runtime behaviour. */
  testID?: string;
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
function TappableWordComponent({ word, state, onPress, onLongPress, testID }: TappableWordProps) {
  return (
    <Text
      testID={testID}
      accessible={false}
      suppressHighlighting
      onPress={state === "pending" ? undefined : onPress}
      onLongPress={state === "pending" ? undefined : onLongPress}
      style={[
        styles.word,
        state === "saved" && styles.saved,
        state === "pending" && styles.pending,
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
} as const;
