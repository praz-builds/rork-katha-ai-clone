/*
 * Approved Expo onboarding and paywall flow.
 * See DESIGN.md for interaction, visual, and integration contracts.
 *
 * Usage (after useFonts):
 *   <KathaOnboardingFlowV2 onDone={() => nav.replace('Home')} />
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Alert, View, Text, TextInput, Pressable, ScrollView, StyleSheet, StatusBar,
  useWindowDimensions, Animated, Easing, Image, SafeAreaView, Platform,
  KeyboardAvoidingView, Modal, AccessibilityInfo,
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
const GENRES = ['Romance','Fantasy','Romantasy','Mystery','Thriller','Horror','Sci-Fi','Adventure','Historical','Dark Academia','Drama','Slice of Life','Mythology','Poetry','Comedy','Bedtime','Other'];
const PURPOSES = [
  { k: 'read',  icon: '\uD83D\uDCD6', label: 'Reading',       sub: 'Get lost in stories from around the world' },
  { k: 'write', icon: '\u270D\uFE0F', label: 'Writing',       sub: 'Create stories of my own with Katha' },
  { k: 'both',  icon: '\u2728', label: 'A bit of both', sub: 'I love to read and to write' },
];
const REFINE_READ = [
  { k: 'read',   icon: '\uD83D\uDCD6', label: 'Reading them myself', sub: 'Words on the page, at my own pace' },
  { k: 'listen', icon: '\uD83C\uDFA7', label: 'Listening to audio',  sub: 'Narrated stories for commutes and nights' },
  { k: 'mix',    icon: '\uD83D\uDD00', label: 'A mix of both',       sub: 'Read sometimes, listen sometimes' },
];
const REFINE_WRITE = [
  { k: 'novel',  icon: '\uD83D\uDCD5', label: 'A full novel',     sub: 'A story big enough to get lost in' },
  { k: 'short',  icon: '\u2712\uFE0F', label: 'Short stories',    sub: 'Quick, complete, satisfying' },
  { k: 'fan',    icon: '\uD83D\uDCAB', label: 'Fan fiction',      sub: 'Worlds and characters I already love' },
  { k: 'poetry', icon: '\uD83D\uDD6F\uFE0F', label: 'Poetry and verse', sub: 'A whole feeling in a few lines' },
];
const REFINE_BOTH = [
  { k: 'find', icon: '\uD83D\uDCDA', label: 'Find my next read', sub: 'Start with a shelf built around my taste' },
  { k: 'create', icon: '\u270D\uFE0F', label: 'Start a story', sub: 'Open a blank page with Katha beside me' },
  { k: 'balance', icon: '\u2696\uFE0F', label: 'Balance both', sub: 'Keep reading and writing close together' },
  { k: 'surprise', icon: '\u2728', label: 'Surprise me', sub: 'Show me the best place to begin' },
];
const MOMENTS_READ = [
  { k: 'sleep', icon: '\uD83C\uDF19', label: 'Before sleep', sub: 'A calm chapter to end the day' },
  { k: 'breaks', icon: '\u2615', label: 'Commutes and breaks', sub: 'Stories that fit into small pockets of time' },
  { k: 'weekend', icon: '\uD83D\uDCDA', label: 'Weekend binges', sub: 'Long sessions when I can settle in' },
  { k: 'escape', icon: '\u2728', label: 'Whenever I need an escape', sub: 'A new world on demand' },
];
const MOMENTS_WRITE = [
  { k: 'draft', icon: '\uD83D\uDCA1', label: 'Turn an idea into a draft', sub: 'Help me get from blank page to first version' },
  { k: 'voice', icon: '\u270E', label: 'Rewrite in my voice', sub: 'Make every line sound unmistakably mine' },
  { k: 'chapters', icon: '\uD83D\uDDC2\uFE0F', label: 'Plan chapters', sub: 'Shape the arc before I lose momentum' },
  { k: 'publish', icon: '\uD83D\uDE80', label: 'Publish and find readers', sub: 'Share the work and grow an audience' },
];
const MOMENTS_BOTH = [
  { k: 'remix', icon: '\uD83D\uDD01', label: 'Read, then remix', sub: 'Let great stories spark my own ideas' },
  { k: 'publish', icon: '\uD83D\uDE80', label: 'Write, then publish', sub: 'Create something and put it in front of readers' },
  { k: 'unwind', icon: '\uD83C\uDFA7', label: 'Listen, then unwind', sub: 'Keep stories close without looking at a screen' },
  { k: 'save', icon: '\uD83D\uDD16', label: 'Explore, then save', sub: 'Collect ideas, worlds, and favorites' },
];
const REVIEWS = [
  { text: '\u201CI fall asleep to a new story every night now.\u201D', name: 'Mira R.', img: require('../../assets/avatars/reader-black-woman.jpg') },
  { text: '\u201CThe audio narration is unreal on my commute.\u201D', name: 'Dev S.', initials: 'DS', color: '#3B4A8C' },
  { text: '\u201CI published my first short story and readers actually replied.\u201D', name: 'Aanya K.', img: require('../../assets/avatars/reader-white-woman.jpg') },
  { text: '\u201CEvery morning there is a fresh chapter waiting for me.\u201D', name: 'Leah T.', initials: 'LT', color: '#8A3B2E' },
  { text: '\u201CIt writes with me, not for me. That is the magic.\u201D', name: 'Noah B.', img: require('../../assets/avatars/reader-brown-man.jpg') },
  { text: '\u201CMy kids beg for one more Katha bedtime story.\u201D', name: 'Priya M.', initials: 'PM', color: '#5B7A54' },
  { text: '\u201CCancelled every other app. This is the only one I open.\u201D', name: 'Sam W.', initials: 'SW', color: '#B15A18' },
  { text: '\u201CWent from never reading to a book a week.\u201D', name: 'Tara I.', initials: 'TI', color: '#2E5D57' },
];
const AVATARS = [
  require('../../assets/avatars/reader-black-woman.jpg'),
  require('../../assets/avatars/reader-brown-man.jpg'),
  require('../../assets/avatars/reader-white-woman.jpg'),
];

const PAYWALL_PRODUCTS = {
  yearly: {
    key: 'yearly',
    productId: 'ai.katha.subscription.yearly',
    title: 'Annual',
    badge: 'MOST POPULAR',
    price: '$59/yr',
    localizedPrice: '$59',
    priceAmount: 59,
    currencyCode: 'USD',
    monthlyPrice: '$4.92/mo',
    strikethroughPrice: '$259',
    priceDetail: '3-day free trial',
    unit: 'per year',
    trial: true,
    trialEligible: true,
    actionLead: 'Start your 3-day free trial',
    cta: 'Start my 3-day free trial',
    billingDisclosure: 'Your yearly subscription automatically renews unless cancelled at least 24 hours before the end of the current term. Cancel any time in the App Store at no additional cost.',
  },
  weekly: {
    key: 'weekly',
    productId: 'ai.katha.subscription.weekly',
    title: 'Weekly',
    price: '$4.99/wk',
    localizedPrice: '$4.99',
    priceAmount: 4.99,
    currencyCode: 'USD',
    priceDetail: 'No free trial',
    unit: 'per week',
    trial: false,
    trialEligible: false,
    actionLead: 'Start your weekly pass',
    cta: 'Start my weekly pass',
    billingDisclosure: 'No free trial. Billed at $4.99/week. Subscription auto-renews unless canceled at least 24 hours before the end of the current period.',
  },
};

const ONE_TIME_OFFER_PRODUCT = {
  productId: 'ai.katha.subscription.yearly.winback',
  title: 'Annual Plus',
  comparisonProductKey: 'yearly',
  localizedPrice: '$17.99',
  priceAmount: 17.99,
  currencyCode: 'USD',
  unit: 'per year',
  monthlyEquivalent: '$1.50/month',
  billingDisclosure: 'Renews yearly at $17.99 unless canceled.',
  offerEligibility: 'one_time_cancel_flow',
  cta: 'Claim one-time offer',
};

const discountPercent = (offer, comparison) => Math.max(0, Math.round((1 - (offer.priceAmount / comparison.priceAmount)) * 100));
const oneTimeOfferDiscount = discountPercent(ONE_TIME_OFFER_PRODUCT, PAYWALL_PRODUCTS[ONE_TIME_OFFER_PRODUCT.comparisonProductKey]);

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
  const reduceMotion = useReducedMotionPreference();

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
      {screen === 'building' && <BuildingScreen fname={fname} purpose={purpose} topGenre={topGenre} reduceMotion={reduceMotion} onDone={() => setScreen('notify')} />}
      {screen === 'paywall' && <Paywall fname={fname} purpose={purpose} topGenre={topGenre} refine={refine} moment={moment} plan={plan} setPlan={setPlan} trial={trial} setTrial={setTrial} reduceMotion={reduceMotion} onSubscribe={() => { setOtp(false); setScreen('email'); }} onClose={() => setScreen('oto')} />}
      {screen === 'oto' && <OneTimeOffer reduceMotion={reduceMotion} onClaim={() => { setOtp(false); setScreen('email'); }} onClose={() => { setOtp(false); setScreen('email'); }} />}
      {screen === 'success' && <SuccessScreen fname={fname} purpose={purpose} reduceMotion={reduceMotion} onStart={() => onDone({ name: name.trim(), genres: Object.keys(genres).filter((key) => genres[key]), otherGenre: otherText.trim(), purpose, email: email.trim(), notificationsAllowed, refine, moment, plan, trial })} />}
    </SafeAreaView>
  );
}

function useReducedMotionPreference() {
  const [reduceMotion, setReduceMotion] = useState(false);

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

// ── Shared ───────────────────────────────────────────────────────────────────
function TopBar({ step, onBack, canBack }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} style={[styles.backBtn, { opacity: canBack ? 1 : 0.35 }]}>
        <Text style={styles.backChevron}>{'\u2039'}</Text>
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
        {selected && <Text style={styles.radioMark}>{'\u2713'}</Text>}
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
                <Text style={{ fontSize: 12, opacity: on ? 1 : 0.28, color: on ? C.orange : C.inkBody2 }}>{'\u2713'}</Text>
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
        <View style={styles.iconBadge}><Text style={{ fontSize: 24 }}>{'\u2709\uFE0F'}</Text></View>
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
        <View style={styles.iconBadge}><Text style={{ fontSize: 24 }}>{'\uD83D\uDD11'}</Text></View>
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
          {'  \u00B7  '}<Text onPress={onEditEmail} style={{ color: C.muted, fontFamily: FF.h6, textDecorationLine: 'underline' }}>Wrong email?</Text>
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
        <View style={styles.permissionIcon}><Text style={{ fontSize: 28 }}>{'\uD83D\uDD14'}</Text></View>
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
          <Text style={styles.reviewStars}>{'\u2605\u2605\u2605\u2605\u2605'}</Text>
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
function BuildingScreen({ fname, purpose, topGenre, reduceMotion, onDone }) {
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      setPct(100);
      setStep(3);
      const doneTimer = setTimeout(onDone, 450);
      return () => clearTimeout(doneTimer);
    }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    const t0 = Date.now(), DUR = 2600;
    const iv = setInterval(() => { const p = Math.min(100, Math.round(((Date.now() - t0) / DUR) * 100)); setPct(p); if (p >= 100) clearInterval(iv); }, 40);
    const t1 = setTimeout(() => setStep(1), 700);
    const t2 = setTimeout(() => setStep(2), 1500);
    const t3 = setTimeout(() => setStep(3), 2300);
    const tf = setTimeout(onDone, 2750);
    return () => { loop.stop(); clearInterval(iv); [t1, t2, t3, tf].forEach(clearTimeout); };
  }, [onDone, reduceMotion, spin]);

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
                {done && <Text style={{ color: '#fff', fontSize: 13 }}>{'\u2713'}</Text>}
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
const PAYWALL_TESTIMONIALS = [
  { img: require('../../assets/avatars/reader-brown-man.jpg'), name: 'Arjun M.', quote: "I've written 12 stories in two weeks. The AI understands exactly what I want.", stars: 5 },
  { img: require('../../assets/avatars/reader-white-woman.jpg'), name: 'Sophie L.', quote: 'The audio narration turned my bedtime stories into a whole experience for my kids.', stars: 5 },
  { img: require('../../assets/avatars/reader-black-woman.jpg'), name: 'Amara O.', quote: 'Finally an app that lets me write AND read. The editing tools are incredible.', stars: 5 },
];

const FEATURE_TABLE = [
  { label: 'Read unlimited stories', free: 'check', plus: 'check' },
  { label: 'Create stories with AI', free: '10 credits', plus: 'Unlimited' },
  { label: 'Audio narration', free: '1 credit each', plus: 'Included' },
  { label: 'Cover image generation', free: '1 credit each', plus: 'Included' },
  { label: 'Ad-free experience', free: 'lock', plus: 'check' },
  { label: 'Priority generation', free: 'lock', plus: 'check' },
  { label: 'Premium voices', free: 'lock', plus: 'check' },
];

function Paywall({ fname, purpose, topGenre, refine, moment, plan, setPlan, setTrial, reduceMotion, onSubscribe, onClose }) {
  const [showWeekly, setShowWeekly] = useState(plan === 'weekly');
  const [confirmClose, setConfirmClose] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const ctaPress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) { enter.setValue(1); return; }
    Animated.timing(enter, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [enter, reduceMotion]);

  const selectedProduct = plan === 'yearly' ? PAYWALL_PRODUCTS.yearly : PAYWALL_PRODUCTS.weekly;

  const selectYearly = () => { setPlan('yearly'); setTrial(true); };
  const selectWeekly = () => { setPlan('weekly'); setTrial(false); setShowWeekly(true); };

  const pressIn = () => {
    if (reduceMotion) return;
    Animated.timing(ctaPress, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  };
  const pressOut = () => {
    if (reduceMotion) return;
    Animated.timing(ctaPress, { toValue: 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  };

  const ctaScale = ctaPress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });
  const headerY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const ctaY = enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Close button - top left */}
      <Pressable onPress={() => setConfirmClose(true)} accessibilityLabel="Close paywall" accessibilityRole="button" style={pw.closeBtn}>
        <Text style={pw.closeBtnText}>{'\u00D7'}</Text>
      </Pressable>

      {/* Scrollable content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>

        {/* Section 1: Hero */}
        <Animated.View style={[pw.heroSection, { opacity: enter, transform: [{ translateY: headerY }] }]}>
          <BrandWordmark size={30} />
          <View style={pw.plusPill}>
            <Text style={pw.plusPillText}>Katha Plus</Text>
          </View>
          <Text style={pw.heroHeadline}>
            {'Create stories '}
            <Text style={{ color: C.orange, fontFamily: FF.bri8, fontWeight: '800' }}>10x faster</Text>
          </Text>
          <Text style={pw.heroSub}>Unlock the full power of AI storytelling</Text>
        </Animated.View>

        {/* Section 2: Pricing Card */}
        <View style={pw.pricingSection}>
          <Pressable onPress={selectYearly} style={pw.pricingCard} accessibilityLabel="Select yearly plan">
            <View style={pw.mostPopularBadge}>
              <Text style={pw.mostPopularText}>Most popular</Text>
            </View>
            <Text style={pw.trialHeading}>3-day free trial</Text>
            <View style={pw.priceRow}>
              <Text style={pw.priceMain}>$4.92</Text>
              <Text style={pw.priceUnit}>/mo</Text>
            </View>
            <View style={pw.strikeRow}>
              <Text style={pw.strikePrice}>{PAYWALL_PRODUCTS.yearly.strikethroughPrice}/yr</Text>
              <Text style={pw.arrowText}>{' \u2192 '}</Text>
              <Text style={pw.finalPrice}>{PAYWALL_PRODUCTS.yearly.localizedPrice}/yr</Text>
            </View>

            {showWeekly ? (
              <View style={pw.weeklyOption}>
                <View style={pw.weeklyDivider} />
                <Pressable onPress={selectWeekly} style={[pw.weeklyRow, plan === 'weekly' && { backgroundColor: C.peach, borderColor: C.orange }]}>
                  <View style={[styles.radio, { borderColor: plan === 'weekly' ? C.orange : '#DCD0BF', backgroundColor: plan === 'weekly' ? C.orange : 'transparent' }]}>
                    {plan === 'weekly' && <Text style={styles.radioMark}>{'\u2713'}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={pw.weeklyLabel}>Weekly</Text>
                    <Text style={pw.weeklyMeta}>No free trial</Text>
                  </View>
                  <Text style={pw.weeklyPrice}>{PAYWALL_PRODUCTS.weekly.localizedPrice}/wk</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setShowWeekly(true)} style={pw.showMoreBtn}>
                <Text style={pw.showMoreText}>{'Show more plans \u25BE'}</Text>
              </Pressable>
            )}
          </Pressable>
        </View>

        {/* Section 3: Feature Comparison Table */}
        <View style={pw.tableSection}>
          <View style={pw.tableHeaderRow}>
            <View style={{ flex: 1.4 }}>
              <Text style={pw.tableTitle}>What you get</Text>
            </View>
            <View style={pw.tableHeaderCell}>
              <Text style={pw.tableHeaderLabel}>Free</Text>
            </View>
            <View style={pw.tableHeaderCell}>
              <View style={pw.plusBadgeSm}>
                <Text style={pw.plusBadgeSmText}>Plus</Text>
              </View>
            </View>
          </View>
          {FEATURE_TABLE.map((row, i) => (
            <View key={i} style={[pw.tableRow, i % 2 === 0 && { backgroundColor: '#FEFCF7' }]}>
              <View style={{ flex: 1.4, paddingRight: 8 }}>
                <Text style={pw.tableFeatureLabel}>{row.label}</Text>
              </View>
              <View style={pw.tableCellCenter}>
                {row.free === 'check' ? (
                  <Text style={pw.checkGreen}>{'\u2713'}</Text>
                ) : row.free === 'lock' ? (
                  <Text style={pw.lockMuted}>{'\uD83D\uDD12'}</Text>
                ) : (
                  <Text style={pw.tableCellText}>{row.free}</Text>
                )}
              </View>
              <View style={pw.tableCellCenter}>
                {row.plus === 'check' ? (
                  <Text style={pw.checkGreen}>{'\u2713'}</Text>
                ) : (
                  <Text style={pw.tableCellTextPlus}>{row.plus}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Section 4: Success Stories */}
        <View style={pw.testimonialsSection}>
          <Text style={pw.sectionTitle}>Loved by storytellers</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pw.testimonialScroll}>
            {PAYWALL_TESTIMONIALS.map((t, i) => (
              <View key={i} style={pw.testimonialCard}>
                <View style={pw.testimonialHeader}>
                  <Image source={t.img} style={pw.testimonialAvatar} />
                  <View>
                    <Text style={pw.testimonialName}>{t.name}</Text>
                    <Text style={pw.testimonialStars}>{'\u2605'.repeat(t.stars)}</Text>
                  </View>
                </View>
                <Text style={pw.testimonialQuote}>{'\u201C'}{t.quote}{'\u201D'}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Section 5: Social Proof Stats */}
        <View style={pw.statsSection}>
          <View style={pw.statCard}>
            <Text style={pw.statEmoji}>{'\uD83C\uDFC6'}</Text>
            <Text style={pw.statValue}>4.8</Text>
            <Text style={pw.statLabel}>average rating</Text>
          </View>
          <View style={pw.statCard}>
            <Text style={pw.statEmoji}>{'\uD83C\uDFC6'}</Text>
            <Text style={pw.statValue}>50K+</Text>
            <Text style={pw.statLabel}>stories created</Text>
          </View>
        </View>

        {/* Section 6: Legal */}
        <View style={pw.legalSection}>
          <Text style={pw.legalDisclosure}>{selectedProduct.billingDisclosure}</Text>
          <View style={pw.legalLinksRow}>
            <Pressable onPress={() => Alert.alert('Restore', 'Restore purchases will be available when Adapty is connected.')} accessibilityRole="button"><Text style={pw.legalLink}>Restore purchases</Text></Pressable>
            <Text style={pw.legalDot}>{'\u00B7'}</Text>
            <Pressable onPress={() => Alert.alert('Terms', 'Terms of Use URL will be configured.')} accessibilityRole="link"><Text style={pw.legalLink}>Terms of Use</Text></Pressable>
            <Text style={pw.legalDot}>{'\u00B7'}</Text>
            <Pressable onPress={() => Alert.alert('Privacy', 'Privacy Notice URL will be configured.')} accessibilityRole="link"><Text style={pw.legalLink}>Privacy Notice</Text></Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Sticky Bottom CTA */}
      <Animated.View style={[pw.stickyFooter, { opacity: enter, transform: [{ translateY: ctaY }] }]}>
        <LinearGradient colors={['rgba(251,246,236,0)', 'rgba(251,246,236,0.92)', C.bg]} style={pw.stickyGradient} pointerEvents="none" />
        <View style={pw.stickyInner}>
          <Pressable onPress={onSubscribe} onPressIn={pressIn} onPressOut={pressOut}>
            <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
              <LinearGradient colors={[C.orangeHi, C.orange]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={pw.stickyCta}>
                <Text style={pw.stickyCtaText}>{selectedProduct.trial ? 'Start my 3-day free trial' : `Subscribe for ${selectedProduct.price}`}</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>
          <Text style={pw.stickyReassure}>{selectedProduct.trial ? 'No payment now. Easy to cancel.' : `Billed ${selectedProduct.price} immediately. Cancel anytime.`}</Text>
        </View>
      </Animated.View>

      {confirmClose && (
        <CancelTrialSheet
          product={selectedProduct}
          reduceMotion={reduceMotion}
          onKeep={() => setConfirmClose(false)}
          onContinue={onClose}
        />
      )}
    </View>
  );
}

const pw = StyleSheet.create({
  closeBtn: { position: 'absolute', top: 6, left: 16, zIndex: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: '#EEE2D0', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#9A8E7E', fontSize: 18, lineHeight: 20, marginTop: -1 },
  heroSection: { alignItems: 'center', paddingTop: 18, paddingHorizontal: 24 },
  plusPill: { marginTop: 16, backgroundColor: C.orange, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999 },
  plusPillText: { fontFamily: FF.h8, fontSize: 13, color: '#fff', letterSpacing: 0 },
  heroHeadline: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 30, lineHeight: 36, color: C.ink, textAlign: 'center', marginTop: 16 },
  heroSub: { fontFamily: FF.h5, fontSize: 15, lineHeight: 22, color: C.muted, textAlign: 'center', marginTop: 8 },
  pricingSection: { marginTop: 24, paddingHorizontal: 24 },
  pricingCard: { backgroundColor: C.card, borderRadius: 24, borderWidth: 2, borderColor: C.orange, paddingTop: 28, paddingBottom: 18, paddingHorizontal: 22, alignItems: 'center',
    ...Platform.select({ ios: { shadowColor: '#3D2D1B', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 4 } }) },
  mostPopularBadge: { position: 'absolute', top: -13, backgroundColor: '#12B5A5', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999 },
  mostPopularText: { fontFamily: FF.h8, fontSize: 12, color: '#fff', letterSpacing: 0 },
  trialHeading: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 17, color: C.ink, marginBottom: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  priceMain: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 42, color: C.ink },
  priceUnit: { fontFamily: FF.h6, fontSize: 18, color: C.muted, marginLeft: 2 },
  strikeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  strikePrice: { fontFamily: FF.h6, fontSize: 14, color: C.muted2, textDecorationLine: 'line-through' },
  arrowText: { fontFamily: FF.h6, fontSize: 14, color: C.muted2 },
  finalPrice: { fontFamily: FF.h7, fontSize: 14, color: '#12B5A5' },
  showMoreBtn: { marginTop: 14, paddingVertical: 6 },
  showMoreText: { fontFamily: FF.h7, fontSize: 13.5, color: C.muted, textAlign: 'center' },
  weeklyOption: { width: '100%', marginTop: 12 },
  weeklyDivider: { height: 1, backgroundColor: C.line, marginBottom: 12 },
  weeklyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.bg },
  weeklyLabel: { fontFamily: FF.h7, fontSize: 15, color: C.ink },
  weeklyMeta: { fontFamily: FF.h4, fontSize: 12, color: C.muted2, marginTop: 1 },
  weeklyPrice: { fontFamily: FF.h8, fontSize: 15, color: C.ink },
  tableSection: { marginTop: 28, paddingHorizontal: 24 },
  tableTitle: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 15, color: C.ink },
  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  tableHeaderCell: { flex: 1, alignItems: 'center' },
  tableHeaderLabel: { fontFamily: FF.h7, fontSize: 13, color: C.muted },
  plusBadgeSm: { backgroundColor: C.orange, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  plusBadgeSmText: { fontFamily: FF.h8, fontSize: 12, color: '#fff' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  tableFeatureLabel: { fontFamily: FF.h6, fontSize: 13, color: C.inkSoft, lineHeight: 18 },
  tableCellCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  checkGreen: { fontSize: 16, color: '#12B5A5', fontWeight: '700' },
  lockMuted: { fontSize: 13, opacity: 0.4 },
  tableCellText: { fontFamily: FF.h6, fontSize: 11.5, color: C.muted2, textAlign: 'center' },
  tableCellTextPlus: { fontFamily: FF.h7, fontSize: 11.5, color: C.orange, textAlign: 'center' },
  testimonialsSection: { marginTop: 28, paddingLeft: 24 },
  sectionTitle: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 20, color: C.ink, marginBottom: 14 },
  testimonialScroll: { paddingRight: 24, gap: 12 },
  testimonialCard: { width: 268, backgroundColor: C.card, borderRadius: 24, padding: 16, borderWidth: 1, borderColor: C.reviewBorder,
    ...Platform.select({ ios: { shadowColor: '#3D2D1B', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 2 } }) },
  testimonialHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  testimonialAvatar: { width: 36, height: 36, borderRadius: 18 },
  testimonialName: { fontFamily: FF.h8, fontSize: 13, color: C.ink },
  testimonialStars: { color: C.orange, fontSize: 11, letterSpacing: 1, marginTop: 1 },
  testimonialQuote: { fontFamily: FF.h4, fontWeight: '500', fontSize: 13, lineHeight: 19, color: C.inkBody2 },
  statsSection: { flexDirection: 'row', gap: 12, marginTop: 24, paddingHorizontal: 24 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 24, paddingVertical: 18, alignItems: 'center', borderWidth: 1, borderColor: C.line,
    ...Platform.select({ ios: { shadowColor: '#3D2D1B', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 2 } }) },
  statEmoji: { fontSize: 20, marginBottom: 6 },
  statValue: { fontFamily: FF.bri8, fontWeight: '800', fontSize: 26, color: C.ink },
  statLabel: { fontFamily: FF.h6, fontSize: 12, color: C.muted2, marginTop: 2 },
  legalSection: { marginTop: 24, paddingHorizontal: 24, paddingBottom: 8 },
  legalDisclosure: { fontFamily: FF.h4, fontSize: 11, lineHeight: 16, color: C.muted3, textAlign: 'center' },
  legalLinksRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10, gap: 6, flexWrap: 'wrap' },
  legalLink: { fontFamily: FF.h4, fontSize: 11.5, color: C.muted2, textDecorationLine: 'underline' },
  legalDot: { fontFamily: FF.h4, fontSize: 11.5, color: C.muted2 },
  stickyFooter: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  stickyGradient: { position: 'absolute', top: -32, left: 0, right: 0, height: 32 },
  stickyInner: { backgroundColor: C.bg, paddingHorizontal: 24, paddingTop: 6, paddingBottom: Platform.OS === 'ios' ? 28 : 20 },
  stickyCta: { height: 56, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ ios: { shadowColor: C.orange, shadowOpacity: 0.7, shadowRadius: 17, shadowOffset: { width: 0, height: 12 } }, android: { elevation: 8 } }) },
  stickyCtaText: { fontFamily: FF.h8, fontSize: 18, color: '#fff' },
  stickyReassure: { textAlign: 'center', marginTop: 8, fontFamily: FF.h4, fontSize: 12, color: '#9A8E7E' },
});

