/**
 * The one paywall in the app: W7 of the character onboarding, and the same
 * screen the credits tab opens.
 *
 * WHAT IT REPLACES. The flow used to ship two of these: a Writer/Reader split
 * at $6.99 weekly / $49.99 yearly in `WriterOnboarding.tsx`, and a "Katha Plus"
 * screen with testimonials, star ratings and a seven-row Free-vs-Plus table.
 * Pricing collapsed the tiers on 2026-09-10: there is one product sold at three
 * durations, the same Katha in each.
 *
 * WHAT CHANGED ON 2026-09-11 (the W7 hand-off). Three things came off this
 * screen and none of them are coming back by accident:
 *
 *   - **No free trial.** The yearly card used to lead with "Start my 3-day free
 *     trial", which sells the cancel button rather than the product. The card
 *     now sells the price.
 *   - **No monthly, and no More options.** Monthly is still a real SKU
 *     (`ai.katha.sub.monthly`, `CREDITS_AND_PRICING.md` §3) and still sells
 *     in-app; it is not offered here. A disclosure triangle on the one screen a
 *     new user cannot skip past is a third decision at the worst moment.
 *   - **No progress row.** W7 is the end of the flow, not a step in it, so the
 *     only top control is the close.
 *
 * WHAT CHANGED ON 2026-09-12 (the feedback round). Two structural things:
 *
 *   - **The price is always on screen.** The plan cards and the CTA moved out
 *     of the scroll and into a pinned bottom sheet. Before this the screen was
 *     one long scroll, so on a 360pt phone with large type the user could be
 *     reading benefits with no visible price and no visible button, which is
 *     the state in which people leave. The scrolling body is padded by the
 *     sheet's MEASURED height (`onLayout`), never by a constant: the sheet
 *     grows with text scaling, and a hardcoded inset hides the last benefit row
 *     behind it at 200% type.
 *   - **"Not now" is gone.** Two dismiss controls on one screen is one too
 *     many, and the quiet one sat directly under the CTA where it competed with
 *     it. The close in the top bar is the only way out, and it is there from
 *     frame one.
 *   - **A testimonial rail.** Eight use cases in other people's words. Not star
 *     ratings and not invented reviews (the "Katha Plus" screen this replaced
 *     had both): each card names one specific way somebody uses the app. See
 *     `src/data/testimonials.ts`.
 *
 * WHAT CHANGED IN THE SECOND FEEDBACK ROUND (2026-09-12):
 *
 *   - **The rail went to the bottom.** It sat between the headline and the
 *     benefits, which put other people's habits in front of what the money
 *     actually buys. Order is now header, benefits, then the rail as the last
 *     thing in the scroll: the proof comes after the offer, not instead of it.
 *   - **The plan cards are one row each, about 92pt.** They were tall enough
 *     that the sheet ate a third of a 390pt screen. Eyebrow and price share a
 *     line, the note sits under it, and the badge is absolutely positioned so
 *     it costs no height at all.
 *   - **The yearly note is derived, never typed.** It used to read "$4.92 a
 *     month, billed yearly" as a literal, which is a second price on the
 *     screen that nothing keeps true: it survived unchanged through one
 *     pricing change already. The note is now the yearly price divided by 365,
 *     computed from the store's own number when there is an offering.
 *
 * WHAT IT PROMISES. Four rows, each one either a real grant (credits) or a real
 * unlock we ship (portraits and reimagines, voices, PDF). Never "unlimited
 * generation", "ad-free", "priority generation", testimonials or star ratings:
 * the screens this replaced promised all of those and we implement none of them.
 *
 * PRICES. The canonical prices are $5.99 weekly and $59 yearly, written here as
 * the fallback only. When RevenueCat has an offering the card renders the
 * store's own localized `priceString`, because a hardcoded dollar figure is
 * wrong for every non-US storefront (`expo/CLAUDE.md`, product integration
 * boundaries).
 *
 * GEOMETRY. Sizes, radii and colours are the hand-off's
 * (`W7-Paywall.dc.html`), and they are exact: the hand-off is pixel-signed, so
 * its 30pt gutter, 20pt card radius, 44pt close plate and 56pt CTA are named
 * tokens (`spacing.onboardingGutter`, `radius.onboardingCard`,
 * `controls.onboardingPlate`, `controls.onboardingCtaHeight`) rather than the
 * nearest step on the general scale. Rounding each of them to a neighbour is
 * how a signed design arrives two points off in four places at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TestimonialRail } from "@/components/onboarding/TestimonialRail";
import { revenueCatService, type RevenueCatPaywallProduct } from "@/lib/revenuecat";
import {
  colors,
  controls,
  fonts,
  IconCheck,
  IconClose,
  motion,
  radius,
  shadows,
  spacing,
} from "@/theme";

export type OnboardingPaywallPurpose = "read" | "write" | "both";

export type OnboardingPaywallProps = {
  /**
   * The character made four screens ago. Empty from the in-app entry, which
   * has no character and says so in its copy.
   */
  characterName: string;
  /** Their portrait. An empty stone card when null. */
  portraitUrl?: string | null;
  /** Which voice the copy takes. `read` and `both` are both the reader's. */
  purpose: OnboardingPaywallPurpose;
  /**
   * A real purchase completed, or a simulated one off-store.
   *
   * It hands back WHAT WAS BOUGHT, not just the fact of it, because the next
   * screen but one is the welcome animation and the number of credits it
   * counts up to is the plan's grant. Passing only a boolean meant the welcome
   * screen showed the free grant of three to somebody who had just paid for
   * fifty, which reads as the purchase not having registered.
   */
  onSubscribed: (grant: OnboardingSubscriptionGrant) => void;
  /** The close in the top bar, which is the only way out and is there from frame one. */
  onDismiss: () => void;
};

