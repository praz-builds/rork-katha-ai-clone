/*
 * KathaOnboarding.jsx  —  Expo / React Native
 * Katha — animated 3-screen onboarding intro (Create → Publish/Community → Read).
 *
 * Drop-in Expo component. Reference frame 390×844. Implements ONBOARDING SPEC §1–§10.
 * Pure Expo SDK — no Reanimated, no gesture-handler. Uses RN Animated + a rAF timeline
 * clock (matches the SwiftUI CADisplayLink / Compose withFrameMillis drivers exactly).
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
  View, Text, Pressable, StyleSheet, useWindowDimensions, Animated, Image, Platform, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BrandWordmark from '../components/BrandWordmark';

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
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const win = (p, a, b) => clamp01((p - a) / (b - a));
const smooth = (x) => { const c = clamp01(x); return c * c * (3 - 2 * c); };

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

const HERO_H = 522;
const STAGE_H = 360;
const COVER_W = 92, COVER_H = 108, COVER_GAP = 8;

// ── Root ────────────────────────────────────────────────────────────────────
export default function KathaOnboarding({ onFinish = () => {}, onSignIn = () => {} }) {
  const { width: W } = useWindowDimensions();
  const [phase, setPhase] = useState(0);
  const [p, setP] = useState(0);            // progress within phase (drives re-render)
  const slide = useRef(new Animated.Value(0)).current;

  // carousel slide (0.6s, cubic-bezier(.45,0,.2,1) ≈ Easing via bezier)
  useEffect(() => {
    Animated.timing(slide, {
      toValue: phase, duration: 600, useNativeDriver: Platform.OS !== 'web',
      easing: Easing.bezier(0.45, 0, 0.2, 1),
    }).start();
  }, [phase]);

  // rAF timeline clock — auto-advance 0→1→2, hold on 2
  useEffect(() => {
    if (phase >= 2) { setP(1); return; }
    let raf, start;
    const dur = DUR[phase];
    const tick = (now) => {
      if (start == null) start = now;
      const e = now - start;
      setP(clamp01(e / dur));
      if (e >= dur) { setPhase((n) => n + 1); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const goTo = useCallback((n) => setPhase(n), []);
  const restart = useCallback(() => { onFinish(); }, [onFinish]);

  return (
    <View style={styles.root}>
      {/* Hero (fixed 522), clipped carousel + floating wordmark */}
      <View style={styles.hero}>
        <LinearGradient
          colors={[C.heroA, C.heroB]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={{
          flexDirection: 'row', width: W * 3, height: HERO_H,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 2], outputRange: [0, -2 * W] }) }],
        }}>
          <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><CreateScreen p={phase === 0 ? p : phase > 0 ? 1 : 0} /></View>
          <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><PublishScreen p={phase === 1 ? p : phase > 1 ? 1 : 0} /></View>
          <View style={{ width: W, height: HERO_H, overflow: 'hidden' }}><ReadScreen /></View>
        </Animated.View>

        <View style={[styles.wordmarkWrap, { pointerEvents: 'none' }]}>
          <BrandWordmark size={28} />
        </View>
      </View>

      {/* Sign in link, top-right, persistent */}
      <Pressable onPress={onSignIn} style={styles.signInTop}>
        <Text style={styles.signInTopText}>Sign in</Text>
      </Pressable>

      <BottomSheet phase={phase} onDot={goTo} onFinish={restart} onSignIn={onSignIn} />
    </View>
  );
}

