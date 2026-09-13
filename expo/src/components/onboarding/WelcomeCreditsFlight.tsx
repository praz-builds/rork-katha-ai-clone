import { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { CreditCoin } from "@/components/onboarding/CreditCoin";
import { motion } from "@/theme";

/**
 * The welcome credits flight.
 *
 * The reader has just been granted credits -- three on the free path, or their
 * plan's twenty or fifty if they subscribed -- and is about to be handed to
 * Home, where the balance lives as a small gold pill in the top-right corner.
 * Nothing on the welcome screen points at that corner, so without this the
 * grant and the place it landed are two unrelated facts. The coins fly there:
 * the reader's eye follows them, and the pill they land on is the answer to
 * "where are my credits" for the rest of the install.
 *
 * ONCE PER INSTALL. See `@/lib/welcome-flight`. This component does not gate
 * itself — the caller decides whether to mount it — because the caller is also
 * the thing that has to mark it played, and splitting that decision across two
 * files is how it ends up done twice or not at all.
 *
 * The overlay is deliberately inert: `pointerEvents="none"` over the whole
 * window. A 400ms animation that can swallow a tap on the CTA underneath it is
 * a bug the user experiences as "the button didn't work".
 */

/** The window coordinates of the thing the coins are flying to. */
export type FlightTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The coin's drawn size. Matches the welcome screen's coin so the hand-off
 * between the two reads as the same object moving, not as one disappearing and
 * another appearing. It is the same `CreditCoin` drawing in both places, which
 * is what makes that literally true rather than approximately.
 */
const COIN_SIZE = 44;

/** Where the coin ends up: pill-sized, not vanished. Never `scale(0)`. */
const LANDED_SCALE = 0.45;

/**
 * The gap between one coin leaving and the next.
 *
 * 110ms is under the ~150ms at which two events stop reading as one gesture,
 * so three coins read as a handful thrown rather than as three separate
 * animations queued up. It also means the whole flight is
 * `2 * 110 + 400 = 620ms`, which is short enough to sit in front of Home.
 */
const STAGGER_MS = 110;

/**
 * The fallback when there is nothing to fly to.
 *
 * Home's pill can genuinely not be measurable: the screen may not have laid
 * out yet, or the header may be off-screen on a short window. Flying to `(0,0)`
 * would send the coins into the top-left corner and teach the reader something
 * false, so the coins simply fade where they are. The caller still gets its
 * `onLanded`/`onDone`, because a missing measurement must never strand the
 * reader on an overlay that never finishes.
 */
const FALLBACK_FADE_MS = 400;

/** Strong ease-out. The coin should leave immediately and arrive gently. */
const EASE_OUT = Easing.out(Easing.cubic);

/**
 * The pill's acknowledgement of a landing: a single overshooting bump.
 *
 * Exported so `HomeScreen` never has to know the shape of the motion — it owns
 * a shared value, this owns what happens to it. 1.18 is large enough to catch
 * the eye in the corner of a busy header and small enough not to collide with
 * the bell beside it.
 */
export function bumpCredits(sv: SharedValue<number>): void {
  sv.set(
    withSequence(
      withSpring(1.18, { damping: 12, stiffness: 220 }),
      withSpring(1, { damping: 14, stiffness: 200 }),
    ),
  );
}

/**
 * The handful. Three, whatever the grant is: see `coins` below.
 */
const DEFAULT_COINS = 3;

/**
 * The balance to show once `landed` of `coins` have arrived.
 *
 * The last landing returns `amount` exactly rather than the rounded figure,
 * because rounding is allowed to be a point out in the middle of an animation
 * and is never allowed to be out at the end: Home keeps whatever the final
 * landing said until the real balance replaces it, so "49" there is a wrong
 * balance sitting on screen rather than a rough count.
 */
function shownFor(landed: number, coins: number, amount: number): number {
  if (coins <= 0) return amount;
  if (landed >= coins) return amount;
  return Math.round((amount * landed) / coins);
}

type CoinProps = {
  /** Window coordinates of the coin's centre at rest. */
  from: { x: number; y: number };
  /** Window coordinates of the target's centre, or null for the fade path. */
  to: { x: number; y: number } | null;
  delayMs: number;
  onArrive: () => void;
};

function Coin({ from, to, delayMs, onArrive }: CoinProps) {
  const progressX = useSharedValue(0);
  const progressY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    // The arc comes from giving x and y DIFFERENT curves rather than from
    // computing a bezier: x is a timing curve that decelerates into the
    // target, y is a spring that overshoots slightly and settles. Their
    // disagreement in the middle of the flight is the arc. One shared curve on
    // both axes draws a straight line, which reads as a teleport.
    const arriveOnX = (finished?: boolean) => {
      "worklet";
      if (finished) runOnJS(onArrive)();
    };

    if (!to) {
      // No target: fade in place and report the landing anyway.
      opacity.set(
        withTiming(0, { duration: FALLBACK_FADE_MS, easing: EASE_OUT }),
      );
      progressX.set(
        withTiming(1, { duration: FALLBACK_FADE_MS }, arriveOnX),
      );
      return;
    }

    progressX.set(
      withDelay(
        delayMs,
        withTiming(1, { duration: motion.slow, easing: EASE_OUT }, arriveOnX),
      ),
    );
    progressY.set(
      withDelay(delayMs, withSpring(1, { damping: 16, stiffness: 140 })),
    );
    scale.set(
      withDelay(
        delayMs,
        withTiming(LANDED_SCALE, { duration: motion.slow, easing: EASE_OUT }),
      ),
    );
    // Opacity goes only in the last 15% of the flight. Fading earlier makes the
    // coin disappear before it reaches the pill, which is precisely the
    // information the flight exists to deliver.
    opacity.set(
      withDelay(
        delayMs + motion.slow * 0.85,
        withTiming(0, { duration: motion.slow * 0.15 }),
      ),
    );
    // Shared values are stable identities and the callback is stable; the
    // flight is a one-shot on mount and must never restart on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const dx = to ? to.x - from.x : 0;
    const dy = to ? to.y - from.y : 0;
    return {
      opacity: opacity.get(),
      // translate before scale, so the coin travels the full distance and is
      // then shrunk about its own centre. Reversed, the translation itself
      // gets multiplied by the scale and the coin lands short of the pill.
      transform: [
        { translateX: progressX.get() * dx },
        { translateY: progressY.get() * dy },
        { scale: scale.get() },
      ],
    };
  });

  const seat: ViewStyle = {
    left: from.x - COIN_SIZE / 2,
    top: from.y - COIN_SIZE / 2,
  };

  return (
    <Animated.View style={[styles.coin, seat, animatedStyle]}>
      <CreditCoin size={COIN_SIZE} />
    </Animated.View>
  );
}