function CancelTrialSheet({ product, reduceMotion, onKeep, onContinue }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 280,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [enter, reduceMotion]);
  const backdropOpacity = enter.interpolate({ inputRange: [0, 1], outputRange: [0, 0.28] });
  const sheetY = enter.interpolate({ inputRange: [0, 1], outputRange: [330, 0] });
  const btnY = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  const title = product.trialEligible ? 'Leave without your free trial?' : 'Leave without Plus?';
  const body = product.trialEligible
    ? `${product.title} includes 3 days free. You can still continue with Katha's free version.`
    : `${product.title} has no free trial. You can switch back to annual for 3 days free, or continue with Katha's free version.`;
  const primary = product.trialEligible ? 'Keep free trial' : 'Stay on paywall';

  return (
    <Modal transparent visible animationType="none" onRequestClose={onKeep}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.paywallBackdrop, { opacity: backdropOpacity }]} />
        <Animated.View accessibilityViewIsModal style={[styles.cancelSheet, { transform: [{ translateY: sheetY }] }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.cancelTitle}>{title}</Text>
          <Text style={styles.cancelBody}>{body}</Text>
          <Animated.View style={{ opacity: enter, transform: [{ translateY: btnY }] }}>
            <Pressable accessibilityRole="button" onPress={onKeep} style={styles.cancelPrimary}>
              <Text style={styles.cancelPrimaryText}>{primary}</Text>
            </Pressable>
          </Animated.View>
          <Pressable accessibilityRole="button" onPress={onContinue} style={styles.cancelSecondary}>
            <Text style={styles.cancelSecondaryText}>Continue without Plus</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── ONE-TIME OFFER ──────────────────────────────────────────────────────────
function OneTimeOffer({ reduceMotion, onClaim, onClose }) {
  const [left, setLeft] = useState(300);
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const iv = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    if (reduceMotion) {
      enter.setValue(1);
      pulse.setValue(0);
      return () => clearInterval(iv);
    }
    Animated.timing(enter, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => { clearInterval(iv); loop.stop(); };
  }, [enter, pulse, reduceMotion]);

  const btnScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const headerY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const cardScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const ctaY = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const offerExpired = left <= 0;

  return (
    <View style={styles.oto}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close one-time offer" onPress={onClose} style={styles.otoClose}><Text style={styles.closeX}>{'\u2715'}</Text></Pressable>
      <Animated.View style={{ opacity: enter, transform: [{ translateY: headerY }] }}>
        <Text style={styles.otoH1}>One-time offer</Text>
        <Text style={styles.otoBig}>Save {oneTimeOfferDiscount}% today</Text>
        <Text style={styles.otoSub}>Try Katha Plus for less than the price of a bedtime book.</Text>
      </Animated.View>
      <Animated.View style={[styles.otoCard, { opacity: enter, transform: [{ scale: cardScale }] }]}>
        <View style={styles.otoRibbon}><Text style={styles.otoRibbonText}>{oneTimeOfferDiscount}% off</Text></View>
        <View style={styles.bookStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.bookLayer, styles.bookBack, { backgroundColor: '#2E5D57', transform: [{ rotate: '-7deg' }] }]} />
          <View style={[styles.bookLayer, styles.bookMid, { backgroundColor: '#B15A18', transform: [{ rotate: '4deg' }] }]} />
          <View style={[styles.bookLayer, styles.bookFront, { backgroundColor: C.orange }]} />
        </View>
        <Text style={styles.otoPlan}>{ONE_TIME_OFFER_PRODUCT.title}</Text>
        <Text style={styles.otoPriceLine}>{ONE_TIME_OFFER_PRODUCT.localizedPrice}/{ONE_TIME_OFFER_PRODUCT.unit.replace('per ', '')}</Text>
        <Text style={styles.otoFine}>That is {ONE_TIME_OFFER_PRODUCT.monthlyEquivalent}. {ONE_TIME_OFFER_PRODUCT.billingDisclosure}</Text>
        <View style={styles.otoTimer}><View style={styles.timerDot} /><Text style={styles.otoTimerTxt}>{fmtTime(left)} left</Text></View>
      </Animated.View>
      <View style={{ flex: 1 }} />
      <Pressable disabled={offerExpired} accessibilityState={{ disabled: offerExpired }} onPress={() => { if (!offerExpired) onClaim(); }}>
        <Animated.View style={{ opacity: offerExpired ? 0.48 : enter, transform: [{ translateY: ctaY }, { scale: btnScale }] }}>
          <LinearGradient colors={[C.orangeHi, C.orange]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.otoBtn}>
            <Text style={styles.otoBtnTxt}>{offerExpired ? 'Offer expired' : ONE_TIME_OFFER_PRODUCT.cta}</Text>
          </LinearGradient>
        </Animated.View>
      </Pressable>
      <Pressable onPress={onClose} style={styles.otoFreeBtn}>
        <Text style={styles.otoFreeText}>Continue with free version</Text>
      </Pressable>
      <Text style={styles.otoLegal}>{ONE_TIME_OFFER_PRODUCT.billingDisclosure} Terms apply.</Text>
    </View>
  );
}

