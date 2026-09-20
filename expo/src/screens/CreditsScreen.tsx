import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import { HeaderAction } from "@/components/HeaderAction";
import CreditPacksSheet from "@/components/credits/CreditPacksSheet";
import FeedbackClaimsCard from "@/components/credits/FeedbackClaimsCard";
import HowCreditsWork from "@/components/credits/HowCreditsWork";
import InviteCard from "@/components/credits/InviteCard";
import LedgerHistory from "@/components/credits/LedgerHistory";
import PaidOptions from "@/components/credits/PaidOptions";
import StreakEarnCard from "@/components/credits/StreakEarnCard";
import MemberSheet from "@/components/profile/MemberSheet";
import { type CreditClaimsResult, fetchCreditClaims } from "@/lib/api";
import { useIsSubscribed } from "@/lib/entitlements";
import {
  fetchLedger,
  fetchOwnProfile,
  type LedgerEntry,
  type OwnProfile,
} from "@/lib/profile";
import { revenueCatService } from "@/lib/revenuecat";
import { bootstrapUser } from "@/lib/session";
import { colors, fonts, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * Get credits (D8, D9, D10).
 *
 * THE ORDER. Paid options, then how credits work, then the free ways, then
 * the history. Paid first because a plan is always the best price per credit
 * and the screen should say so before it lists the slower paths; the
 * explanation sits between the two so that whichever way somebody chooses,
 * they have read what a credit buys. History last: it is the only part that
 * is about the past.
 *
 * WHAT IS REAL. The balance in the pill is the app's, the streak and the
 * invite code are the profile's, the claims list and the ledger are read from
 * their own endpoints, and every purchase goes through the store. Nothing on
 * this screen is seeded.
 *
 * WEB. RevenueCat is disabled there, so the packs sheet shows the canonical
 * prices with a disabled Purchase, and the Plus card for a member opens the
 * plan-facts sheet instead of the Customer Center. See D7 and D8.
 */
export default function CreditsScreen({
  credits,
  onBack,
  onPaywall,
  onJourney,
  onBalance,
}: {
  credits: number;
  onBack: () => void;
  onPaywall: () => void;
  /** Handed the profile this screen loaded, so Journey opens with it filled in. */
  onJourney: (profile: OwnProfile | null) => void;
  /** The server said the balance is now this. */
  onBalance: (balance: number) => void;
}) {
  const subscribed = useIsSubscribed();
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [claims, setClaims] = useState<CreditClaimsResult | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null | undefined>(undefined);
  const [packs, setPacks] = useState(false);
  const [memberSheet, setMemberSheet] = useState(false);

  const loadProfile = useCallback(() => {
    return fetchOwnProfile().then(setProfile).catch(() => setProfile(null));
  }, []);
  const loadClaims = useCallback(() => {
    return fetchCreditClaims().then(setClaims).catch(() => setClaims(null));
  }, []);
  const loadLedger = useCallback(() => {
    return fetchLedger().then(setLedger).catch(() => setLedger(null));
  }, []);
  const refreshBalance = useCallback(() => {
    return bootstrapUser()
      .then((user) => {
        if (user) onBalance(user.balance);
      })
      .catch(() => undefined);
  }, [onBalance]);

  useEffect(() => {
    void loadProfile();
    void loadClaims();
    void loadLedger();
  }, [loadClaims, loadLedger, loadProfile]);

  const openPlus = useCallback(() => {
    if (!subscribed) {
      onPaywall();
      return;
    }
    revenueCatService
      .presentCustomerCenter()
      .then((presented) => {
        if (!presented) setMemberSheet(true);
      })
      .catch(() => setMemberSheet(true));
  }, [onPaywall, subscribed]);

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {/* Top bar: back, the title, the balance on the right. */}
        <View style={styles.topBar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={styles.back}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>Get credits</Text>
          {/* The same object as Home's credits action, drawn by the same
              component. It was a peach `accentSoft` capsule with an accent
              number in it, which is a third face for one idea -- and a number
              in `accent` on a warm ground is the least legible thing in the
              header and also the one thing there you actually read.

              No `onPress`: this balance is a readout, not a control. It draws
              in HeaderAction's non-interactive mode, so it is announced as
              "7 credits" rather than "7 credits, button" and there is nothing
              to activate. */}
          <View testID="credits-balance">
            <HeaderAction
              icon={Sparkles}
              tint={colors.chromeStar}
              fill={colors.chromeStar}
              iconSize={16}
              value={String(credits)}
              label={`${credits} credits`}
            />
          </View>
        </View>

        <Text style={styles.section}>Paid options</Text>
        <PaidOptions subscribed={subscribed} onPlus={openPlus} onPacks={() => setPacks(true)} />

        <Text style={styles.section}>How credits work</Text>
        <HowCreditsWork />

        <Text style={styles.section}>Free credits</Text>
        <View style={styles.stack}>
          <StreakEarnCard profile={profile} onJourney={() => onJourney(profile)} />
          <FeedbackClaimsCard
            claims={claims}
            onChanged={(balance) => {
              if (balance !== null) onBalance(balance);
              else void refreshBalance();
              void loadClaims();
              void loadLedger();
            }}
          />
          <InviteCard
            code={profile?.referralCode ?? null}
            referral={profile?.referral ?? null}
            onClaimed={() => void loadProfile()}
          />
        </View>

        <Text style={styles.section}>History</Text>
        <LedgerHistory entries={ledger === undefined ? null : ledger} />
      </ScrollView>

      <CreditPacksSheet
        visible={packs}
        onClose={() => setPacks(false)}
        onPurchased={() => {
          // The webhook grants the credits; the balance is re-read from the
          // server rather than incremented here, so the number on screen is
          // never one the ledger disagrees with.
          void refreshBalance();
          void loadLedger();
        }}
      />
      <MemberSheet visible={memberSheet} onClose={() => setMemberSheet(false)} />
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
    page: { padding: spacing.xl, paddingBottom: spacing.huge },
    topBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    back: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -8,
    },
    title: { flex: 1, fontFamily: fonts.display, color: colors.ink, fontSize: 26 },
    section: {
      marginTop: spacing.betweenGroups,
      marginBottom: spacing.md,
      fontFamily: fonts.display,
      color: colors.ink,
      fontSize: 22,
    },
    stack: { gap: spacing.md },
  }),
};
