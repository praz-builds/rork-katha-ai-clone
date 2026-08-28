import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fonts, spacing } from "@/theme";
import type { Genre } from "@/types/domain";
import { getGeneratingPhrases, parsePhrase } from "@/data/generating-phrases";

type Props = {
  genre: Genre;
  mode?: "story" | "chapter" | "finale";
};

// Dark palette (warm charcoal, not cold)
const DARK = {
  bg: "#0F0E0C",
  bgGradientEnd: "#1A1815",
  orbCore: "#FF8C42",
  orbGlow: "#FF6B1A",
  ringOuter: "rgba(255,107,26,0.12)",
  ringMiddle: "rgba(255,107,26,0.20)",
  ringInner: "rgba(255,140,66,0.35)",
  textPrimary: "#F5F0E9",
  textKeyword: "#FFD4A8",
  textSecondary: "rgba(245,240,233,0.45)",
  starDot: "rgba(245,240,233,0.08)",
};

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

  // Phrase rotation
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

  // Orb breathing (scale + opacity) — static when reduced motion
  const orbBreath = useRef(new Animated.Value(reduceMotion ? 0.5 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbBreath, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(orbBreath, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [orbBreath]);

  const orbScale = orbBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });
  const orbOpacity = orbBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  // Ring rotations — static when reduced motion
  const ringRotate1 = useRef(new Animated.Value(0)).current;
  const ringRotate2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const r1 = Animated.loop(
      Animated.timing(ringRotate1, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const r2 = Animated.loop(
      Animated.timing(ringRotate2, {
        toValue: 1,
        duration: 18000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    r1.start();
    r2.start();
    return () => { r1.stop(); r2.stop(); };
  }, [ringRotate1, ringRotate2]);

  const spin1 = ringRotate1.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const spin2 = ringRotate2.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });

  // Glow halo pulse — static when reduced motion
  const haloPulse = useRef(new Animated.Value(reduceMotion ? 0.4 : 0.3)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloPulse, {
          toValue: 0.6,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(haloPulse, {
          toValue: 0.3,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [haloPulse]);

  return (
    <View style={styles.overlay}>
      {/* Decorative dots (star field) */}
      <View style={styles.starField}>
        {STAR_POSITIONS.map((pos, i) => (
          <View key={i} style={[styles.star, { top: pos[0], left: pos[1] }] as const} />
        ))}
      </View>

      <View style={styles.content}>
        {/* Orb assembly */}
        <View style={styles.orbContainer}>
          {/* Outer glow halo */}
          <Animated.View style={[styles.halo, { opacity: haloPulse }]} />

          {/* Outer ring (slow rotate) */}
          <Animated.View
            style={[styles.ringOuter, { transform: [{ rotate: spin1 }] }]}
          />

          {/* Inner ring (counter-rotate) */}
          <Animated.View
            style={[styles.ringInner, { transform: [{ rotate: spin2 }] }]}
          />

          {/* Core orb */}
          <Animated.View
            style={[
              styles.orbCore,
              { opacity: orbOpacity, transform: [{ scale: orbScale }] },
            ]}
          />
        </View>

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

// Scattered dots for the star field effect (percentage values as DimensionValue)
const STAR_POSITIONS: [number, number][] = [
  [48, 58], [32, 280], [88, 340], [140, 30],
  [192, 355], [248, 18], [280, 302], [312, 85],
  [340, 232], [368, 135], [72, 174], [220, 70],
  [160, 252], [112, 116], [300, 186], [352, 318],
];

const ORB_SIZE = 120;
const RING_OUTER = 160;
const RING_INNER = 140;
const HALO_SIZE = 200;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DARK.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  starField: {
    ...StyleSheet.absoluteFillObject,
  },
  star: {
    position: "absolute",
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: DARK.starDot,
  },
  content: {
    alignItems: "center",
    gap: spacing.xxl,
    paddingHorizontal: spacing.xxxl,
  },
  orbContainer: {
    width: HALO_SIZE,
    height: HALO_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  halo: {
    position: "absolute",
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: HALO_SIZE / 2,
    backgroundColor: DARK.orbGlow,
  },
  ringOuter: {
    position: "absolute",
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER / 2,
    borderWidth: 1.5,
    borderColor: DARK.ringOuter,
    // Dashed ring effect via partial border
    borderTopColor: DARK.ringMiddle,
    borderRightColor: "transparent",
    borderBottomColor: DARK.ringMiddle,
    borderLeftColor: "transparent",
  },
  ringInner: {
    position: "absolute",
    width: RING_INNER,
    height: RING_INNER,
    borderRadius: RING_INNER / 2,
    borderWidth: 1,
    borderColor: DARK.ringInner,
    borderTopColor: "transparent",
    borderRightColor: DARK.ringInner,
    borderBottomColor: "transparent",
    borderLeftColor: DARK.ringInner,
  },
  orbCore: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: DARK.orbCore,
    // Soft glow via shadow
    shadowColor: DARK.orbGlow,
    shadowOpacity: 0.8,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  phraseWrap: {
    minHeight: 64,
    justifyContent: "center",
  },
  phraseText: {
    fontFamily: fonts.display,
    color: DARK.textPrimary,
    fontSize: 22,
    textAlign: "center",
    lineHeight: 32,
  },
  phraseKeyword: {
    fontFamily: fonts.readerItalic,
    color: DARK.textKeyword,
    fontSize: 22,
    fontStyle: "italic",
  },
  statusLine: {
    fontFamily: fonts.ui,
    color: DARK.textSecondary,
    fontSize: 14,
    fontWeight: "500",
  },
});
