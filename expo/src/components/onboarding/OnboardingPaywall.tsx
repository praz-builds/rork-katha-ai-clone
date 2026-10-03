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
 *   - **No free trial.** *(Reversed 2026-10-03: yearly offers a 3-day trial
 *     again, shown only when the store reports one the account can take --
 *     see the 2026-10-03 note below.)*
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
 *     the state in which people leave. The sheet is laid out BELOW the scroll
 *     view (a flex sibling, not an overlay), so the scroll needs only its own
 *     end padding. *(Until 2026-10-03 it also added the sheet's measured
 *     height, which counted the sheet twice and left a blank band.)*
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
 * WHAT CHANGED ON 2026-10-03 (founder feedback). The per-day cost leads each
 * card (`perDayPrice`), with the period price under it. Yearly carries a
 * 3-day free trial when Play reports an eligible offer (`advertisableTrial`),
 * and the button says so; a tap never buys the base plan behind that label.
 * The terms line moved to fine print under the links (it must stay on the
 * screen for Play's policy). The benefit lines speak to the person, from the
 * onboarding answers, not to the character.
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
 * its 30pt gutter, 20pt card radius and 44pt close plate are named tokens
 * (`spacing.onboardingGutter`, `radius.onboardingCard`,
 * `controls.onboardingPlate`) rather than the nearest step on the general
 * scale. Rounding each of them to a neighbour is how a signed design arrives
 * two points off in four places at once. The one exception is the CTA: the
 * hand-off drew it at 56, and it is now the app's single 52pt `Button`
 * (`controls.onboardingCtaHeight` is an alias of `controls.primaryCtaHeight`),
 * because one button across the whole app beats four points of a signed
 * height on one screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TestimonialRail } from "@/components/onboarding/TestimonialRail";
import { PLAN_FACTS } from "@/components/profile/MemberSheet";
import i18n from "@/i18n";
import { useIsSubscribed } from "@/lib/entitlements";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal-links";
import {
  revenueCatService,
  type RevenueCatPaywallProduct,
  type RevenueCatUnavailableReason,
} from "@/lib/revenuecat";
import {
  freeTrialOption,
  manageSubscriptionsUrl,
  STORE_SUBSCRIPTIONS,
  subscriptionPackages,
  trialDays,
} from "@/lib/store-catalog";
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
import { Button } from "@/components/Button";

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
   * What the person told onboarding, so the benefit lines speak to it: their
   * genres, when they read, and how. Absent from the in-app entry (Home,
   * Credits), which then says the general thing.
   */
  personalization?: PaywallPersonalization;
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

/** The onboarding answers the paywall copy reads. All optional. */
export type PaywallPersonalization = {
  /** Genre labels in the order they were tapped, e.g. ["Romance", "Fantasy"]. */
  genres?: readonly string[];
  /** Moment keys: the reader's sleep/commute/breaks/weekend/whenever, and `unwind` (both). */
  moment?: readonly string[];
  /** The refine answer keys; `listen` means audio matters to them. */
  refine?: readonly string[];
};

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
  /** The unit, set beside the period price on the card's second line. */
  period: string;
  /** Days the price covers, for the per-day figure that leads the card. */
  days: number;
  /** The grant period as the benefit row's lead states it ("a week", "a month"). */
  grantPeriod: string;
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

/** The RevenueCat package type the store catalogue assigns a plan. */
function packageTypeFor(plan: PlanId): string {
  const match = STORE_SUBSCRIPTIONS.find((subscription) => subscription.plan === plan);
  if (!match) throw new Error(`No store subscription for ${plan}`);
  return match.packageType;
}

const PLANS: Record<PlanId, Plan> = {
  weekly: {
    id: "weekly",
    eyebrow: "WEEKLY",
    fallbackPrice: "$5.99",
    fallbackAmount: 5.99,
    period: "/wk",
    days: 7,
    credits: 20,
    grantPeriod: "a week",
    packageType: packageTypeFor("weekly"),
  },
  yearly: {
    id: "yearly",
    eyebrow: "YEARLY",
    fallbackPrice: "$59",
    credits: 50,
    fallbackAmount: 59,
    period: "/yr",
    days: 365,
    grantPeriod: "a month",
    packageType: packageTypeFor("yearly"),
    /**
     * Weekly annualises to $311.48 against $59 (`CREDITS_AND_PRICING.md` §3),
     * which is 81%. The claim is the weekly-vs-yearly comparison, rounded
     * down, and it is the only discount claim on the screen.
     */
    badge: "SAVE 80%",
  },
};

