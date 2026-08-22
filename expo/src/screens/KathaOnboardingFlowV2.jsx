/*
 * Approved Expo onboarding and paywall flow.
 * See DESIGN.md for interaction, visual, and integration contracts.
 *
 * Usage (after useFonts):
 *   <KathaOnboardingFlowV2 onDone={() => nav.replace('Home')} />
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, StatusBar,
  useWindowDimensions, Animated, Easing, Image, SafeAreaView, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BrandWordmark from '../components/BrandWordmark';

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#FBF6EC', ink: '#1E1A16', inkSoft: '#2A231C', inkBody2: '#3A2E20',
  orange: '#FF6B1A', orangeHi: '#FF8A3D', orangeDeep: '#B15A18',
  muted: '#6B625A', muted2: '#8A7F73', muted3: '#B49A82',
  peach: '#FFF1E5', peachSoft: '#FFF6EF', line: '#E7DCC9', track: '#EAE0D0',
  disabledBg: '#EDE3D4', disabledFg: '#B7AB99', card: '#FFFFFF',
  iconBg: '#FFEDDD', reviewBorder: '#F3EADB',
};
const FF = {
  bri6: 'BricolageGrotesque',
  bri7: 'BricolageGrotesque',
  bri8: 'BricolageGrotesque',
  h4: 'HankenGrotesk',
  h5: 'HankenGrotesk',
  h6: 'HankenGrotesk',
  h7: 'HankenGrotesk',
  h8: 'HankenGrotesk',
  baloo: 'Baloo2',
};

// ── Static data ─────────────────────────────────────────────────────────────
const GENRES = ['Thriller','Fantasy','Bedtime Stories','Mystery','Adventure','Sci-Fi','Horror','Young Adult','Romance','Dark Romance','Historical','Literary','Fanfiction','Poetry','Mythology','Coming of Age','Contemporary','Comedy','Drama','Non-fiction','Other'];
const PURPOSES = [
  { k: 'read',  icon: '📖', label: 'Reading',       sub: 'Get lost in stories from around the world' },
  { k: 'write', icon: '✍️', label: 'Writing',       sub: 'Create stories of my own with Katha' },
  { k: 'both',  icon: '✨', label: 'A bit of both', sub: 'I love to read and to write' },
];
const REFINE_READ = [
  { k: 'read',   icon: '📖', label: 'Reading them myself', sub: 'Words on the page, at my own pace' },
  { k: 'listen', icon: '🎧', label: 'Listening to audio',  sub: 'Narrated stories for commutes and nights' },
  { k: 'mix',    icon: '🔀', label: 'A mix of both',       sub: 'Read sometimes, listen sometimes' },
];
const REFINE_WRITE = [
  { k: 'novel',  icon: '📕', label: 'A full novel',     sub: 'A story big enough to get lost in' },
  { k: 'short',  icon: '✒️', label: 'Short stories',    sub: 'Quick, complete, satisfying' },
  { k: 'fan',    icon: '💫', label: 'Fan fiction',      sub: 'Worlds and characters I already love' },
  { k: 'poetry', icon: '🕯️', label: 'Poetry and verse', sub: 'A whole feeling in a few lines' },
];
const REFINE_BOTH = [
  { k: 'find', icon: '📚', label: 'Find my next read', sub: 'Start with a shelf built around my taste' },
  { k: 'create', icon: '✍️', label: 'Start a story', sub: 'Open a blank page with Katha beside me' },
  { k: 'balance', icon: '⚖️', label: 'Balance both', sub: 'Keep reading and writing close together' },
  { k: 'surprise', icon: '✨', label: 'Surprise me', sub: 'Show me the best place to begin' },
];
const MOMENTS_READ = [
  { k: 'sleep', icon: '🌙', label: 'Before sleep', sub: 'A calm chapter to end the day' },
  { k: 'breaks', icon: '☕', label: 'Commutes and breaks', sub: 'Stories that fit into small pockets of time' },
  { k: 'weekend', icon: '📚', label: 'Weekend binges', sub: 'Long sessions when I can settle in' },
  { k: 'escape', icon: '✨', label: 'Whenever I need an escape', sub: 'A new world on demand' },
];
const MOMENTS_WRITE = [
  { k: 'draft', icon: '💡', label: 'Turn an idea into a draft', sub: 'Help me get from blank page to first version' },
  { k: 'voice', icon: '✎', label: 'Rewrite in my voice', sub: 'Make every line sound unmistakably mine' },
  { k: 'chapters', icon: '🗂️', label: 'Plan chapters', sub: 'Shape the arc before I lose momentum' },
  { k: 'publish', icon: '🚀', label: 'Publish and find readers', sub: 'Share the work and grow an audience' },
];
const MOMENTS_BOTH = [
  { k: 'remix', icon: '🔁', label: 'Read, then remix', sub: 'Let great stories spark my own ideas' },
  { k: 'publish', icon: '🚀', label: 'Write, then publish', sub: 'Create something and put it in front of readers' },
  { k: 'unwind', icon: '🎧', label: 'Listen, then unwind', sub: 'Keep stories close without looking at a screen' },
  { k: 'save', icon: '🔖', label: 'Explore, then save', sub: 'Collect ideas, worlds, and favorites' },
];
const REVIEWS = [
  { text: '"I fall asleep to a new story every night now."', name: 'Mira R.', img: require('../../assets/avatars/reader-black-woman.jpg') },
  { text: '"The audio narration is unreal on my commute."', name: 'Dev S.', initials: 'DS', color: '#3B4A8C' },
  { text: '"I published my first short story and readers actually replied."', name: 'Aanya K.', img: require('../../assets/avatars/reader-white-woman.jpg') },
  { text: '"Every morning there is a fresh chapter waiting for me."', name: 'Leah T.', initials: 'LT', color: '#8A3B2E' },
  { text: '"It writes with me, not for me. That is the magic."', name: 'Noah B.', img: require('../../assets/avatars/reader-brown-man.jpg') },
  { text: '"My kids beg for one more Katha bedtime story."', name: 'Priya M.', initials: 'PM', color: '#5B7A54' },
  { text: '"Cancelled every other app. This is the only one I open."', name: 'Sam W.', initials: 'SW', color: '#B15A18' },
  { text: '"Went from never reading to a book a week."', name: 'Tara I.', initials: 'TI', color: '#2E5D57' },
];
const AVATARS = [
  require('../../assets/avatars/reader-black-woman.jpg'),
  require('../../assets/avatars/reader-brown-man.jpg'),
  require('../../assets/avatars/reader-white-woman.jpg'),
];

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const emailRe = /\S+@\S+\.\S+/;

// ── Root ────────────────────────────────────────────────────────────────────
export default function KathaOnboardingFlowV2({ onDone = () => {}, initialScreen = 'purpose' }) {
  const [screen, setScreen] = useState(initialScreen);
  const [name, setName] = useState('');
  const [genres, setGenres] = useState({});
  const [otherText, setOtherText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(false);
  const [code, setCode] = useState('');
  const [notificationsAllowed, setNotificationsAllowed] = useState(false);
  const [refine, setRefine] = useState('');
  const [moment, setMoment] = useState('');
  const [plan, setPlan] = useState('yearly');
  const [trial, setTrial] = useState(true);

  const fname = name.trim() || 'there';
  const topGenre = Object.keys(genres).filter((k) => genres[k] && k !== 'Other')[0] || 'stories you love';
  const genreCount = Object.values(genres).filter(Boolean).length;
  const qStep = { purpose: 1, name: 2, genres: 3, refine: 4, moment: 5 }[screen];

  const toggleGenre = (g) => setGenres((prev) => { const n = { ...prev }; n[g] ? delete n[g] : (n[g] = true); return n; });

  const next = () => {
    const map = { purpose: 'name', name: 'genres', genres: 'refine', refine: 'moment', moment: 'building' };
    if (map[screen]) setScreen(map[screen]);
  };
  const back = () => {
    if (screen === 'email' && otp) { setOtp(false); return; }
    const map = { name: 'purpose', genres: 'name', refine: 'genres', moment: 'refine', notify: 'moment', email: 'paywall' };
    if (map[screen]) setScreen(map[screen]);
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      {qStep != null && <TopBar step={qStep} onBack={back} canBack={screen !== 'purpose'} />}

      {screen === 'purpose' && <PurposeScreen fname={fname} purpose={purpose} setPurpose={setPurpose} onNext={next} />}
      {screen === 'name' && <NameScreen name={name} setName={setName} fname={fname} onNext={next} />}
      {screen === 'genres' && <GenreScreen fname={fname} genres={genres} toggle={toggleGenre} count={genreCount} otherText={otherText} setOtherText={setOtherText} onNext={next} />}
      {screen === 'refine' && <RefineScreen fname={fname} purpose={purpose} refine={refine} setRefine={setRefine} onNext={next} />}
      {screen === 'moment' && <MomentScreen fname={fname} purpose={purpose} moment={moment} setMoment={setMoment} onNext={next} />}
      {screen === 'email' && !otp && <EmailScreen fname={fname} email={email} setEmail={setEmail} onContinue={() => { if (emailRe.test(email.trim())) { setOtp(true); setCode(''); } }} />}
      {screen === 'email' && otp && <OtpScreen email={email} code={code} setCode={setCode} onVerify={() => setScreen('success')} onResend={() => setCode('')} onEditEmail={() => setOtp(false)} />}
      {screen === 'notify' && <NotifyScreen onAllow={() => { setNotificationsAllowed(false); setScreen('paywall'); }} onLater={() => { setNotificationsAllowed(false); setScreen('paywall'); }} />}
      {screen === 'building' && <BuildingScreen fname={fname} purpose={purpose} topGenre={topGenre} onDone={() => setScreen('notify')} />}
      {screen === 'paywall' && <Paywall fname={fname} purpose={purpose} topGenre={topGenre} refine={refine} moment={moment} plan={plan} setPlan={setPlan} trial={trial} setTrial={setTrial} onSubscribe={() => { setOtp(false); setScreen('email'); }} onClose={() => setScreen('oto')} />}
      {screen === 'oto' && <OneTimeOffer onClaim={() => { setOtp(false); setScreen('email'); }} onClose={() => { setOtp(false); setScreen('email'); }} />}
      {screen === 'success' && <SuccessScreen fname={fname} purpose={purpose} onStart={() => onDone({ name: name.trim(), genres: Object.keys(genres).filter((key) => genres[key]), otherGenre: otherText.trim(), purpose, email: email.trim(), notificationsAllowed, refine, moment, plan, trial })} />}
    </SafeAreaView>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────
function TopBar({ step, onBack, canBack }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} style={[styles.backBtn, { opacity: canBack ? 1 : 0.35 }]}>
        <Text style={styles.backChevron}>‹</Text>
      </Pressable>
      <View style={styles.progressTrack}>
        <LinearGradient colors={[C.orangeHi, C.orange]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[styles.progressFill, { width: `${(step / 5) * 100}%` }]} />
      </View>
      <Text style={styles.stepLabel}>{step}/5</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, enabled = true }) {
  if (!enabled) return <View style={[styles.cta, { backgroundColor: C.disabledBg }]}><Text style={[styles.ctaText, { color: C.disabledFg }]}>{label}</Text></View>;
  return <Pressable onPress={onPress} style={styles.cta}><Text style={styles.ctaText}>{label}</Text></Pressable>;
}

function OptionRow({ icon, label, sub, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.optRow, { borderColor: selected ? C.orange : C.line, backgroundColor: selected ? C.peach : C.card }]}>
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <View style={{ flex: 1 }}><Text style={styles.optLabel}>{label}</Text><Text style={styles.optSub}>{sub}</Text></View>
      <View style={[styles.radio, { borderColor: selected ? C.orange : '#DCD0BF', backgroundColor: selected ? C.orange : 'transparent' }]}>
        {selected && <Text style={styles.radioMark}>✓</Text>}
      </View>
    </Pressable>
  );
}

// ── NAME ────────────────────────────────────────────────────────────────────
function NameScreen({ name, setName, fname, onNext }) {
  const ready = name.trim().length > 0;
  return (
    <KeyboardAvoidingView style={styles.pad} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }}>
        <View style={{ marginBottom: 32, marginTop: 6 }}><BrandWordmark size={28} /></View>
        <Text style={styles.h1}>First, what should we call you?</Text>
        <Text style={styles.sub}>Katha writes with you, so every story feels personal. Let's start with your name.</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Your first name" placeholderTextColor={C.muted3}
          autoCapitalize="words" autoCorrect={false} style={styles.nameInput} returnKeyType="done"
          onSubmitEditing={() => ready && onNext()} />
      </View>
      <PrimaryButton label="Continue" enabled={ready} onPress={onNext} />
    </KeyboardAvoidingView>
  );
}

// ── GENRES ──────────────────────────────────────────────────────────────────
function GenreScreen({ fname, genres, toggle, count, otherText, setOtherText, onNext }) {
  const ready = count >= 2;
  const cta = count >= 2 ? `Continue with ${count}` : count === 1 ? 'Pick 1 more' : 'Pick at least 2';
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.headPad}>
        <Text style={styles.h1sm}>Nice to meet you, {fname}. What worlds pull you in?</Text>
        <Text style={styles.subSm}>Pick at least 2 and we'll build your shelf around them.</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 16 }}>
        <View style={styles.chipWrap}>
          {GENRES.map((g) => {
            const on = !!genres[g];
            return (
              <Pressable key={g} onPress={() => toggle(g)}
                style={[styles.chip, { borderColor: on ? C.orange : C.line, backgroundColor: on ? C.peach : C.card }]}>
                <Text style={{ fontSize: 12, opacity: on ? 1 : 0.28, color: on ? C.orange : C.inkBody2 }}>✓</Text>
                <Text style={{ fontFamily: FF.h6, fontSize: 14.5, color: on ? C.orangeDeep : C.inkBody2 }}>{g}</Text>
              </Pressable>
            );
          })}
        </View>
        {genres['Other'] && (
          <TextInput value={otherText} onChangeText={setOtherText} placeholder="Tell us your genre"
            placeholderTextColor={C.muted3} style={styles.otherInput} />
        )}
      </ScrollView>
      <View style={styles.footPad}><PrimaryButton label={cta} enabled={ready} onPress={onNext} /></View>
    </View>
  );
}

// ── PURPOSE ─────────────────────────────────────────────────────────────────
function PurposeScreen({ purpose, setPurpose, onNext }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.headPad}>
        <View style={{ marginBottom: 26 }}><BrandWordmark size={28} /></View>
        <Text style={styles.h1sm}>What brings you to Katha?</Text>
        <Text style={styles.subSm}>We will shape your first experience around what matters most.</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 12, gap: 12 }}>
        {PURPOSES.map((o) => <OptionRow key={o.k} icon={o.icon} label={o.label} sub={o.sub} selected={purpose === o.k} onPress={() => setPurpose(o.k)} />)}
      </ScrollView>
      <View style={styles.footPad}><PrimaryButton label="Continue" enabled={!!purpose} onPress={onNext} /></View>
    </View>
  );
}

// ── EMAIL ───────────────────────────────────────────────────────────────────
function EmailScreen({ fname, email, setEmail, onContinue }) {
  const valid = emailRe.test(email.trim());
  return (
    <KeyboardAvoidingView style={styles.pad} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }}>
        <View style={styles.iconBadge}><Text style={{ fontSize: 24 }}>✉️</Text></View>
        <Text style={styles.h1med}>Save your profile, {fname}</Text>
        <Text style={[styles.sub, { marginBottom: 26 }]}>Add your email so your shelf, stories, and purchases stay with you on every device.</Text>
        <TextInput value={email} onChangeText={setEmail} placeholder="you@email.com" placeholderTextColor={C.muted3}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.emailInput}
          returnKeyType="done" onSubmitEditing={() => valid && onContinue()} />
        <Text style={styles.emailHint}>We send a quick code to confirm it. No spam, ever.</Text>
      </View>
      <PrimaryButton label="Send my code" enabled={valid} onPress={onContinue} />
    </KeyboardAvoidingView>
  );
}

// ── OTP ─────────────────────────────────────────────────────────────────────
function OtpScreen({ email, code, setCode, onVerify, onResend, onEditEmail }) {
  const inputRef = useRef(null);
  const ready = code.length === 6;
  const codeAdvRef = useRef(null);

  const handleCode = useCallback((text) => {
    const v = text.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    if (v.length === 6) { clearTimeout(codeAdvRef.current); codeAdvRef.current = setTimeout(onVerify, 280); }
  }, [setCode, onVerify]);

  useEffect(() => () => clearTimeout(codeAdvRef.current), []);

  return (
    <KeyboardAvoidingView style={styles.pad} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }}>
        <View style={styles.iconBadge}><Text style={{ fontSize: 24 }}>🔑</Text></View>
        <Text style={styles.h1med}>Check your inbox</Text>
        <Text style={[styles.sub, { marginBottom: 26 }]}>Enter the 6 digit code we sent to <Text style={{ fontFamily: FF.h7, color: C.inkBody2 }}>{email.trim() || 'your email'}</Text>.</Text>
        <Pressable onPress={() => inputRef.current?.focus()} style={styles.otpRow}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const ch = code[i] || '';
            const active = i === code.length;
            return (
              <View key={i} style={[styles.otpBox, { borderColor: active ? C.orange : ch ? '#FFD3AE' : C.line }]}>
                <Text style={styles.otpDigit}>{ch}</Text>
              </View>
            );
          })}
          <TextInput ref={inputRef} value={code} onChangeText={handleCode} keyboardType="number-pad"
            maxLength={6} style={styles.otpHidden} caretHidden autoFocus />
        </Pressable>
        <Text style={styles.otpMeta}>Didn't get it?{' '}
          <Text onPress={onResend} style={{ color: C.orange, fontFamily: FF.h7 }}>Resend code</Text>
          {'  ·  '}<Text onPress={onEditEmail} style={{ color: C.muted, fontFamily: FF.h6, textDecorationLine: 'underline' }}>Wrong email?</Text>
        </Text>
      </View>
      <PrimaryButton label="Verify and continue" enabled={ready} onPress={onVerify} />
    </KeyboardAvoidingView>
  );
}

// ── NOTIFICATION EDUCATION ──────────────────────────────────────────────────
function NotifyScreen({ onAllow, onLater }) {
  const reviewRailRef = useRef(null);
  const reviewOffset = useRef(0);
  const reviewPaused = useRef(false);

  useEffect(() => {
    const cycleWidth = REVIEWS.length * 298;
    const interval = setInterval(() => {
      if (reviewPaused.current) return;
      reviewOffset.current += 1;
      if (reviewOffset.current >= cycleWidth) reviewOffset.current = 0;
      reviewRailRef.current?.scrollTo({ x: reviewOffset.current, animated: false });
    }, 40);
    return () => clearInterval(interval);
  }, []);

  return (
    <Pressable accessible={false} onPress={onLater} style={styles.notifyWrap}>
      <BrandWordmark size={26} style={{ alignSelf: 'center', marginBottom: 30 }} />
      <View style={styles.permissionAlert}>
        <View style={styles.permissionIcon}><Text style={{ fontSize: 28 }}>🔔</Text></View>
        <Text style={styles.permissionTitle}>Stay close to every story</Text>
        <Text style={styles.permissionBody}>Katha can notify you when a fresh chapter lands or someone responds to your writing. You can change this anytime.</Text>
        <View style={styles.permissionDivider} />
        <View style={styles.permissionActions}>
          <Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onLater(); }} style={styles.permissionAction}>
            <Text style={styles.permissionActionText}>Not now</Text>
          </Pressable>
          <View style={styles.permissionActionDivider} />
          <Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onAllow(); }} style={styles.permissionAction}>
            <Text style={[styles.permissionActionText, { fontFamily: FF.h8 }]}>Allow</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.reviewRailLabel}>Loved by readers and writers</Text>
      <ScrollView ref={reviewRailRef} horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast"
        onScrollBeginDrag={() => { reviewPaused.current = true; }}
        onScrollEndDrag={() => { reviewPaused.current = false; }}
        onMomentumScrollEnd={() => { reviewPaused.current = false; }}
        contentContainerStyle={styles.reviewRail}>
        {[...REVIEWS, ...REVIEWS].map((r, i) => <ReviewCard key={`${r.name}-${i}`} r={r} />)}
      </ScrollView>
    </Pressable>
  );
}

function ReviewCard({ r }) {
  return (
    <View style={styles.reviewCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        {r.img ? (
          <Image source={r.img} style={styles.reviewAvImg} />
        ) : (
          <View style={[styles.reviewAvInit, { backgroundColor: r.color || '#8A7F73' }]}>
            <Text style={styles.reviewInitText}>{r.initials}</Text>
          </View>
        )}
        <View>
          <Text style={styles.reviewName}>{r.name}</Text>
          <Text style={styles.reviewStars}>★★★★★</Text>
        </View>
      </View>
      <Text style={styles.reviewText}>{r.text}</Text>
    </View>
  );
}

// ── REFINE (adaptive) ───────────────────────────────────────────────────────
function RefineScreen({ fname, purpose, refine, setRefine, onNext }) {
  const opts = purpose === 'read' ? REFINE_READ : purpose === 'write' ? REFINE_WRITE : REFINE_BOTH;
  const title = purpose === 'read' ? `How do you want to enjoy stories, ${fname}?` : purpose === 'write' ? `What do you want to make first, ${fname}?` : `Where should Katha start today, ${fname}?`;
  const sub = purpose === 'read' ? 'We will tune reading and narration around you.' : purpose === 'write' ? 'We will prepare the right creative tools.' : 'Your shelf and writing room can work together.';
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.headPad}>
        <Text style={styles.h1sm}>{title}</Text>
        <Text style={styles.subSm}>{sub}</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 12, gap: 12 }}>
        {opts.map((o) => <OptionRow key={o.k} icon={o.icon} label={o.label} sub={o.sub} selected={refine === o.k} onPress={() => setRefine(o.k)} />)}
      </ScrollView>
      <View style={styles.footPad}><PrimaryButton label="Continue" enabled={!!refine} onPress={onNext} /></View>
    </View>
  );
}

function MomentScreen({ fname, purpose, moment, setMoment, onNext }) {
  const opts = purpose === 'read' ? MOMENTS_READ : purpose === 'write' ? MOMENTS_WRITE : MOMENTS_BOTH;
  const title = purpose === 'read' ? `When will Katha fit your day, ${fname}?` : purpose === 'write' ? `Where should Katha help most, ${fname}?` : `Which loop sounds most like you, ${fname}?`;
  const sub = purpose === 'read' ? 'We will pace recommendations around your real routine.' : purpose === 'write' ? 'Your answer decides what we put within reach first.' : 'We will connect discovery and creation around this rhythm.';
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.headPad}><Text style={styles.h1sm}>{title}</Text><Text style={styles.subSm}>{sub}</Text></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 12, gap: 12 }}>
        {opts.map((o) => <OptionRow key={o.k} icon={o.icon} label={o.label} sub={o.sub} selected={moment === o.k} onPress={() => setMoment(o.k)} />)}
      </ScrollView>
      <View style={styles.footPad}><PrimaryButton label="Build my profile" enabled={!!moment} onPress={onNext} /></View>
    </View>
  );
}

// ── BUILDING ────────────────────────────────────────────────────────────────
function BuildingScreen({ fname, purpose, topGenre, onDone }) {
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' })).start();
    const t0 = Date.now(), DUR = 2600;
    const iv = setInterval(() => { const p = Math.min(100, Math.round(((Date.now() - t0) / DUR) * 100)); setPct(p); if (p >= 100) clearInterval(iv); }, 40);
    const t1 = setTimeout(() => setStep(1), 700);
    const t2 = setTimeout(() => setStep(2), 1500);
    const t3 = setTimeout(() => setStep(3), 2300);
    const tf = setTimeout(onDone, 2750);
    return () => { clearInterval(iv); [t1, t2, t3, tf].forEach(clearTimeout); };
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const steps = purpose === 'read'
    ? [`Matching your ${topGenre.toLowerCase()} picks`, 'Lining up audio narrations', 'Preparing your tailored shelf']
    : purpose === 'write'
      ? ['Loading your co-writing tools', `Matching you with ${topGenre.toLowerCase()} readers`, 'Preparing your first draft']
      : [`Matching your ${topGenre.toLowerCase()} shelf`, 'Loading your writing room', 'Connecting reading and creation'];

  return (
    <View style={styles.buildWrap}>
      <View style={{ width: 118, height: 118, marginBottom: 34, alignItems: 'center', justifyContent: 'center' }}>
        <View style={styles.ringBase} />
        <Animated.View style={[styles.ringSpin, { transform: [{ rotate }] }]} />
        <Text style={styles.ringPct}>{pct}%</Text>
      </View>
      <Text style={styles.buildTitle}>{purpose === 'read' ? `Tuning your reading profile, ${fname}` : purpose === 'write' ? `Setting up your writing room, ${fname}` : `Building your Katha profile, ${fname}`}</Text>
      <View style={{ marginTop: 26, width: '100%', maxWidth: 290, gap: 14 }}>
        {steps.map((label, i) => {
          const done = step >= i + 1;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: done ? 1 : 0.4 }}>
              <View style={[styles.checkDot, { backgroundColor: done ? C.orange : '#D8CCBA' }]}>
                {done && <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text>}
              </View>
              <Text style={{ fontFamily: FF.h6, fontSize: 14.5, color: C.inkBody2 }}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── PAYWALL ─────────────────────────────────────────────────────────────────
function Paywall({ fname, purpose, topGenre, refine, moment, plan, setPlan, setTrial, onSubscribe, onClose }) {
  const [showWeekly, setShowWeekly] = useState(plan === 'weekly');
  const [confirmClose, setConfirmClose] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const ctaPress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [enter]);

  const readerFeatures = [
    `Unlimited ${topGenre} stories and 20 more genres`,
    refine === 'listen' || refine === 'mix' ? 'Studio quality narration whenever you want it' : 'Read or listen at your own pace',
    moment === 'sleep' ? 'Fresh chapters for your nightly wind-down' : 'Recommendations shaped around your routine',
    'Save stories offline and pick up anywhere',
  ];
  const writerFeatures = [
    moment === 'draft' ? 'Turn rough ideas into polished first drafts' : 'Co-write with Katha without limits',
    moment === 'voice' ? 'Rewrite every line until it sounds like you' : 'Plan, draft, and revise in one writing room',
    moment === 'publish' ? 'Publish and reach Katha readers' : 'Publish to a community ready to react',
    'Turn any story into audio in one tap',
  ];
  const bothFeatures = ['Read stories you love, then create your own', 'Switch between audio, reading, and writing', 'Keep your shelf and drafts in one profile', 'Publish and discover new readers'];
  const features = purpose === 'read' ? readerFeatures : purpose === 'write' ? writerFeatures : bothFeatures;
  const yOn = plan === 'yearly';
  const wOn = plan === 'weekly';
  const title = purpose === 'read' ? `Your ${topGenre} shelf is ready` : purpose === 'write' ? 'Your writing room is ready' : 'Your shelf and writing room are ready';
  const actionLead = yOn ? 'Start your 3-day free trial' : 'Start your weekly pass';
  const subtitle = purpose === 'read' ? `${actionLead}, ${fname}. Stories to read or listen to, chosen around your taste and routine.` : purpose === 'write' ? `${actionLead}, ${fname}. Draft, rewrite, publish, and build a readership with Katha beside you.` : `${actionLead}, ${fname}. Move naturally between discovering stories and creating your own.`;

  const selectYearly = () => {
    setPlan('yearly');
    setTrial(true);
  };
  const selectWeekly = () => {
    setPlan('weekly');
    setTrial(false);
    setShowWeekly(true);
  };
  const pressIn = () => {
    Animated.timing(ctaPress, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  };
  const pressOut = () => {
    Animated.timing(ctaPress, { toValue: 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  };

  const cta = yOn ? 'Start my 3-day free trial' : 'Start my weekly pass';
  const reassure = yOn ? 'No charge today. Then $49.99 per year unless canceled.' : 'Weekly plan has no free trial. Billed at $4.99 per week.';
  const headerY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const ctaY = enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const ctaScale = ctaPress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });

  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={() => setConfirmClose(true)} style={styles.closeBtn}><Text style={styles.closeX}>✕</Text></Pressable>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 8 }}>
        <Animated.View style={{ alignItems: 'center', opacity: enter, transform: [{ translateY: headerY }] }}>
          <View style={{ flexDirection: 'row', marginBottom: 9 }}>
            {AVATARS.map((src, i) => <Image key={i} source={src} style={[styles.proofAv, { marginLeft: i === 0 ? 0 : -11 }]} />)}
            <View style={[styles.proofMore, { marginLeft: -11 }]}><Text style={styles.proofMoreTxt}>40k+</Text></View>
          </View>
          <Text style={{ color: C.orange, fontSize: 14, letterSpacing: 2 }}>★★★★★</Text>
          <Text style={styles.proofSub}>4.9 rating, loved by 40,000+ this month</Text>
          <Text style={styles.payEyebrow}>Katha Plus</Text>
          <Text style={styles.payTitle}>{title}</Text>
          <Text style={styles.paySub}>{subtitle}</Text>
        </Animated.View>
        <View style={styles.planStack}>
          <PlanCard
            title="Annual"
            per="3 days free, then $0.96/week"
            price="$49.99"
            unit="per year"
            selected={yOn}
            onPress={selectYearly}
            badge="BEST VALUE"
          />
          {showWeekly ? (
            <PlanCard
              title="Weekly"
              per="No free trial"
              price="$4.99"
              unit="per week"
              selected={wOn}
              onPress={selectWeekly}
            />
          ) : (
            <Pressable onPress={() => setShowWeekly(true)} style={styles.morePlansBtn}>
              <Text style={styles.morePlansText}>See weekly option</Text>
            </Pressable>
          )}
        </View>
        <View style={{ gap: 10, marginTop: 14, marginBottom: 16 }}>
          {features.map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={styles.featTick}><Text style={styles.featTickTxt}>✓</Text></View>
              <Text style={styles.featText}>{f}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <Animated.View style={[styles.payFoot, { opacity: enter, transform: [{ translateY: ctaY }] }]}>
        <Pressable onPress={onSubscribe} onPressIn={pressIn} onPressOut={pressOut}>
          <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
          <LinearGradient colors={[C.orangeHi, C.orange]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.payCta}>
            <Text style={styles.payCtaTxt}>{cta}</Text>
          </LinearGradient>
          </Animated.View>
        </Pressable>
        <Text style={styles.payReassure}>{reassure}</Text>
        <Text style={styles.payLegal}>Restore  ·  Terms  ·  Privacy</Text>
      </Animated.View>
      {confirmClose && (
        <CancelTrialSheet
          hasTrial={yOn}
          onKeep={() => setConfirmClose(false)}
          onContinue={onClose}
        />
      )}
    </View>
  );
}

function PlanCard({ title, per, price, unit, selected, onPress, badge }) {
  return (
    <Pressable onPress={onPress} style={[styles.planCard, { borderColor: selected ? C.orange : C.line, backgroundColor: selected ? C.peachSoft : C.card }]}>
      <View style={[styles.radio, { borderColor: selected ? C.orange : '#DCD0BF', backgroundColor: selected ? C.orange : 'transparent' }]}>
        {selected && <Text style={styles.radioMark}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}><Text style={styles.planTitle}>{title}</Text><Text style={styles.planPer}>{per}</Text></View>
      <View style={{ alignItems: 'flex-end' }}><Text style={styles.planPrice}>{price}</Text><Text style={styles.planUnit}>{unit}</Text></View>
      {badge && <View style={styles.planBadge}><Text style={styles.planBadgeTxt}>{badge}</Text></View>}
    </Pressable>
  );
}

function CancelTrialSheet({ hasTrial, onKeep, onContinue }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 280,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [enter]);
  const backdropOpacity = enter.interpolate({ inputRange: [0, 1], outputRange: [0, 0.28] });
  const sheetY = enter.interpolate({ inputRange: [0, 1], outputRange: [330, 0] });
  const btnY = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  const title = hasTrial ? 'Leave without your free trial?' : 'Leave without Plus?';
  const body = hasTrial
    ? "Annual includes 3 days free. You can still continue with Katha's free version."
    : "Weekly has no free trial. You can switch back to annual for 3 days free, or continue with Katha's free version.";
  const primary = hasTrial ? 'Keep free trial' : 'Stay on paywall';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.paywallBackdrop, { opacity: backdropOpacity }]} />
      <Animated.View style={[styles.cancelSheet, { transform: [{ translateY: sheetY }] }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.cancelTitle}>{title}</Text>
        <Text style={styles.cancelBody}>{body}</Text>
        <Animated.View style={{ opacity: enter, transform: [{ translateY: btnY }] }}>
          <Pressable onPress={onKeep} style={styles.cancelPrimary}>
            <Text style={styles.cancelPrimaryText}>{primary}</Text>
          </Pressable>
        </Animated.View>
        <Pressable onPress={onContinue} style={styles.cancelSecondary}>
          <Text style={styles.cancelSecondaryText}>Continue without Plus</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ── ONE-TIME OFFER ──────────────────────────────────────────────────────────
function OneTimeOffer({ onClaim, onClose }) {
  const [left, setLeft] = useState(300);
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const iv = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    Animated.timing(enter, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ])).start();
    return () => clearInterval(iv);
  }, []);

  const btnScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const headerY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const cardScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const ctaY = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });

  return (
    <View style={styles.oto}>
      <Pressable onPress={onClose} style={styles.otoClose}><Text style={styles.closeX}>✕</Text></Pressable>
      <Animated.View style={{ opacity: enter, transform: [{ translateY: headerY }] }}>
        <Text style={styles.otoH1}>One-time offer</Text>
        <Text style={styles.otoBig}>Save 70% today</Text>
        <Text style={styles.otoSub}>Try Katha Plus for less than the price of a bedtime book.</Text>
      </Animated.View>
      <Animated.View style={[styles.otoCard, { opacity: enter, transform: [{ scale: cardScale }] }]}>
        <View style={styles.otoRibbon}><Text style={styles.otoRibbonText}>70% off</Text></View>
        <View style={styles.bookStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.bookLayer, styles.bookBack, { backgroundColor: '#2E5D57', transform: [{ rotate: '-7deg' }] }]} />
          <View style={[styles.bookLayer, styles.bookMid, { backgroundColor: '#B15A18', transform: [{ rotate: '4deg' }] }]} />
          <View style={[styles.bookLayer, styles.bookFront, { backgroundColor: C.orange }]} />
        </View>
        <Text style={styles.otoPlan}>Annual Plus</Text>
        <Text style={styles.otoPriceLine}>$17.99/year</Text>
        <Text style={styles.otoFine}>That is $1.50/month. Renews yearly unless canceled.</Text>
        <View style={styles.otoTimer}><View style={styles.timerDot} /><Text style={styles.otoTimerTxt}>{fmtTime(left)} left</Text></View>
      </Animated.View>
      <View style={{ flex: 1 }} />
      <Pressable onPress={onClaim}>
        <Animated.View style={{ opacity: enter, transform: [{ translateY: ctaY }, { scale: btnScale }] }}>
          <LinearGradient colors={[C.orangeHi, C.orange]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.otoBtn}>
            <Text style={styles.otoBtnTxt}>Claim one-time offer</Text>
          </LinearGradient>
        </Animated.View>
      </Pressable>
      <Pressable onPress={onClose} style={styles.otoFreeBtn}>
        <Text style={styles.otoFreeText}>Continue with free version</Text>
      </Pressable>
      <Text style={styles.otoLegal}>Renews yearly at $17.99 unless canceled. Terms apply.</Text>
    </View>
  );
}

// ── SUCCESS ─────────────────────────────────────────────────────────────────
function SuccessScreen({ fname, purpose, onStart }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.sequence([
    Animated.timing(p, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    Animated.timing(p, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
  ])).start(); }, []);
  const scale = p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const cta = purpose === 'read' ? 'Start reading' : purpose === 'write' ? 'Start writing' : 'Open Katha';
  const sub = purpose === 'read' ? 'Your shelf is stocked and your first chapter is waiting. Welcome to Katha.' : purpose === 'write' ? 'Your writing room is ready and your first draft is waiting. Welcome to Katha.' : 'Your shelf and writing room are ready. Welcome to Katha.';
  return (
    <View style={styles.successWrap}>
      <Animated.View style={[styles.successBadge, { transform: [{ scale }] }]}><Text style={{ color: '#fff', fontSize: 44 }}>✓</Text></Animated.View>
      <Text style={styles.successTitle}>You're all set, {fname}</Text>
      <Text style={styles.successSub}>{sub}</Text>
      <Pressable onPress={onStart} style={styles.successBtn}><Text style={styles.successBtnTxt}>{cta}</Text></Pressable>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pad: { flex: 1, paddingHorizontal: 30, paddingTop: 30, paddingBottom: 30 },
  headPad: { paddingHorizontal: 30, paddingTop: 20, paddingBottom: 14 },
  footPad: { paddingHorizontal: 30, paddingTop: 12, paddingBottom: 30 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 6 },
  backBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backChevron: { color: C.muted, fontSize: 20, lineHeight: 22, marginTop: -2 },
  progressTrack: { flex: 1, height: 6, borderRadius: 6, backgroundColor: C.track, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6 },
  stepLabel: { width: 28, fontFamily: FF.h7, fontSize: 12, color: C.muted3 },
  h1: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 31, lineHeight: 35, letterSpacing: 0, color: C.ink },
  h1sm: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 27, lineHeight: 31, letterSpacing: 0, color: C.ink },
  h1med: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 28, lineHeight: 32, letterSpacing: 0, color: C.ink },
  sub: { fontFamily: FF.h4, fontWeight: '500', fontSize: 15, lineHeight: 23, color: C.muted, marginTop: 10 },
  subSm: { fontFamily: FF.h4, fontWeight: '500', fontSize: 14.5, lineHeight: 22, color: C.muted, marginTop: 8 },
  cta: { height: 58, borderRadius: 16, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ ios: { shadowColor: C.orange, shadowOpacity: 0.5, shadowRadius: 15, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 6 } }) },
  ctaText: { fontFamily: FF.h7, fontSize: 17, color: '#fff' },
  nameInput: { borderBottomWidth: 2, borderBottomColor: '#E4D8C4', paddingVertical: 12, paddingHorizontal: 2, fontSize: 24, fontFamily: FF.bri7, color: C.ink },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5 },
  otherInput: { marginTop: 14, borderWidth: 1.5, borderColor: '#F0D9C4', borderRadius: 14, backgroundColor: '#fff', paddingVertical: 13, paddingHorizontal: 15, fontFamily: FF.h5, fontSize: 15, color: C.ink },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 18, borderWidth: 1.5 },
  optLabel: { fontFamily: FF.h7, fontSize: 16, color: C.ink },
  optSub: { fontFamily: FF.h4, fontSize: 13, color: C.muted2, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioMark: { color: '#fff', fontSize: 12 },
  iconBadge: { width: 52, height: 52, borderRadius: 15, backgroundColor: C.iconBg, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  emailInput: { borderWidth: 1.5, borderColor: '#E4D8C4', borderRadius: 14, backgroundColor: '#fff', padding: 16, fontFamily: FF.h6, fontSize: 17, color: C.ink },
  emailHint: { marginTop: 14, fontFamily: FF.h4, fontSize: 12.5, color: '#9A8E7E', lineHeight: 19 },
  otpRow: { flexDirection: 'row', gap: 9 },
  otpBox: { flex: 1, height: 60, borderRadius: 14, borderWidth: 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  otpDigit: { fontFamily: FF.bri8, fontSize: 24, color: C.ink },
  otpHidden: { position: 'absolute', width: '100%', height: '100%', opacity: 0 },
  otpMeta: { marginTop: 18, fontFamily: FF.h4, fontSize: 13, color: '#9A8E7E' },
  notifyWrap: { flex: 1, paddingTop: 26, paddingBottom: 22 },
  permissionAlert: { alignSelf: 'center', width: 326, backgroundColor: '#fff', borderRadius: 28, alignItems: 'center', paddingTop: 22, overflow: 'hidden',
    ...Platform.select({ ios: { shadowColor: '#3D2B1E', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } }, android: { elevation: 10 }, default: { boxShadow: '0 12px 30px rgba(61,43,30,0.16)' } }) },
  permissionIcon: { width: 58, height: 58, borderRadius: 15, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  permissionTitle: { paddingHorizontal: 26, fontFamily: FF.bri8, fontWeight: '800', fontSize: 22, lineHeight: 26, letterSpacing: 0, textAlign: 'center', color: C.ink },
  permissionBody: { paddingHorizontal: 25, marginTop: 8, marginBottom: 18, fontFamily: FF.h5, fontWeight: '500', fontSize: 13.5, lineHeight: 19, textAlign: 'center', color: C.muted },
  permissionDivider: { width: '100%', height: StyleSheet.hairlineWidth, backgroundColor: '#D9D9DD' },
  permissionActions: { height: 52, width: '100%', flexDirection: 'row' },
  permissionAction: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  permissionActionDivider: { width: StyleSheet.hairlineWidth, height: '100%', backgroundColor: '#D9D9DD' },
  permissionActionText: { fontFamily: FF.h6, fontSize: 16, color: '#007AFF' },
  reviewRailLabel: { marginTop: 34, marginBottom: 12, paddingHorizontal: 30, fontFamily: FF.h7, fontSize: 14, color: C.inkSoft },
  reviewRail: { paddingHorizontal: 30, paddingBottom: 8, gap: 12 },
  reviewCard: { width: 286, height: 106, backgroundColor: '#fff', borderRadius: 18, padding: 13, borderWidth: 1, borderColor: C.reviewBorder,
    ...Platform.select({ ios: { shadowColor: '#7A2E0E', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 3 } }) },
  reviewAvImg: { width: 30, height: 30, borderRadius: 15 },
  reviewAvInit: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reviewInitText: { color: '#fff', fontFamily: FF.h8, fontSize: 11 },
  reviewName: { fontFamily: FF.h8, fontSize: 12, color: C.ink },
  reviewStars: { color: C.orange, fontSize: 9, letterSpacing: 1 },
  reviewText: { fontFamily: FF.h4, fontWeight: '500', fontSize: 12.5, lineHeight: 17, color: C.inkBody2 },
  buildWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  ringBase: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 5, borderColor: '#EEE3D2' },
  ringSpin: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 5, borderColor: C.orange, borderRightColor: 'transparent', borderBottomColor: 'transparent' },
  ringPct: { fontFamily: FF.bri8, fontSize: 26, color: C.orange },
  buildTitle: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 24, lineHeight: 29, letterSpacing: 0, color: C.ink, textAlign: 'center' },
  checkDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { position: 'absolute', top: 2, right: 22, zIndex: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: '#EEE2D0', alignItems: 'center', justifyContent: 'center' },
  closeX: { color: '#9A8E7E', fontSize: 15 },
  proofAv: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, borderColor: C.bg },
  proofMore: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, borderColor: C.bg, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  proofMoreTxt: { color: '#fff', fontFamily: FF.h7, fontSize: 10.5 },
  proofSub: { fontFamily: FF.h6, fontSize: 12.5, color: C.muted2, marginTop: 3 },
  payEyebrow: { marginTop: 11, fontFamily: FF.h7, fontSize: 13, color: C.orange },
  payTitle: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 25, lineHeight: 29, letterSpacing: 0, color: C.ink, textAlign: 'center', marginTop: 12 },
  paySub: { fontFamily: FF.h4, fontSize: 14, lineHeight: 21, color: C.muted, textAlign: 'center', marginTop: 9, marginBottom: 16 },
  featTick: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.iconBg, alignItems: 'center', justifyContent: 'center' },
  featTickTxt: { color: C.orange, fontFamily: FF.h8, fontSize: 13 },
  featText: { flex: 1, fontFamily: FF.h6, fontSize: 14, lineHeight: 19, color: C.inkSoft },
  planStack: { gap: 12, marginTop: 2 },
  morePlansBtn: { height: 40, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  morePlansText: { fontFamily: FF.h7, fontSize: 13.5, color: C.muted, textDecorationLine: 'underline' },
  planCard: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 15, paddingHorizontal: 18, borderRadius: 18, borderWidth: 2, overflow: 'visible' },
  planTitle: { fontFamily: FF.h7, fontSize: 16, color: C.ink },
  planPer: { fontFamily: FF.h4, fontSize: 13, color: C.muted2, marginTop: 1 },
  planPrice: { fontFamily: FF.h8, fontSize: 16, color: C.ink },
  planUnit: { fontFamily: FF.h4, fontSize: 12, color: C.muted2 },
  planBadge: { position: 'absolute', top: -11, left: 18, backgroundColor: C.ink, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  planBadgeTxt: { color: '#fff', fontFamily: FF.h8, fontSize: 10.5, letterSpacing: 0.4 },
  payFoot: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 20 },
  payCta: { height: 60, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ ios: { shadowColor: C.orange, shadowOpacity: 0.7, shadowRadius: 17, shadowOffset: { width: 0, height: 12 } }, android: { elevation: 8 } }) },
  payCtaTxt: { fontFamily: FF.h8, fontSize: 18, color: '#fff' },
  payReassure: { textAlign: 'center', marginTop: 9, fontFamily: FF.h4, fontSize: 12, color: '#9A8E7E' },
  payLegal: { textAlign: 'center', marginTop: 6, fontFamily: FF.h4, fontSize: 11.5, color: C.muted3 },
  paywallBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: C.ink },
  cancelSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 310, backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28,
    ...Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: -8 } }, android: { elevation: 12 } }) },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#D8CDBE', marginBottom: 24 },
  cancelTitle: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 25, lineHeight: 29, color: C.ink, textAlign: 'center' },
  cancelBody: { marginTop: 10, fontFamily: FF.h5, fontSize: 14.5, lineHeight: 21, color: C.muted, textAlign: 'center' },
  cancelPrimary: { height: 56, borderRadius: 17, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  cancelPrimaryText: { fontFamily: FF.h8, fontSize: 17, color: '#fff' },
  cancelSecondary: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelSecondaryText: { fontFamily: FF.h7, fontSize: 14, color: C.muted, textDecorationLine: 'underline' },
  oto: { flex: 1, backgroundColor: '#FFFDF9', paddingHorizontal: 30, paddingTop: 24, paddingBottom: 30 },
  otoClose: { position: 'absolute', top: 18, right: 24, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(30,26,22,0.06)', alignItems: 'center', justifyContent: 'center' },
  otoH1: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 35, lineHeight: 39, letterSpacing: 0, color: C.ink },
  otoBig: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 45, lineHeight: 49, letterSpacing: 0, color: C.orange, marginTop: 4 },
  otoSub: { fontFamily: FF.h5, fontSize: 15, lineHeight: 22, color: C.muted, marginTop: 10, paddingRight: 30 },
  otoCard: { marginTop: 28, backgroundColor: '#fff', borderWidth: 2, borderColor: C.ink, borderRadius: 18, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 22, minHeight: 246, overflow: 'hidden' },
  otoRibbon: { alignSelf: 'flex-start', backgroundColor: C.peach, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16 },
  otoRibbonText: { fontFamily: FF.h8, fontSize: 12, color: C.orangeDeep },
  bookStack: { position: 'absolute', top: 30, right: 26, width: 58, height: 72 },
  bookLayer: { position: 'absolute', width: 38, height: 58, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  bookBack: { right: 18, bottom: 8 },
  bookMid: { right: 9, bottom: 4 },
  bookFront: { right: 0, bottom: 0 },
  otoPlan: { fontFamily: FF.h7, fontSize: 15, color: C.inkSoft },
  otoPriceLine: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 34, lineHeight: 38, color: C.ink, marginTop: 8 },
  otoFine: { fontFamily: FF.h4, fontSize: 13, lineHeight: 19, color: C.muted, marginTop: 8, paddingRight: 36 },
  otoTimer: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.ink, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, marginTop: 18 },
  timerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange },
  otoTimerTxt: { fontFamily: FF.h8, fontSize: 13.5, color: '#fff' },
  otoBtn: { height: 64, borderRadius: 18, borderWidth: 2.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.22, shadowRadius: 0, shadowOffset: { width: 0, height: 12 } }, android: { elevation: 8 } }) },
  otoBtnTxt: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 20, letterSpacing: 0, color: '#fff' },
  otoFreeBtn: { alignItems: 'center', justifyContent: 'center', height: 44, marginTop: 10 },
  otoFreeText: { fontFamily: FF.h7, fontSize: 14, color: C.muted, textDecorationLine: 'underline' },
  otoLegal: { textAlign: 'center', marginTop: 8, fontFamily: FF.h4, fontSize: 11.5, lineHeight: 16, color: C.muted3 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  successBadge: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ ios: { shadowColor: C.orange, shadowOpacity: 0.7, shadowRadius: 20, shadowOffset: { width: 0, height: 14 } }, android: { elevation: 10 } }) },
  successTitle: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 29, lineHeight: 33, letterSpacing: 0, color: C.ink, textAlign: 'center', marginTop: 26 },
  successSub: { fontFamily: FF.h4, fontSize: 15, lineHeight: 23, color: C.muted, textAlign: 'center', marginTop: 12, marginBottom: 30 },
  successBtn: { height: 52, paddingHorizontal: 30, borderRadius: 16, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  successBtnTxt: { fontFamily: FF.h7, fontSize: 16, color: '#fff' },
});
