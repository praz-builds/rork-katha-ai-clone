/*
 * KathaOnboardingComplete.jsx  —  Expo / React Native
 * The ENTIRE onboarding, one entrypoint:
 *   Animated intro (Create → Publish → Read + Sign In)
 *     → Name → Genres → Purpose → Persona questions → Building or writer path
 *     → Notifications → Paywall → Email/OTP → Success
 *
 * Composer over KathaOnboarding.jsx (intro) + KathaOnboardingFlowV2.jsx (flow).
 * See DESIGN.md for the approved flow and visual specification.
 *
 * Usage (after useFonts, see README):
 *   <KathaOnboardingComplete onDone={() => nav.replace('Home')} onSignIn={() => nav.replace('SignIn')} />
 */

import React, { useState } from 'react';
import KathaOnboarding from './KathaOnboarding';
import KathaOnboardingFlowV2 from './KathaOnboardingFlowV2';

export default function KathaOnboardingComplete({ onDone = () => {}, onSignIn = () => {}, onWriterPath = null }) {
  const [phase, setPhase] = useState('intro');

  if (phase === 'intro') {
    return <KathaOnboarding onFinish={() => setPhase('flow')} onSignIn={onSignIn} />;
  }
  return <KathaOnboardingFlowV2 onDone={onDone} onWriterPath={onWriterPath} />;
}
