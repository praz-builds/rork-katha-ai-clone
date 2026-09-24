# Google Play billing setup — the founder's checklist

<!-- markdownlint-disable MD013 -->

This is the one list to follow to make purchases work on Android. **When every
box below is ticked, purchases work with no code change**: the app, the webhook
and the monthly grant job already expect exactly the identifiers in the
catalogue below.

- **Prices and grants are decided in
  [`source-of-truth/CREDITS_AND_PRICING.md`](../source-of-truth/CREDITS_AND_PRICING.md)
  §3 *Store SKUs*.** If this page ever disagrees with it, that file wins. The
  prices appear here only so the checklist can be followed without switching
  files, and a test fails if they drift apart.
- **The identifiers here are the code's.** The client's copy is
  `expo/src/lib/store-catalog.ts` and `expo/src/lib/pricing.ts`; the server's
  is `REVENUECAT_PRODUCT_MAP` in
  `backend/supabase/functions/_shared/revenuecat.ts`. Two tests read this
  file and fail if a product id, base plan, grant, package, offering or
  entitlement differs from the code: `expo/src/__tests__/store-catalog.test.ts`
  and `backend/supabase/functions/_shared/revenuecat_test.ts`. **Type every id
  exactly as written.** A typo does not show up as an error anywhere a person
  would see it; it shows up as a paid purchase that grants nothing.

Nothing on this page costs money. The Play merchant profile, the Google Cloud
project, the service account, Pub/Sub at this volume and RevenueCat's free tier
are all free.

## The catalogue

Eight products: three subscriptions and five credit packs, one entitlement.

<!-- catalogue:start -->
| Type | Product ID | Play base plan ID | Billing period | Price (USD) | Credits granted | RevenueCat package | Offering | Entitlement |
|---|---|---|---|---|---|---|---|---|
| Subscription | `ai.katha.sub.weekly` | `weekly` | Every week (P1W), auto-renewing | $5.99 | 20 each week | `$rc_weekly` | `default` | `katha` |
| Subscription | `ai.katha.sub.monthly` | `monthly` | Every month (P1M), auto-renewing | $12.99 | 50 each month | `$rc_monthly` | `default` | `katha` |
| Subscription | `ai.katha.sub.yearly` | `yearly` | Every year (P1Y), auto-renewing | $59.00 | 50 each month | `$rc_annual` | `default` | `katha` |
| Credit pack | `ai.katha.credits.2` | — | One-time, consumable | $0.99 | 2 | `credits_2` | `credit_packs` | — |
| Credit pack | `ai.katha.credits.10` | — | One-time, consumable | $3.49 | 10 | `credits_10` | `credit_packs` | — |
| Credit pack | `ai.katha.credits.50` | — | One-time, consumable | $15.99 | 50 | `credits_50` | `credit_packs` | — |
| Credit pack | `ai.katha.credits.200` | — | One-time, consumable | $44.99 | 200 | `credits_200` | `credit_packs` | — |
| Credit pack | `ai.katha.credits.1000` | — | One-time, consumable | $119.99 | 1000 | `credits_1000` | `credit_packs` | — |
<!-- catalogue:end -->

Things the table implies that are easy to get wrong:

- **One base plan per subscription, with the id in the table.** RevenueCat
  names an Android subscription `productId:basePlanId`
  (`ai.katha.sub.yearly:yearly`) and sends that name in every webhook. The
  webhook accepts exactly the base plan listed; a second base plan on the same
  subscription is treated as an unknown product, parked in
  `payment_event_backlog`, and grants nothing until someone looks.
- **The yearly plan's 50 credits arrive monthly.** The first 50 land with the
  purchase; `refresh-subscription-grants` (daily cron) tops the plan back up to
  50 on each following calendar month. Weekly and monthly are topped up by
  their own renewals.
