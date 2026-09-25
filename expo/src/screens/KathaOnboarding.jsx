/*
 * KathaOnboarding.jsx  —  Expo / React Native
 * Katha — animated 3-screen onboarding intro (Create → Publish/Community → Read).
 *
 * Drop-in Expo component. Reference frame 390×844. Implements ONBOARDING SPEC §1–§10.
 * Motion runs on the UI thread (Reanimated 4, per `.agents/skills/expo-animation`): one
 * shared progress value per phase drives every element through `useAnimatedStyle`, so
 * React renders when the phase changes, not on every frame. The carousel also follows a
 * finger (Gesture Handler), and the whole intro honours the OS reduced-motion setting.
 *
 * Deps (all in the Expo managed workflow):
 *   npx expo install expo-font expo-linear-gradient
 *   npx expo install @expo-google-fonts/bricolage-grotesque @expo-google-fonts/hanken-grotesk @expo-google-fonts/baloo-2
 *
 * Usage:
 *   const [ready] = useFonts({ ...Bricolage, ...Hanken, ...Baloo });
 *   if (!ready) return null;
 *   <KathaOnboarding onFinish={() => nav.replace('Paywall')} />
 *
 * Assets: put the 16 covers + 3 avatars in ./assets and require() them in COVERS/AVATARS
 * below (see SPEC §8 for the exact order + filenames).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, useWindowDimensions, Image, Platform, ScrollView,
  AccessibilityInfo,
} from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, useAnimatedReaction, useAnimatedStyle, useDerivedValue,
  useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import BrandWordmark from '../components/BrandWordmark';
// The shared onboarding pill. A `.jsx` file importing a `.tsx` component is
// already how `BrandWordmark` arrives above, so the intro draws the SAME
// button as every screen after it rather than a look-alike copy that drifts.
import { Primary } from '../components/onboarding/primitives';
import { controls } from '../theme';

// ── Color tokens (SPEC §2) ──────────────────────────────────────────────────
const C = {
  orange: '#FF6B1A', orangePress: '#E5560A', orangeDeep: '#B15A18', orangeEdit: '#8A3E12',
  ink: '#1E1A16', inkSoft: '#2A231C', inkBody2: '#3A2E20',
  muted: '#6B625A', muted2: '#8A7F73', muted3: '#B49A82',
  sheet: '#FAF7F2', card: '#FFFFFF', dotIdle: '#DED5C8', hairline: '#F0E7D6',
  chipPeach: '#FFF1E5', coverInk: '#16110E', phoneBg: '#FBF6EC',
  heroA: '#FEFBF3', heroB: '#F3EAD8', shadowWarm: '#7A2E0E',
};

// ── Fonts (SPEC §3) — PostScript keys from the @expo-google-fonts packages ───
const F = {
  briSemi: 'BricolageGrotesque',
  briBold: 'BricolageGrotesque',
  briXbold: 'BricolageGrotesque',
  hanken: 'HankenGrotesk',
  hankenIt: 'HankenGrotesk',
  hankenSemi: 'HankenGrotesk',
  hankenBold: 'HankenGrotesk',
  hankenXbold: 'HankenGrotesk',
  baloo: 'Baloo2',
};

// ── Timeline math (SPEC §5) ─────────────────────────────────────────────────
// Worklets: they run inside `useAnimatedStyle` on the UI thread.
function clamp01(x) { 'worklet'; return Math.min(1, Math.max(0, x)); }
function win(p, a, b) { 'worklet'; return clamp01((p - a) / (b - a)); }
function smooth(x) { 'worklet'; const c = clamp01(x); return c * c * (3 - 2 * c); }

const DUR = [10500, 9600]; // ms — phases 0,1; phase 2 holds

// ── Copy (SPEC §4) ──────────────────────────────────────────────────────────
const HEADLINES = [
  ['Write it with Katha, make it yours',
    "Start from a single idea, let Katha draft it with you, and grow it from a short story to a novel, rewriting any line until it sounds like you."],
  ['Publish it and watch it come alive',
    "Share your story with Katha's readers, feel the reactions land, and see it continue in other hands."],
  ['Read from an endless library',
    'From late-night romance to bedtime tales, a new world waits every time you tap in.'],
];

// ── Assets (SPEC §8). Replace paths with your bundled files ──────────────────
const COVERS = [
  { t: 'The Door Above the Clouds',       a: 'Maya Brooks',    img: require('../../assets/covers/door-above-the-clouds.jpg') },
  { t: 'Ravenwick School for Wild Magic', a: 'Ethan Parker',   img: require('../../assets/covers/ravenwick-owl-window.jpg') },
  { t: "The Maharani's Last Cipher",      a: 'Anika Rao',      img: require('../../assets/covers/maharanis-last-cipher.jpg') },
  { t: 'The Dog Who Found Saturn',        a: 'Olivia Hart',    img: require('../../assets/covers/saturn-beach-dog.jpg') },
  { t: 'Midnight Chai Case Files',        a: 'Rumi Khan',      img: require('../../assets/covers/midnight-chai-case-files.jpg') },
  { t: 'The Wolf on Campus',              a: 'Madison Blake',  img: require('../../assets/covers/wolf-on-campus.jpg') },
  { t: 'Garden of Little Dragons',        a: 'Claire Whitman', img: require('../../assets/covers/garden-of-little-dragons.jpg') },
  { t: 'Camp Midnight',                   a: 'Avery Collins',  img: require('../../assets/covers/camp-midnight.jpg') },
  { t: 'The Girl Beneath the Sea',        a: 'Sana Mir',       img: require('../../assets/covers/girl-beneath-the-sea.jpg') },
  { t: 'The Bird at Dusk',                a: 'Noah Bennett',   img: require('../../assets/covers/mockingbird-sky.jpg') },
  { t: 'Train to Moonlit Jaipur',         a: 'Tara Iyer',      img: require('../../assets/covers/moonlit-train-platform.jpg') },
  { t: 'The Library Under Rain',          a: 'Liam Carter',    img: require('../../assets/covers/library-under-rain.jpg') },
  { t: 'The Museum Shadow',               a: 'Leela Varma',    img: require('../../assets/covers/gallery-shadow.jpg') },
  { t: 'The Red Boat',                    a: 'Avery Collins',  img: require('../../assets/covers/old-sea-boat.jpg') },
  { t: 'Rooftop Summer',                  a: 'Mira James',     img: require('../../assets/covers/rooftop-student.jpg') },
  { t: 'Neon Jinn of Sector Nine',        a: 'Kabir Bose',     img: require('../../assets/covers/neon-jinn-sector-nine.jpg') },
];
const AVATARS = [
  require('../../assets/avatars/reader-black-woman.jpg'),
  require('../../assets/avatars/reader-brown-man.jpg'),
  require('../../assets/avatars/reader-white-woman.jpg'),
];

const HERO_H = 478;
const STAGE_H = 340;
const COVER_W = 76, COVER_H = 110, COVER_GAP = 9;

// ── Motion (expo-animation SKILL) ───────────────────────────────────────────
// On-screen movement between slides: the skill's ease-in-out. The slide keeps
// the 0.6s the SPEC gave it; it is a page of the intro, not a chip.
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SLIDE_MS = 600;
// A finger let go of the carousel: the skill's reposition-after-a-drag spring.
const SNAP = { duration: 400, dampingRatio: 0.8 };
// A flick this fast turns the page even if it travelled less than a quarter.
const FLICK_VELOCITY = 500;
// The sheet's fixed slots (dots, headline, description, action) plus its
// padding: DESIGN.md "Message sheet ... h 322". A window shorter than hero +
// sheet scrolls instead of letting "Get started" slide under the copy.
const SHEET_MIN_H = 322;

// ── Root ────────────────────────────────────────────────────────────────────
export default function KathaOnboarding({ onFinish = () => {}, onSignIn = () => {} }) {
  const { width: windowW, height: windowH } = useWindowDimensions();
  // THE DESKTOP TRAP. Every slide is one frame wide and the frame used to be
  // the whole window: on a 1440pt browser each slide was 1440pt, the middle
  // marquee ran out of covers half way, and a window shorter than 800pt put
  // "Get started" on top of the copy with nothing to scroll. The frame is a
  // phone-width column now, and the page scrolls when the window is short.
  const W = Math.min(windowW, controls.introMaxWidth);
  const [phase, setPhase] = useState(0);
  const reduceMotion = useReducedMotionPreference();

  // Progress through the CURRENT phase, 0..1, on the UI thread. It used to be
  // React state set from requestAnimationFrame: a render of the whole intro on
  // every frame for twenty seconds, the first thing anybody sees.
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const phaseSV = useSharedValue(0);
  const slideX = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // The phase a swipe has already started springing towards, so the phase
  // effect does not replace a velocity-carrying spring with a fresh curve.
  // A PHASE, not a boolean: a swipe can ask for the phase the auto-advance
  // committed a frame earlier (the gesture reads `phaseSV`, which syncs after
  // commit). That `setPhase` is a same-value bail-out and runs no effect, and
  // a boolean left armed swallowed the NEXT real transition: hero on Publish,
  // sheet on Read.
  const settledByGesture = useRef(null);

  const advanceFrom = useCallback((from) => {
    setPhase((current) => (current === from ? Math.min(2, from + 1) : current));
  }, []);

  // Timeline: auto-advance 0 → 1 → 2, hold on 2.
  useEffect(() => {
    phaseSV.set(phase);
    cancelAnimation(progress);
    if (reduceMotion || phase >= 2) {
      progress.set(1);
      return undefined;
    }
    progress.set(0);
    progress.set(withTiming(1, { duration: DUR[phase], easing: Easing.linear }, (finished) => {
      if (finished) scheduleOnRN(advanceFrom, phase);
    }));
    return () => cancelAnimation(progress);
  }, [phase, reduceMotion, progress, phaseSV, advanceFrom]);

  // Carousel position. A resize snaps (nothing to animate towards); a phase
  // change slides, unless a swipe is already carrying it there.
  const lastW = useRef(W);
  useEffect(() => {
    const target = -phase * W;
    const resized = lastW.current !== W;
    lastW.current = W;
    const swipedHere = settledByGesture.current === phase;
    settledByGesture.current = null;
    if (swipedHere && !resized) return;
    if (reduceMotion || resized) {
      cancelAnimation(slideX);
      slideX.set(target);
      return;
    }
    slideX.set(withTiming(target, { duration: SLIDE_MS, easing: EASE_IN_OUT }));
  }, [phase, W, reduceMotion, slideX]);

  const goTo = useCallback((n) => setPhase(n), []);
  const goToFromSwipe = useCallback((n) => {
    settledByGesture.current = n;
    setPhase(n);
  }, []);

  const pan = Gesture.Pan()
    .withTestId('intro-pan')
    // Horizontal intent only: a vertical scroll of a short window must still
    // scroll the page, not grab the carousel.
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => {
      cancelAnimation(slideX);
      dragStart.set(slideX.get());
    })
    .onUpdate((e) => {
      const min = -2 * W;
      const x = dragStart.get() + e.translationX;
      // Rubber-band past the first and last slide rather than a hard stop.
      slideX.set(x > 0 ? x * 0.3 : x < min ? min + (x - min) * 0.3 : x);
    })
    .onEnd((e) => {
      const current = phaseSV.get();
      let next = current;
      if (e.translationX < -W / 4 || e.velocityX < -FLICK_VELOCITY) next = Math.min(2, current + 1);
      else if (e.translationX > W / 4 || e.velocityX > FLICK_VELOCITY) next = Math.max(0, current - 1);
      slideX.set(reduceMotion
        ? withTiming(-next * W, { duration: 0 })
        : withSpring(-next * W, { ...SNAP, velocity: e.velocityX, overshootClamping: next === current }));
      if (next !== current) scheduleOnRN(goToFromSwipe, next);
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slideX.get() }] }));

  // Each slide's own clock: running while it is the current phase, finished
  // once it has been passed, unstarted before.
  const p0 = useDerivedValue(() => (phaseSV.get() === 0 ? progress.get() : phaseSV.get() > 0 ? 1 : 0));
  const p1 = useDerivedValue(() => (phaseSV.get() === 1 ? progress.get() : phaseSV.get() > 1 ? 1 : 0));

  return (
    <GestureHandlerRootView style={styles.root}>
      <ScrollView
        testID="intro-page"
        style={styles.flex}
        contentContainerStyle={[styles.page, { minHeight: windowH }]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* The hero band runs the full window width behind the column. */}
        <LinearGradient
          colors={[C.heroA, C.heroB]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
          style={styles.heroBand}
        />
        <View testID="intro-column" style={[styles.column, { width: W }]}>
          <GestureDetector gesture={pan}>
            <View style={styles.hero}>
              <Animated.View testID="intro-slides" style={[{ flexDirection: 'row', width: W * 3, height: HERO_H }, rowStyle]}>
                <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><CreateScreen p={p0} reduceMotion={reduceMotion} /></View>
                <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><PublishScreen p={p1} reduceMotion={reduceMotion} /></View>
                <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><ReadScreen reduceMotion={reduceMotion} /></View>
              </Animated.View>

              <View style={[styles.wordmarkWrap, { pointerEvents: 'none' }]}>
                <BrandWordmark size={28} />
              </View>
            </View>
          </GestureDetector>

          {/* Sign in link, top-right, persistent */}
          <Pressable onPress={onSignIn} accessibilityRole="button" hitSlop={12} style={styles.signInTop}>
            <Text style={styles.signInTopText}>Sign in</Text>
          </Pressable>

          <BottomSheet phase={phase} onDot={goTo} onFinish={onFinish} onSignIn={onSignIn} reduceMotion={reduceMotion} />
        </View>
      </ScrollView>
    </GestureHandlerRootView>
  );
}