// ── SUCCESS ─────────────────────────────────────────────────────────────────
function SuccessScreen({ fname, purpose, reduceMotion, onStart }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      p.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(p, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(p, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [p, reduceMotion]);
  const scale = p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const cta = purpose === 'read' ? 'Start reading' : purpose === 'write' ? 'Start writing' : 'Open Katha';
  const sub = purpose === 'read' ? 'Your shelf is stocked and your first chapter is waiting. Welcome to Katha.' : purpose === 'write' ? 'Your writing room is ready and your first draft is waiting. Welcome to Katha.' : 'Your shelf and writing room are ready. Welcome to Katha.';
  return (
    <View style={styles.successWrap}>
      <Animated.View style={[styles.successBadge, { transform: [{ scale }] }]}><Text style={{ color: '#fff', fontSize: 44 }}>{'\u2713'}</Text></Animated.View>
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
  reviewStars: { color: C.orange, fontSize: 9, letterSpacing: 0 },
  reviewText: { fontFamily: FF.h4, fontWeight: '500', fontSize: 12.5, lineHeight: 17, color: C.inkBody2 },
  buildWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  ringBase: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 5, borderColor: '#EEE3D2' },
  ringSpin: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 5, borderColor: C.orange, borderRightColor: 'transparent', borderBottomColor: 'transparent' },
  ringPct: { fontFamily: FF.bri8, fontSize: 26, color: C.orange },
  buildTitle: { fontFamily: FF.bri7, fontWeight: '800', fontSize: 24, lineHeight: 29, letterSpacing: 0, color: C.ink, textAlign: 'center' },
  checkDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  closeX: { color: '#9A8E7E', fontSize: 15 },
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
