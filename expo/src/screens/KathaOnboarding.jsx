/*
 * KathaOnboarding.jsx  —  Expo / React Native
 * Katha — animated 3-screen onboarding intro (Character → Story → Read & listen).
 *
 * Reference frame 390×844. Motion runs on the UI thread (Reanimated 4, per
 * `.agents/skills/expo-animation`): ONE shared progress value per phase drives
 * every element through `useAnimatedStyle`, so React renders when the phase
 * changes, not on every frame. The carousel follows a finger (Gesture Handler),
 * and the whole intro honours the OS reduced-motion setting.
 *
 * ## What changed, and why (2026-09-29)
 *
 * The old intro was Create → Publish → Read. That was true when it was built
 * and is not true now: the first thing a new user does after "Get started" is
 * make a CHARACTER — a name and an appearance — and watch a portrait get drawn
 * (`CharacterOnboarding.tsx`, W3→W6). The story brief comes after that. So the
 * intro was rehearsing a flow the app no longer has, and each screen now causes
 * the next one:
 *
 *   1. Raya is drawn from two fields.
 *   2. Raya leads a story; Praz joins the cast; Katha offers directions.
 *   3. That story is on the shelf, ready to read or listen to.
 *
 * ## THE PROGRESS VALUE IS IN MILLISECONDS, NOT 0..1
 *
 * It used to be a 0..1 ratio with every window written as a fraction of a
 * duration that lived in another constant. The timings are authored in ms, so
 * every window was a division done by hand, and changing one slide's duration
 * silently moved every beat inside it. `progress` now counts elapsed ms and
 * `win(t, a, b)` takes ms, so a beat written as 1850–2350 IS 1850–2350.
 *
 * `LEAD_IN` is subtracted inside `win`: every slide's animation starts 350ms
 * after the slide becomes active, so the 600ms carousel transition is most of
 * the way done before anything on the new slide moves.
 *
 * Deps (all in the Expo managed workflow):
 *   npx expo install expo-font expo-linear-gradient
 *   npx expo install @expo-google-fonts/bricolage-grotesque @expo-google-fonts/hanken-grotesk @expo-google-fonts/baloo-2
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

/**
 * Which screen-2 treatment ships.
 *
 * 'A' keeps the directions inside the brief card, swapped in place. 'B'
 * collapses the card to a 110pt summary and stacks the directions below it.
 * Both end on the same frame; A ships because the swap keeps the reader's eye
 * where the idea was, and B's collapse animates a height, which is the one
 * thing the animation skill asks us not to do without a reason.
 */
export const INTRO_S2_VARIANT = 'A';