export function WelcomeCreditsFlight({
  coins = DEFAULT_COINS,
  amount,
  measureTarget,
  onLanded,
  onDone,
}: {
  /**
   * How many coins fly. Always three unless a caller says otherwise.
   *
   * DELIBERATELY NOT THE CREDIT COUNT. A subscriber is granted fifty credits
   * and fifty coins is not a gift, it is a swarm; the handful of three is the
   * picture of "you were given something" at any grant size. The number is
   * carried by `amount` instead.
   */
  coins?: number;
  /**
   * The balance the coins deliver: the free grant of three, or the plan's
   * credits for somebody who just subscribed on the paywall.
   */
  amount: number;
  /** Home's credits pill in WINDOW coordinates. Null when it cannot be found. */
  measureTarget: () => Promise<FlightTarget | null>;
  /**
   * Fires on every landing with the balance to SHOW at that moment, so the
   * caller only ever displays the number it is given. Three coins delivering
   * fifty credits report 17, 33, 50; the last landing always reports `amount`
   * exactly, because a count-up that stops one short of the real balance is
   * the bug this rounding would otherwise introduce.
   */
  onLanded: (creditsShown: number) => void;
  /** The overlay has nothing left to draw and can be unmounted. */
  onDone: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  /**
   * `undefined` means "not measured yet" and null means "measured, nothing
   * there". They are different states: the first draws nothing and waits, the
   * second draws the fade. Collapsing them into one nullable would start the
   * fallback on the first frame, before the measurement had a chance.
   */
  const [target, setTarget] = useState<FlightTarget | null | undefined>(
    undefined,
  );

  const landedRef = useRef(0);
  const doneRef = useRef(false);

  // Kept in a ref so a caller that re-creates its callbacks each render does
  // not make the flight restart or double-report.
  const onLandedRef = useRef(onLanded);
  const onDoneRef = useRef(onDone);
  onLandedRef.current = onLanded;
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  /**
   * Landings are counted here, not derived from the coin's index.
   *
   * The count the caller shows must be monotonic -- 17, 33, 50 -- and coin index
   * order is not a guarantee: a spring that settles early or a dropped frame
   * can reorder two arrivals, and a balance that reads 1, 3, 2 is worse than
   * no animation at all.
   */
  const handleArrive = useCallback(
    (arrivals: number) => {
      if (doneRef.current) return;
      landedRef.current = Math.min(landedRef.current + arrivals, coins);
      onLandedRef.current(shownFor(landedRef.current, coins, amount));
      if (landedRef.current >= coins) finish();
    },
    [amount, coins, finish],
  );

  useEffect(() => {
    if (reducedMotion) return;
    let alive = true;
    // A measurement that throws is a missing target, not a crash: the promise
    // comes from the caller and reaches into a view tree this component does
    // not own.
    measureTarget()
      .then((next) => {
        if (alive) setTarget(next ?? null);
      })
      .catch(() => {
        if (alive) setTarget(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  useEffect(() => {
    if (!reducedMotion) return;
    // Reduced motion is not "no credits": the grant still has to be reported,
    // or the caller's balance never ticks up and Home opens showing zero. Next
    // frame rather than synchronously, so the caller's `onDone` cannot unmount
    // this component during its own first render.
    const frame = requestAnimationFrame(() => {
      landedRef.current = coins;
      onLandedRef.current(amount);
      finish();
    });
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, amount, coins, finish]);

  if (reducedMotion || target === undefined) return null;

  const from = { x: width / 2, y: height / 2 };
  // A zero rect is as unusable as no rect. An unlaid-out view measures as
  // 0x0 at 0,0, and flying to it would drop the coins in the top-left corner
  // and look like a bug rather than like a destination.
  const usable =
    target !== null && (target.width > 0 || target.height > 0);
  const to = usable
    ? { x: target.x + target.width / 2, y: target.y + target.height / 2 }
    : null;

  // Without a target one coin fades and reports every credit at once, rather
  // than three coins fading on top of each other in the middle of the screen.
  const coinCount = to ? coins : 1;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.overlay]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="welcome-credits-flight"
    >
      {Array.from({ length: coinCount }, (_, i) => (
        <Coin
          key={i}
          from={from}
          to={to}
          delayMs={i * STAGGER_MS}
          onArrive={() => handleArrive(to ? 1 : coins)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    // Above every screen it can be mounted over, on both platforms: iOS reads
    // zIndex, Android reads elevation, and a value on only one of them means
    // the coins fly UNDER the header on the platform that was not checked.
    zIndex: 999,
    elevation: 999,
  },
  coin: {
    position: "absolute",
    width: COIN_SIZE,
    height: COIN_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default WelcomeCreditsFlight;
