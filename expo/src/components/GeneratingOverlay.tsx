import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { DottedGround } from "@/components/brand/DottedGround";
import { KathaMark } from "@/components/brand/KathaMark";
import { colors, fonts, spacing } from "@/theme";
import type { Genre } from "@/types/domain";
import { getGeneratingPhrases, parsePhrase } from "@/data/generating-phrases";

/**
 * The wait inside Create Studio.
 *
 * Same composition as `CraftingLoader`: the dotted light ground, the mark, and
 * words underneath. It used to be a dark charcoal screen with a glowing orb,
 * two counter-rotating rings and a star field — a second, unrelated visual
 * language for the same moment, reached from a different door. The orb and the
 * dark palette are retired; what is genre-specific here is the writing, not the
 * treatment.
 *
 * The rotating phrase is what tells you work is in flight, which is why it
 * keeps its cross-fade and its 3.2s cadence.
 */

type Props = {
  genre: Genre;
  mode?: "story" | "chapter" | "finale";
};

/** The mark at the size it holds a screen on its own, as in `CraftingLoader`. */
const MARK_SIZE = 72;

/** The beat between draws, matched to the crafting loader so the two waits
 *  read as the same app doing the same thing. */
const LOOP_DELAY_MS = 600;

const PHRASE_INTERVAL = 3200;

/**
 * The phrase block's height is fixed, and this is why the mark stops moving.
 *
 * `getGeneratingPhrases` **shuffles** its pool, so the phrase this screen opens
 * on is a different one every single time it mounts, and the phrases are not
 * the same length — "Darkening the edges" is one line, "Sharpening the tension
 * between danger and want" is three at 22pt. The block used to be
 * `minHeight: 64` (two lines) inside a column with `justifyContent: "center"`,
 * so the column's height was a function of which phrase the shuffle happened to
 * deal: a one-line phrase made the column 32pt shorter and pushed the mark
 * *down* by 16, a three-line phrase pulled it *up* by 16. That is the K landing
 * somewhere different on every load — and, because the phrase rotates every
 * 3.2s, drifting up and down while the user waits.
 *
 * So the slot is reserved rather than measured: three lines at the 32pt line
 * height, always, whatever is in it. `numberOfLines` on the text is the other
 * half of the same guarantee — without it a fourth line would overflow the
 * fixed box and the clipping would be a worse bug than the drift. Three lines
 * clears the longest phrase in the catalogue with room to spare.
 *
 * `CraftingLoader` already did this (its headline is `height: 34`, not
 * `minHeight`), which is why the K holds still there and not here.
 */
const PHRASE_LINE_HEIGHT = 32;
const PHRASE_MAX_LINES = 3;
const PHRASE_BLOCK_HEIGHT = PHRASE_LINE_HEIGHT * PHRASE_MAX_LINES;

/**
 * The status line gets a reserved slot for the same reason: it is also picked
 * at random per mount, and a two-line status under a one-line status is the
 * same reflow by a smaller amount.
 */
const STATUS_LINE_HEIGHT = 20;

export default function GeneratingOverlay({ genre, mode = "story" }: Props) {
  const [data] = useState(() => getGeneratingPhrases(genre, mode));
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const currentPhrase = parsePhrase(data.phrases[phraseIndex]);

  // Respect reduced motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // Phrase rotation. Not gated on reduced motion: that is a request about
  // animation, not about information, and the phrase is the only thing here
  // saying the wait is still moving.
  useEffect(() => {
    const timer = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % data.phrases.length);
    }, PHRASE_INTERVAL);
    return () => clearInterval(timer);
  }, [data.phrases.length]);

  // Phrase fade (skip if reduced motion)
  const phraseFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.timing(phraseFade, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(phraseFade, {
        toValue: 1,
        duration: 350,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [phraseIndex, phraseFade, reduceMotion]);

  return (
    <View style={styles.overlay}>
      <DottedGround />

      <View style={styles.content}>
        {/* Redraws for as long as the generation runs — the same progress
            signal the crafting loader uses, and the same reason: this wait is
            indeterminate, so the only honest thing the screen can say is that
            it is still going. */}
        <KathaMark
          size={MARK_SIZE}
          color={colors.accent}
          loop
          loopDelay={LOOP_DELAY_MS}
        />

        {/* Main phrase with keyword highlight */}
        <Animated.View
          style={[styles.phraseWrap, { opacity: phraseFade }]}
          testID="generating-phrase"
        >
          <Text
            style={styles.phraseText}
            numberOfLines={PHRASE_MAX_LINES}
            testID="generating-phrase-text"
          >
            {currentPhrase.prefix}
            {currentPhrase.keyword && (
              <Text style={styles.phraseKeyword}>
                {currentPhrase.prefix.length > 0 ? " " : ""}
                {currentPhrase.keyword}
              </Text>
            )}
            ...
          </Text>
        </Animated.View>

        {/* Secondary status line */}
        <Text style={styles.statusLine} numberOfLines={1}>
          {data.statusLine}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  content: {
    alignItems: "center",
    gap: spacing.xxl,
    paddingHorizontal: spacing.xxxl,
  },
  phraseWrap: {
    // Fixed, never `minHeight`. See PHRASE_BLOCK_HEIGHT: the phrase is chosen
    // by a shuffle, so a block that sizes to its content moves everything
    // above it — including the mark — by a different amount on every load.
    height: PHRASE_BLOCK_HEIGHT,
    justifyContent: "center",
  },
  phraseText: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    textAlign: "center",
    lineHeight: PHRASE_LINE_HEIGHT,
  },
  phraseKeyword: {
    fontFamily: fonts.readerItalic,
    // The keyword is the genre-specific word in the sentence, and on light
    // ground accent is what marks it without turning the line into two colours
    // of body text.
    color: colors.accent,
    fontSize: 22,
    fontStyle: "italic",
  },
  statusLine: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    lineHeight: STATUS_LINE_HEIGHT,
    height: STATUS_LINE_HEIGHT,
    fontWeight: "500",
    textAlign: "center",
  },
});