// ── Color tokens (SPEC §2) ──────────────────────────────────────────────────
const C = {
  orange: '#FF6B1A', orangePress: '#E5560A', orangeDeep: '#B15A18', orangeEdit: '#8A3E12',
  ink: '#1E1A16', inkSoft: '#2A231C', inkBody2: '#3A2E20',
  muted: '#6B625A', muted2: '#8A7F73', muted3: '#B49A82',
  sheet: '#FAF7F2', card: '#FFFFFF', dotIdle: '#DED5C8', hairline: '#F0E7D6',
  chipPeach: '#FFF1E5', coverInk: '#16110E', phoneBg: '#FBF6EC',
  heroA: '#FEFBF3', heroB: '#F3EAD8', shadowWarm: '#7A2E0E',
  field: '#DED5C7', stone: '#E4DCD0', portraitGround: '#E9E0D3',
  appBg: '#F3F2EF', appBorder: '#EEE7DE', heart: '#E85D5D',
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

// ── Timeline math ───────────────────────────────────────────────────────────
// Worklets: they run inside `useAnimatedStyle` on the UI thread.
function clamp01(x) { 'worklet'; return Math.min(1, Math.max(0, x)); }
function smooth(x) { 'worklet'; const c = clamp01(x); return c * c * (3 - 2 * c); }

/** Every slide's animation starts this long after the slide becomes active. */
const LEAD_IN = 350;

/**
 * 0 before `a` ms, 1 after `b` ms, linear between — with `LEAD_IN` already
 * taken off, so the numbers here are the numbers in the spec.
 */
function win(t, a, b) { 'worklet'; return clamp01((t - LEAD_IN - a) / (b - a)); }

/** Opacity + a small rise: the shape every line and chip enters with. */
function riseStyle(r, dy) {
  'worklet';
  return { opacity: r, transform: [{ translateY: (1 - r) * dy }] };
}

/** A press: down to 0.95 and back, over the window. */
function pressScale(t, a, b) { 'worklet'; return 1 - 0.05 * Math.sin(Math.PI * win(t, a, b)); }

/** A pulse: up to 1.06 and back, over the window. */
function pulseScale(t, a, b) { 'worklet'; return 1 + 0.06 * Math.sin(Math.PI * win(t, a, b)); }

const EASE_OUT_CUBIC = (x) => { 'worklet'; return 1 - Math.pow(1 - clamp01(x), 3); };

/** ms per phase. Phase 2 holds on its end frame. */
const DUR = [5200, 9200, 8800];

// ── Copy ────────────────────────────────────────────────────────────────────
/**
 * What the reader can DO, not what the screen is showing.
 *
 * The first pass narrated: "Meet the lead of your story" invites you to be
 * introduced to somebody who already exists, when the thing on offer is that
 * YOU make them. Every headline is now the capability in the second person,
 * and every subcopy is the same shape underneath it -- what it costs you, then
 * what Katha does with it -- so the three screens read as one promise getting
 * bigger rather than three descriptions.
 *
 * ## Length is load-bearing, not taste
 *
 * EVERY HEADLINE IS ONE LINE, and they have to stay that way. The slot used to
 * be two lines tall to fit the longest of them, which meant the short ones
 * carried a spare line of slack -- and wherever that slack went, it made one
 * slide's spacing different from another's. Below the headline it opened a
 * 30pt hole above the subcopy; above the headline it opened the same hole
 * under the dots, on slides 1 and 3 but not 2. There is no third place to put
 * it. The only fix that makes all three slides identical is for all three
 * headlines to be the same height, so they are all short enough to be one
 * line: about 21 characters at 27/31.3 in the reference column.
 *
 * The subcopy slot is 54pt at 22.5, and all three run to two lines; past about
 * 85 characters a third appears and is clipped. Keep both bounds.
 */
const HEADLINES = [
  ['Create your character',
    'A name and one line about their look. Katha draws them, and they lead your story.'],
  ['Turn it into a story',
    'Katha drafts it from your idea, then you rewrite any line until it sounds like you.'],
  ['Read it, or listen',
    "Katha narrates every chapter. Publish when you're ready, and read what others write."],
];

const SLIDE_NAMES = ['character', 'story', 'read'];

// ── The cast ────────────────────────────────────────────────────────────────
/**
 * Raya leads, Praz joins on screen 2.
 *
 * `RAYA_APPEARANCE` is typed on screen 1 character by character AND is the
 * exact string `backend/scripts/generate-intro-characters.ts` sent to the
 * portrait model to draw `raya-cutout.png`. The screen shows a field, then
 * shows what Katha drew from it; if these two ever drift apart the screen is
 * lying about the product, so they are regenerated together or not at all.
 */
const RAYA_APPEARANCE =
  'An Indian woman in her twenties with curly black hair and round glasses. Athletic build, olive field jacket, worn hiking boots.';
const APPEARANCE_MAX = 300;

const STORY_IDEA =
  'Raya and Praz, friends since childhood, trek through the still, dark forests of Silence Ridge.';

/**
 * The three directions, as the product really makes them.
 *
 * NOT hand-written atmosphere, and not hand-written prose either. Each of
 * these is a real output of `toDirection` (src/lib/directions.ts) — the same
 * converter the create flow and the chapter-end chips run every beat through
 * — so the intro shows sentences the product can actually produce.
 *
 * THEY ARE THREE OPENINGS, NOT A PLOT. `DirectionStep` asks "Where does it
 * begin?" and every card it offers is a candidate chapter one, derived from
 * `beats` where `beats[0]` IS chapter one's brief. So the three cards are
 * three different ways to start the SAME story -- through its atmosphere,
 * through the friendship, through the trek going wrong -- and not a
 * pressure/turn/payoff arc. A previous draft made them an arc, which put a
 * decision about a broken bridge on a card labelled "where does it begin";
 * the founder read it as arriving from nowhere, and it was.
 *
 * THEY USE ONLY WHAT THE TYPED IDEA CONTAINS. `STORY_IDEA` gives two people, a
 * friendship going back to childhood, a trek on foot, and a forest that is
 * unusually still. Every card above is built from exactly those: the silence
 * the ridge is named for, the promise between two old friends, the trail lost
 * as the light goes. Nothing enters from outside the sentence -- no rescuers,
 * no bridges, no fire towers -- because the screen's whole claim is that Katha
 * read what the writer typed.
 *
 * THE THREE FRAMES ARE DELIBERATELY DIFFERENT, and that is a content choice
 * made in the beats, not a licence taken with the converter:
 *
 *   1. opens with an imperative verb, so `ALREADY_IMPERATIVE` passes the beat
 *      through untouched;
 *   2. is a beat written as a decision ("Raya must decide whether..."), which
 *      takes the modal frame and comes back as "Have Raya decide...";
 *   3. is a "what happens when" beat, which takes the whatHappens frame.
 *
 * The first draft of this screen used three plain declarative beats, which
 * then came back through a "Write it so ..." frame (removed 2026-10-08; plain
 * statements now go on the card unframed). Beats that vary in shape still
 * produce directions that vary in shape, which is also what the live screen
 * looks like on a real idea.
 */
const DIRECTIONS = [
  'Open with Raya stopping on the dark trail when the forest suddenly falls completely silent.',
  'Have Raya decide whether to tell Praz the childhood promise she never kept.',
  'Show what happens when Praz loses the trail in the darkening still forest.',
];

/**
 * The title, and it is not decoration.
 *
 * "The Long Way Up" described the trek, which any hiking story could be called.
 * This one names what the chosen direction is ABOUT -- a promise twenty years
 * old that Raya still has not kept -- so slide 2 and slide 3 are visibly the
 * same story: the reader picks an opening about a childhood promise, and the
 * book that appears on the shelf is called after it. It also obeys the
 * product's own rule for titles (`ONBOARDING_SHAPE_SYSTEM_PROMPT`): one to six
 * words, specific to this story, never a genre label.
 *
 * It also has to be ONE line at 28/32 in the story page's 298pt column, and
 * fit the Home card's 214pt without an ellipsis. This measures 244 and 133.
 * Check both when changing it: "The Promise She Never Kept" was an earlier
 * choice and is the better sentence, but at 380pt it wrapped to two lines and
 * the second line pushed the blurb down into the Read and Listen pills.
 */
const STORY_TITLE = 'Twenty Years Late';
const STORY_BLURB = 'Raya and Praz trek through the still, dark forests of Silence Ridge.';

// ── Assets ──────────────────────────────────────────────────────────────────
const RAYA = require('../../assets/onboarding/raya-cutout.png');
const PRAZ = require('../../assets/onboarding/praz-cutout.png');
const COVER_TREK = require('../../assets/onboarding/cover-trek.png');

const TRENDING = [
  { img: require('../../assets/covers/maharanis-last-cipher.jpg'), genre: 'Mystery', likes: '428' },
  { img: require('../../assets/covers/wolf-on-campus.jpg'), genre: 'Romance', likes: '1.2k' },
  { img: require('../../assets/covers/neon-jinn-sector-nine.jpg'), genre: 'Sci-fi', likes: '860' },
  { img: require('../../assets/covers/midnight-chai-case-files.jpg'), genre: 'Mystery', likes: '640' },
];
const ORIGINALS = [
  { img: require('../../assets/covers/garden-of-little-dragons.jpg'), genre: 'Fantasy', likes: '2.1k' },
  { img: require('../../assets/covers/library-under-rain.jpg'), genre: 'Slice of life', likes: '934' },
  { img: require('../../assets/covers/door-above-the-clouds.jpg'), genre: 'Adventure', likes: '512' },
  { img: require('../../assets/covers/ravenwick-owl-window.jpg'), genre: 'Fantasy', likes: '1.4k' },
];

const HERO_H = 478;

/**
 * Where the cover's vertical crop is anchored, 0 = top, 0.5 = centre.
 *
 * THE STORY PAGE IS THE CRUEL CROP. One square source is shown as a 70x81
 * tile on Home (which keeps the full height and trims the sides) and as a
 * 334x230 band on the story page (which keeps only the middle 69%). Centred,
 * that band cut the top of the taller character's head off — the cover is OF
 * the two characters, so beheading one is the one thing it cannot do.
 *
 * Biasing the anchor towards the top keeps both heads and spends the slack at
 * the bottom, which is the character's legs and the forest floor: the part the
 * gradient fades out anyway. The product's own covers solve this in the prompt
 * (`SAFE_ZONE_CLAUSE`, cover-prompts.ts) by asking for the faces between 20%
 * and 50% of the height. That clause is in this cover's prompt too, and across
 * three generations the model put the heads above it every time, so the crop
 * is the layer that actually has to hold the line.
 */
const COVER_FOCUS_Y = 0.1;

/**
 * ONE tile size for both shelves, and it is the product's own.
 *
 * Trending was 104x100 and Originals 104x86, which is what the handoff drew.
 * Side by side in one 392pt card that reads as two different components
 * rather than two shelves of the same thing, and the founder saw it
 * immediately. One size for both fixes that.
 *
 * 74x96 IS THIS SCREEN'S OWN NUMBER, not a product spec. An earlier comment
 * here claimed it was the "mini" cover size from `backend/COVER_IMAGES.md`;
 * that file carries no such figure, the product's `mini` cover is a 96pt
 * SQUARE (`KathaPrimitives.tsx`, `aspectRatio: 1`), and the 74pt width was
 * explicitly retired in `lib/cover-url.ts`. It is kept because a portrait tile
 * is what reads as a book at this size and four of them fit the card, but it
 * is a drawing of a shelf, not the shelf, and it should not be cited as a
 * precedent by anything else.
 */
const TILE_W = 74;
const TILE_H = 96;
const TILE_GAP = 8;

/**
 * The Home story card's padding, and the cover well inside it.
 *
 * Shared between the stylesheet and the morph, because they have to agree:
 * the morph starts at the well's position, and when those two drifted apart
 * the cover hung off the top and bottom edges of the card it was supposed to
 * be sitting inside.
 */
const STORY_CARD_PAD = 8;
const SLOT_W = 70;
const SLOT_H = 68;

// ── Motion (expo-animation SKILL) ───────────────────────────────────────────
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SLIDE_MS = 600;
// A finger let go of the carousel: the skill's reposition-after-a-drag spring.
const SNAP = { duration: 400, dampingRatio: 0.8 };
// A flick this fast turns the page even if it travelled less than a quarter.
const FLICK_VELOCITY = 500;
// The sheet's fixed slots (dots, headline, description, action) plus its
// padding. A window shorter than hero + sheet scrolls instead of letting
// "Get started" slide under the copy.
const SHEET_MIN_H = 322;

/** A warm shadow, never a neutral grey one. */
function warmShadow(opacity, color = C.shadowWarm) {
  return Platform.select({
    web: { boxShadow: `0 10px 28px rgba(122,46,14,${0.10 * opacity})` },
    default: {
      shadowColor: color,
      shadowOpacity: 0.16 * opacity,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
  });
}

// ── Root ────────────────────────────────────────────────────────────────────
export default function KathaOnboarding({ onFinish = () => {}, onSignIn = () => {} }) {
  const { width: windowW, height: windowH } = useWindowDimensions();
  // THE DESKTOP TRAP. Every slide is one frame wide and the frame used to be
  // the whole window: on a 1440pt browser each slide was 1440pt, and a window
  // shorter than 800pt put "Get started" on top of the copy with nothing to
  // scroll. The frame is a phone-width column now, and the page scrolls when
  // the window is short.
  const W = Math.min(windowW, controls.introMaxWidth);
  const [phase, setPhase] = useState(0);
  const reduceMotion = useReducedMotionPreference();

  // Elapsed ms through the CURRENT phase, on the UI thread. It used to be
  // React state set from requestAnimationFrame: a render of the whole intro on
  // every frame for twenty seconds, the first thing anybody sees.
  const progress = useSharedValue(reduceMotion ? DUR[0] : 0);
  const phaseSV = useSharedValue(0);
  const slideX = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // The phase a swipe has already started springing towards, so the phase
  // effect does not replace a velocity-carrying spring with a fresh curve.
  // A PHASE, not a boolean: a swipe can ask for the phase the auto-advance
  // committed a frame earlier (the gesture reads `phaseSV`, which syncs after
  // commit). That `setPhase` is a same-value bail-out and runs no effect, and
  // a boolean left armed swallowed the NEXT real transition.
  const settledByGesture = useRef(null);

  const advanceFrom = useCallback((from) => {
    setPhase((current) => (current === from ? Math.min(2, from + 1) : current));
  }, []);

  // Timeline: auto-advance 0 → 1 → 2, hold on 2.
  useEffect(() => {
    phaseSV.set(phase);
    cancelAnimation(progress);
    const total = DUR[phase];
    if (reduceMotion || phase >= 2) {
      // The end frame, immediately. Phase 2 holds there anyway; reduced motion
      // holds there on every slide.
      progress.set(total + LEAD_IN);
      if (phase >= 2 && !reduceMotion) {
        // Phase 2 still PLAYS, it just has nothing after it to advance to.
        progress.set(0);
        progress.set(withTiming(total + LEAD_IN, { duration: total + LEAD_IN, easing: Easing.linear }));
      }
      return undefined;
    }
    progress.set(0);
    progress.set(withTiming(total + LEAD_IN, { duration: total + LEAD_IN, easing: Easing.linear }, (finished) => {
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
  const p0 = useDerivedValue(() => (phaseSV.get() === 0 ? progress.get() : phaseSV.get() > 0 ? DUR[0] + LEAD_IN : 0));
  const p1 = useDerivedValue(() => (phaseSV.get() === 1 ? progress.get() : phaseSV.get() > 1 ? DUR[1] + LEAD_IN : 0));
  const p2 = useDerivedValue(() => (phaseSV.get() === 2 ? progress.get() : 0));

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
                <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><CharacterScreen t={p0} reduceMotion={reduceMotion} /></View>
                <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><StoryScreen t={p1} reduceMotion={reduceMotion} /></View>
                <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><ReadScreen t={p2} reduceMotion={reduceMotion} /></View>
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

// ── Bottom sheet ────────────────────────────────────────────────────────────
function BottomSheet({ phase, onDot, onFinish, onSignIn, reduceMotion }) {
  const [h, s] = HEADLINES[phase];

  // The copy crossfades in its fixed slots: opacity only, so nothing reflows
  // and reduced motion keeps the same gentle change.
  const enter = FadeIn.duration(reduceMotion ? 0 : 300).easing(EASE_OUT);

  return (
    <View testID="intro-sheet" style={styles.sheet}>
      <View style={styles.dots}>
        {[0, 1, 2].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Show ${SLIDE_NAMES[n]} intro`}
            accessibilityState={{ selected: n === phase }}
            onPress={() => onDot(n)} style={styles.dotHit}>
            {/* A 6pt dot needs a 44pt target; the hit box is negative-margined
                so the row keeps the SPEC's 6pt height.
                KNOWINGLY crosses the skill's "Never Ship: animating width" row:
                the dot is in flow, so its two siblings re-lay-out on each of
                the 200ms frames. Accepted because it is three 6pt nodes, only
                on a slide change, and `scaleX` (the transform alternative)
                smears the 3pt corner radius into an oval. The transition is a
                Reanimated 4 CSS transition, which runs on native and web. */}
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
        {/* One line tall, and every headline is written to fit it: see the
            note on HEADLINES for why equal content, not a fixed slot, is what
            makes the three slides' spacing match. */}
        <View style={styles.headlineSlot}>
          <Text style={styles.headline}>{h}</Text>
        </View>
        <Text style={styles.sub}>{s}</Text>
      </Animated.View>
      <View style={styles.actionSlot}>
        {phase === 2 && (
          <Animated.View entering={enter}>
            <Primary label="Get started" onPress={onFinish} />
            <Pressable onPress={onSignIn} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={styles.signInBelow}>Already have an account? <Text style={styles.signInBelowLink}>Sign in</Text></Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/**
 * Text that types itself from a shared clock.
 *
 * The one piece of a slide that has to be React: text content. It re-renders
 * only when another character is due, and only itself, never the stage around
 * it. `from` is the fraction already on screen when the window opens — screen
 * 1 starts at 70% deliberately, so the viewer sees a field being finished
 * rather than sitting through 118 characters of typing.
 */
function TypedText({ t, a, b, text, style, from = 0, reduceMotion, numberOfLines, showCursor = true }) {
  const firstCount = Math.floor(text.length * from);
  const [count, setCount] = useState(reduceMotion ? text.length : firstCount);
  useAnimatedReaction(
    () => {
      const r = from + (1 - from) * clamp01(win(t.get(), a, b));
      return Math.floor(text.length * r);
    },
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setCount, next);
    },
  );
  const cursor = useAnimatedStyle(() => {
    const v = t.get();
    const typing = win(v, a, b) < 1 && v > LEAD_IN;
    // 450ms blink: one frame of the cycle on, one off.
    return { opacity: typing && Math.floor(v / 450) % 2 === 0 ? 1 : 0 };
  });
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {text.slice(0, count)}
      {showCursor ? <Animated.Text style={[{ color: C.orange }, cursor]}>|</Animated.Text> : null}
    </Text>
  );
}

/** A live character counter driven by the same clock as the typing. */
function TypedCounter({ t, a, b, total, from, reduceMotion }) {
  const [count, setCount] = useState(reduceMotion ? total : Math.floor(total * from));
  useAnimatedReaction(
    () => {
      const r = from + (1 - from) * clamp01(win(t.get(), a, b));
      return Math.floor(total * r);
    },
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setCount, next);
    },
  );
  return <Text style={styles.counter}>{count} / {APPEARANCE_MAX}</Text>;
}

/** A label that swaps once the clock passes `at`. */
function SwapLabel({ t, at, before, after, style }) {
  const [past, setPast] = useState(false);
  useAnimatedReaction(() => t.get() >= at + LEAD_IN, (next, previous) => {
    if (next !== previous) scheduleOnRN(setPast, next);
  });
  return <Text style={style}>{past ? after : before}</Text>;
}

// ── Screen 0 : CHARACTER ────────────────────────────────────────────────────
/**
 * Two fields, a press, a scan, a face.
 *
 * The fields are NAME and APPEARANCE and nothing else, because that is all the
 * product asks for (`CharacterOnboarding.tsx` W4). Adding a third would make
 * the screen's own promise — "two details are all it takes" — false.
 */
function CharacterScreen({ t, reduceMotion }) {
  const card = useAnimatedStyle(() => ({ opacity: smooth(win(t.get(), 0, 220)) }));
  // The form dims under the scan rather than disappearing: the person keeps
  // seeing what the portrait was made from.
  const form = useAnimatedStyle(() => ({ opacity: 1 - 0.5 * smooth(win(t.get(), 1000, 1150)) }));
  const cta = useAnimatedStyle(() => {
    const v = t.get();
    return { transform: [{ scale: pulseScale(v, 650, 900) * pressScale(v, 900, 1100) }] };
  });
  const ctaFill = useAnimatedStyle(() => ({
    backgroundColor: win(t.get(), 1000, 1000.1) > 0 ? C.orangePress : C.orange,
  }));
  const scan = useAnimatedStyle(() => {
    const v = t.get();
    const r = win(v, 1000, 1850);
    return {
      opacity: r > 0 && r < 1 ? 1 : 0,
      transform: [{ translateY: -90 + r * (346 + 90) }],
    };
  });
  const portrait = useAnimatedStyle(() => {
    const r = smooth(win(t.get(), 1850, 2350));
    return { opacity: r, transform: [{ scale: 1.06 - 0.06 * r }] };
  });

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.characterCard, warmShadow(0.45), card]}>
        <Animated.View style={form}>
          <View style={styles.eyebrowRow}>
            <View style={styles.dot7} />
            <Text style={styles.eyebrow}>NEW CHARACTER</Text>
          </View>

          <Text style={styles.fieldLabel}>NAME</Text>
          <View style={styles.nameField}><Text style={styles.nameValue}>Raya</Text></View>

          <View style={styles.labelRow}>
            <Text style={styles.fieldLabel}>APPEARANCE</Text>
            <TypedCounter t={t} a={0} b={500} total={RAYA_APPEARANCE.length} from={0.7} reduceMotion={reduceMotion} />
          </View>
          <View style={styles.appearanceField}>
            <TypedText
              t={t} a={0} b={500} text={RAYA_APPEARANCE} from={0.7}
              reduceMotion={reduceMotion} style={styles.appearanceText} numberOfLines={4}
            />
          </View>
        </Animated.View>

        <Animated.View style={[styles.characterCtaWrap, cta]}>
          <Animated.View style={[styles.ctaPill, ctaFill, warmShadow(0.6, C.orange)]}>
            <SwapLabel t={t} at={1000} before="Bring Raya to life" after="Drawing Raya…" style={styles.ctaLabel} />
          </Animated.View>
        </Animated.View>

        {/* The scan band sweeps the whole card once, then the portrait lands
            on top of it. Both are clipped by the card's own radius. */}
        <Animated.View style={[styles.scanBand, scan, { pointerEvents: 'none' }]}>
          <LinearGradient
            colors={['rgba(255,107,26,0)', 'rgba(255,107,26,0.22)', 'rgba(255,107,26,0.5)']}
            locations={[0, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.scanLine} />
        </Animated.View>

        <Animated.View style={[styles.portraitLayer, portrait]}>
          <Image source={RAYA} resizeMode="contain" style={styles.portraitImage} />
          <View style={styles.portraitChipLeft}><Text style={styles.portraitChipLeftText}>Raya</Text></View>
          <View style={styles.portraitChipRight}><Text style={styles.portraitChipRightText}>DRAWN BY KATHA</Text></View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ── Screen 1 : STORY ────────────────────────────────────────────────────────
const GENRES = ['Romance', 'Adventure', 'Fantasy', 'Thriller'];

function StoryScreen({ t, reduceMotion }) {
  const collapses = INTRO_S2_VARIANT === 'B';

  const cardEnter = useAnimatedStyle(() => {
    const r = smooth(win(t.get(), 0, 400));
    return { opacity: r, transform: [{ translateY: (1 - r) * 14 }] };
  });
  // Variant A swaps the brief for the directions inside one card; B collapses
  // the card to a summary and stacks the directions below it.
  const cardBody = useAnimatedStyle(() => ({ opacity: 1 - smooth(win(t.get(), 3900, 4200)) }));
  const cardHeight = useAnimatedStyle(() => {
    if (!collapses) return { height: 372 };
    return { height: 372 - 262 * EASE_OUT_CUBIC(win(t.get(), 3900, 4500)) };
  });
  const summary = useAnimatedStyle(() => ({
    opacity: collapses ? smooth(win(t.get(), 4200, 4600)) : 0,
  }));
  const createCta = useAnimatedStyle(() => {
    const v = t.get();
    return { transform: [{ scale: pulseScale(v, 3400, 3650) * pressScale(v, 3650, 3900) }] };
  });

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.briefCard, warmShadow(0.45), cardEnter, cardHeight]}>
        {/* The brief. Fades out at 3900 in both variants. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.briefBody, cardBody]}>
          <View style={styles.kidsRow}>
            <View style={styles.kidsTrack}><View style={styles.kidsKnob} /></View>
            {/* "All-ages", not "For kids". `CreateBriefFlow.tsx` renders
                All-ages and `source-of-truth/STORY_GENERATION_FLOW.md` §3
                states it as the on-screen label; "kids" is the internal
                `audienceMode` value, not a string a user ever sees. */}
            <Text style={styles.kidsLabel}>All-ages</Text>
          </View>

          <View style={styles.genreRow}>
            {GENRES.map((g) => <GenreChip key={g} t={t} label={g} selected={g === 'Adventure'} />)}
          </View>

          <Text style={[styles.eyebrow, styles.eyebrowOrange]}>CREATE</Text>
          <Text style={styles.briefTitle}>What is your story about?</Text>

          <IdeaField t={t} reduceMotion={reduceMotion} />

          <View style={styles.labelRow}>
            <Text style={styles.fieldLabel}>WHO&apos;S IN IT</Text>
            <CastCount t={t} />
          </View>
          <View style={styles.castRow}>
            <CastChip label="Raya" source={RAYA} selectedAt={0} t={t} />
            <CastChip label="Praz" source={PRAZ} selectedAt={3000} t={t} />
          </View>

          <Animated.View style={[styles.createCtaWrap, createCta]}>
            <View style={[styles.ctaPill, styles.ctaPillOrange, warmShadow(0.6, C.orange)]}>
              <Text style={styles.ctaLabel}>Create story</Text>
            </View>
          </Animated.View>
        </Animated.View>

        {/* Variant B only: what the collapsed card says instead. */}
        {collapses && (
          <Animated.View style={[styles.summaryRow, summary]}>
            <View style={styles.summaryAvatars}>
              <Image source={RAYA} style={styles.summaryAvatar} />
              <Image source={PRAZ} style={[styles.summaryAvatar, styles.summaryAvatarOverlap]} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.summaryTitle}>Adventure · Raya and Praz</Text>
              <Text style={styles.summaryIdea} numberOfLines={2}>{STORY_IDEA}</Text>
            </View>
          </Animated.View>
        )}

        {/* Variant A only: the directions live inside the same card. */}
        {!collapses && <Directions t={t} inside />}
      </Animated.View>

      {/* Variant B only: the directions stack below the collapsed card. */}
      {collapses && <Directions t={t} inside={false} />}
    </View>
  );
}

function GenreChip({ t, label, selected }) {
  const style = useAnimatedStyle(() => {
    const on = selected ? smooth(win(t.get(), 500, 700)) : 0;
    return {
      backgroundColor: on > 0.5 ? C.orange : 'transparent',
      borderColor: on > 0.5 ? C.orange : C.field,
    };
  });
  const text = useAnimatedStyle(() => {
    const on = selected ? smooth(win(t.get(), 500, 700)) : 0;
    return { color: on > 0.5 ? '#FFFFFF' : C.inkSoft };
  });
  return (
    <Animated.View style={[styles.genreChip, style]}>
      <Animated.Text style={[styles.genreChipText, text]}>{label}</Animated.Text>
    </Animated.View>
  );
}

function IdeaField({ t, reduceMotion }) {
  const ring = useAnimatedStyle(() => ({
    borderColor: win(t.get(), 800, 800.1) > 0 ? C.orange : C.field,
  }));
  return (
    <Animated.View style={[styles.ideaField, ring]}>
      <TypedText
        t={t} a={800} b={2800} text={STORY_IDEA} reduceMotion={reduceMotion}
        style={styles.ideaText} numberOfLines={3}
      />
    </Animated.View>
  );
}

function CastCount({ t }) {
  const [two, setTwo] = useState(false);
  useAnimatedReaction(() => t.get() >= 3250 + LEAD_IN, (next, previous) => {
    if (next !== previous) scheduleOnRN(setTwo, next);
  });
  return <Text style={styles.counter}>{two ? 2 : 1} of 3</Text>;
}

/**
 * A cast member. Raya is already in (she is the character screen 1 drew);
 * Praz joins at 3000, which is the moment the intro's two halves meet.
 */
function CastChip({ label, source, selectedAt, t }) {
  const chip = useAnimatedStyle(() => {
    const on = smooth(win(t.get(), selectedAt, selectedAt + 250));
    return {
      borderColor: on > 0.5 ? C.orange : C.field,
      backgroundColor: on > 0.5 ? C.chipPeach : 'transparent',
    };
  });
  const [added, setAdded] = useState(selectedAt === 0);
  useAnimatedReaction(() => t.get() >= selectedAt + 250 + LEAD_IN, (next, previous) => {
    if (next !== previous) scheduleOnRN(setAdded, next);
  });
  return (
    <Animated.View style={[styles.castChip, chip]}>
      <View style={styles.castAvatar}>
        <Image source={source} style={styles.castAvatarImage} resizeMode="cover" />
      </View>
      <Text style={styles.castChipText}>{label}</Text>
      <Text style={styles.castChipMark}>{added ? '✓' : '+'}</Text>
    </Animated.View>
  );
}

/**
 * "Where does it begin?" — the real heading of the real screen.
 *
 * The create flow calls this step `heading="Where does it begin?"`
 * (`components/create/DirectionStep.tsx`), and the cards are imperative
 * instructions, not blurbs. The handoff brief called it "Choose a direction"
 * with three atmospheric third-person sentences; both were inventions, and an
 * intro that teaches a screen the app does not have is worse than no intro.
 */
function Directions({ t, inside }) {
  const container = useAnimatedStyle(() => ({
    opacity: inside ? smooth(win(t.get(), 4000, 4300)) : smooth(win(t.get(), 4300, 4700)),
  }));
  const actions = useAnimatedStyle(() => ({ opacity: smooth(win(t.get(), 5400, 5800)) }));

  return (
    <Animated.View style={[inside ? styles.directionsInside : styles.directionsBelow, container]}>
      {/* No "WRITTEN BY KATHA AI" badge. The three cards are self-evidently
          Katha's suggestions -- that is what the screen is showing -- and
          labelling them was the product explaining itself instead of working.
          It also put a second, brighter thing on the header line than the
          question the reader is actually being asked. */}
      <View style={styles.directionsHeader}>
        <Text style={styles.directionsTitle} numberOfLines={1}>Where does it begin?</Text>
      </View>

      {DIRECTIONS.map((prompt, i) => (
        <DirectionRow key={i} t={t} index={i} prompt={prompt} />
      ))}

      <Animated.View style={[styles.directionActions, inside ? null : styles.directionActionsPlain, actions]}>
        <View style={inside ? styles.directionActionPill : null}>
          <Text style={inside ? styles.directionActionText : styles.directionActionLink}>✎ Edit</Text>
        </View>
        <View style={inside ? styles.directionActionPill : null}>
          <Text style={inside ? styles.directionActionText : styles.directionActionLink}>↻ Reprompt</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/** Row enter times from the spec: 4300/4550/4800, each over 400ms. */
const ROW_IN = [4300, 4550, 4800];

/**
 * The card the demo picks, and it is the second one.
 *
 * "Have Raya decide whether to tell Praz the childhood promise she never kept"
 * is the opening that goes through the friendship rather than through the
 * weather or the trail, and it is the one the story on slide 3 is named after.
 * Picking the first card instead would have the intro choose the most obvious
 * option on the screen and then show a story that came from a different one.
 */
const CHOSEN_DIRECTION = 1;

function DirectionRow({ t, index, prompt }) {
  const enter = useAnimatedStyle(() => {
    const a = ROW_IN[index];
    return riseStyle(smooth(win(t.get(), a, a + 400)), 14);
  });
  // One row is chosen at the very end of the slide; see CHOSEN_DIRECTION.
  const chosen = useAnimatedStyle(() => {
    const on = index === CHOSEN_DIRECTION ? smooth(win(t.get(), 5900, 6200)) : 0;
    return {
      backgroundColor: on > 0.5 ? C.chipPeach : C.card,
      borderColor: on > 0.5 ? C.orange : C.appBorder,
    };
  });
  const numberStyle = useAnimatedStyle(() => {
    const on = index === CHOSEN_DIRECTION ? smooth(win(t.get(), 5900, 6200)) : 0;
    return { backgroundColor: on > 0.5 ? C.orange : C.stone };
  });
  const numberText = useAnimatedStyle(() => {
    const on = index === CHOSEN_DIRECTION ? smooth(win(t.get(), 5900, 6200)) : 0;
    return { color: on > 0.5 ? '#FFFFFF' : C.inkSoft };
  });
  const tick = useAnimatedStyle(() => ({
    opacity: index === CHOSEN_DIRECTION ? smooth(win(t.get(), 5900, 6200)) : 0,
  }));

  return (
    <Animated.View style={[styles.directionRow, chosen, enter]}>
      <Animated.View style={[styles.directionNumber, numberStyle]}>
        <Animated.Text style={[styles.directionNumberText, numberText]}>{index + 1}</Animated.Text>
      </Animated.View>
      <Text style={styles.directionText} numberOfLines={3}>{prompt}</Text>
      <Animated.Text style={[styles.directionTick, tick]}>✓</Animated.Text>
    </Animated.View>
  );
}

// ── Screen 2 : READ & LISTEN ────────────────────────────────────────────────
/**
 * Home, then one story opening out of it.
 *
 * The cover is a SEPARATE layer above the Home content, not the tile inside
 * the story card: a shared-element morph needs one node that survives the
 * transition, and animating the tile would drag the card's layout with it.
 */
function ReadScreen({ t, reduceMotion }) {
  /*
    WHERE THE COVER STARTS IS MEASURED, NOT WRITTEN DOWN.

    The morph began at a hard-coded left 15.5 / top 39.5 / 70x81 taken from
    the handoff's mock. The well is 70x68 (SLOT_W/SLOT_H) and this Home has
    different section labels, so it sits lower — and the cover spent the first three seconds of the slide
    hanging off the top and bottom of the white card it was supposed to be
    inside. Anything derived twice drifts; the story card reports its own box
    and the well's offset inside it is a shared constant, so there is now one
    source for it.

    Seeded with the value for the reference frame so the first paint, before
    any layout has been reported, is already close rather than at 0,0.
  */
  const slotX = useSharedValue(14 + STORY_CARD_PAD);
  const slotY = useSharedValue(43 + STORY_CARD_PAD);
  const onStoryCardLayout = useCallback((event) => {
    const { x, y } = event.nativeEvent.layout;
    slotX.set(x + STORY_CARD_PAD);
    slotY.set(y + STORY_CARD_PAD);
  }, [slotX, slotY]);

  const card = useAnimatedStyle(() => ({ opacity: smooth(win(t.get(), 0, 450)) }));
  const home = useAnimatedStyle(() => ({ opacity: 1 - smooth(win(t.get(), 3350, 3750)) }));
  const storyCard = useAnimatedStyle(() => riseStyle(smooth(win(t.get(), 300, 700)), 10));
  const trending = useAnimatedStyle(() => {
    const r = smooth(win(t.get(), 600, 1000));
    return {
      opacity: r,
      // SETTLES TO FLUSH, never past it. Both shelves used to drift NEGATIVE,
      // which slides the first tile off the card's left edge and slices it in
      // half — motion that reads as a broken layout. A shelf already says
      // "there is more" by overflowing the RIGHT edge (four 74pt tiles and
      // three gaps is 320 against 306 of usable width), so the drift only has
      // to be movement, not displacement. Starting inset and settling flush
      // gives that and can never cut the leading tile.
      transform: [{ translateY: (1 - r) * 10 }, { translateX: 12 * (1 - smooth(win(t.get(), 1200, 3300))) }],
    };
  });
  const originals = useAnimatedStyle(() => {
    const r = smooth(win(t.get(), 900, 1300));
    return {
      opacity: r,
      // Same rule as Trending above, a little further out so the two shelves
      // do not move in lockstep.
      transform: [{ translateY: (1 - r) * 10 }, { translateX: 22 * (1 - smooth(win(t.get(), 1200, 3300))) }],
    };
  });
  const tapped = useAnimatedStyle(() => ({
    borderColor: smooth(win(t.get(), 3000, 3350)) > 0.5 ? C.orange : 'transparent',
  }));

  // The morph. One ease-out cubic drives every property so they cannot drift.
  const cover = useAnimatedStyle(() => {
    const r = EASE_OUT_CUBIC(win(t.get(), 3350, 4150));
    const x = slotX.get();
    const y = slotY.get();
    return {
      left: x * (1 - r),
      top: y * (1 - r),
      width: SLOT_W + (334 - SLOT_W) * r,
      height: SLOT_H + (230 - SLOT_H) * r,
      // The well is 12pt; the four corners round down to the page's square
      // top edge together, so the tile never looks half-rounded mid-morph.
      borderRadius: 12 * (1 - r),
    };
  });
  /*
    The cover's own box, sized by hand rather than by `resizeMode`.

    A square source covering a box is a square whose side is the LONGER of the
    box's two dimensions; where that square sits inside the box is the crop.
    Computing it here, from the same `r` as the morph above, is what makes the
    anchor controllable at all — `resizeMode="cover"` always centres, and
    centred is the framing that cut a character's head off.
  */
  const coverImg = useAnimatedStyle(() => {
    const r = EASE_OUT_CUBIC(win(t.get(), 3350, 4150));
    const w = SLOT_W + (334 - SLOT_W) * r;
    const h = SLOT_H + (230 - SLOT_H) * r;
    const side = Math.max(w, h);
    return {
      width: side,
      height: side,
      left: -(side - w) / 2,
      top: -(side - h) * COVER_FOCUS_Y,
    };
  });
  const coverPill = useAnimatedStyle(() => ({ opacity: 1 - smooth(win(t.get(), 3350, 3650)) }));
  const page = useAnimatedStyle(() => ({ opacity: smooth(win(t.get(), 3900, 4300)) }));
  const listen = useAnimatedStyle(() => ({ transform: [{ scale: pressScale(t.get(), 5550, 5750) }] }));

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.readCard, warmShadow(0.45), card]}>
        {/* ── Home ── */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.readBody, home]}>
          <Text style={styles.sectionLabel}>YOUR STORIES</Text>
          <Animated.View onLayout={onStoryCardLayout} style={[styles.homeStoryCard, tapped, storyCard]}>
            {/* The cover's slot. The drawn cover is the layer below, which is
                why this is an empty well and not an Image. */}
            <View style={styles.homeCoverSlot} />
            <View style={styles.homeStoryText}>
              <Text style={styles.homeStoryTitle} numberOfLines={1}>{STORY_TITLE}</Text>
              <Text style={styles.homeStoryBlurb} numberOfLines={2}>{STORY_BLURB}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Animated.View>

          <Text style={styles.sectionLabel}>TRENDING NOW</Text>
          <Animated.View style={[styles.tileRow, trending]}>
            {TRENDING.map((tile, i) => (
              <CoverTile key={i} tile={tile} t={t} liveHeart={i === 0} />
            ))}
          </Animated.View>

          <Text style={styles.sectionLabel}>KATHA ORIGINALS</Text>
          <Animated.View style={[styles.tileRow, originals]}>
            {ORIGINALS.map((tile, i) => <CoverTile key={i} tile={tile} t={t} />)}
          </Animated.View>
        </Animated.View>

        {/* ── The cover, morphing from the Home tile to the story page ── */}
        <Animated.View style={[styles.coverLayer, cover]}>
          <Animated.Image source={COVER_TREK} style={[styles.coverImage, coverImg]} resizeMode="cover" />
          <Animated.View style={[styles.genrePill, styles.coverGenrePill, coverPill]}>
            <Text style={styles.genrePillText}>Adventure</Text>
          </Animated.View>
          <Animated.View style={[styles.coverFade, page]}>
            <LinearGradient
              colors={['rgba(243,242,239,0)', C.appBg]}
              locations={[0.45, 0.95]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>

        {/* ── The story page ── */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.pageBody, page, { pointerEvents: 'none' }]}>
          <Text style={styles.pageTitle} numberOfLines={2}>{STORY_TITLE}</Text>
          <Text style={styles.pageMeta}>@praz · Sep 29, 2026 · 4/4 chapters</Text>
          <View style={styles.pageGenreChip}><Text style={styles.pageGenreText}>Adventure</Text></View>
          <Text style={styles.pageBlurb}>{STORY_BLURB}</Text>
        </Animated.View>

        <Animated.View style={[styles.pageActions, page]}>
          <View style={styles.pagePill}><Text style={styles.pagePillText}>📖 Read</Text></View>
          <Animated.View style={[styles.pagePill, listen]}>
            <ListenLabel t={t} reduceMotion={reduceMotion} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function CoverTile({ tile, t, liveHeart }) {
  return (
    <View style={styles.tile}>
      <Image source={tile.img} style={styles.tileImage} resizeMode="cover" />
      <View style={[styles.genrePill, styles.tileGenrePill]}>
        <Text style={styles.genrePillText} numberOfLines={1}>{tile.genre}</Text>
      </View>
      <View style={styles.likePill}>
        {liveHeart
          ? <LiveHeart t={t} />
          : <Text style={styles.likeText} numberOfLines={1}>♡ {tile.likes}</Text>}
      </View>
    </View>
  );
}

/** One heart flips from outline to filled, and the count ticks by one. */
function LiveHeart({ t }) {
  const [liked, setLiked] = useState(false);
  useAnimatedReaction(() => t.get() >= 2650 + LEAD_IN, (next, previous) => {
    if (next !== previous) scheduleOnRN(setLiked, next);
  });
  return (
    <Text style={[styles.likeText, liked && styles.likeTextOn]} numberOfLines={1}>
      {liked ? '♥ 429' : '♡ 428'}
    </Text>
  );
}

/**
 * "Listen", pressed, becomes "Listening" with three bars that keep moving.
 *
 * The bars are the one thing on the intro that animates after its slide's
 * clock has run out, so they get their own repeating value rather than a
 * window on `t`. Reduced motion leaves them at the still heights the end frame
 * is defined with.
 */
function ListenLabel({ t, reduceMotion }) {
  const [listening, setListening] = useState(reduceMotion);
  useAnimatedReaction(() => t.get() >= 5850 + LEAD_IN, (next, previous) => {
    if (next !== previous) scheduleOnRN(setListening, next);
  });

  const beat = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || !listening) return undefined;
    beat.set(withRepeat(withTiming(1, { duration: BAR_CYCLE_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(beat);
  }, [beat, listening, reduceMotion]);

  return (
    <View style={styles.listenRow}>
      <View style={styles.equaliser}>
        {[0, 1, 2].map((k) => <Bar key={k} k={k} beat={beat} live={listening && !reduceMotion} />)}
      </View>
      <Text style={styles.pagePillText}>{listening ? 'Listening' : 'Listen'}</Text>
    </View>
  );
}

/**
 * The three equaliser bars.
 *
 * ## Why this is a plain sine and a third of a cycle apart
 *
 * It was `5 + 9·|sin(t/140 + k·1.4)|`, straight from the handoff spec, and it
 * looked wrong for two separate reasons.
 *
 * `|sin|` has period π, so offsets of 0, 1.4 and 2.8 land at 0%, 45% and 89%
 * of a cycle — the first and third bars end up nearly in phase, rising and
 * falling together while the middle one does the opposite. That is the
 * "outside two together, middle against them" pulse the founder saw, and it
 * reads as a heartbeat, not as music.
 *
 * `|sin|` also turns around instantly at every zero crossing, because the
 * curve reflects instead of easing through the bottom. Even with good phases
 * it twitches at the floor of each bounce.
 *
 * A plain sine mapped into 0..1, with the bars exactly a third of a cycle
 * apart, gives the standard travelling wave: at any instant all three bars are
 * at different heights, each one peaks after the one to its left, and every
 * turn eases. `BAR_MAX` is taller in the middle because that is what a level
 * meter looks like — three bars of identical range read as a machine.
 */
const BAR_CYCLE_MS = 760;
/** The still heights, used before playback starts and under reduced motion. */
const BAR_REST = [5, 9, 6];
const BAR_MIN = 3;
const BAR_MAX = [8, 11, 9];

function Bar({ k, beat, live }) {
  const style = useAnimatedStyle(() => {
    if (!live) return { height: BAR_REST[k] };
    // k / 3 of a cycle apart: 0°, 120°, 240°.
    const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (beat.get() + k / 3));
    return { height: BAR_MIN + (BAR_MAX[k] - BAR_MIN) * wave };
  });
  return <Animated.View style={[styles.bar, style]} />;
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.sheet },
  flex: { flex: 1 },
  page: { alignItems: 'center' },
  heroBand: { position: 'absolute', top: 0, left: 0, right: 0, height: HERO_H },
  column: { flexGrow: 1 },
  hero: { height: HERO_H, flexShrink: 0, overflow: 'hidden' },
  wordmarkWrap: { position: 'absolute', top: 34, left: 0, right: 0, alignItems: 'center' },
  // The stage is the whole hero: each slide positions its own card inside it,
  // centred rather than hard-left so the layout survives the 430pt clamp.
  stage: { position: 'absolute', top: 0, left: 0, right: 0, height: HERO_H, alignItems: 'center' },

  // sheet
  sheet: { flexGrow: 1, minHeight: SHEET_MIN_H, backgroundColor: C.sheet, paddingHorizontal: 28, paddingTop: 22, paddingBottom: 24 },
  dots: { flexDirection: 'row', alignItems: 'center', height: 6, marginBottom: 16, marginLeft: -3 },
  // 44pt tall, 3pt either side of the dot: adjacent targets meet at the SPEC's
  // 6pt gap, and the negative margin keeps the visible row at 6pt.
  dotHit: { height: 44, marginVertical: -19, paddingHorizontal: 3, justifyContent: 'center' },
  // `minHeight`, not `height`: at the reference width all three headlines are
  // one line and this is exactly their height, so every slide's dots-to-
  // headline and headline-to-subcopy gaps are identical. On a column narrow
  // enough to wrap one, the slot grows and pushes the subcopy down rather than
  // letting the second line overlap it -- the CTA below is in a `flex: 1` slot
  // pinned to the bottom, so nothing else moves.
  headlineSlot: { minHeight: 32, justifyContent: 'flex-end' },
  headline: { fontFamily: F.briBold, fontWeight: '700', fontSize: 27, lineHeight: 31.3, letterSpacing: 0, color: C.ink },
  sub: { fontFamily: F.hanken, fontWeight: '500', fontSize: 15, lineHeight: 22.5, color: C.muted, height: 54, marginTop: 6 },
  actionSlot: { flex: 1, justifyContent: 'flex-end' },
  signInBelow: { fontSize: 14, color: C.muted },
  signInBelowLink: { color: C.orange, fontWeight: '700' },

  // ── screen 1: character ──
  characterCard: { position: 'absolute', top: 92, width: 306, height: 346, backgroundColor: C.card, borderRadius: 22, padding: 16, overflow: 'hidden' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot7: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange },
  eyebrow: { fontFamily: F.hankenXbold, fontWeight: '800', fontSize: 10, letterSpacing: 0.6, color: C.muted3 },
  eyebrowOrange: { color: C.orange },
  fieldLabel: { fontFamily: F.hankenXbold, fontWeight: '800', fontSize: 10, letterSpacing: 0.6, color: C.muted3, marginTop: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  counter: { fontFamily: F.hankenSemi, fontWeight: '600', fontSize: 10, color: C.muted2, marginTop: 12 },
  nameField: { height: 40, borderWidth: 1.5, borderColor: C.field, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 12, marginTop: 6 },
  nameValue: { fontFamily: F.hankenSemi, fontWeight: '600', fontSize: 15, color: C.ink },
  appearanceField: { height: 104, borderWidth: 2, borderColor: C.orange, borderRadius: 14, padding: 10, marginTop: 6 },
  appearanceText: { fontFamily: F.hankenIt, fontStyle: 'italic', fontSize: 13.5, lineHeight: 18.5, color: C.inkBody2 },
  characterCtaWrap: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  ctaPill: { height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange },
  ctaPillOrange: { backgroundColor: C.orange },
  ctaLabel: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 14, color: '#FFFFFF' },
  scanBand: { position: 'absolute', left: 0, right: 0, height: 90 },
  scanLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: C.orange, ...Platform.select({ web: { boxShadow: '0 0 18px 4px rgba(255,107,26,0.6)' }, default: { shadowColor: C.orange, shadowOpacity: 0.6, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } } }) },
  // Centred by the LAYOUT, not by `resizeMode`. Both of the obvious style
  // shapes -- insets with `width: undefined`, and insets on all four sides --
  // put Raya in the right-hand third of her own card on web, because
  // react-native-web sizes an inset Image from its intrinsic width. The layer
  // is a flex column that centres and bottom-aligns, and the image is given
  // the exact box the 450x630 source fits: 326 tall, 326 * 450/630 = 233 wide.
  portraitLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: C.portraitGround, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  portraitImage: { width: 233, height: 326 },
  portraitChipLeft: { position: 'absolute', top: 12, left: 12, backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  portraitChipLeftText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 12, color: C.ink },
  portraitChipRight: { position: 'absolute', top: 12, right: 12, backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  portraitChipRightText: { fontFamily: F.hankenXbold, fontWeight: '800', fontSize: 9, letterSpacing: 0.6, color: '#FFFFFF' },

  // ── screen 2: story ──
  briefCard: { position: 'absolute', top: 84, width: 334, backgroundColor: C.card, borderRadius: 22, overflow: 'hidden' },
  briefBody: { padding: 16 },
  kidsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kidsTrack: { width: 34, height: 20, borderRadius: 999, backgroundColor: C.stone, justifyContent: 'center', paddingHorizontal: 2 },
  kidsKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.card },
  kidsLabel: { fontFamily: F.hankenSemi, fontWeight: '600', fontSize: 12, color: C.muted },
  genreRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  genreChip: { height: 30, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  genreChipText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 12 },
  briefTitle: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 18, color: C.ink, marginTop: 2 },
  ideaField: { height: 78, borderWidth: 1.5, borderRadius: 14, padding: 10, marginTop: 8 },
  ideaText: { fontFamily: F.hanken, fontSize: 13, lineHeight: 18, color: C.inkSoft },
  castRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  castChip: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 999, paddingLeft: 6, paddingRight: 12 },
  castAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.stone, overflow: 'hidden' },
  // The head of a full-body cutout: scaled up and pinned to the top of the
  // circle, which is where a standing figure's face is.
  castAvatarImage: { width: 28, height: 84, marginTop: 1 },
  castChipText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 13, color: C.ink },
  castChipMark: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 13, color: C.orange },
  createCtaWrap: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  summaryRow: { position: 'absolute', left: 16, right: 16, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryAvatars: { flexDirection: 'row' },
  summaryAvatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: C.card, backgroundColor: C.stone },
  summaryAvatarOverlap: { marginLeft: -8 },
  summaryTitle: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 13, color: C.ink },
  summaryIdea: { fontFamily: F.hanken, fontSize: 13, lineHeight: 18, color: C.muted },

  directionsInside: { ...StyleSheet.absoluteFillObject, padding: 16 },
  directionsBelow: { position: 'absolute', top: 204, left: 28, right: 28 },
  directionsHeader: { marginBottom: 10 },
  directionsTitle: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 16, color: C.ink },
  directionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1.5, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 13, marginBottom: 8 },
  directionNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  directionNumberText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 11 },
  directionText: { flex: 1, fontFamily: F.hanken, fontSize: 12.5, lineHeight: 16, color: C.inkSoft },
  directionTick: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 13, color: C.orange },
  directionActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  directionActionsPlain: { justifyContent: 'center', gap: 20 },
  directionActionPill: { height: 36, flex: 1, borderRadius: 999, borderWidth: 1.5, borderColor: C.field, alignItems: 'center', justifyContent: 'center' },
  directionActionText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 12.5, color: C.inkSoft },
  directionActionLink: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 12.5, color: C.orangeDeep },

  // ── screen 3: read & listen ──
  readCard: { position: 'absolute', top: 78, width: 334, height: 392, backgroundColor: C.appBg, borderRadius: 22, overflow: 'hidden' },
  readBody: { padding: 14 },
  sectionLabel: { fontFamily: F.hankenXbold, fontWeight: '800', fontSize: 10, letterSpacing: 1, color: C.muted2, marginTop: 10, marginBottom: 6 },
  homeStoryCard: { height: 84, flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, borderWidth: 1.5, padding: STORY_CARD_PAD, gap: 10 },
  homeCoverSlot: { width: SLOT_W, height: SLOT_H, borderRadius: 12, backgroundColor: C.stone },
  homeStoryText: { flex: 1 },
  homeStoryTitle: { fontFamily: F.briBold, fontWeight: '700', fontSize: 15, color: C.ink },
  homeStoryBlurb: { fontFamily: F.hanken, fontSize: 11.5, lineHeight: 15, color: C.muted, marginTop: 2 },
  chevron: { fontSize: 20, color: C.muted3, marginRight: 4 },
  tileRow: { flexDirection: 'row', gap: TILE_GAP },
  tile: { width: TILE_W, flexShrink: 0 },
  tileImage: { width: TILE_W, height: TILE_H, borderRadius: 14 },
  genrePill: { position: 'absolute', backgroundColor: '#0F0E0C', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  tileGenrePill: { left: 5, bottom: 5 },
  coverGenrePill: { left: 10, bottom: 10 },
  genrePillText: { fontFamily: F.hankenXbold, fontWeight: '800', fontSize: 8.5, color: '#FFFFFF' },
  likePill: { position: 'absolute', right: 5, top: 5, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  likeText: { fontFamily: F.hankenXbold, fontWeight: '800', fontSize: 10, color: C.muted },
  likeTextOn: { color: C.heart },

  coverLayer: { position: 'absolute', overflow: 'hidden' },
  // Position only; every dimension comes from `coverImg` above. An inset box
  // with undefined width/height sizes the node from the source's intrinsic
  // pixels on web, which is why the Home tile and the opened page both used to
  // show nothing but empty night sky.
  coverImage: { position: 'absolute' },
  coverFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 230 },

  pageBody: { paddingHorizontal: 18, paddingTop: 186 },
  pageTitle: { fontFamily: F.briBold, fontWeight: '700', fontSize: 28, lineHeight: 32, color: C.ink },
  pageMeta: { fontFamily: F.hanken, fontSize: 11.5, color: C.muted, marginTop: 6 },
  pageGenreChip: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: C.field, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8 },
  pageGenreText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 11, color: C.inkSoft },
  pageBlurb: { fontFamily: F.hanken, fontSize: 13.5, lineHeight: 19, color: C.inkSoft, marginTop: 10 },
  // Content-width and left-aligned, not two half-width blocks. Stretched edge
  // to edge they were the heaviest thing on the slide, competing with the one
  // control the screen actually wants pressed.
  pageActions: { position: 'absolute', left: 18, right: 18, bottom: 18, flexDirection: 'row', gap: 8 },
  /*
    OUTLINED AND SMALL, for a composition reason rather than a taste one.

    "Get started" sits directly below this slide in the sheet and is the one
    real, filled, accent CTA on the screen. These began as two filled 50pt
    pills stretched edge to edge, which put three orange blocks down the same
    column with the only pressable one at the bottom. Outlining them fixed the
    colour competition; they were still the heaviest shapes on the slide, so
    they are now 36pt and content-width as well.

    The outline treatment is the app's own second tier
    (`components/reader/ChapterEnd.tsx#secondaryButton`). At 36pt they also sit
    under the button-recipe guard's 48pt floor, so the allow-list entry this
    screen used to need is gone -- see `__tests__/button-recipe.test.ts`.
  */
  pagePill: { height: 36, borderRadius: 999, borderWidth: 1.5, borderColor: C.orange, backgroundColor: 'rgba(255,255,255,0.72)', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  pagePillText: { fontFamily: F.hankenBold, fontWeight: '700', fontSize: 12.5, color: C.orangeDeep },
  listenRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  equaliser: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 11 },
  bar: { width: 2.5, borderRadius: 2, backgroundColor: C.orangeDeep },

  signInTop: { position: 'absolute', top: 40, right: 24, zIndex: 19 },
  // 13.5/700, as it was before this rewrite. The handoff spec asked for
  // 15/800; that is heavier than the same link anywhere else in onboarding and
  // it pulled the eye to the one control on the screen we do NOT want pressed.
  signInTopText: { fontSize: 13.5, fontWeight: '700', color: C.orange },
});