/**
 * "$0.16" from $59 a year, "$0.86" from $5.99 a week: the figure that LEADS
 * each card since 2026-10-03 (founder feedback: highlight the per-day cost,
 * the period price underneath).
 *
 * WHY IT IS COMPUTED. A typed-out daily figure is a second price no pricing
 * change touches; "$4.92 a month, billed yearly" outlived one change already.
 * Divide the real number and the card cannot disagree with itself.
 *
 * WHY THE SYMBOL COMES OUT OF `priceString`. RevenueCat gives the amount as a
 * number and the currency only inside the store's formatted string, so the
 * symbol is what is left once digits and separators are gone, kept on the side
 * it was on: "¥8800" keeps ¥ in front, "59,00 €" keeps € behind. Two decimals
 * regardless: it is a comparison, never the figure anybody is billed.
 */
export function perDayPrice(amount: number, priceString: string, days: number): string {
  const perDay = (amount / days).toFixed(2);
  const symbol = priceString.replace(/[\d\s.,\u00A0\u202F]/g, "").trim();
  if (!symbol) return perDay;
  const leading = priceString.trimStart().startsWith(symbol);
  return leading ? `${symbol}${perDay}` : `${perDay}${symbol}`;
}

/**
 * The trial the yearly card offers. Three days is the store configuration
 * (`CREDITS_AND_PRICING.md` §3, *The 3-day trial*); with a store, its own
 * reported period is what the card states. The fallback is only for the
 * off-store review render (web, development). Ten credits is what the backend grants for a
 * TRIAL period (`_shared/revenuecat.ts` `trialCredits`); the plan's full grant
 * lands with the first charge.
 */
const TRIAL_DAYS_FALLBACK = 3;
export const TRIAL_CREDITS = 10;

/**
 * The trial this package can honestly be advertised with, in days, or null.
 *
 * Null when Play reports no eligible free-trial offer, AND whenever the
 * screen cannot state its length truthfully: a period in months or years, no
 * period at all, or a single day (the copy is plural). Advertising "3 days
 * free" for an offer of another length misstates a store term, and an
 * unadvertised trial is simply not bought -- the base plan is.
 */
function advertisableTrial(
  pkg: Parameters<typeof freeTrialOption>[0],
): number | null {
  const option = freeTrialOption(pkg);
  if (!option) return null;
  const days = trialDays(option.freePhase?.billingPeriod?.iso8601);
  return days !== null && days >= 2 ? days : null;
}

const CTA_LABEL = "Unlock Katha";
const trialCtaLabel = (days: number) => i18n.t("paywall.trialCta", { days });
const PURCHASE_ERROR = "Purchase didn't go through. Try again.";

/**
 * The Subscriptions-policy lines, in the device's language (EN/PT/ES).
 *
 * Google Play requires the paywall itself to say what is charged and how
 * often, that it renews on its own, and how to cancel -- next to the button,
 * not behind a link. These are the only strings on this screen that go
 * through i18n today: the rest of the screen is English until the app's
 * i18n pass, but a policy disclosure a Portuguese speaker cannot read is not
 * a disclosure.
 */
export function renewalLine(plan: PlanId, price: string): string {
  return i18n.t(`paywall.renews.${plan}`, { price });
}

/** The yearly trial's terms: how long, what it grants, what it costs after. */
export function trialLine(days: number, price: string): string {
  return i18n.t("paywall.renews.yearlyTrial", { days, credits: TRIAL_CREDITS, price });
}

export function cancelLine(platform: string = Platform.OS): string {
  const key = platform === "android" ? "android" : platform === "ios" ? "ios" : "other";
  return i18n.t(`paywall.cancel.${key}`);
}

