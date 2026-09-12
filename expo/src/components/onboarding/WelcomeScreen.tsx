import { useCallback, useEffect, useRef } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import BrandWordmark from "@/components/BrandWordmark";
import { DottedGround } from "@/components/brand/DottedGround";
import { CreditCoin } from "@/components/onboarding/CreditCoin";
import { colors, onboardingType, shadows, spacing } from "@/theme";

/**
 * The last screen of onboarding.
 *
 * ITS ONE JOB is to hand the reader into the app feeling like something was
 * given to them, and the thing given is credits. So the credits are the only
 * object on the screen: three coins that fall onto the dotted ground and stack.
 *
 * NO NUMBER, NO BALANCE, NO PRICE, NO PLAN. This is a canonical rule, not a
 * layout preference (`source-of-truth/ONBOARDING_FLOW.md`). Three coins already
 * say "three", and a numeral here reads as an account statement at the exact
 * moment the screen is trying to read as a gift. A price or a plan name here is
 * a second sell after the paywall has already been answered.
 *
 * The count of coins still comes from `credits` rather than being hardcoded to
 * three, because the grant is a pricing decision and pricing changes without
 * this file being reopened. A grant that ever exceeds what the stack can hold
 * is a layout problem to solve then, not a reason to bake in a 3 now.
 */

/** The coin at a 390pt reference width. Scaled per window below. */
const COIN_BASE = 44;

/**
 * How far above its seat a coin starts.
 *
 * A multiple of the coin, not a fixed number of points, so the drop reads the
 * same on a 360 phone as on a 430 one.
 */
const DROP_HEIGHT_COINS = 3.2;

/** The gap between one coin landing and the next starting. */
const STAGGER_MS = 120;

/**
 * The settle. Damping 14 at stiffness 160 lands with one small overshoot —
 * a coin dropped onto a table, not a coin easing into position.
 */
const SETTLE_SPRING = { damping: 14, stiffness: 160 } as const;

/**
 * The loose stack, as fractions of the coin size.
 *
 * Deliberately not a neat row and not a neat pile: the coins overlap by about
 * a third and each sits at its own angle, which is what makes three identical
 * circles read as a handful rather than as a progress indicator.
 */
/**
 * How long the settled stack is held before the screen hands over.
 *
 * 700ms is long enough for the last coin's overshoot to finish and for the eye
 * to land on the pile as a finished object, and short enough that it never
 * reads as the app having stalled. Reduced motion has nothing to watch land,
 * so it gets a flat 900ms: the copy is the whole screen there, and 900ms is
 * about what one short sentence takes to read.
 */
const HOLD_AFTER_SETTLE_MS = 700;
const HOLD_REDUCED_MOTION_MS = 900;

/**
 * The failsafe.
 *
 * The hand-off hangs off a spring's completion callback, and a spring that is
 * interrupted, or a coin that is unmounted mid-flight, never reports finishing.
 * With no button on the screen, that would strand the reader on the last screen
 * of onboarding with nothing to press. This timer guarantees the hand-off
 * happens; in every normal run the settle fires long before it.
 */
const FAILSAFE_MS = 4000;

const SEATS = [
  { dx: -0.62, dy: 0.1, rotate: -9 },
  { dx: 0, dy: -0.12, rotate: 4 },
  { dx: 0.62, dy: 0.14, rotate: 12 },
] as const;

function coinSeat(index: number, coin: number) {
  const seat = SEATS[index % SEATS.length];
  // Beyond three, coins keep walking right rather than landing on top of each
  // other, so a larger grant degrades into a wider stack instead of a blob.
  const extraRow = Math.floor(index / SEATS.length);
  return {
    x: seat.dx * coin + extraRow * coin * 0.3,
    y: seat.dy * coin + extraRow * coin * 0.22,
    rotate: seat.rotate,
  };
}