// ── Bottom sheet (SPEC §4) ──────────────────────────────────────────────────
function BottomSheet({ phase, onDot, onFinish, onSignIn }) {
  const [h, s] = HEADLINES[phase];
  return (
    <View style={styles.sheet}>
      <View style={styles.dots}>
        {[0, 1, 2].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Show ${['create', 'publish', 'read'][n]} intro`} onPress={() => onDot(n)}
            style={{ width: n === phase ? 22 : 6, height: 6, borderRadius: 3,
              backgroundColor: n === phase ? C.orange : C.dotIdle }} />
        ))}
      </View>
      <Text style={styles.headline}>{h}</Text>
      <Text style={styles.sub}>{s}</Text>
      <View style={styles.actionSlot}>
        {phase === 2 && (
          <>
            <Pressable onPress={onFinish} style={styles.cta}>
              <Text style={styles.ctaText}>Get started</Text>
            </Pressable>
            <Pressable onPress={onSignIn} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: '#6B625A' }}>Already have an account? <Text style={{ color: '#FF6B1A', fontWeight: '700' }}>Sign in</Text></Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ── Screen 0 : CREATE then EDIT (SPEC §5, §6) ───────────────────────────────
function CreateScreen({ p }) {
  const typed = smooth(win(p, 0.05, 0.22));
  const genShow = smooth(win(p, 0.24, 0.30));
  const genScale = (0.9 + 0.1 * genShow) * (1 - 0.12 * Math.sin(Math.PI * win(p, 0.31, 0.37)));
  const writing = smooth(win(p, 0.37, 0.43)) * (1 - smooth(win(p, 0.56, 0.62)));
  const hi = smooth(win(p, 0.60, 0.65)) * (1 - smooth(win(p, 0.90, 0.96)));
  const swap = smooth(win(p, 0.65, 0.69));
  const chip = smooth(win(p, 0.67, 0.72));
  const cardIn = smooth(win(p, 0, 0.04));
  const line = (k) => { const a = 0.44 + k * 0.06; return smooth(win(p, a, a + 0.10)); };

  const prompt = "Write a mystery-fantasy thriller about a teen who finds a hidden door in her family's old house.";
  const typedPrompt = prompt.slice(0, Math.floor(prompt.length * typed));
  const cursorVisible = typed < 1 && Math.floor(p * 80) % 2 === 0;

  return (
    <View style={styles.stage}>
      <View style={[styles.createCard, warmShadow(0.40), { opacity: cardIn }]}>
        <View style={styles.eyebrowRow}>
          <View style={styles.dot7} />
          <Text style={styles.eyebrow}>NEW STORY</Text>
        </View>

        {/* Character-by-character typing keeps line wrapping stable. */}
        <View style={{ marginTop: 10, minHeight: 54 }}>
          <Text style={styles.prompt} numberOfLines={3}>{typedPrompt}<Text style={{ color: C.orange, opacity: cursorVisible ? 1 : 0 }}>|</Text></Text>
        </View>

        <View style={{ transform: [{ scale: genScale }], opacity: genShow, marginTop: 10, alignSelf: 'flex-start' }}>
          <View style={[styles.pillOrange, warmShadow(0.6, C.orange)]}>
            <Text style={styles.pillOrangeText}>✦ Generate story</Text>
          </View>
        </View>

        <Text style={[styles.writing, { opacity: writing }]}>✦ Katha is writing…</Text>

        <View style={styles.storyBlock}>
          <Text style={[styles.storyLine, { opacity: line(0), transform: [{ translateY: (1 - line(0)) * 6 }] }]}>
            Tara pulled the old wallpaper back and found it:
          </Text>
          <Text style={[styles.storyLine, { opacity: line(1), transform: [{ translateY: (1 - line(1)) * 6 }] }]}>
            a door her family swore had never been there,
          </Text>
          <View style={[styles.storyLastLine, { opacity: smooth(win(p, 0.56, 0.66)) }]}>
            <Text style={styles.storyLine}>warm to the touch, humming with a </Text>
            <View style={[styles.wordSwap, { backgroundColor: `rgba(255,107,26,${0.20 * hi})` }]}>
              <Text style={[styles.swapText, { opacity: 1 - swap, transform: [{ translateY: -3 * swap }] }]}>dream.</Text>
              <Text style={[styles.swapText, styles.swapTextNew, { opacity: swap, transform: [{ translateY: 3 * (1 - swap) }] }]}>warning.</Text>
            </View>
          </View>
        </View>

        <View style={{ opacity: chip, transform: [{ translateY: (1 - chip) * 6 }], alignSelf: 'flex-start', marginTop: 7 }}>
          <View style={styles.pillPeach}><Text style={styles.pillPeachText}>✎ You rewrote this line</Text></View>
        </View>
      </View>
    </View>
  );
}

// ── Screen 1 : PUBLISH then COMMUNITY (SPEC §5, §7) ─────────────────────────
function PublishScreen({ p }) {
  const pubOut = smooth(win(p, 0.22, 0.30));
  const pubScale = (1 - 0.12 * Math.sin(Math.PI * win(p, 0.16, 0.22))) * (1 - 0.06 * pubOut);
  const stats = smooth(win(p, 0.26, 0.34));
  const readers = smooth(win(p, 0.30, 0.40));
  const hearts = 128 + Math.round(smooth(win(p, 0.30, 0.58)) * 118);
  const note = smooth(win(p, 0.72, 0.82));
  const chipR = (a) => smooth(win(p, a, a + 0.09));
  const av = (i) => { const a = [0.34, 0.44, 0.54][i]; return smooth(win(p, a, a + 0.10)); };

  return (
    <View style={styles.stage}>
      {/* reaction chips (absolute — SPEC §7) */}
      <ReactionChip text="the door gave me chills" style={{ top: 54, left: 38 }} r={chipR(0.40)} />
      <ReactionChip text="♥ liked" peach style={{ top: 132, right: 22 }} r={chipR(0.52)} />
      <ReactionChip text="read it twice ✦" style={{ top: 258, left: 34 }} r={chipR(0.62)} />

      <View style={styles.stageCenter}>
        <View style={[styles.publishCard, warmShadow(0.45)]}>
          <View style={{ flexDirection: 'row' }}>
            <BookSpine />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.bookTitle}>The Forgotten Door</Text>
              <Text style={styles.bookSub}>{p >= 0.26 ? 'by you · published' : 'Draft · ready to share'}</Text>
              <View style={{ height: 32, marginTop: 12 }}>
                <View style={{ position: 'absolute', transform: [{ scale: pubScale }], opacity: 1 - pubOut }}>
                  <View style={[styles.pillOrangeSm, warmShadow(0.6, C.orange)]}>
                    <Text style={styles.pillOrangeText}>Publish story</Text>
                  </View>
                </View>
                <View style={{ position: 'absolute', top: 6, flexDirection: 'row', opacity: stats }}>
                  <Text style={[styles.stat, { color: C.orangeDeep }]}>♥ {hearts}</Text>
                  <Text style={[styles.stat, { color: C.muted, marginLeft: 16 }]}>💬 24</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.hairline} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
            <View style={{ flexDirection: 'row' }}>
              {AVATARS.map((src, i) => (
                <Image key={i} source={src}
                  style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff',
                    marginLeft: i === 0 ? 0 : -8, opacity: av(i), transform: [{ scale: 0.5 + 0.5 * av(i) }] }} />
              ))}
            </View>
            <Text style={[styles.readers, { opacity: readers }]}>new readers today</Text>
          </View>
        </View>
      </View>

      {/* continuation notification, bottom 40 */}
      <View style={{ position: 'absolute', bottom: 18, left: 0, right: 0, alignItems: 'center',
        opacity: note, transform: [{ translateY: (1 - note) * 22 }] }}>
        <NotificationCard />
      </View>
    </View>
  );
}

function ReactionChip({ text, peach, style, r }) {
  return (
    <View style={[{ position: 'absolute', zIndex: 4, opacity: r, transform: [{ translateY: (1 - r) * 8 }, { scale: 0.92 + 0.08 * r }] },
      peach ? [styles.chipOrange, warmShadow(0.5, C.orange)] : [styles.chipWhite, warmShadow(0.35)], style]}>
      <Text style={peach ? styles.chipOrangeText : styles.chipWhiteText}>{text}</Text>
    </View>
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
function ReadScreen() {
  const rows = [
    { reverse: false, dur: 32000, start: 0 },
    { reverse: true,  dur: 26000, start: 6 },
    { reverse: false, dur: 36000, start: 11 },
  ];
  return (
    <View style={[styles.stage, styles.stageCenter, { flexDirection: 'column' }]}>
      {rows.map((r, i) => (
        <View key={i} style={{ marginTop: i === 0 ? 0 : COVER_GAP }}>
          <MarqueeRow {...r} />
        </View>
      ))}
    </View>
  );
}

function MarqueeRow({ reverse, dur, start }) {
  const strip = Array.from({ length: 10 }, (_, i) => COVERS[(start + i) % COVERS.length]);
  const unitWidth = strip.length * (COVER_W + COVER_GAP);
  const x = useRef(new Animated.Value(reverse ? 1 : 0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(x, { toValue: reverse ? 0 : 1, duration: dur, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [0, -unitWidth] });

  return (
    <MaskedFade width={unitWidth * 2}>
      <Animated.View style={{ flexDirection: 'row', transform: [{ translateX }] }}>
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
      <View style={{ position: 'absolute', left: 9, right: 9, bottom: 9, top: 28, justifyContent: 'flex-end' }}>
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
  root: { flex: 1, backgroundColor: C.phoneBg },
  hero: { height: HERO_H, overflow: 'hidden' },
  wordmarkWrap: { position: 'absolute', top: 54, left: 0, right: 0, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { position: 'absolute', top: 104, left: 0, right: 0, height: STAGE_H, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  stageCenter: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

  // sheet
  sheet: { height: 322, backgroundColor: C.sheet, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 20 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  headline: { fontFamily: F.briBold, fontWeight: '700', fontSize: 27, lineHeight: 31.3, letterSpacing: 0, color: C.ink, height: 64 },
  sub: { fontFamily: F.hanken, fontWeight: '500', fontSize: 15, lineHeight: 22.5, color: C.muted, height: 54, marginTop: 8 },
  actionSlot: { height: 100, justifyContent: 'flex-end' },
  cta: { height: 56, borderRadius: 16, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ ios: { shadowColor: C.orange, shadowOpacity: 0.5, shadowRadius: 15, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 8 } }) },
  ctaText: { fontFamily: F.hankenBold, fontSize: 17, color: '#fff' },

  // create card
  createCard: { width: 306, height: 346, backgroundColor: C.card, borderRadius: 22, padding: 16, paddingBottom: 14 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot7: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange },
  eyebrow: { fontFamily: F.hankenXbold, fontSize: 10, letterSpacing: 1.6, color: C.muted3 },
  prompt: { fontFamily: F.hankenIt, fontStyle: 'italic', fontSize: 13.5, lineHeight: 18.5, color: C.inkBody2 },
  pillOrange: { backgroundColor: C.orange, borderRadius: 22, paddingHorizontal: 15, paddingVertical: 9 },
  pillOrangeSm: { backgroundColor: C.orange, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 8 },
  pillOrangeText: { fontFamily: F.hankenBold, fontSize: 12, color: '#fff' },
  writing: { height: 14, fontFamily: F.hankenSemi, fontSize: 10.5, color: C.orangeDeep, marginTop: 7 },
  storyBlock: { marginTop: 6, paddingTop: 7, borderTopWidth: 1, borderTopColor: C.hairline },
  storyLine: { fontFamily: F.hanken, fontSize: 13.2, lineHeight: 19, color: C.inkSoft, marginBottom: 1, flexShrink: 1 },
  storyLastLine: { minHeight: 38, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  wordSwap: { position: 'relative', width: 54, height: 20, borderRadius: 6 },
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

  coverTitle: { fontFamily: F.briXbold, fontSize: 9.5, lineHeight: 10, color: '#fff' },
  coverAuthor: { fontFamily: F.hankenXbold, fontSize: 6.2, letterSpacing: 0.37, color: 'rgba(255,255,255,0.82)', marginTop: 3 },

  fadeL: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '12%' },
  fadeR: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '12%' },
  signInTop: { position: 'absolute', top: 57, right: 24, zIndex: 19 },
  signInTopText: { fontSize: 13.5, fontWeight: '700', color: '#FF6B1A' },
});