/**
 * The service's reason, read defensively: a service (or a test double) that
 * does not report one is treated as having no key, the conservative answer.
 */
function storeUnavailableReason(): RevenueCatUnavailableReason {
  return revenueCatService.unavailableReason ?? "no-key";
}

/** Web cannot open a store's subscription page for an app it is not running in. */
const WEB_MANAGE_NOTICE = "Manage or cancel from the store you subscribed on.";

/** The store's own subscriptions page, for the active Katha plan when there is one. */
function openStoreSubscriptions(): Promise<unknown> {
  const active = revenueCatService.profile?.activeSubscriptions?.[0] ?? null;
  return Linking.openURL(manageSubscriptionsUrl(Platform.OS, active));
}

type BenefitRow = { emoji: string; lead: string; body: string };

/**
 * "romance and fantasy" from the genres somebody tapped: the first two, in
 * the order they were picked, lower-cased the way a sentence carries them.
 */
function genrePhrase(genres: readonly string[] | undefined): string | null {
  const picked = (genres ?? []).map((genre) => genre.trim()).filter(Boolean).slice(0, 2);
  if (!picked.length) return null;
  return picked.map((genre) => genre.toLowerCase()).join(" and ");
}

/**
 * The voices line, said for the moment they told us they read in. Premium
 * voices are a listening feature, so the line meets them where they listen.
 */
function voiceLine(personalization: PaywallPersonalization | undefined): string {
  const moment = personalization?.moment ?? [];
  if (moment.includes("sleep")) return "Fall asleep to stories read aloud";
  if (moment.includes("commute")) return "Stories read aloud on your commute";
  if (moment.includes("breaks")) return "A chapter read aloud on a short break";
  if (moment.includes("weekend")) return "Long weekend stories, read aloud";
  // `unwind` is the "both" path's moment ("Listen, then unwind"); `listen` is
  // the reader's refine answer ("Listening to audio"). Writers' moments
  // (draft, voice, chapters, publish) say nothing about listening.
  const refine = personalization?.refine ?? [];
  if (moment.includes("unwind") || refine.includes("listen")) {
    return "Listen without looking at a screen";
  }
  return "Hear stories read aloud";
}

/**
 * The copy: the heading speaks to the character when there is one, and the
 * benefit lines speak to the PERSON, from what they told onboarding.
 *
 * 2026-10-03 (founder feedback): the benefit lines used to be about the
 * character ("Raya looks the same in every chapter", "with you as the lead"),
 * but a subscription is not about one character -- people write and read
 * stories with no character at all. The lines now describe what the plan
 * does for any story, and personalise from the answers instead: the genres
 * they picked, when they read, whether they listen. The credits row follows
 * the SELECTED plan, which is why the weekly card no longer repeats its grant.
 *
 * The emoji are content, not icons: the hand-off draws them, and an Ionicon in
 * their place makes the card read as a settings list.
 */
export function copyFor(
  name: string,
  purpose: OnboardingPaywallPurpose,
  plan: Plan,
  personalization?: PaywallPersonalization,
) {
  const reader = purpose !== "write";
  const named = name.trim();

  const heading = named
    ? reader
      ? `${named} is ready. Step into the story.`
      : `${named} is ready. Give them a story.`
    : "Katha is ready when you are.";
  // A reader came to read; "Start writing tonight" is the writer's line. The
  // in-app entry has no onboarding purpose to speak in, so it names neither.
  const sub = !named
    ? "Unlock Katha and start tonight."
    : reader
    ? "Unlock Katha and start reading tonight."
    : "Unlock Katha and start writing tonight.";

  // A chapter is 1 credit (2 with art): `CREDITS_AND_PRICING.md` §1, *Every
  // price, in one place*. So the grant is "up to" that many chapters -- the
  // "about 16" this line used to say came from a retired price and undersold
  // the plan threefold. ALWAYS PER MONTH: weekly's 20 a week is ~86 a month,
  // and a per-week figure beside yearly's monthly one read as weekly giving
  // less when it gives more. The yearly lead already says "a month".
  const monthlyCredits = plan.id === "weekly" ? (plan.credits * 52) / 12 : plan.credits;
  const chapters = Math.floor(monthlyCredits);
  const genres = genrePhrase(personalization?.genres);
  const per = plan.id === "weekly" ? " a month" : "";
  const creditsLine = genres
    ? `Up to ${chapters} chapters of ${genres}${per}`
    : `Up to ${chapters} new chapters${per}`;

  const rows: BenefitRow[] = [
    {
      emoji: "✨",
      lead: `${plan.credits} credits ${plan.grantPeriod}`,
      body: creditsLine,
    },
    {
      emoji: "🎨",
      lead: "Unlimited portraits and reimagines",
      body: "Give any character a face, or take a chapter another way",
    },
    { emoji: "🎙️", lead: "Premium voices", body: voiceLine(personalization) },
    {
      emoji: "📄",
      lead: "Download as PDF",
      body: "Your stories as a file to print or share",
    },
  ];

  return { heading, sub, rows };
}

