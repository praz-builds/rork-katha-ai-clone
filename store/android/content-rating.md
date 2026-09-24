# Content rating, target audience, ads and App access — Play Console answers

<!-- markdownlint-disable MD013 -->

**Where:** Play Console → your app → Policy → App content.
**Grounded in:** `source-of-truth/STORY_PROMPT_SYSTEM.md` (Base Safety Rules, Spice Modules, Genre and Spice Matrix) and the client at `main` `dbd2168`.

The questionnaire is answered for **what a user can meet in the app**, which includes other people's published stories, their cover art, and comments. It is not answered for the Originals alone. Answering low and being re-rated after launch is worse than answering honestly now: a rating raised by Google after complaints can pull the app from some countries until it is fixed.

## 1. Content rating (IARC questionnaire)

**Email for IARC:** the developer account email. **Category:** **Entertainment** (the app's purpose is making and reading stories). "Social networking / UGC" is also defensible because of public publishing and comments; if the form offers only that for apps with UGC, pick it — the answers below do not change.

Google's wording shifts between questionnaire versions; match on meaning.

### Violence

| Question | Answer | Why |
|---|---|---|
| Does the app contain violence? | **Yes** | Horror, mystery, adventure, fantasy and historical stories include fights, deaths and threat. |
| Fantasy / cartoon violence | **Yes** | Fantasy and folktale genres. |
| Realistic violence against humans | **Yes** | Mystery and historical stories can describe a realistic killing in prose. |
| Graphic violence, dismemberment, gore | **No** | The horror module is written as "Suggestion over gore" and bans "gore inventories" (`STORY_PROMPT_SYSTEM.md` horror module). Blood can be *mentioned*; it is not dwelt on. Cover prompts use "blood red" only as a colour accent (`_shared/cover-prompts.ts:105,154,174`). |
| Violence against animals | **No** (not a focus). | |

### Fear

| Question | Answer | Why |
|---|---|---|
| Does the app contain content that could frighten or scare? | **Yes** | Horror is one of the twelve genres on the Create screen, with dark cover art (e.g. the Originals cover `decimal-point-hardware.jpg`). |

### Sexuality

| Question | Answer | Why |
|---|---|---|
| Sexual content / sexual themes or innuendo | **Yes — suggestive themes and innuendo only** | Romance defaults to the `steamy` tier: "Desire is on the page; the act is not … Undressing, hands, mouths, the weight of one body against another are allowed" (`STORY_PROMPT_SYSTEM.md`, Spice Modules → Steamy). |
| Depictions of sexual activity | **No** | Base Safety Rules: "**No sexual content, at any tier.** Sex acts happen off the page." `explicit` is retired, not deferred; `CRUDE_LEXICON` bans crude sexual vocabulary, and `scanCrudeLexicon()` reports misses. |
| Nudity | **No** | Nothing in the text or cover prompts asks for it. Cover generation runs through Google's image models, which refuse nudity. |
| Sexual content involving minors | **No** | Rejected before generation (Base Safety Rules). |

### Language

| Question | Answer | Why |
|---|---|---|
| Profanity or crude language | **Yes — strong language possible** | "It is not a profanity list: a character swearing in anger is characterisation" (`STORY_PROMPT_SYSTEM.md`, Base Safety Rules). User comments are unfiltered text as well. |
| Crude sexual language | **No** | `CRUDE_LEXICON`. |
| Discriminatory / hate language | **No** | Not produced by design and prohibited in the Terms; users can report it. |

### Controlled substances

| Question | Answer | Why |
|---|---|---|
| References to alcohol, tobacco or drugs | **Yes — references** | Adult fiction mentions drinking and smoking (a Katha Original is set in a Lisbon bar). |
| Use depicted, or encouraged | **No encouragement.** If asked whether use is *depicted*, answer **Yes** (a character can drink in a scene). | Base Safety Rules ban "drug synthesis" instructions even in fiction. |

### Crude humour, gambling, miscellaneous

| Question | Answer | Why |
|---|---|---|
| Crude or bathroom humour | **Yes — mild** | Comedy is a genre; the model is not filtered for it. Answer "No" only if the questionnaire means *prominent* crude humour. |
| Real-money gambling | **No** | |
| Simulated gambling | **No** | Credits buy actions at fixed prices. There are no randomised rewards or loot boxes. |
| Does the app promote age-restricted products or activities? | **No** | |

### Interactive elements (asked in every category)

| Question | Answer | Why |
|---|---|---|
| Can users interact or communicate with each other? | **Yes** | Comments on published stories (`expo/src/components/comments/`), follows, likes. |
| Can users share user-generated content with others? | **Yes** | "Make it public" publishes a story to every Katha reader (`publish-story`, `visibility: "public"`). |
| Does the app share the user's current location with other users? | **No** | |
| Does the app allow digital purchases? | **Yes** | Subscriptions and credit packs through Google Play Billing (RevenueCat). |
| Does the app provide unrestricted access to the internet (a browser or search engine)? | **No** | |
| Is the app primarily a news or educational app? | **No** | |
| Does the app contain AI-generated content? (if asked) | **Yes** | Stories, covers, portraits and narration are generated. Reporting is in place from every story (`StoryActionsSheet.tsx`) and comment; see the Generative AI row in `backend/ROADMAP.md`. |

### What to expect back

Probably **ESRB Mature 17+**, **PEGI 16** (possibly 18 for the combination of violence and sexual themes), **USK 16**, **ClassInd 16**, with interactive-element notes "Users Interact" and "In-App Purchases". That is consistent with an 18+ target audience. If IARC returns *lower* than PEGI 16, re-read the sexuality and violence answers before accepting: the listing says romance and horror include mature themes, and the two should agree.

## 2. Target audience and content

| Question | Answer |
|---|---|
| Target age groups | **18 and over** only. Leave every younger band unticked. |
| Could your app unintentionally appeal to children? | **No.** The store listing, feature graphic and screenshots contain no child-directed art or wording, and the listing states "for adults 18 and over". (The in-app "For kids" audience toggle is a tone setting a grown-up applies to what they write; the P0 row "Kids mode wording" renames it to *All-ages* before the build — land that first so the reviewer never sees a "Kids" label.) |
| Store listing presence in the "Teacher approved" / Kids sections | Not applicable. |

## 3. Ads

**Does your app contain ads? → No.** No ads SDK is in `expo/package.json`; AdMob is "Not yet wired" in `AGENTS.md` and rewarded-ad credits were removed from the economy (`source-of-truth/CREDITS_AND_PRICING.md` §5, "Deliberately removed"). Paywalls and credit offers inside the app are the app's own products, not ads.

## 4. News apps, COVID-19, Government, Financial features, Health, Data safety

News: **No**. COVID-19 contact tracing/status: **No**. Government app: **No**. Financial features: **None**. Health apps: **No**. Data safety: see `data-safety.md`.

## 5. App access (reviewer sign-in)

**Answer:** "All or some functionality in my app is restricted" → **Add instructions**.

Sign-in is by emailed one-time code, which a reviewer cannot receive. The `reviewer-signin` edge function covers exactly that case: one pre-provisioned address (`tester_accounts`), a fixed six-digit code checked as an HMAC with a server-held pepper, and a normal Supabase session on success. It is tried only after the real code check fails (`EmailCodeAuth.tsx:135-150`, `reviewerSignIn` in `expo/src/lib/session.ts:563`). The account carries `profiles.entitlement_override = 'katha'`, so it reads as a subscriber without a receipt. Its credits are **seeded by hand** — testers earn nothing (migration 00089, "Testers earn nothing: the reviewer account is seeded directly") — so the balance has to be topped up before review.

Paste into Play Console (name: **Katha reviewer account**):

- **Username / email:** `reviewer@thetractionlabs.com`
- **Password:** the six-digit code from `backend/.reviewer-code.local` on your machine (git-ignored; never paste it anywhere else, and never into this repo).
- **Any other information required to access the app:**

```text
Katha signs in with an emailed one-time code, not a password. For review, use the fixed code above instead of waiting for an email:

1. Open the app. On the first screen, tap "Sign in" (top right).
2. Enter reviewer@thetractionlabs.com and tap to send the code. (An email is sent, but you do not need it.)
3. On the code screen, type the six-digit code given in the Password field and continue.
4. You are signed in to an account that already has the Katha subscription and a credit balance, so every paid feature can be used and nothing needs to be bought.

To see the full product: tap + (Create) to start a story from an idea, open any story on Home to read it, use the Listen button on a story page for narration, and open the ⋮ menu on a story to report it or block its author. Account deletion is in the You tab, at the bottom.

Five wrong codes lock the address for 15 minutes.
```

**Check before you submit:**

1. On a release build, sign in with the steps above yourself. The lockout is real (5 failures per address per 15 minutes, 100 per IP per hour — `reviewer_signin_locked`, migration 00089), so do not experiment with the code on the review day.
2. `REVIEWER_CODE_PEPPER` is set in the production function secrets (without it every attempt answers 401 and logs `reviewer_pepper_missing`).
3. Story generation works for this account on that day (P0 row "Generation provider (paid primary)"). A reviewer whose first story fails files it as broken functionality.
4. The reviewer account has enough credits for a reviewer to start two or three stories and narrate a chapter (say 20). It cannot earn any, so a balance spent by your own test run stays spent.
5. The reviewer account is already excluded from metrics (`tester_accounts`, `CREDITS_AND_PRICING.md` decision 53); nothing to do.
