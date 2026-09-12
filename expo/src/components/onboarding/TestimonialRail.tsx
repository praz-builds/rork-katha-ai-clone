/**
 * The paywall's testimonial rail: eight use cases drifting past at reading
 * speed.
 *
 * THE GATE (expo-animation step 1 and 2). Frequency: rare — a user sees this
 * once, at the paywall. Purpose: **explanation**. The rail is not decoration;
 * it is how the screen shows that Katha is eight different habits rather than
 * one, in less space than eight stacked cards would take and without asking
 * anybody to swipe. Motion is the only thing that reveals there is more than
 * one and a half cards' worth of content on a 390pt screen.
 *
 * THE INGREDIENTS. A single `translateX` shared value over a row that holds the
 * eight cards twice; when the first copy has fully left, `translateX` is back at
 * zero and the second copy is exactly where the first one started, so the seam
 * never arrives. Linear easing, because constant motion is the one case where
 * an ease reads as a stutter. Speed is derived from the measured content width
 * (`RAIL_SPEED_PTS_PER_SECOND`) rather than a fixed duration: a fixed duration
 * means the rail runs faster the more testimonials anybody adds, and the copy
 * stops being readable at the ninth one.
 *
 * TOUCH. `onTouchStart` cancels the animation where it stands and `onTouchEnd`
 * restarts it from that exact offset, so a finger put down to read a quote
 * stops the rail rather than fighting it. It is not a `ScrollView` in the
 * animated path: a scroll view that is also being translated gives the user two
 * conflicting positions for the same content.
 *
 * REDUCED MOTION. A plain horizontal `ScrollView`, shipped with the animation
 * and not after it. Nothing is lost: the same eight cards, the user moves them.
 *
 * ACCESSIBILITY. The rail is one `list` and each card a `listitem`. The second
 * copy of the row is hidden from assistive technology
 * (`importantForAccessibility` / `accessibilityElementsHidden`), or a screen
 * reader reads sixteen testimonials and the user has no way to know that eight
 * of them are the same eight.
 */
import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { TESTIMONIALS, type Testimonial } from "@/data/testimonials";
import {
  colors,
  onboardingType,
  radius,
  spacing,
} from "@/theme";

/** Slow enough to read a name and a first line before a card leaves. */
const RAIL_SPEED_PTS_PER_SECOND = 40;
const CARD_WIDTH = 260;
const PHOTO_SIZE = 44;

export type TestimonialRailProps = {
  /** Injectable so a test can render a short, deterministic list. */
  items?: readonly Testimonial[];
};

export function TestimonialRail({ items = TESTIMONIALS }: TestimonialRailProps) {
  const reducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  // The width of ONE copy of the row, measured rather than computed: the card
  // is a fixed 260 but the gaps are tokens, and a token that changes would
  // otherwise desync the loop by a few points per lap until the seam shows.
  const [rowWidth, setRowWidth] = useState(0);

  const run = useCallback(
    (from: number) => {
      if (!rowWidth) return;
      const fullLapMs = (rowWidth / RAIL_SPEED_PTS_PER_SECOND) * 1000;
      // `from` is zero or negative. The first leg only covers what is left of
      // the current lap, so resuming after a touch does not jump.
      const remainingMs = fullLapMs * ((rowWidth + from) / rowWidth);
      translateX.set(
        withSequence(
          withTiming(-rowWidth, {
            duration: remainingMs,
            easing: Easing.linear,
          }),
          // Snap back to zero before the loop starts: `withRepeat` replays from
          // the value it was given at the start of the repeat, and a repeat
          // that begins at -rowWidth animates to -rowWidth forever, which looks
          // exactly like the rail having stopped.
          withTiming(0, { duration: 0 }),
          withRepeat(
            withTiming(-rowWidth, {
              duration: fullLapMs,
              easing: Easing.linear,
            }),
            -1,
            false,
          ),
        ),
      );
    },
    [rowWidth, translateX],
  );

  useEffect(() => {
    if (reducedMotion || !rowWidth) return;
    translateX.set(0);
    run(0);
    return () => cancelAnimation(translateX);
  }, [reducedMotion, rowWidth, run, translateX]);

  const railStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const cards = (hidden: boolean) => (
    <View
      style={styles.row}
      onLayout={hidden
        ? undefined
        : (event) => setRowWidth(event.nativeEvent.layout.width)}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={hidden}
      testID={hidden ? "testimonial-rail-loop-copy" : "testimonial-rail-row"}
    >
      {items.map((item) => <Card key={item.slug} item={item} />)}
    </View>
  );

  if (reducedMotion) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="list"
        testID="testimonial-rail-static"
      >
        {items.map((item) => <Card key={item.slug} item={item} />)}
      </ScrollView>
    );
  }

  return (
    <View
      style={styles.viewport}
      accessibilityRole="list"
      testID="testimonial-rail"
      // Pause where it stands while a finger is down, resume from there. Both
      // handlers read the shared value on the RN runtime, which is safe here
      // because a touch is two events, not sixty a second.
      onTouchStart={() => cancelAnimation(translateX)}
      onTouchEnd={() => run(translateX.get())}
      onTouchCancel={() => run(translateX.get())}
    >
      <Animated.View style={[styles.track, railStyle]}>
        {cards(false)}
        {cards(true)}
      </Animated.View>
    </View>
  );
}

function Card({ item }: { item: Testimonial }) {
  return (
    <View
      style={styles.card}
      // `role`, not `accessibilityRole`: "listitem" is in React Native's ARIA
      // `Role` union and not in the older `AccessibilityRole` one, so the
      // legacy prop does not typecheck with it. Both reach the same platform
      // trait.
      role="listitem"
      // One node per card, not three. Swiping through photo, then name, then
      // quote makes eight testimonials twenty-four stops.
      accessible
      accessibilityLabel={`${item.name}. ${item.quote}`}
    >
      <View style={styles.head}>
        <Image
          source={item.portrait}
          style={styles.photo}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          // Decorative: the name and the quote beside it carry the meaning, and
          // "portrait of Mateo R." read aloud before every quote is noise.
          accessible={false}
        />
        {/*
          One line, vertically centred against the photo. With the tag gone
          there is nothing to stack under the name, so the head is a 44pt row
          with a single baseline in it rather than a two-line block that leaves
          half its height empty.
        */}
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      </View>
      <Text style={styles.quote}>{item.quote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Clips the row so the cards enter and leave rather than overhang the screen. */
  viewport: { overflow: "hidden" },
  track: { flexDirection: "row" },
  row: { flexDirection: "row", gap: spacing.md, paddingRight: spacing.md },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.onboardingBorder,
    borderRadius: radius.onboardingCard,
    padding: spacing.lg,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    backgroundColor: colors.onboardingStone,
  },
  name: {
    ...onboardingType.body,
    flex: 1,
    minWidth: 0,
    fontWeight: "700",
    color: colors.ink,
  },
  quote: {
    ...onboardingType.helper,
    color: colors.muted,
    marginTop: spacing.md,
  },
});

export default TestimonialRail;
