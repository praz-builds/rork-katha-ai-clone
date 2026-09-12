/*
 * KathaOnboardingComplete.jsx  -  Expo / React Native
 * The first-run entry point:
 *   Animated intro (Create → Publish → Read + Sign In)
 *     → Name → Genres → Purpose → Refine → Moment → the character flow
 *
 * Composer over KathaOnboarding.jsx (intro) + KathaOnboardingFlowV2.tsx (the
 * five questions). Everything after the questions (the portrait, auth, the
 * paywall, the notification prompt and the welcome hand-off) belongs to
 * `CharacterOnboarding.tsx`, which App.tsx mounts when `onCharacterPath` fires.
 *
 * Usage (after useFonts, see README):
 *   <KathaOnboardingComplete onCharacterPath={...} onSignIn={() => nav.replace('SignIn')} />
 */

import React, { useState } from 'react';
import KathaOnboarding from './KathaOnboarding';
import KathaOnboardingFlowV2 from './KathaOnboardingFlowV2';

export default function KathaOnboardingComplete({ onCharacterPath = () => {}, onSignIn = () => {} }) {
  const [phase, setPhase] = useState('intro');

  if (phase === 'intro') {
    return <KathaOnboarding onFinish={() => setPhase('flow')} onSignIn={onSignIn} />;
  }
  return <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />;
}
