import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import { HeaderAction } from "@/components/HeaderAction";
import CreditPacksSheet from "@/components/credits/CreditPacksSheet";
import FeedbackClaimsCard from "@/components/credits/FeedbackClaimsCard";
import InviteCard from "@/components/credits/InviteCard";
import LedgerHistory from "@/components/credits/LedgerHistory";
import PaidOptions from "@/components/credits/PaidOptions";
import SecondaryActions from "@/components/credits/SecondaryActions";
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
import { markOwnProfileStale } from "@/lib/profile-store";
import { bootstrapUser } from "@/lib/session";
import { colors, fonts, spacing } from "@/theme";
import { sharedStyles } from "@/screens/shared";

/**
 * Get credits (D8, D9, D10).
 *
 * THE ORDER. Paid options, then two quiet secondary buttons, then the free
 * ways, then the history. Paid first because a plan is always the best price
 * per credit and the screen should say so before it lists the slower paths.
 *
 * WHAT MOVED, AND WHY. The prices used to be inlined here, between the paid
 * and the free sections. They now live on their own screen, because Profile
 * offered two rows -- "Credits, get more" and "How credits work" -- that both
 * opened this one, so the row promising an explanation answered with a shop.
 * The explanation is still one tap away, from the secondary button under the
 * paid options, alongside the one that jumps to the free ways. History last:
 * it is the only part that is about the past.
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
  onHowCredits,
  onBalance,
}: {
  credits: number;
  onBack: () => void;
  onPaywall: () => void;
  /** Opens Your journey, which reads the app-wide profile copy. */
  onJourney: () => void;
  /** Opens the prices, on their own screen, with nothing to buy. */
  onHowCredits: () => void;
  /** The server said the balance is now this. */
  onBalance: (balance: number) => void;
}) {
  const subscribed = useIsSubscribed();
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [claims, setClaims] = useState<CreditClaimsResult | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null | undefined>(undefined);
  const [packs, setPacks] = useState(false);
  const [memberSheet, setMemberSheet] = useState(false);
  // The Free credits heading's y within the scroll content, measured by its
  // own `onLayout` rather than guessed, because the paid options above it
  // change height between a member and a non-member.
  const scrollRef = useRef<ScrollView>(null);
  const freeSectionY = useRef(0);
  const freeHeadingRef = useRef<Text>(null);
  const scrollToFree = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(freeSectionY.current - spacing.lg, 0), animated: true });
    // A scroll is invisible to a screen reader: without this the control is
    // inert to VoiceOver and TalkBack, because the screen moved and the
    // reading cursor did not.
    //
    // ONE MECHANISM PER PLATFORM, not two everywhere. Moving focus makes the
    // screen reader speak the newly focused node, and that node is a heading
    // reading "Free credits", so pairing it with an announcement of the same
    // words either pre-empts the announcement or says it twice. Focus is the
    // better of the two on native, because it also moves the reading cursor
    // and the next swipe continues from the section rather than the button.
    //
    // WEB GETS THE ANNOUNCEMENT, and the split is on the PLATFORM rather than
    // on whether there is a node. `setAccessibilityFocus` needs a native tag
    // and does nothing on react-native-web -- but `findNodeHandle` there
    // returns the DOM node, so a `node !== null` guard passes and the
    // announcement never runs. `create/Dropdown.tsx:532` learned this and
    // guards the same call with the same check; web is also the only surface
    // this client can currently be looked at on.
    try {
      if (Platform.OS === "web") {
        AccessibilityInfo.announceForAccessibility?.("Free credits");
        return;
      }
      const node = freeHeadingRef.current
        ? findNodeHandle(freeHeadingRef.current)
        : null;
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    } catch {
      // A courtesy, and never a reason to fail the tap.
    }
  }, []);

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
    // `fresh`: this runs because credits just moved, and the kept bootstrap
    // answer is from before they did.
    // The profile's referral and streak-reward numbers can move with them.
    markOwnProfileStale();
    return bootstrapUser({ fresh: true })
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
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
          <Text accessibilityRole="header" style={styles.title}>Get credits</Text>
          {/* The same object as Home's credits action, drawn by the same
              component. It was a peach `accentSoft` capsule with an accent
              number in it, which is a third face for one idea -- and a number
              in `accent` on a warm ground is the least legible thing in the
              header and also the one thing there you actually read.

              No `onPress`: this balance is a readout, not a control. It draws
              in HeaderAction's non-interactive mode -- one accessibility node
              with `accessibilityRole="text"` -- so it is announced as
              "7 credits" rather than "7 credits, button" and there is nothing
              to activate. The spark and the number are inside that one node,
              which is why the whole reading is in `label`. */}
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

        {/* Every section heading on this screen carries the role, not just
            the one `scrollToFree` focuses. Marking one made heading navigation
            worse than marking none: the rotor found a single "Free credits"
            and no way to reach the other two. */}
        <Text accessibilityRole="header" style={styles.section}>Paid options</Text>
        <PaidOptions subscribed={subscribed} onPlus={openPlus} onPacks={() => setPacks(true)} />

        <View style={styles.secondary}>
          <SecondaryActions
            claims={claims}
            onFreeCredits={scrollToFree}
            onHowCredits={onHowCredits}
          />
        </View>

        <Text
          ref={freeHeadingRef}
          accessibilityRole="header"
          style={styles.section}
          onLayout={(event) => {
            freeSectionY.current = event.nativeEvent.layout.y;
          }}
        >
          Free credits
        </Text>
        <View style={styles.stack}>
          <StreakEarnCard profile={profile} onJourney={onJourney} />
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

        <Text accessibilityRole="header" style={styles.section}>History</Text>
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
    secondary: { marginTop: spacing.md },
  }),
};