export type OnboardingPlanId = "weekly" | "yearly";

/** What a completed purchase grants, handed to the caller by `onSubscribed`. */
export type OnboardingSubscriptionGrant = {
  credits: number;
  plan: OnboardingPlanId;
};

type PlanId = OnboardingPlanId;

type Plan = {
  id: PlanId;
  eyebrow: string;
  /**
   * The plan's credit grant, and the ONE place either number is written down.
   *
   * Both the note on the weekly card and the first benefit row are rendered
   * from here, and so is the welcome animation's count-up, which reaches this
   * through `onSubscribed`. The figure used to be typed out as prose in each
   * of those places, which is three copies of a pricing decision and two of
   * them silently wrong the first time it changes.
   */
  credits: number;
  /** Canonical price, used until the store hands over a localized one. */
  fallbackPrice: string;
  /**
   * The same figure as a number, for notes computed from the price. Kept
   * beside `fallbackPrice` rather than parsed out of it: the string is a
   * display form ("$59", not "$59.00") and a parser for it is a parser for
   * every storefront's display form, which is exactly what `product.price`
   * exists to save us from.
   */
  fallbackAmount?: number;
  /** The unit, set beside the price at body size. */
  period: string;
  /**
   * The line under the price, when it is a claim about the grant rather than
   * about the price. Written as a function of `credits` so the card cannot
   * disagree with the number the rest of the flow uses. The yearly card has
   * none: its note is derived from the price (`dailyNote`), because a typed-out
   * second figure is a figure nothing keeps in step.
   */
  note?: (credits: number) => string;
  /**
   * RevenueCat's `PackageType`, as a plain string.
   *
   * NOT the `PACKAGE_TYPE` enum. Importing a *value* from
   * `react-native-purchases` pulls the native module into every Jest suite that
   * renders this screen, and the module throws at import under the test
   * runtime. The type is a string enum, so comparing the string is the same
   * comparison without the import.
   */
  packageType: string;
  badge?: string;
};