export function OnboardingPaywall({
  characterName,
  portraitUrl = null,
  purpose,
  personalization,
  onSubscribed,
  onDismiss,
}: OnboardingPaywallProps) {
  const subscribed = useIsSubscribed();
  if (subscribed) return <MemberState onDismiss={onDismiss} />;
  return (
    <PaywallOffer
      characterName={characterName}
      portraitUrl={portraitUrl}
      purpose={purpose}
      personalization={personalization}
      onSubscribed={onSubscribed}
      onDismiss={onDismiss}
    />
  );
}

/**
 * The member state (D7).
 *
 * A subscriber who reaches the paywall -- from Credits, from Home, or a
 * tester account holding the entitlement override -- is shown that they have
 * the plan, not a screen selling it to them. The four facts are the offer's
 * four rows, so what a member reads here is what they read when they bought.
 * "Manage subscription" opens the Customer Center where it exists; on web and
 * in an unconfigured build it cannot, and the line under the facts says
 * where the store keeps it instead.
 */
function MemberState({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<string | null>(null);
  const manage = useCallback(() => {
    // The store's own page is the fallback for BOTH failures: Customer Center
    // not presentable (SDK unconfigured) and Customer Center throwing (it is
    // optional in the dashboard). A member must always have a working way to
    // manage or cancel -- Play's Subscriptions policy requires it.
    const fallBack = () => {
      if (Platform.OS === "web") {
        setNotice(WEB_MANAGE_NOTICE);
        return;
      }
      openStoreSubscriptions().catch(() =>
        setNotice("Subscription management is not available right now.")
      );
    };
    revenueCatService
      .presentCustomerCenter()
      .then((presented) => {
        if (!presented) fallBack();
      })
      .catch(fallBack);
  }, []);

  return (
    <View
      style={[styles.screen, { paddingTop: insets.top }]}
      testID="paywall-member-state"
    >
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
        style={styles.body}
        contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xl + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.heading} accessibilityRole="header">
            You're a Katha member
          </Text>
          <Text style={styles.sub}>Your plan is active. Here is what it includes.</Text>
        </View>
        <View style={styles.benefits}>
          {PLAN_FACTS.map((fact, index) => (
            <View
              key={fact}
              style={[
                styles.benefitRow,
                index < PLAN_FACTS.length - 1 && styles.benefitRowDivided,
              ]}
            >
              <IconCheck size={16} color={colors.accent} />
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitLead}>{fact}</Text>
              </View>
            </View>
          ))}
        </View>
        {notice ? <Text style={styles.memberNotice}>{notice}</Text> : null}
        <Button
          label="Manage subscription"
          onPress={manage}
          style={styles.primary}
        />
      </ScrollView>
    </View>
  );
}