function useReducedMotionPreference() {
  // Seeded from Reanimated's synchronous read so the first frame is already
  // right, then kept live by the OS event (Reanimated's hook does not update).
  const initial = useReducedMotion();
  const [reduceMotion, setReduceMotion] = useState(Boolean(initial));

  useEffect(() => {
    let mounted = true;
    const preference = AccessibilityInfo.isReduceMotionEnabled?.();
    preference?.then((enabled) => {
      if (mounted) setReduceMotion(Boolean(enabled));
    });
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}

// ── Bottom sheet (SPEC §4) ──────────────────────────────────────────────────
function BottomSheet({ phase, onDot, onFinish, onSignIn, reduceMotion }) {
  const [h, s] = HEADLINES[phase];
  // The copy crossfades in its fixed slots: opacity only, so nothing reflows
  // and reduced motion keeps the same gentle change.
  const enter = FadeIn.duration(reduceMotion ? 0 : 220).easing(EASE_OUT);
  return (
    <View testID="intro-sheet" style={styles.sheet}>
      <View style={styles.dots}>
        {[0, 1, 2].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Show ${['create', 'publish', 'read'][n]} intro`}
            accessibilityState={{ selected: n === phase }}
            onPress={() => onDot(n)} style={styles.dotHit}>
            {/* A 6pt dot needs a 44pt target; the hit box is negative-margined
                so the row keeps the SPEC's 6pt height. The width change is a
                200ms CSS transition on a childless dot. */}
            <Animated.View style={{
              width: n === phase ? 22 : 6, height: 6, borderRadius: 3,
              backgroundColor: n === phase ? C.orange : C.dotIdle,
              transitionProperty: ['width', 'backgroundColor'],
              transitionDuration: reduceMotion ? 0 : 200,
              transitionTimingFunction: 'ease-out',
            }} />
          </Pressable>
        ))}
      </View>
      <Animated.View key={phase} entering={enter}>
        <Text style={styles.headline}>{h}</Text>
        <Text style={styles.sub}>{s}</Text>
      </Animated.View>
      <View style={styles.actionSlot}>
        {phase === 2 && (
          <Animated.View entering={enter}>
            <Primary label="Get started" onPress={onFinish} />
            <Pressable onPress={onSignIn} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: '#6B625A' }}>Already have an account? <Text style={{ color: '#FF6B1A', fontWeight: '700' }}>Sign in</Text></Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

// ── Screen 0 : CREATE then EDIT (SPEC §5, §6) ───────────────────────────────
const PROMPT = "Write a mystery-fantasy thriller about a teen who finds a hidden door in her family's old house.";

// Opacity + a small rise, the shape every line and chip on the stage enters with.
function riseStyle(r, dy) {
  'worklet';
  return { opacity: r, transform: [{ translateY: (1 - r) * dy }] };
}

function CreateScreen({ p, reduceMotion }) {
  const card = useAnimatedStyle(() => ({ opacity: smooth(win(p.get(), 0, 0.04)) }));
  const gen = useAnimatedStyle(() => {
    const v = p.get();
    const show = smooth(win(v, 0.24, 0.30));
    const scale = (0.9 + 0.1 * show) * (1 - 0.12 * Math.sin(Math.PI * win(v, 0.31, 0.37)));
    return { opacity: show, transform: [{ scale }] };
  });
  const writing = useAnimatedStyle(() => {
    const v = p.get();
    return { opacity: smooth(win(v, 0.37, 0.43)) * (1 - smooth(win(v, 0.56, 0.62))) };
  });
  const line0 = useAnimatedStyle(() => riseStyle(smooth(win(p.get(), 0.44, 0.54)), 6));
  const line1 = useAnimatedStyle(() => riseStyle(smooth(win(p.get(), 0.50, 0.60)), 6));
  const lastLine = useAnimatedStyle(() => ({ opacity: smooth(win(p.get(), 0.56, 0.66)) }));
  const swapBg = useAnimatedStyle(() => {
    const v = p.get();
    const hi = smooth(win(v, 0.60, 0.65)) * (1 - smooth(win(v, 0.90, 0.96)));
    return { backgroundColor: `rgba(255,107,26,${0.20 * hi})` };
  });
  const oldWord = useAnimatedStyle(() => {
    const v = p.get();
    return { opacity: 1 - smooth(win(v, 0.65, 0.67)), transform: [{ translateY: -3 * smooth(win(v, 0.65, 0.72)) }] };
  });
  const newWord = useAnimatedStyle(() => {
    const v = p.get();
    return { opacity: smooth(win(v, 0.69, 0.72)), transform: [{ translateY: 3 * (1 - smooth(win(v, 0.65, 0.72))) }] };
  });
  const chip = useAnimatedStyle(() => riseStyle(smooth(win(p.get(), 0.67, 0.72)), 6));

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.createCard, warmShadow(0.40), card]}>
        <View style={styles.eyebrowRow}>
          <View style={styles.dot7} />
          <Text style={styles.eyebrow}>NEW STORY</Text>
        </View>

        {/* Character-by-character typing keeps line wrapping stable. */}
        <View style={{ marginTop: 10, minHeight: 54 }}>
          <TypedPrompt p={p} reduceMotion={reduceMotion} />
        </View>

        <Animated.View style={[{ marginTop: 10, alignSelf: 'flex-start' }, gen]}>
          <View style={[styles.pillOrange, warmShadow(0.6, C.orange)]}>
            <Text style={styles.pillOrangeText}>✦ Generate story</Text>
          </View>
        </Animated.View>

        <Animated.Text style={[styles.writing, writing]}>✦ Katha is writing…</Animated.Text>

        <View style={styles.storyBlock}>
          <Animated.Text style={[styles.storyLine, line0]}>
            Tara pulled the old wallpaper back as everyone watched:
          </Animated.Text>
          <Animated.Text style={[styles.storyLine, line1]}>
            her brother, aunt, and neighbors crowding the stairs,
          </Animated.Text>
          <Animated.View style={[styles.storyLastLine, lastLine]}>
            <Text style={styles.storyLine}>while the hidden door pulsed like a </Text>
            <Animated.View style={[styles.wordSwap, swapBg]}>
              <Animated.Text style={[styles.swapText, oldWord]}>dream.</Animated.Text>
              <Animated.Text style={[styles.swapText, styles.swapTextNew, newWord]}>warning.</Animated.Text>
            </Animated.View>
          </Animated.View>
        </View>

        <Animated.View style={[{ alignSelf: 'flex-start', marginTop: 7 }, chip]}>
          <View style={styles.pillPeach}><Text style={styles.pillPeachText}>✎ You rewrote this line</Text></View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The one piece of the Create slide that has to be React: text content. It
 * re-renders only when another character is due (about 95 times over 1.8s),
 * and only itself, never the stage around it.
 */
function TypedPrompt({ p, reduceMotion }) {
  const [count, setCount] = useState(reduceMotion ? PROMPT.length : 0);
  useAnimatedReaction(
    () => Math.floor(PROMPT.length * smooth(win(p.get(), 0.05, 0.22))),
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setCount, next);
    },
  );
  const cursor = useAnimatedStyle(() => {
    const v = p.get();
    const typing = smooth(win(v, 0.05, 0.22)) < 1;
    return { opacity: typing && Math.floor(v * 80) % 2 === 0 ? 1 : 0 };
  });
  return (
    <Text style={styles.prompt} numberOfLines={3}>
      {PROMPT.slice(0, count)}
      <Animated.Text style={[{ color: C.orange }, cursor]}>|</Animated.Text>
    </Text>
  );
}

// ── Screen 1 : PUBLISH then COMMUNITY (SPEC §5, §7) ─────────────────────────
function PublishScreen({ p }) {
  const publishBtn = useAnimatedStyle(() => {
    const v = p.get();
    const out = smooth(win(v, 0.22, 0.30));
    const scale = (1 - 0.12 * Math.sin(Math.PI * win(v, 0.16, 0.22))) * (1 - 0.06 * out);
    return { opacity: 1 - out, transform: [{ scale }] };
  });
  const stats = useAnimatedStyle(() => ({ opacity: smooth(win(p.get(), 0.26, 0.34)) }));
  const readers = useAnimatedStyle(() => ({ opacity: smooth(win(p.get(), 0.30, 0.40)) }));
  const note = useAnimatedStyle(() => riseStyle(smooth(win(p.get(), 0.72, 0.82)), 22));

  return (
    <View style={styles.stage}>
      {/* reaction chips (absolute — SPEC §7) */}
      <ReactionChip p={p} at={0.40} text="the door gave me chills" style={{ top: 54, left: 38 }} />
      <ReactionChip p={p} at={0.52} text="♥ liked" peach style={{ top: 132, right: 22 }} />
      <ReactionChip p={p} at={0.62} text="read it twice ✦" style={{ top: 258, left: 34 }} />

      <View style={styles.stageCenter}>
        <View style={[styles.publishCard, warmShadow(0.45)]}>
          <View style={{ flexDirection: 'row' }}>
            <BookSpine />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.bookTitle}>The Forgotten Door</Text>
              <BookStatus p={p} />
              <View style={{ height: 32, marginTop: 12 }}>
                <Animated.View style={[{ position: 'absolute' }, publishBtn]}>
                  <View style={[styles.pillOrangeSm, warmShadow(0.6, C.orange)]}>
                    <Text style={styles.pillOrangeText}>Publish story</Text>
                  </View>
                </Animated.View>
                <Animated.View style={[{ position: 'absolute', top: 6, flexDirection: 'row' }, stats]}>
                  <Hearts p={p} />
                  <Text style={[styles.stat, { color: C.muted, marginLeft: 16 }]}>💬 24</Text>
                </Animated.View>
              </View>
            </View>
          </View>
          <View style={styles.hairline} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
            <View style={{ flexDirection: 'row' }}>
              {AVATARS.map((src, i) => <ReaderAvatar key={i} p={p} i={i} src={src} />)}
            </View>
            <Animated.Text style={[styles.readers, readers]}>new readers today</Animated.Text>
          </View>
        </View>
      </View>

      {/* continuation notification, bottom 40 */}
      <Animated.View style={[{ position: 'absolute', bottom: 18, left: 0, right: 0, alignItems: 'center' }, note]}>
        <NotificationCard />
      </Animated.View>
    </View>
  );
}

function BookStatus({ p }) {
  const [published, setPublished] = useState(false);
  useAnimatedReaction(() => p.get() >= 0.26, (next, previous) => {
    if (next !== previous) scheduleOnRN(setPublished, next);
  });
  return <Text style={styles.bookSub}>{published ? 'by you · published' : 'Draft · ready to share'}</Text>;
}

/** Likes count up 128 → 246. Text, so React; re-renders only itself. */
function Hearts({ p }) {
  const [hearts, setHearts] = useState(128);
  useAnimatedReaction(() => 128 + Math.round(smooth(win(p.get(), 0.30, 0.58)) * 118), (next, previous) => {
    if (next !== previous) scheduleOnRN(setHearts, next);
  });
  return <Text style={[styles.stat, { color: C.orangeDeep }]}>♥ {hearts}</Text>;
}

function ReaderAvatar({ p, i, src }) {
  const style = useAnimatedStyle(() => {
    const a = [0.34, 0.44, 0.54][i];
    const r = smooth(win(p.get(), a, a + 0.10));
    // From 0.5, never from nothing (SKILL: no scale(0)).
    return { opacity: r, transform: [{ scale: 0.5 + 0.5 * r }] };
  });
  return (
    <Animated.Image source={src}
      style={[{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff',
        marginLeft: i === 0 ? 0 : -8 }, style]} />
  );
}

function ReactionChip({ p, at, text, peach, style }) {
  const motion = useAnimatedStyle(() => {
    const r = smooth(win(p.get(), at, at + 0.09));
    return { opacity: r, transform: [{ translateY: (1 - r) * 8 }, { scale: 0.92 + 0.08 * r }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', zIndex: 4 },
      peach ? [styles.chipOrange, warmShadow(0.5, C.orange)] : [styles.chipWhite, warmShadow(0.35)], style, motion]}>
      <Text style={peach ? styles.chipOrangeText : styles.chipWhiteText}>{text}</Text>
    </Animated.View>
  );
}

function BookSpine() {
  return (
    <View style={{ width: 58, height: 78, borderRadius: 6, overflow: 'hidden' }}>
      <LinearGradient colors={['#2E5D57', '#1C3A36']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: 'rgba(0,0,0,0.28)' }} />
      <Text style={styles.spineTitle}>The Forgotten Door</Text>
    </View>
  );
}

function NotificationCard() {
  return (
    <View style={[styles.notif, warmShadow(0.6, C.ink)]}>
      <LinearGradient colors={[C.orange, C.orangePress]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.notifTile}><Text style={{ color: '#fff', fontSize: 16 }}>✦</Text></LinearGradient>
      <View style={{ flex: 1, marginLeft: 11 }}>
        <Text style={styles.notifTitle}>Mira continued your story</Text>
        <Text style={styles.notifBody}>"She followed the light down…"</Text>
      </View>
    </View>
  );
}

// ── Screen 2 : READ marquee (SPEC §8) ───────────────────────────────────────
function ReadScreen({ reduceMotion }) {
  const rows = [
    { reverse: false, dur: 32000, start: 0 },
    { reverse: true,  dur: 26000, start: 6 },
    { reverse: false, dur: 36000, start: 11 },
  ];
  return (
    <View style={[styles.stage, styles.stageCenter, { flexDirection: 'column' }]}>
      {rows.map((r, i) => (
        <View key={i} style={{ marginTop: i === 0 ? 0 : COVER_GAP }}>
          <MarqueeRow {...r} reduceMotion={reduceMotion} />
        </View>
      ))}
    </View>
  );
}

function MarqueeRow({ reverse, dur, start, reduceMotion }) {
  const strip = Array.from({ length: 14 }, (_, i) => COVERS[(start + i) % COVERS.length]);
  const unitWidth = strip.length * (COVER_W + COVER_GAP);
  // Constant motion: linear, looping on the UI thread, stopped under reduced
  // motion on the representative first covers (DESIGN.md "Reduced Motion").
  const x = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(x);
    if (reduceMotion) {
      x.set(0);
      return undefined;
    }
    x.set(reverse ? 1 : 0);
    x.set(withRepeat(withTiming(reverse ? 0 : 1, { duration: dur, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(x);
  }, [dur, reduceMotion, reverse, x]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -unitWidth * x.get() }] }));

  return (
    <MaskedFade>
      <Animated.View style={[{ flexDirection: 'row' }, style]}>
        {[...strip, ...strip].map((c, i) => <CoverCard key={i} c={c} last={i === strip.length * 2 - 1} />)}
      </Animated.View>
    </MaskedFade>
  );
}

// edge fade via overlaid gradients (works without @react-native-masked-view)
function MaskedFade({ children }) {
  return (
    <View style={{ height: COVER_H, overflow: 'hidden' }}>
      {children}
      <LinearGradient colors={[C.heroB, 'rgba(243,234,216,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[styles.fadeL, { pointerEvents: 'none' }]} />
      <LinearGradient colors={['rgba(243,234,216,0)', C.heroB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[styles.fadeR, { pointerEvents: 'none' }]} />
    </View>
  );
}

function CoverCard({ c, last }) {
  return (
    <View style={[{ width: COVER_W, height: COVER_H, borderRadius: 12, overflow: 'hidden', backgroundColor: C.coverInk,
      marginRight: last ? 0 : COVER_GAP }, warmShadow(0.5)]}>
      <Image source={c.img} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient colors={['rgba(24,20,16,0)', 'rgba(24,20,16,0.12)', 'rgba(24,20,16,0.82)']}
        locations={[0, 0.46, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(0,0,0,0.16)', 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 }} />
      <View style={{ position: 'absolute', left: 8, right: 8, bottom: 9, top: 24, justifyContent: 'flex-end' }}>
        <Text style={styles.coverTitle} numberOfLines={2}>{c.t}</Text>
        <Text style={styles.coverAuthor}>{c.a.toUpperCase()}</Text>
      </View>
    </View>
  );
}

// ── warm drop shadow helper (SPEC §9) ───────────────────────────────────────
function warmShadow(opacity, color = C.shadowWarm) {
  return Platform.select({
    ios: { shadowColor: color, shadowOpacity: opacity, shadowRadius: 15, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 12 },
    default: {},
  });
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.sheet },
  flex: { flex: 1 },
  page: { alignItems: 'center' },
  heroBand: { position: 'absolute', top: 0, left: 0, right: 0, height: HERO_H },
  column: { flexGrow: 1 },
  hero: { height: HERO_H, flexShrink: 0, overflow: 'hidden' },
  wordmarkWrap: { position: 'absolute', top: 54, left: 0, right: 0, alignItems: 'center' },
  stage: { position: 'absolute', top: 88, left: 0, right: 0, height: STAGE_H, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  stageCenter: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

  // sheet
  sheet: { flexGrow: 1, minHeight: SHEET_MIN_H, backgroundColor: C.sheet, paddingHorizontal: 28, paddingTop: 22, paddingBottom: 24 },
  dots: { flexDirection: 'row', alignItems: 'center', height: 6, marginBottom: 16, marginLeft: -3 },
  // 44pt tall, 3pt either side of the dot: adjacent targets meet at the SPEC's
  // 6pt gap, and the negative margin keeps the visible row at 6pt.
  dotHit: { height: 44, marginVertical: -19, paddingHorizontal: 3, justifyContent: 'center' },
  headline: { fontFamily: F.briBold, fontWeight: '700', fontSize: 27, lineHeight: 31.3, letterSpacing: 0, color: C.ink, height: 64 },
  sub: { fontFamily: F.hanken, fontWeight: '500', fontSize: 15, lineHeight: 22.5, color: C.muted, height: 54, marginTop: 8 },
  actionSlot: { flex: 1, justifyContent: 'flex-end' },

  // create card
  createCard: { width: 306, height: 346, backgroundColor: C.card, borderRadius: 22, padding: 16, paddingBottom: 14 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot7: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange },
  eyebrow: { fontFamily: F.hankenXbold, fontSize: 10, letterSpacing: 0, color: C.muted3 },
  prompt: { fontFamily: F.hankenIt, fontStyle: 'italic', fontSize: 13.5, lineHeight: 18.5, color: C.inkBody2 },
  pillOrange: { backgroundColor: C.orange, borderRadius: 22, paddingHorizontal: 15, paddingVertical: 9 },
  pillOrangeSm: { backgroundColor: C.orange, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 8 },
  pillOrangeText: { fontFamily: F.hankenBold, fontSize: 12, color: '#fff' },
  writing: { height: 14, fontFamily: F.hankenSemi, fontSize: 10.5, color: C.orangeDeep, marginTop: 7 },
  storyBlock: { marginTop: 6, paddingTop: 7, borderTopWidth: 1, borderTopColor: C.hairline },
  storyLine: { fontFamily: F.hanken, fontSize: 13.2, lineHeight: 19, color: C.inkSoft, marginBottom: 1, flexShrink: 1 },
  storyLastLine: { minHeight: 38, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  wordSwap: { position: 'relative', width: 58, height: 20, borderRadius: 6 },
  swapText: { position: 'absolute', left: 2, top: 0, fontFamily: F.hanken, fontSize: 13.2, lineHeight: 19, color: C.orangeEdit },
  swapTextNew: { fontFamily: F.hankenBold },
  pillPeach: { backgroundColor: C.chipPeach, borderRadius: 22, paddingHorizontal: 10, paddingVertical: 5 },
  pillPeachText: { fontFamily: F.hankenBold, fontSize: 10.5, color: C.orangeDeep },

  // publish card
  publishCard: { zIndex: 2, width: 290, backgroundColor: C.card, borderRadius: 20, padding: 18 },
  bookTitle: { fontFamily: F.briBold, fontSize: 16, color: C.ink },
  bookSub: { fontFamily: F.hanken, fontSize: 11, color: C.muted2, marginTop: 2 },
  stat: { fontFamily: F.hankenSemi, fontSize: 12 },
  hairline: { height: 1, backgroundColor: C.hairline, marginTop: 16 },
  readers: { fontFamily: F.hankenSemi, fontSize: 11.5, color: C.muted2, marginLeft: 10 },
  spineTitle: { position: 'absolute', left: 7, bottom: 7, right: 7, fontFamily: F.briBold, fontSize: 8.5, lineHeight: 9, color: '#F1F5F2' },

  chipWhite: { backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  chipWhiteText: { fontFamily: F.hankenSemi, fontSize: 11, color: C.inkSoft },
  chipOrange: { backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 },
  chipOrangeText: { fontFamily: F.hankenBold, fontSize: 12, color: '#fff' },

  notif: { width: 270, flexDirection: 'row', alignItems: 'center', backgroundColor: C.ink, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  notifTile: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  notifTitle: { fontFamily: F.hankenBold, fontSize: 12.5, color: '#FAF7F2' },
  notifBody: { fontFamily: F.hankenIt, fontStyle: 'italic', fontSize: 11, color: '#B7ADA1', marginTop: 1 },

  coverTitle: { fontFamily: F.briXbold, fontSize: 8.8, lineHeight: 9.6, color: '#fff' },
  coverAuthor: { fontFamily: F.hankenXbold, fontSize: 5.8, letterSpacing: 0, color: 'rgba(255,255,255,0.82)', marginTop: 3 },

  fadeL: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '12%' },
  fadeR: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '12%' },
  signInTop: { position: 'absolute', top: 57, right: 24, zIndex: 19 },
  signInTopText: { fontSize: 13.5, fontWeight: '700', color: '#FF6B1A' },
});