const PLANS: Record<PlanId, Plan> = {
  weekly: {
    id: "weekly",
    eyebrow: "WEEKLY",
    fallbackPrice: "$5.99",
    period: "/wk",
    credits: 20,
    note: (credits) => `${credits} credits a week`,
    packageType: "WEEKLY",
  },
  yearly: {
    id: "yearly",
    eyebrow: "YEARLY",
    fallbackPrice: "$59",
    credits: 50,
    fallbackAmount: 59,
    period: "/yr",
    packageType: "ANNUAL",
    /**
     * Weekly annualises to $311.48 against $59 (`CREDITS_AND_PRICING.md` §3),
     * which is 81%. The claim is the weekly-vs-yearly comparison, rounded
     * down, and it is the only discount claim on the screen.
     */
    badge: "SAVE 80%",
  },
};

/**
 * "$0.16 a day" from $59 a year.
 *
 * WHY IT IS COMPUTED. The card used to carry "$4.92 a month, billed yearly" as
 * a literal string, and a literal is a second price that no pricing change
 * touches: it outlived one already. Divide the real number by 365 and the note
 * cannot disagree with the price above it.
 *
 * WHY THE SYMBOL COMES OUT OF `priceString`. RevenueCat gives us the amount as
 * a number and the currency only as part of the store's formatted string, so
 * the symbol is whatever is left of that string once the digits and the
 * separators are gone, placed on the side it was already on. A Japanese
 * storefront reading "¥8800" keeps its ¥ in front; a French one reading
 * "59,00 €" keeps its € behind. Two decimal places regardless: this is a
 * comparison, not a charge, and it is never the figure anybody is billed.
 */
function dailyNote(amount: number, priceString: string): string {
  const perDay = (amount / 365).toFixed(2);
  const symbol = priceString.replace(/[\d\s.,\u00A0\u202F]/g, "").trim();
  if (!symbol) return `${perDay} a day`;
  const leading = priceString.trimStart().startsWith(symbol);
  return leading ? `${symbol}${perDay} a day` : `${perDay}${symbol} a day`;
}

const CTA_LABEL = "Unlock Katha";
const PURCHASE_ERROR = "Purchase didn't go through. Try again.";

type BenefitRow = { emoji: string; lead: string; body: string };

/**
 * The copy, which is the whole difference between the three entries.
 *
 * The emoji are content, not icons: the hand-off draws them, and an Ionicon in
 * their place makes the card read as a settings list instead of a list of
 * things you get.
 */
function copyFor(name: string, purpose: OnboardingPaywallPurpose) {
  const reader = purpose !== "write";
  const named = name.trim();

  // The in-app entry (Home, Credits) has no character to promise anything
  // about, so the promises are made about the user's own, in the plural.
  const heading = named
    ? reader
      ? `${named} is ready. Step into the story.`
      : `${named} is ready. Give them a story.`
    : "Katha is ready when you are.";
  const voiceLine = named
    ? reader ? "Hear your story read aloud" : `Hear ${named}'s story read aloud`
    : "Hear your stories read aloud";
  const portraitLine = named
    ? `${named} looks the same in every chapter`
    : "Your characters look the same in every chapter";

  const rows: BenefitRow[] = [
    {
      emoji: "✨",
      lead: `${PLANS.yearly.credits} credits a month`,
      body: "About 16 full chapters, every month",
    },
    {
      emoji: "🎨",
      lead: "Unlimited portraits and reimagines",
      body: portraitLine,
    },
    { emoji: "🎙️", lead: "Premium voices", body: voiceLine },
    {
      emoji: "📄",
      lead: "Download as PDF",
      body: "Your stories, off the app and in your hands",
    },
  ];

  return { heading, rows };
}