- **No free trial for launch.** The pricing doc keeps a 3-day trial as store
  configuration on the yearly plan, but no screen in the app discloses a trial
  today (the onboarding paywall removed it on 2026-09-11), and a trial the
  screen does not mention breaks the Subscriptions policy. The app always buys
  the base plan (`basePlanOnly` in `expo/src/lib/revenuecat.ts`), so an offer
  created by accident is never applied from the app. If a trial is wanted
  later, it is an offer with id `yearly-trial-3d` on the `yearly` base plan
  (3 days free, "new customer acquisition"), and it needs a paywall that says
  so first.
- **Packs are not in the entitlement.** Only the three subscriptions unlock
  `katha`. Packs only add credits.

## 1. Google Play Console: the products

Before you start: the app `ai.katha.createstories` exists in Play Console, and
**an AAB has been uploaded to any track** (internal testing is enough). Play
refuses to create products for an app whose uploaded build lacks the billing
permission; `react-native-purchases` adds it, so any EAS build of this app
qualifies.

- [ ] **Payments profile.** Play Console → *Settings* → *Payments profile*.
      Create or link the merchant (payments) profile. Free; needs the business
      address and a bank account for payouts.
- [ ] **Five one-time products.** *Monetize with Play* → *Products* →
      *One-time products* → *Create one-time product*, once per pack row in the
      catalogue. Product ID exactly as in the table; name "2 credits",
      "10 credits" and so on; description "Credits for creating stories and
      unlocking narration. Pack credits never expire."; price in USD from the
      table. Activate each.
- [ ] **Three subscriptions.** *Monetize with Play* → *Products* →
      *Subscriptions* → *Create subscription*, once per subscription row.
      Product ID exactly as in the table, name "Katha Weekly" / "Katha Monthly"
      / "Katha Yearly". Then in each: *Add base plan* → base plan ID exactly as
      in the table → *Auto-renewing* → billing period from the table → price in
      USD from the table → keep Google's default grace period and account hold
      → *Activate*. **Do not add offers** (see *No free trial for launch*).
- [ ] **Country prices.** For every product: USD base, let Google convert every
      other country, and set **India by hand to a local figure ending in 9**
      (`CREDITS_AND_PRICING.md` §3, decision 54). No other overrides. The app
      shows whatever price string Play hands it and never converts currency.
- [ ] **License testers.** *Settings* → *License testing* → add the Google
      accounts of everyone who will test purchases (including the reviewer
      account if it signs in with Google Play on a device). Their purchases are
      free test purchases and subscriptions renew in minutes (weekly every
      5 minutes, yearly every 30), up to six times.

## 2. Google Cloud: a service account for RevenueCat

RevenueCat validates every purchase with Google's servers, and it needs its
own credentials to do that.