function FallingCoin({
  index,
  coin,
  reducedMotion,
  onSettled,
}: {
  index: number;
  coin: number;
  reducedMotion: boolean;
  /** Fires once, on the last coin only. */
  onSettled?: () => void;
}) {
  const seat = coinSeat(index, coin);
  const drop = coin * DROP_HEIGHT_COINS;

  // Reduced motion starts at rest. Not "animates faster": the coins are
  // decoration, and the screen has to be complete and readable on frame one
  // for a reader who has asked the system for no movement.
  const fall = useSharedValue(reducedMotion ? 0 : -drop);

  useEffect(() => {
    if (reducedMotion) {
      onSettled?.();
      return;
    }
    const settled = (finished?: boolean) => {
      "worklet";
      if (finished && onSettled) runOnJS(onSettled)();
    };
    fall.set(
      withDelay(index * STAGGER_MS, withSpring(0, SETTLE_SPRING, settled)),
    );
    // One-shot on mount. Re-running on a re-render would re-drop coins that
    // are already sitting on the ground.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The seat and the drop share ONE transform array. Two arrays across two
  // style objects do not merge — the later one replaces the earlier — so
  // putting the seat in the static style and the fall in the animated style
  // silently dropped the offset and the rotation, and all three coins landed
  // in a single pile in the centre.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: seat.x },
      { translateY: seat.y + fall.get() },
      { rotate: `${seat.rotate}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.coin,
        { width: coin, height: coin, borderRadius: coin / 2 },
        animatedStyle,
      ]}
      testID={`welcome-coin-${index}`}
    >
      <CreditCoin size={coin} />
    </Animated.View>
  );
}

export function WelcomeScreen({
  credits = 3,
  onOpen,
}: {
  /** How many coins land. Three, per `source-of-truth/CREDITS_AND_PRICING.md`. */
  credits?: number;
  onOpen: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  // The coin tracks the window so the stack keeps its proportion at 360, 390
  // and 430, and is clamped so it never dominates a small screen or floats on
  // a large one. Everything else on the screen is flex and percentages.
  const coin = Math.max(38, Math.min(52, Math.round((COIN_BASE * width) / 390)));

  const count = Math.max(0, Math.floor(credits));

  // `onOpen` is read through a ref so a caller that re-creates the callback on
  // every render cannot restart the timers, and so a timer that is already in
  // flight calls the callback the caller has NOW rather than a stale closure.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const openedRef = useRef(false);
  const mountedRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const settleScheduledRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Firing `onOpen` after the screen is gone navigates an app that has
      // already navigated. The flag and the clear are both needed: the flag
      // covers a timer that has already been handed to the event loop.
      mountedRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  const openAfter = useCallback((ms: number) => {
    timersRef.current.push(
      setTimeout(() => {
        if (!mountedRef.current || openedRef.current) return;
        openedRef.current = true;
        onOpenRef.current();
      }, ms),
    );
  }, []);

  const handleLastSettled = useCallback(() => {
    // Every coin can report a settle if a spring is re-entered; only the first
    // one may schedule the hand-off.
    if (settleScheduledRef.current) return;
    settleScheduledRef.current = true;

    // One haptic, on the last landing, paired with a visual that stands alone
    // without it. Skipped on web: `expo-haptics` is a no-op there, and calling
    // it is noise in the console rather than feedback.
    if (Platform.OS !== "web" && !reducedMotion) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    openAfter(reducedMotion ? HOLD_REDUCED_MOTION_MS : HOLD_AFTER_SETTLE_MS);
  }, [openAfter, reducedMotion]);

  useEffect(() => {
    // A grant of zero draws no coins, so nothing would ever report a settle.
    if (count === 0) handleLastSettled();
    openAfter(FAILSAFE_MS);
    // One-shot on mount, like the drop itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={[
        styles.root,
        // The footer is gone, so the insets are what keep the centred group
        // from sitting under the notch or the home indicator.
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <DottedGround />
      <View style={styles.wordmarkRow}>
        <BrandWordmark size={24} />
      </View>

      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          Welcome to Katha.
        </Text>
        <Text style={styles.sub}>Your next chapter starts here.</Text>

        {/* The stack sits under the copy in flexible space, so a short window
            squeezes the gap rather than clipping the drop. `height` is a
            multiple of the coin for the same reason the drop is. */}
        <View
          style={[styles.stack, { height: coin * 2.2 }]}
          accessibilityRole="image"
          accessibilityLabel="Your welcome credits"
        >
          {Array.from({ length: count }, (_, i) => (
            <FallingCoin
              key={i}
              index={i}
              coin={coin}
              reducedMotion={reducedMotion}
              onSettled={i === count - 1 ? handleLastSettled : undefined}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  wordmarkRow: {
    alignItems: "center",
    paddingTop: spacing.xxl,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  title: {
    ...onboardingType.title,
    color: colors.ink,
    textAlign: "center",
  },
  sub: {
    ...onboardingType.helper,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.related,
  },
  stack: {
    marginTop: spacing.betweenGroups,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  coin: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    // The contact shadow lives on the wrapper, not in the drawing: an SVG
    // cannot cast one, and the coin has to look like it is ON the dotted
    // ground rather than floating over it. No `backgroundColor` -- the drawing
    // supplies its own rim and face, and a fill here would ring it in gold.
    boxShadow: shadows.card,
  },
});

export default WelcomeScreen;
