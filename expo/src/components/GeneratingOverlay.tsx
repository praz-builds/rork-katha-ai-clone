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
        <Animated.View style={[styles.phraseWrap, { opacity: phraseFade }]}>
          <Text style={styles.phraseText}>
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
        <Text style={styles.statusLine}>{data.statusLine}</Text>
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
    minHeight: 64,
    justifyContent: "center",
  },
  phraseText: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    textAlign: "center",
    lineHeight: 32,
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
    fontWeight: "500",
  },
});