export function OnboardingPaywall({
  characterName,
  portraitUrl = null,
  purpose,
  onSubscribed,
  onDismiss,
}: OnboardingPaywallProps) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<PlanId>("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<RevenueCatPaywallProduct[] | null>(null);
  /**
   * How far the body has to stop short of the bottom.
   *
   * Measured, because the sheet holds two cards of text that grow with the
   * system type size. Starts at zero: the first frame is one layout pass early
   * and the scroll corrects itself on the next.
   */
  const [sheetHeight, setSheetHeight] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Localized prices if the store has any. A failure here is not an error the
  // user needs: the canonical prices stand and the purchase path simulates.
  useEffect(() => {
    let cancelled = false;
    revenueCatService
      .getOfferings()
      .then((offerings) => {
        if (cancelled) return;
        setPackages(offerings?.current?.availablePackages ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const priceFor = useCallback(
    (plan: Plan) => {
      const match = packages?.find(
        (candidate) => String(candidate.packageType) === plan.packageType,
      );
      return match?.product.priceString ?? plan.fallbackPrice;
    },
    [packages],
  );

  /**
   * The line under the price. Fixed for weekly, derived for yearly, and
   * derived from the STORE's number when there is one, so a non-US storefront
   * gets its own currency in its own daily figure rather than ours.
   */
  const noteFor = useCallback(
    (plan: Plan) => {
      if (plan.note) return plan.note(plan.credits);
      const match = packages?.find(
        (candidate) => String(candidate.packageType) === plan.packageType,
      );
      const amount = match?.product.price ?? plan.fallbackAmount ?? 0;
      return dailyNote(amount, match?.product.priceString ?? plan.fallbackPrice);
    },
    [packages],
  );

  const { heading, rows } = useMemo(
    () => copyFor(characterName, purpose),
    [characterName, purpose],
  );

  const choose = useCallback((plan: PlanId) => {
    setSelected(plan);
    setError(null);
  }, []);

  const purchase = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const plan = PLANS[selected];
    try {
      const offerings = await revenueCatService.getOfferings();
      const pkg = offerings?.current?.availablePackages.find(
        (candidate) => String(candidate.packageType) === plan.packageType,
      );
      if (!pkg) {
        // No package came back: web, or a build with no RevenueCat
        // configuration yet. In development and on web the flow still has to
        // be walkable end to end for review, so it completes off-store after
        // one beat rather than dead-ending on a button that does nothing.
        //
        // In a shipped native build it does NOT. A missing package there means
        // the store lookup failed, and granting the entitlement on that path
        // would hand premium to every user whose offerings request errored --
        // no purchase, no receipt, nothing for the backend to verify. That is
        // a retryable failure, so it says so.
        if (__DEV__ || Platform.OS === "web") {
          await new Promise((resolve) => setTimeout(resolve, motion.slow));
          if (!mounted.current) return;
          onSubscribed({ credits: plan.credits, plan: plan.id });
          return;
        }
        if (mounted.current) setError(PURCHASE_ERROR);
        return;
      }
      const profile = await revenueCatService.purchasePackage(pkg);
      if (!mounted.current) return;
      // A cancel resolves with null rather than throwing, and it is a cancel
      // even for someone who was already premium: reading `isPremium` here
      // would grant that person a plan they just declined to buy. No error
      // line for a cancel: the user knows what they just did.
      if (profile === null) return;
      if (revenueCatService.isPremium) {
        onSubscribed({ credits: plan.credits, plan: plan.id });
      }
    } catch {
      if (mounted.current) setError(PURCHASE_ERROR);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, onSubscribed, selected]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          style={styles.closeTile}
        >
          <IconClose size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView
        // `flex: 1` explicitly: without it the scroll view sizes to its content
        // and pushes the pinned sheet off the bottom of a long screen.
        style={styles.body}
        contentContainerStyle={[
          styles.scroll,
          // The sheet's measured height, not a constant: see the header note.
          { paddingBottom: sheetHeight + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.portraitFrame}>
            {portraitUrl
              ? (
                <Image
                  source={{ uri: portraitUrl }}
                  resizeMode="cover"
                  style={styles.portraitImage}
                  accessible
                  accessibilityLabel={`Portrait of ${characterName}`}
                />
              )
              : null}
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.heading} accessibilityRole="header">
              {heading}
            </Text>
            <Text style={styles.sub}>Unlock Katha and start writing tonight.</Text>
          </View>
        </View>

        <View style={styles.benefits}>
          {rows.map((row, index) => (
            <View
              key={row.lead}
              style={[
                styles.benefitRow,
                index < rows.length - 1 && styles.benefitRowDivided,
              ]}
            >
              <Text style={styles.benefitEmoji}>{row.emoji}</Text>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitLead}>{row.lead}</Text>
                <Text style={styles.benefitBody}>{row.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/*
          Last in the scroll, and full bleed. Last because the proof follows
          the offer: a screen that opens with other people's habits has not yet
          said what it is selling. Full bleed because the rail is the one
          element here that must look like it continues past the edge, which is
          what says there are more than the one and a half cards a 390pt screen
          can hold.
        */}
        <View style={styles.rail}>
          <TestimonialRail />
        </View>
      </ScrollView>

      {/*
        The sheet. Pinned so the price and the button are never scrolled off:
        the decision this screen asks for cannot be made from a screenful of
        benefits with no figure on it.
      */}
      <View
        style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
      >
        <View style={styles.planRow}>
          <PlanCard
            plan={PLANS.weekly}
            price={priceFor(PLANS.weekly)}
            note={noteFor(PLANS.weekly)}
            selected={selected === "weekly"}
            onPress={() => choose("weekly")}
          />
          <PlanCard
            plan={PLANS.yearly}
            price={priceFor(PLANS.yearly)}
            note={noteFor(PLANS.yearly)}
            selected={selected === "yearly"}
            onPress={() => choose("yearly")}
          />
        </View>

        <View style={styles.cancelLine}>
          <IconCheck size={14} color={colors.onboardingSuccess} />
          <Text style={styles.cancelText}>Cancel anytime, no commitments</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={purchase}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={CTA_LABEL}
          accessibilityState={{ disabled: busy, busy }}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
            busy && styles.primaryDisabled,
          ]}
        >
          <Text style={styles.primaryText}>{CTA_LABEL}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One duration, in about 92 points.
 *
 * THE SHAPE. Eyebrow and price share one line, the note goes under it. The
 * card used to stack a badge, an eyebrow, a 30pt price and a note in four rows,
 * which made the pinned sheet a third of a 390pt screen and pushed the benefits
 * out of the first viewport on every phone.
 *
 * THE BADGE IS ABSOLUTE. Top left, straddling the border. In the flow it cost
 * a row on the yearly card and an invisible spacer of exactly the same height
 * on the weekly one, only so the two prices would line up; out of the flow it
 * costs neither card anything and nothing has to be kept in sync.
 *
 * `flex: 1`, never a width. Two fixed-width cards that fit a 390pt screen wrap
 * their price onto a second line at 360, and the price is the one thing on the
 * card that must survive the narrowest phone — hence `adjustsFontSizeToFit`
 * over a single line rather than a smaller type size for everybody.
 */
function PlanCard({
  plan,
  price,
  note,
  selected,
  onPress,
}: {
  plan: Plan;
  price: string;
  note: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${plan.eyebrow.toLowerCase()}, ${price} ${plan.period}, ${note}`}
      style={[styles.planCard, selected && styles.planCardSelected]}
    >
      {plan.badge
        ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{plan.badge}</Text>
          </View>
        )
        : null}
      <View style={styles.planHead}>
        <View style={styles.planEyebrowGroup}>
          <Text style={[styles.planEyebrow, plan.badge && styles.planEyebrowBadged]}>
            {plan.eyebrow}
          </Text>
          {selected ? <IconCheck size={12} color={colors.accent} /> : null}
        </View>
        <Text
          style={styles.planPrice}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {price}
          <Text style={styles.planPeriod}>{` ${plan.period}`}</Text>
        </Text>
      </View>
      <Text style={styles.planNote} numberOfLines={2}>{note}</Text>
    </Pressable>
  );
}

/** The hand-off's 104 x 134 portrait, and the 56pt CTA pill it pins at the bottom. */
const PORTRAIT_WIDTH = 104;
const PORTRAIT_HEIGHT = 134;
/**
 * The compact plan card. A floor rather than a height: at 200% system type the
 * eyebrow, the price and the note all grow, and a fixed 92 would clip the note
 * off the bottom of the only element on the screen carrying the price.
 */
const PLAN_CARD_MIN_HEIGHT = 92;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.onboardingBg },
  topBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    alignItems: "flex-end",
  },
  closeTile: {
    width: controls.onboardingPlate,
    height: controls.onboardingPlate,
    borderRadius: controls.onboardingPlateRadius,
    backgroundColor: colors.onboardingPlate,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.onboardingGutter,
    paddingTop: spacing.xs,
  },
  header: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  portraitFrame: {
    width: PORTRAIT_WIDTH,
    height: PORTRAIT_HEIGHT,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.onboardingStone,
    borderWidth: 3,
    borderColor: colors.surface,
    boxShadow: shadows.onboardingChip,
  },
  portraitImage: { width: "100%", height: "100%" },
  headerCopy: { flex: 1, minWidth: 0, paddingTop: spacing.xs },
  heading: {
    fontFamily: fonts.display,
    fontWeight: "700",
    fontSize: 25,
    lineHeight: 27.5,
    color: colors.ink,
  },
  sub: {
    fontFamily: fonts.ui,
    fontSize: 13.5,
    lineHeight: 19.5,
    color: colors.muted,
    marginTop: spacing.related,
  },
  rail: {
    marginTop: spacing.xl,
    marginHorizontal: -spacing.onboardingGutter,
  },
  benefits: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.onboardingBorder,
    borderRadius: radius.onboardingCard,
    paddingHorizontal: spacing.lg,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  benefitRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: colors.onboardingPlate,
  },
  benefitEmoji: { fontSize: 20, lineHeight: 24 },
  benefitCopy: { flex: 1 },
  benefitLead: {
    fontFamily: fonts.ui,
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 19,
    color: colors.ink,
  },
  benefitBody: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.muted,
    marginTop: spacing.tight,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.onboardingBorder,
    boxShadow: shadows.overlay,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  planRow: { flexDirection: "row", gap: spacing.md, alignItems: "stretch" },
  planCard: {
    flex: 1,
    minHeight: PLAN_CARD_MIN_HEIGHT,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.onboardingBorder,
    borderRadius: radius.onboardingCard,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  planCardSelected: {
    backgroundColor: colors.accentSoft,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  /** Out of the flow, straddling the top border: see the `PlanCard` note. */
  badge: {
    position: "absolute",
    top: -spacing.sm,
    left: spacing.md,
    backgroundColor: colors.premium,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.tight,
  },
  badgeText: {
    fontFamily: fonts.ui,
    fontWeight: "800",
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1,
    color: colors.surface,
  },
  planHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  /** Never shrinks: the price is what gives way on a narrow card, not the label. */
  planEyebrowGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 0,
  },
  planEyebrow: {
    fontFamily: fonts.ui,
    fontWeight: "800",
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 1.6,
    color: colors.tertiary,
  },
  /** The yearly eyebrow carries the badge's colour, so the card reads as one block. */
  planEyebrowBadged: { color: colors.premium },
  planPrice: {
    fontFamily: fonts.display,
    fontWeight: "700",
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
    // Shrinking is what gives `adjustsFontSizeToFit` a bounded width to fit
    // into; without it the price lays out at its natural width and pushes the
    // eyebrow off a 360pt card instead of scaling down.
    flexShrink: 1,
    textAlign: "right",
  },
  planPeriod: {
    fontFamily: fonts.ui,
    fontWeight: "600",
    fontSize: 12,
    color: colors.muted,
  },
  planNote: {
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  cancelLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cancelText: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.muted,
  },
  error: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.accentPressed,
    textAlign: "center",
    marginTop: spacing.md,
  },
  primary: {
    marginTop: spacing.md,
    height: controls.onboardingCtaHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.onboardingCta,
  },
  primaryPressed: { backgroundColor: colors.accentPressed },
  primaryDisabled: { opacity: 0.4 },
  primaryText: {
    fontFamily: fonts.ui,
    fontWeight: "700",
    fontSize: 17,
    lineHeight: 22,
    color: colors.surface,
  },
});

export default OnboardingPaywall;