- [ ] **Project and APIs.** [console.cloud.google.com](https://console.cloud.google.com)
      → create a project (or use one already linked to Play) → *APIs & Services*
      → enable **Google Play Android Developer API** and **Google Play
      Developer Reporting API**. Also enable **Cloud Pub/Sub API** (step 4).
- [ ] **Service account.** *IAM & Admin* → *Service accounts* → *Create
      service account*, e.g. `revenuecat`. Grant it the roles **Pub/Sub Admin**
      and **Monitoring Viewer** (RevenueCat's own instructions ask for these,
      for the notification topic). Then *Keys* → *Add key* → *JSON* → download
      the file. Keep it off the repository and out of chat.
- [ ] **Give it access in Play.** Play Console → *Users and permissions* →
      *Invite new users* → the service account's email → *App permissions* →
      `Katha AI` with: **View app information and download bulk reports
      (read-only)**, **View financial data, orders, and cancellation survey
      responses**, **Manage orders and subscriptions**. Send the invite (it
      accepts itself).
- [ ] **Allow for the delay.** Google can take **up to 36 hours** before new
      service-account credentials work. RevenueCat will show "invalid
      credentials" until then; that is expected, not a mistake. Do this step
      first on the day.

## 3. RevenueCat: app, products, entitlement, offerings

Project: the existing Katha project in RevenueCat.

- [ ] **Add the Play Store app.** *Project settings* → *Apps* → *+ New* →
      *Google Play Store*. Package name **`ai.katha.createstories`**. Upload
      the service-account JSON from step 2. Save.
- [ ] **Import the products.** *Product catalog* → *Products* → *Import* (or
      add each). You should see eight: the five packs by their bare id, and the
      subscriptions as `ai.katha.sub.weekly:weekly`,
      `ai.katha.sub.monthly:monthly`, `ai.katha.sub.yearly:yearly`.
- [ ] **Mark the packs consumable.** Open each `ai.katha.credits.*` product and
      set its type to **Consumable**. Without this the SDK never consumes the
      purchase, and Google will not sell the same pack to the same person a
      second time.
- [ ] **Entitlement.** *Product catalog* → *Entitlements* → *+ New* →
      identifier **`katha`** (exactly; the app and the webhook both ask for this
      name). Attach the three subscription products. Attach no pack.
- [ ] **Subscription offering.** *Product catalog* → *Offerings* → *+ New* →
      identifier **`default`**. Add three packages using RevenueCat's standard
      identifiers: **`$rc_weekly`** → the weekly product, **`$rc_monthly`** →
      monthly, **`$rc_annual`** → yearly. Then *Make current* on `default`.
      The paywall asks for `default` by id and falls back to whichever offering
      is current, and it picks plans by package type, so the standard
      identifiers matter.
- [ ] **Pack offering.** *+ New* offering, identifier **`credit_packs`**. Five
      custom packages with the identifiers in the table (`credits_2` …
      `credits_1000`), each pointing at its pack. The app finds packs by product
      id across every offering, so this offering is not current and does not
      need to be.
- [ ] **Customer Center (optional).** *Customer Center* → enable. "Manage
      subscription" for a member opens it; without it the app sends them to
      Play's subscriptions page instead, which also satisfies the policy.
- [ ] **Leave the Test Store alone.** Development builds keep using the Test
      Store key (`test_…`), which is right. Its old `katha_ai_pro` entitlement
      is still recognised by the client and harmless.

## 4. Real-Time Developer Notifications (through RevenueCat)

Google tells RevenueCat about renewals, cancellations and refunds the moment
they happen. Without this RevenueCat only learns on its own polling schedule,
and renewals and refunds reach the webhook hours late.

- [ ] **Connect.** RevenueCat → the Play Store app's settings → *Google
      developer notifications* → *Connect to Google*. RevenueCat creates a
      Pub/Sub topic in the Cloud project from step 2 and shows its full name
      (`projects/<project>/topics/<topic>`). Copy it.
- [ ] **Point Play at it.** Play Console → *Monetize with Play* →
      *Monetization setup* → *Google Play Billing* → *Real-time developer
      notifications* → enable, paste the topic name, notification content
      **Subscriptions, voided purchases, and all one-time products** → *Save*.
- [ ] **Test it.** *Send test notification* on the same Play screen. RevenueCat's
      notifications section should show a "last received" time within a
      minute.

## 5. RevenueCat → Katha: the webhook

The webhook is what turns a purchase into credits. It is deployed as
`revenuecat-webhook` with `verify_jwt = false` and checks its own secret.

- [ ] **The secret.** `REVENUECAT_WEBHOOK_SECRET` is already set on the
      production project (build-log 2026-09-16). Check with
      `supabase secrets list` from `backend/`. If it is missing, generate one
      (`openssl rand -hex 32`) and `supabase secrets set
      REVENUECAT_WEBHOOK_SECRET=<value>`.
- [ ] **Add the webhook.** RevenueCat → *Integrations* → *Webhooks* → *+ New*:
  - URL: `https://iafeuxgoiknncgyjmugd.supabase.co/functions/v1/revenuecat-webhook`
  - Authorization header value: `Bearer <REVENUECAT_WEBHOOK_SECRET>` (the
    function accepts the value with or without `Bearer `).
  - Environment: **Production and Sandbox** is fine — the function drops
    sandbox events itself unless told otherwise (next item).
  - Events: all.
- [ ] **Decide about test purchases.** Purchases by license testers arrive as
      `SANDBOX` and the webhook **ignores them** (`ignored: "sandbox"`) unless
      the secret `REVENUECAT_ALLOW_SANDBOX=true` is set. For the closed test,
      set it so testers' test purchases grant credits and the flow can be
      verified end to end; **unset it before production** (`supabase secrets
      unset REVENUECAT_ALLOW_SANDBOX`), or a license tester's free purchase
      mints real credits.
- [ ] **Send a test event.** RevenueCat's *Send test event* posts a `TEST`
      event; the function answers 200 with `ignored: "TEST"`. A 401 means the
      header does not match the secret.

## 6. The key into the app

The app reads the key from build configuration; nobody edits source.

- [ ] **Copy the key.** RevenueCat → *Project settings* → *API keys* → the
      Play Store app's **public** SDK key, which starts with `goog_`.
- [ ] **Store it in EAS.** From `expo/`:

  ```bash
  eas env:create --environment production \
    --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_XXXXXXXX \
    --visibility plaintext
  ```

  Repeat with `--environment preview` if preview builds should sell too.
  `plaintext` is correct: a public SDK key ships inside the app and is not a
  secret, and `EXPO_PUBLIC_*` values are compiled into the JavaScript bundle.
- [ ] **Ship it.** Either a new build (`eas build -p android --profile
      production`), or, once OTA is configured, an update published with the
      same environment (`eas update --channel production --environment
      production`). Both carry the key, because it is inlined into the bundle.
      A key that does not start with `goog_` is ignored and purchases stay off.

Until this step lands, every purchase surface says so instead of failing: the
paywall disables *Unlock Katha* and shows "Subscriptions aren't available in
this version of the app yet. Reading stays free."; the credit-pack sheet shows
"Purchases aren't available in this version yet".

## 7. Verify on a device

With a license tester's Google account, the closed-test build, and
`REVENUECAT_ALLOW_SANDBOX=true`:

- [ ] Paywall shows both plan prices in the device's currency, the renewal
      line ("… a year, renews automatically until you cancel. Cancel anytime in
      Google Play."), and Restore · Manage subscriptions · Terms · Privacy.
- [ ] Buy **weekly**. RevenueCat → *Customers* → the user shows `katha`
      active. Supabase `credit_ledger` has a `subscription` row of **+20** and
      the balance on Credits moved. Five minutes later a renewal writes another
      `subscription` row (a reset and a +20).
- [ ] Buy the **2-credit pack twice**. Two `purchase` rows of +2. (A second
      purchase that fails means the pack is not marked Consumable.)
- [ ] **Refund** the weekly plan from RevenueCat (*Customers* → the user → the
      transaction → *Refund*). RevenueCat reports it as a `CANCELLATION` with
      reason `CUSTOMER_SUPPORT`; a `chargeback` row of −20 appears and the
      subscription row goes inactive.
- [ ] **Restore purchases** on a reinstall shows the member state.
- [ ] Nothing new in `payment_event_backlog`. A row there means an id in the
      store does not match this page.
- [ ] Unset `REVENUECAT_ALLOW_SANDBOX` before the production release.

## Google Play Subscriptions policy — what the app already does

For the record, so nobody re-derives it before review:

| Requirement | Where |
|---|---|
| Price and billing period of the plan being bought, next to the button | The renewal line under the plan cards, from the store's `priceString` (`OnboardingPaywall.tsx`) |
| States that it renews automatically | Same line |
| How to cancel | "Cancel anytime in Google Play." on the same line |
| Manage / cancel link | "Manage subscriptions" → `play.google.com/store/account/subscriptions` (with the product and package when the user holds a plan) |
| Restore purchases | "Restore purchases" under the button |
| Terms and Privacy | Linked under the button |
| No undisclosed trial | The app buys the base plan only; no offer is created |
| Languages | The policy lines are in EN, PT and ES (`expo/src/i18n/*.json`, `paywall.*`) |