function PaywallOffer({
  characterName,
  portraitUrl = null,
  purpose,
  personalization,
  onSubscribed,
  onDismiss,
}: OnboardingPaywallProps) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<PlanId>("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<RevenueCatPaywallProduct[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Whether the store can be talked to. Read live, because RevenueCat
   * configures asynchronously at app start and this screen can mount first.
   */
  const [storeAvailable, setStoreAvailable] = useState(() =>
    Boolean(revenueCatService.isAvailable)
  );
  const [storeReason, setStoreReason] = useState(storeUnavailableReason);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = revenueCatService.subscribe(() => {
      if (!mounted.current) return;
      setStoreAvailable(Boolean(revenueCatService.isAvailable));
      setStoreReason(storeUnavailableReason());
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  /**
   * Why a shipped native build cannot sell, split by whether trying again
   * can help (Development and web keep the off-store walk-through below):
   *
   *   - `storeMissing`: the build has no RevenueCat key. Nothing a user does
   *     changes that, so the button is disabled and the screen says so,
   *     instead of letting every tap fail with "Try again".
   *   - `storeOffline`: the key is there but the SDK did not start. That is
   *     the network, not the version, so the copy says so and a tap retries.
   */
  const releaseNative = !__DEV__ && Platform.OS !== "web";
  const storeMissing = releaseNative && !storeAvailable && storeReason === "no-key";
  const storeOffline = releaseNative && !storeAvailable && storeReason === "failed";

  // Localized prices if the store has any. A failure here is not an error the
  // user needs: the canonical prices stand and the purchase path simulates.
  useEffect(() => {
    let cancelled = false;
    revenueCatService
      .getOfferings()
      .then((offerings) => {
        if (cancelled) return;
        setPackages(subscriptionPackages(offerings));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeAvailable]);

  const packageFor = useCallback(
    (plan: Plan) =>
      packages?.find((candidate) => String(candidate.packageType) === plan.packageType) ??
        null,
    [packages],
  );

  /** The period price as the store formats it, or the canonical fallback. */
  const priceFor = useCallback(
    (plan: Plan) => packageFor(plan)?.product.priceString ?? plan.fallbackPrice,
    [packageFor],
  );

  /**
   * The per-day figure that leads each card, from the STORE's number when there
   * is one, so a non-US storefront gets its own currency in it.
   */
  const perDayFor = useCallback(
    (plan: Plan) => {
      const match = packageFor(plan);
      const amount = match?.product.price ?? plan.fallbackAmount ?? 0;
      return perDayPrice(amount, match?.product.priceString ?? plan.fallbackPrice, plan.days);
    },
    [packageFor],
  );

  /**
   * The yearly free trial, in days, or null when there is none to offer.
   *
   * With a store: only when Google Play reports a free-trial offer this account
   * is eligible for -- a user who already had one is shown the price, never a
   * trial the store will not give them. Without one (web, development) the
   * trial is shown so the design can be reviewed, and the off-store purchase
   * simulates it. A shipped native build with no offerings shows no trial: a
   * claim the store cannot back is worse than no claim.
   */
  const yearlyTrialDays = useMemo((): number | null => {
    const yearly = packageFor(PLANS.yearly);
    if (yearly) return advertisableTrial(yearly);
    return releaseNative ? null : TRIAL_DAYS_FALLBACK;
  }, [packageFor, releaseNative]);
  const trialDaysSelected = selected === "yearly" ? yearlyTrialDays : null;


  const { heading, sub, rows } = useMemo(
    () => copyFor(characterName, purpose, PLANS[selected], personalization),
    [characterName, purpose, selected, personalization],
  );

  const choose = useCallback((plan: PlanId) => {
    setSelected(plan);
    setError(null);
  }, []);

  const purchase = useCallback(async () => {
    if (busy || storeMissing) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const plan = PLANS[selected];
    try {
      if (releaseNative && !revenueCatService.isAvailable) {
        // Not started, or failed to: try once more before calling it offline.
        await revenueCatService.activate?.();
        if (!mounted.current) return;
        if (!revenueCatService.isAvailable) {
          setError(i18n.t("paywall.storeOffline"));
          return;
        }
      }
      const offerings = await revenueCatService.getOfferings();
      const pkg = subscriptionPackages(offerings)?.find(
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
          onSubscribed({
            credits: trialDaysSelected ? TRIAL_CREDITS : plan.credits,
            plan: plan.id,
          });
          return;
        }
        if (mounted.current) setError(PURCHASE_ERROR);
        return;
      }
      // Exactly what the card says. Weekly is the base plan, never an offer.
      // Yearly takes the free trial when the card is showing one (the store
      // reported an eligible offer) and the base plan otherwise -- never a
      // store default the screen did not describe (`revenuecat.ts`).
      const trial = Boolean(trialDaysSelected);
      if (trial && !advertisableTrial(pkg)) {
        // The trial was on screen, but the store's fresh answer has none this
        // account can take (offer ended, eligibility changed). Never buy the
        // base plan behind a button that says "free trial": refresh the cards
        // to the price and say so, and let the person decide again.
        setPackages(subscriptionPackages(offerings));
        setError(i18n.t("paywall.trialGone"));
        return;
      }
      const profile = await revenueCatService.purchasePackage(
        pkg,
        trial ? { freeTrial: true } : { basePlanOnly: true },
      );
      if (!mounted.current) return;
      // A cancel resolves with null rather than throwing, and it is a cancel
      // even for someone who was already premium: reading `isPremium` here
      // would grant that person a plan they just declined to buy. No error
      // line for a cancel: the user knows what they just did.
      if (profile === null) return;
      if (revenueCatService.isPremium) {
        // A trial grants TRIAL_CREDITS now and the plan's full grant at the
        // first charge, so the welcome count-up says what actually arrived.
        onSubscribed({ credits: trial ? TRIAL_CREDITS : plan.credits, plan: plan.id });
      }
    } catch {
      if (mounted.current) setError(PURCHASE_ERROR);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, onSubscribed, releaseNative, selected, storeMissing, trialDaysSelected]);

  /**
   * Restore. A restored plan needs no navigation: `useIsSubscribed` hears the
   * new profile and this screen becomes the member state on its own. Nothing
   * restored says so, rather than leaving the tap looking ignored.
   */
  const restore = useCallback(async () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!storeAvailable) {
      setNotice(
        Platform.OS === "web"
          ? i18n.t("paywall.webOnly")
          : storeReason === "failed"
          ? i18n.t("paywall.storeOffline")
          : i18n.t("paywall.unavailable"),
      );
      return;
    }
    setBusy(true);
    try {
      await revenueCatService.restorePurchases();
      if (!mounted.current) return;
      setNotice(
        revenueCatService.isPremium
          ? i18n.t("paywall.restored")
          : i18n.t("paywall.nothingToRestore"),
      );
    } catch {
      if (mounted.current) setError(i18n.t("paywall.restoreFailed"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, storeAvailable, storeReason]);

  // Web runs in no store, so Google Play is the wrong answer there too.
  const manage = useCallback(() => {
    if (Platform.OS === "web") {
      setNotice(WEB_MANAGE_NOTICE);
      return;
    }
    openStoreSubscriptions().catch(() => undefined);
  }, []);

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
        // The sheet is laid out BELOW this scroll view, not over it, so the
        // body needs only its own breathing room at the end. It used to add
        // the sheet's measured height as well, which counted the sheet twice
        // and left a sheet-sized blank under the reviews (2026-10-03).
        contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xl }]}
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
            <Text style={styles.sub}>{sub}</Text>
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
      <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
        <View style={styles.planRow}>
          <PlanCard
            plan={PLANS.weekly}
            perDay={perDayFor(PLANS.weekly)}
            price={priceFor(PLANS.weekly)}
            trialDays={null}
            selected={selected === "weekly"}
            onPress={() => choose("weekly")}
          />
          <PlanCard
            plan={PLANS.yearly}
            perDay={perDayFor(PLANS.yearly)}
            price={priceFor(PLANS.yearly)}
            trialDays={yearlyTrialDays}
            selected={selected === "yearly"}
            onPress={() => choose("yearly")}
          />
        </View>

        {storeMissing ? <Text style={styles.memberNotice}>{i18n.t("paywall.unavailable")}</Text> : null}
        {storeOffline && !notice && !error
          ? <Text style={styles.memberNotice}>{i18n.t("paywall.storeOffline")}</Text>
          : null}
        {notice && !storeMissing ? <Text style={styles.memberNotice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={trialDaysSelected ? trialCtaLabel(trialDaysSelected) : CTA_LABEL}
          onPress={purchase}
          loading={busy}
          disabled={storeMissing}
          style={styles.primary}
        />

        <View style={styles.legalRow}>
          <LegalLink label={i18n.t("paywall.restore")} onPress={restore} />
          <Text style={styles.legalDot}>·</Text>
          <LegalLink label={i18n.t("paywall.manage")} onPress={manage} />
          <Text style={styles.legalDot}>·</Text>
          <LegalLink
            label={i18n.t("paywall.terms")}
            onPress={() => void Linking.openURL(TERMS_URL).catch(() => undefined)}
          />
          <Text style={styles.legalDot}>·</Text>
          <LegalLink
            label={i18n.t("paywall.privacy")}
            onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)}
          />
        </View>

        {/*
          The Subscriptions-policy terms, as fine print at the very bottom.

          2026-10-03: the founder asked for the explanatory line between the
          plans and the button to go. It is moved here, smaller, rather than
          deleted, because Google Play's Subscriptions policy requires the
          paywall itself to state the price after any trial, that it renews,
          and how to cancel -- and a free trial makes that stricter, not looser.
        */}
        <Text style={styles.finePrint} testID="paywall-renewal-terms">
          {`${
            trialDaysSelected
              ? trialLine(trialDaysSelected, priceFor(PLANS.yearly))
              : renewalLine(selected, priceFor(PLANS[selected]))
          } ${cancelLine()}`}
        </Text>
      </View>
    </View>
  );
}

/**
 * One duration, in about 92 points.
 *
 * THE FIGURES (2026-10-03, founder feedback). The per-day cost leads -- it is
 * the comparable number, and "$0.16/day" against "$0.86/day" makes the yearly
 * case on its own -- and the price the store charges sits under it, small.
 * When the yearly plan carries a free trial, that second line says so and
 * what comes after it. The weekly card no longer repeats its credit grant:
 * the first benefit row states the selected plan's grant.
 *
 * THE BADGE IS ABSOLUTE. Top left, straddling the border, so it costs neither
 * card a row and nothing has to be kept in sync.
 *
 * `flex: 1`, never a width, and the lead figure is `adjustsFontSizeToFit` on
 * one line: it is the thing on the card that must survive a 360pt phone.
 */
function PlanCard({
  plan,
  perDay,
  price,
  trialDays: trial,
  selected,
  onPress,
}: {
  plan: Plan;
  perDay: string;
  price: string;
  trialDays: number | null;
  selected: boolean;
  onPress: () => void;
}) {
  const periodPrice = `${price}${plan.period}`;
  const second = trial
    ? i18n.t("paywall.trialCard", { days: trial, price: periodPrice })
    : periodPrice;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${plan.eyebrow.toLowerCase()}, ${perDay} a day, ${second}`}
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
          {perDay}
          <Text style={styles.planPeriod}>/day</Text>
        </Text>
      </View>
      <Text style={[styles.planNote, trial ? styles.planNoteTrial : null]} numberOfLines={2}>
        {second}
      </Text>
    </Pressable>
  );
}

/** One quiet text link in the row under the CTA. 44pt tall with its hit slop. */
function LegalLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
    >
      <Text style={styles.legalLink}>{label}</Text>
    </Pressable>
  );
}

/** The hand-off's 104 x 134 portrait. The CTA below it is the shared 52pt `Button`. */
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
  /**
   * Stacked since 2026-10-03: the label (and the tick) on one line, the
   * per-day figure under it. On one row, "YEARLY ✓ $0.16/day" did not fit a
   * half-width card on a 390pt phone and the figure was cut to "$0.16...".
   */
  planHead: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.tight,
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
  planNoteTrial: { color: colors.accent, fontWeight: "600" },
  finePrint: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    textAlign: "center",
  },
  legalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: spacing.xs,
    marginTop: spacing.md,
  },
  legalLink: {
    fontFamily: fonts.ui,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.muted,
    textDecorationLine: "underline",
  },
  legalDot: {
    fontFamily: fonts.ui,
    fontSize: 11.5,
    lineHeight: 16,
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
  memberNotice: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.md,
  },
  /** Layout only; the recipe is `Button`'s. */
  primary: { marginTop: spacing.md },
});

export default OnboardingPaywall;
