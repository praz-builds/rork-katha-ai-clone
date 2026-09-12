# Credits and Pricing — source of truth

<!-- markdownlint-disable MD013 -->

> **This file is canonical.** Every credit price, plan price, grant amount, store
> SKU and earn mechanic in Katha AI is defined here and nowhere else. If another
> file disagrees with this one, this one is right and the other is stale.
>
> Referenced from `AGENTS.md`. Supersedes the pricing tables previously held in
> `AGENTS.md`, `backend/ROADMAP.md`, `backend/references/story-generator-app.md`,
> `backend/references/strategic-decisions.md` and `expo/DESIGN.md`.
>
> Last revised 2026-09-12. Cost figures are computed from the shipped code;
> external rates are cited inline. Sentences that are inference rather than a
> cited fact say so.

---

## Summary

**One credit = one AI action**, with one deliberate exception: **starting a story
costs 1 credit and bundles three actions.**

| Its cast | + | Chapter 1's words | + | Chapter 1's art *(this is the cover)* | = | **1 credit** |
|---|---|---|---|---|---|---|

Every chapter after that is **1 credit**, or 2 if you illustrate it. A 3-chapter
story is 3 credits; a 15-chapter story is 15. You are charged as each chapter is
written, so a story you abandon costs what it wrote.

**A story's total is what it was planned for, not what it is fixed at.** Since
2026-09-11 the planned length is a starting length: a finished series whose
plan is below 15 offers its author direction chips at its end instead of "the
story is complete", and picking one writes the next chapter and charges the
ordinary chapter price for it — 1 credit, or 2 illustrated. Extension is
neither discounted nor surcharged, so the arithmetic above is unchanged; a
1-chapter story grown to four has simply been charged as a 4-chapter story, one
chapter at a time. It always takes a deliberate tap: auto-continue stops at the
plan and never extends by itself.

Reading is **free and unlimited on every tier, forever**. Audio is **1 credit per
chapter, unlocked permanently**. **Editing by hand is free and unlimited**, and
it is not capped, because it calls nothing.

Two actions are **unlimited on any paid plan**: **reimagining a chapter** and
**character portraits**. On the free tier a reimagine is free once per chapter on
a story you created, and a portrait is free four times per account. Beyond that
the free tier is offered the plan, not a price, for reimagine; a fifth portrait
is 1 credit.

One product, three durations. There is no separate reader tier.

| | Weekly | Monthly | Yearly · 3-day trial |
|---|---|---|---|
| **Katha** | **$5.99** · 20 credits | **$12.99** · 50/mo | **$59** · 50/mo |

The five findings that shape the numbers:

1. **The bundled start is the most expensive credit in the product, and that is
   the central fact of this document.** Gemini charges a flat rate per image —
   **$0.039**, no size or quality parameter — so a cast of three is $0.117 and a
   cover another $0.039. With chapter text at **$0.0218** streamed, a story start
   costs **$0.178** for one credit, against $0.0218 for the chapter that follows
   it. **A story start costs 8× what a chapter costs and is priced the same.**
   Everything below follows from that ratio: short stories are dear per credit,
   long ones are cheap, and any free credit is dangerous in proportion to how
   easily it reaches a story start.
2. **The yearly plan is the binding constraint on everything.** At $59/yr for 50
   credits/month it nets **$0.0836/credit** against **$0.0322–$0.0738** of
   creation cost depending on story shape (§2). Every future price or grant change
   is tested against this row first, at the **worst** shape and never the blended
   one.
3. **A 50-credit grant is more profitable than a 100-credit one**, and not only
   because of margin. 50 credits is ~50 chapters/month against a working writer's
   ~63-credit appetite, so overflow demand routes into credit packs at 60–78%
   margin instead of being absorbed by a ~12%-margin subscription.
4. **Audio only works as a catalog investment, not a per-user cost.** A Microsoft
   edge-tts narration is estimated at **~$0.001-$0.006** to generate and $0 to
   replay from cache. Narrating the top ~500 chapters ourselves is therefore a
   **one-time ~$0.50-$3.00** if those voices pass production measurement; MiniMax
   fallback remains materially more expensive.
5. **Reading must stay free, and that is a strategic asset.** It costs us nothing
   to serve, it is the entire top of the funnel, and it is what every walled
   competitor cannot copy.

---

## 0. Governing principles

These are the constitution. Every pricing question is decided by them, and every
future feature should be decided by them without reopening this document.

1. **Reading is free. Always, everywhere, on every tier, with no cap.**
2. **A credit buys one AI action.** One text generation, one cover, one character
   set, one chapter of audio. If we call a paid API on the user's behalf, that is
   a credit. If we do not, it is free.
3. **Whole numbers only.** A user never sees a decimal, a fraction, a percentage,
   or a second currency. An action that cannot be priced at a whole credit
   becomes free-with-a-cap or bundled.
4. **Never charge for our own failure.** Failed generations auto-refund. ~~Every
   paid image gets one free retry.~~ **Amended 2026-09-10: there are no free
   image retries.** The first half stands unchanged — a *failed* generation still
   auto-refunds every credit it reserved. A delivered image you simply dislike is
   not a failure, and regenerating it is a second paid API call, so it is a second
   credit. See §1.

   > ⚠ **This is a code change, not only a doc change.** Migration 00044 exists
   > *specifically* to implement the free retry: `stories.cover_regen_count` is the
   > free-versus-paid discriminator (0 means the next regeneration is free), and
   > `finish_cover_regeneration` increments it only on success. That column and its
   > branch are now dead logic, and `regenerate-cover` must charge from the first
   > regeneration. **`STORY_GENERATION_FLOW.md` §10.4 still states the old rule**
   > ("Regenerate: 1 free retry, then 1 ✦") and now contradicts this file. Neither
   > has been updated.
5. **Never charge twice for the same thing.** An unlocked chapter stays unlocked
   forever — re-reads, re-listens, pause/resume and library re-opens are free.
6. **A subscription must always be the best price per credit** against any pack
   it competes with. A pack that undercuts the plan it sits next to is a bug in
   the price list, not a promotion.
7. **Steady-state earnable free credits stay at or below 50% of the cheapest paid
   grant** — the streak ladder pays **nothing** in steady state (14 credits
   once, inside the first ten days), so the headroom is the whole ceiling.
   Measure it against the **most expensive action a credit can buy**, never the
   blended cost: see §5, *The daily credit, re-examined*.

---

## 1. How Credits Work

> **This section is written to be lifted verbatim into the "How Credits Work"
> page in Profile.** It is user-facing copy, not internal reasoning. Everything
> below it is the justification.

### Reading is always free

Read anything, as much as you want, on any plan, forever. Browse, search,
re-read, build your library — none of it costs a credit. You never need a
subscription to read on Katha.

### Credits are for creating and for listening

One credit = one AI action.

**Creating a story**

A story runs to a length you choose. You are charged for each AI action as it
happens, never up front.

> **Implemented.** The 3 / 7 / 15 chapter lengths and the per-action prices below
> are the active Create contract.

| | Credits |
|---|---|
| **Start a story** — its cast, chapter 1, and chapter 1's art *(the cover)* | **1** |
| Write another chapter | 1 each |
| Art for any other chapter — optional, off by default | 1 each |
| Regenerate the cover | 1 each |

| Your story | Just the words | Every chapter illustrated |
|---|---|---|
| 3 chapters | **3** | **5** |
| 7 chapters | **7** | **13** |
| 15 chapters | **15** | **29** |

**You pay as each chapter is written**, so a story you stop halfway costs what
it wrote, not what it planned.

**Bringing your own cover is free, and it replaces chapter 1's art rather than
sitting on top of it.** The story start is a bundle, so uploading before you
generate does not make it cheaper — it is already 1 credit, the floor. What it
does buy is a cover you chose. Upload afterwards and it replaces the generated
one; the credit that made it is not refunded, because that generation was
delivered. Keeping the free typographic concept card is also a legitimate
published look, and also costs nothing.

**Listening — 1 credit**

| | Credits |
|---|---|
| Unlock a chapter's audio | 1 |
| Re-listen to it, forever | **0** |

One credit unlocks that chapter's audio permanently. Pause it, come back
tomorrow, listen ten more times — it's yours. Every voice is available on every
plan; we don't lock voices behind a tier.

**Editing — free**

| | Free | Any paid plan |
|---|---|---|
| Type, rewrite, restructure your draft by hand | **0**, unlimited | **0**, unlimited |
| **Reimagine a chapter** — re-prompt it, recast it | **1 free** per chapter, on stories you created | **Unlimited** |
| Reimagine a chapter in somebody else's story | **1** — it makes you your own copy | **Unlimited** |
| **Create or edit a character image** | **4 free** per account, then **1** each | **Unlimited** |
| Use a saved character in a new story | **0**, always | **0**, always |
| Regenerate a cover you paid for | **1** — there is no free retry | **1** |

**Reimagine is the only AI editing action, and hand editing is free forever.**
*(2026-09-11: the 3 free AI redrafts and 20 free paragraph edits this table used
to list are retired — see §1a.)*

**If a paid action fails, its credit comes back automatically.** Text failure
refunds the complete start reservation. After text succeeds, cast and cover are
tracked independently: either missing component receives its own idempotent
one-credit refund without discarding the completed chapter. Every time.

### 1a. AI redrafts and paragraph edits — retired

**Retired 2026-09-11.** This document priced *3 free AI redrafts per chapter* and
*20 free paragraph AI edits per chapter* from the first version of the editing
table. **Neither action exists in the shipped product.**

What actually ships is `ReimagineSheet`
([`expo/src/components/reader/ReimagineSheet.tsx`](../expo/src/components/reader/ReimagineSheet.tsx)),
backed by the `reimagine-chapter` edge function: the person picks a chapter,
optionally swaps characters, types what should change, and the chapter is written
again. There is no "redraft this chapter" button and no "rewrite this paragraph"
button anywhere in the reader or the studio. Hand editing is a plain text editor,
free and uncapped, calling nothing.

So the caps were pricing a feature that was never built, and worse, they were
being cited: §3's reimagine scoping argument leaned on them as precedent, §10
scheduled per-chapter counter columns to enforce them, and §11 listed a p95
redraft metric to tune a cap that binds on nothing. All three are corrected.

**If a redraft or a paragraph rewrite is ever built, it returns to this document
before it ships** — it is a text call, so it is a priced action under principle 2
and not a free allowance by default.

### Where credits come from

**Free**

| | Credits |
|---|---|
| Keep a reading streak | **2** at day 2, **7** at day 5, **5** at day 10 |
| Invite a friend who creates something | **10** to you, **5** to them |
| Welcome bonus | **3**, once |

A streak is consecutive days with reading activity. Miss a day and it resets to
zero — the rewards start again from day 2. **Missed one?** Read for 30 minutes
the next day and the streak carries on as if you hadn't (twice a month).

**Plans**

| | Weekly | Monthly | Yearly |
|---|---|---|---|
| **Katha** | $5.99 · 20 credits | $12.99 · 50/mo | **$59** · 50/mo |

Yearly plans start with a **3-day free trial**. Reading stays free whether you
subscribe or not — plans are for creating and listening. **A plan is always the
best price per credit**, at every size, against every pack below.

Paid plans also unlock **unlimited character portraits**, **unlimited
reimagines**, **premium voices** and **Download PDF**, none of which the free tier
has in full.

**Credit packs** — no subscription needed

| | | |
|---|---|---|
| 5 credits | $1.99 | |
| 10 credits | $3.49 | |
| 30 credits | $9.99 | |
| 100 credits | $24.99 | |
| 300 credits | $64.99 | |
| 1000 credits | $119.99 | best pack value |

**Pack credits don't expire at the end of the month.** Plan credits refresh each
month and don't stack — run out on the 20th and you wait for the next cycle. Pack
credits sit in your balance until you spend them. That, not price, is what a pack
is for.

### The rules

- **Plan credits refresh each month** and don't stack up — you get a fresh 20 or
  50 every month rather than a growing pile.
- **Credits are tied to an active plan.** If your subscription ends, your credit
  balance ends with it. Use them before you cancel.
- **What you've already made is yours forever.** Every story you created and
  every chapter of audio you unlocked stays in your library, on any plan or none.
  **Reading stays free.**

---

## 2. Cost basis

**Text.** Revised 2026-09-05. `_shared/llm.ts` now chains OpenRouter
(`meta/muse-spark-1.3-contributor`, then `meta/muse-spark-1.3`) → Gemini 3.1 Pro
Preview → OpenAI (`gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini`) → OpenRouter Free
Router ([implementation](../backend/supabase/functions/_shared/llm.ts)).

> **Superseded figures, kept so the history reads.** The **~$0.031 per chapter**
> planning figure came from the retired Anthropic rate card. It was replaced by
> **~$0.004 per ~1k-word chapter** on `gpt-5.6-luna`, which held the primary
> position while Gemini (`429`) and OpenRouter (`402`) were blocked. Both are
> superseded by the measured Muse Spark figures below and **must not be quoted**.

**Muse Spark is a reasoning model, and that changes how text is costed.** Every
earlier text figure in this file was a naive prompt-plus-visible-output
calculation. These models emit reasoning tokens before any visible prose, those
tokens are billed at the completion rate, and they are the majority of the
completion bill. Costing text without them understates it by several multiples.

Rates per million tokens:

| Model | Prompt | Completion | Trains on our data |
|---|---|---|---|
| `meta/muse-spark-1.3-contributor` | **$0.10** | **$0.20** | **Yes** |
| `meta/muse-spark-1.3` | $1.20 | $4.20 | No |

**Measured, not estimated.** A live shaping call on 2026-09-05 against
`meta/muse-spark-1.3` billed **$0.006099** for ~154 prompt tokens and 1,408
completion tokens, of which **957 were reasoning**. Two-thirds of that call's
completion bill was thought, not output.

Per ~1k-word chapter, modelling ~2,500 prompt tokens and ~3,100 completion
tokens (~1,600 visible JSON plus ~1,500 reasoning at effort `low`):

| Model | Prompt | Completion | **Per chapter** |
|---|---|---|---|
| `meta/muse-spark-1.3-contributor` | $0.00025 | $0.00062 | **$0.0009** |
| `meta/muse-spark-1.3` | $0.0030 | $0.0130 | **$0.0160** |

> ⚠ **Superseded 2026-09-05: the contributor tier now serves.** This block used
> to say the tier returned `404` because the OpenRouter account's privacy setting
> blocked endpoints that train on prompts and completions. That setting has since
> been changed, and live calls to `meta/muse-spark-1.3-contributor` returned `200`
> repeatedly on 2026-09-05, including every call in the streaming work. **So the
> live figure is $0.0009, not $0.0160.**
>
> That is a cost win and a standing data decision, and the second half has not
> changed: the tier is cheap *because* it retains users' story ideas and the
> prose generated from them for training. It is wired as the default, so this is
> live behaviour, not a proposal. Reversing it is one constant in `llm.ts` and
> restores the $0.0160 basis. Both bases are carried here so the trade can be
> read as a number rather than argued.

**Streaming adds a second text call, and it is not free.** The streamed path
(`generate-story-stream`) splits generation in two: prose streams as plain text,
then a second structured call turns the finished prose into title, themes, hook
and `series_state`. The reason is technical rather than economic and is recorded
in `AGENTS.md` — a strict JSON schema cannot be streamed usefully — but it
changes this table.

The second call sends the whole chapter back as its prompt. Modelled on the
1,824-word chapter measured in production on 2026-09-05 (~2,700 prompt tokens,
~600 completion including reasoning at effort `minimal`):

| Model | Metadata call | Chapter total (prose + metadata) |
|---|---|---|
| `meta/muse-spark-1.3-contributor` | **~$0.0004** | **~$0.0013** |
| `meta/muse-spark-1.3` | ~$0.0058 | ~$0.0218 |

So streaming costs roughly **45% more per chapter** on the contributor tier and
**36% more** on the standard one. It buys an 8.8x improvement in perceived
latency, which is the single largest product effect available for the money, and
it is still an order of magnitude under the cheapest image in the table below.

> **Open, and the pricing owner's call.** The §4 margin rows have **not** been
> re-run against this figure. They should be before the streamed path becomes the
> only path. The cushion was already noted as narrowed on the standard tier, and
> this widens the gap between the two tiers rather than closing it.

**Images.** `google/gemini-2.5-flash-image` — "nano banana" — through OpenRouter,
with `google/gemini-3.1-flash-image` behind it.

| model | ≈ per image |
|---|---|
| google/gemini-2.5-flash-image ("nano banana") | **$0.039** |
| google/gemini-3.1-flash-image (fallback) | ~$0.077 |

> **This replaces `gpt-image-1`, and the tier model with it (2026-09-08).** The
> OpenAI credential was revoked, so the whole size×quality price matrix that the
> three render tiers below were derived from no longer applies to anything this
> codebase can call. Gemini charges a **flat 1,290 output tokens per image**: it
> takes no `size` and no `quality` parameter, so a cover, a chapter illustration
> and a character portrait all cost the same.
>
> That is straightforwardly better for the two cheap tiers and worse for none —
> a cover falls from $0.063 to $0.039 — but it removes the lever the tiering was
> built on. **The three tiers below are retained as a record of the intent, not
> as a live constraint**. The per-cast portrait arithmetic has since been redone
> against the flat rate — a cast of three is **$0.117**, not $0.033 — and the
> portrait path is priced in §3 (*Character portraits*). Aspect ratio
> is now carried in the prompt text rather than a parameter (`ASPECT` in
> `_shared/image.ts`), so it is a request, not a guarantee.

**Three render tiers, retained as intent.** Changing one is a pricing change and
returns to this file — but see the note above: none of them is currently
enforceable, because the provider does not price by size or quality.

| Image | Intended tier | Old cost | Cost today | Why the tier existed |
|---|---|---|---|---|
| **Cover** — chapter 1's art | 1024×1536 medium | $0.063 | **$0.039** | The 390×340 hero, the 108×152 card and the 74×96 mini. Quality is visible everywhere. |
| **Chapter art** — chapters 2–N | 1024×1024 medium | $0.042 | **$0.039** | An inline illustration at ~350pt in a reading column, seen once, in flow. Square suits the placement; it is not a shelf image. |
| **Character portraits** | 1024×1024 low | $0.011 | **$0.039** | Displayed inline and small. The 6× reduction against the cover tier is what let a whole cast be one credit — **that reduction is gone**, and this is the number to recheck. |

A cast is capped at **3 characters**. That is a product bound, not a margin one —
four portraits still clear the floor on a blended basis — chosen so the cast
stays legible and matches the set-of-three costing above.

**Audio.** Fresh narration now has two cost bases:

- **Microsoft edge-tts voices** through our own `EDGE_TTS_SERVICE_URL` worker:
  no per-character API bill, only worker runtime + storage + bandwidth. Working
  estimate: **~$0.001-$0.006 per fresh chapter narration** after included quotas,
  then near-zero replays from the cached MP3. This is an estimate until a real
  production batch records duration, output size and worker bill.
- **MiniMax `speech-02-hd` via RunPod** remains the legacy/fallback provider for
  `runpod_minimax` voices. Official MiniMax rate **$0.10/1k chars**
  ([MiniMax](https://minimax-ai.chat/pricing/)); third parties $0.05–$0.10/1k
  ([WaveSpeed](https://wavespeed.ai/models/minimax/speech-02-hd),
  [fal](https://fal.ai/models/fal-ai/minimax/speech-02-hd/api)). A RunPod A100
  serverless worker is ~$2.72/hr of active compute
  ([RunPod](https://www.runpod.io/pricing)). ElevenLabs, for comparison, charges
  $0.05–$0.10/1k chars
  ([Flexprice](https://flexprice.io/blog/elevenlabs-pricing-breakdown)).

An 800-word chapter ≈ 4,500 chars. MiniMax still implies **$0.22 at $0.05/1k,
$0.45 at $0.10/1k**; edge-tts should be treated as the preferred provider if its
quality and reliability pass production measurement.

**⚠ We have not measured our actual audio cost.** For edge-tts the unknown is
worker runtime/throttling; for RunPod it is endpoint throughput. Every audio
number here is an estimate from published rates or infrastructure arithmetic.
**Measure before enabling narration broadly** (§12).

### The credit's cost basis

> **Rebuilt 2026-09-10** against the flat Gemini image rate and the bundled story
> start. The tables this replaces used $0.063 / $0.042 / $0.011 image tiers the
> provider no longer prices, and a $0.033 cast that is now $0.117.

| Action | Cost | Credits |
|---|---|---|
| **Start a story** — cast of 3 + chapter 1 + cover | **$0.178** | **1** |
| Chapter text, streamed — live `meta/muse-spark-1.3` | $0.0218 | 1 |
| Chapter text — if the contributor tier is enabled | $0.0013 | 1 |
| Any single image — cover, chapter art, one portrait | **$0.039** | — |
| Chapter art | $0.039 | 1 |
| Cover regeneration | $0.039 | 1 |
| Reimagine a chapter | $0.0218 | free: 1 per chapter on your own story, then the plan. Paid: unlimited |
| Character image — create or edit | $0.039 | free: 0 ×4 per account, then 1. Paid: unlimited |
| Reusing a saved character's portrait | **$0** | 0 |
| Audio unlock — cached chapter | **~$0** | 1 |
| Audio unlock — triggers fresh narration | ~$0.22 ⚠ | 1 |

**The spread across a single credit is 8×**, from $0.0218 for a chapter to $0.178
for a story start. That is the widest this document has ever priced at one credit.
It is a deliberate product choice — a one-credit start is the simplest thing to
put on a Create screen — paid for in margin on short stories.

**A story, not a chapter, is the unit that matters.** The cast and the cover are
paid once and amortise across every credit after them, so the blended cost per
credit depends on the story's shape.

**Live basis, streamed text at $0.0218 per chapter, every image $0.039:**

| Story | Credits | Cost | **Blended $/credit** |
|---|---|---|---|
| 3 chapters, words only | 3 | $0.221 | **$0.0738** ← worst |
| 7 chapters, words only | 7 | $0.309 | $0.0441 |
| 15 chapters, words only | 15 | $0.483 | $0.0322 |
| 3 chapters, illustrated | 5 | $0.299 | $0.0599 |
| 7 chapters, illustrated | 13 | $0.543 | $0.0417 |
| 15 chapters, illustrated | 29 | $1.029 | **$0.0355** |

**The short words-only story is the worst shape, and the reason is structural.** A
3-chapter words-only story spreads $0.156 of fixed image cost over 3 credits; a
15-chapter one spreads the same $0.156 over 15. **Every margin in this document is
tested at $0.0738**, never at a blended figure.

**If the contributor tier is enabled, $0.0013 per chapter:**

| Story | Credits | Cost | **Blended $/credit** |
|---|---|---|---|
| 3 chapters, words only | 3 | $0.160 | $0.0533 |
| 7 chapters, words only | 7 | $0.165 | $0.0236 |
| 15 chapters, words only | 15 | $0.176 | **$0.0117** |
| 3 chapters, illustrated | 5 | $0.238 | $0.0476 |
| 7 chapters, illustrated | 13 | $0.399 | $0.0307 |
| 15 chapters, illustrated | 29 | $0.722 | $0.0249 |

**Images are 70-95% of creation cost**, so the contributor tier moves the worst
shape only from $0.0738 to $0.0533. Text is no longer the lever it was.

**Creation costs between $0.0322 and $0.0738 per credit today**, against
$0.0836/credit of net yearly revenue. The margin at the worst shape is 12%; at the
best it is 62%.

---

## 3. Pricing and plans

### The grid

> **Rebuilt 2026-09-10.** The two-audience Reader/Writer grid is retired. There is
> one product at three durations. The audience split was always a volume ladder
> wearing an identity label — Reader credits cost 73% more per credit than Writer
> credits, which is not how you price a different *product* — and the created-flow
> work erased the line it assumed: a reader who reimagines a chapter is creating.

| | Weekly | Monthly | Yearly · 3-day trial |
|---|---|---|---|
| **Katha** | **$5.99** · 20 credits | **$12.99** · 50/mo | **$59** · 50/mo |

| | Weekly | Monthly | Yearly |
|---|---|---|---|
| Net after 15% | $5.09 | $11.04 | $50.15 |
| Credits | 20/wk | 50/mo | 600/yr |
| **Gross $/credit** | $0.300 | $0.260 | **$0.0983** |
| **Net $/credit** | $0.255 | $0.221 | **$0.0836** |
| Annualised cost to user | $311.48 | $155.88 | $59 |

**The ladder descends monotonically and never inverts.** Weekly is the most
expensive credit, yearly the cheapest, and committing for a year is 5.2× cheaper
than paying weekly for one. **Every credit pack prices above the weekly rung**
(§*Credit packs*), so principle 6 holds against every SKU in the product — the
first price list in this document's history for which that is true.

**Presentation order: weekly and yearly upfront; monthly disclosed below them.**
Weekly is the impulse entry, yearly is the value anchor, monthly exists for the
user who wants it but is not the plan we lead with. Yearly is selected by
default; weekly has no trial.

> **The onboarding paywall shows two cards and nothing else** *(decided
> 2026-09-11, the W7 hand-off)*. Weekly and yearly, yearly selected by default,
> **no trial offered and no monthly disclosure** — not even behind a "More
> options" control. **Monthly stays a live SKU** (`ai.katha.sub.monthly`, below)
> and sells in-app from Home and Credits; it is removed from the one screen a
> new user cannot skip past, because a disclosure triangle there is a third
> decision at the worst moment. The trial likewise stays a store configuration
> on the yearly SKU for the surfaces that use it; onboarding no longer leads
> with it, because a card whose headline is "Start my 3-day free trial" sells
> the cancel button rather than the product.
>
> **The "SAVE 80%" badge on the yearly card is the weekly-vs-yearly annualised
> comparison**: $311.48 a year at the weekly price against $59, which is 81%,
> rounded down to 80. It is not the 62% yearly-vs-monthly discount above, and it
> must not be restated against monthly — monthly is not on that screen. If
> either price moves, this claim is recomputed from the annualised row in the
> table above or it comes off the card.
>
> **The yearly card's note is a daily comparison, added 2026-09-12**:
> **"$0.16 a day"**, which is **$59 / 365 = $0.1616, rounded to cents**. Like the
> badge it is **computed from the plan's price in code and never written as a
> literal**, so a localised or revised price moves the line with it. It replaces
> **"$4.92 a month, billed yearly"** — $59 / 12 — and it replaces it for the same
> reason the badge may not be restated against monthly: a monthly equivalent on
> the onboarding paywall is a comparison against the one plan that screen
> deliberately withholds, and it only means something to a person who already
> knows what a month costs. **Both are restatements of the same $59 and neither
> is a second charge**: the card shows $59 /yr as its price, the day figure sits
> under it as a note, and neither number may be drawn as a price in its own
> right, as a struck-through former price, or beside a "from" or a "just".
> Nothing in the model changes: the constraint of record is still
> $0.0836/credit at the yearly rung (§4).

The yearly discount is **62%** against the monthly price — steep, and inside the
normal band for consumer subscription apps, but note that it is the discount, not
the credit price, that has broken every previous version of this grid. A yearly
sold at a third of the monthly price for identical credits is how $49.99 came to
be a loss-making row.

### Why 50 credits and not 100

**At $59/yr, 100 credits/month is a loss at every story shape**: 1,200 credits
against $50.15 of net revenue is $0.0418/credit, under the $0.0738 worst case and
under the $0.0441 seven-chapter case. Fifty credits at $59 is **12% at the worst
shape and 49% blended**. You can have the sub-$60 price point or the 100-credit
headline, not both.

Fifty is also the better product decision independently of margin. It buys ~50
chapters a month, against a working writer's appetite of ~63 credits. A grant
deliberately set below the heavy user's appetite routes overflow demand into
**credit packs at 60–78% margin** rather than absorbing it inside a 12%-margin
subscription. A 100-credit grant swallows that demand and you never see the pack
revenue.

**A competitor's headline credit count is not comparable to ours and should never
drive this number.** A credit that buys a whole story is not a credit that buys
one action; matching a rival's "100" without matching what their credit does is
matching a label.

### The one-time offer — removed

**Removed 2026-09-10.** The offer discounted the yearly to $29 for the first year,
renewing at $59. Under the two-audience grid it discounted the *Reader* plan,
whose cost was dominated by cached audio at ~$0 marginal, so $19.99 still cleared
~100%. **The single ladder left nothing to discount but the thinnest row in the
model**, and the arithmetic never recovered: $29 for 600 credits nets $24.65
against **$44.28** of cost at the worst story shape — a **$19.63 loss** — and
clears only 43% at the blended shape.

It is removed rather than repriced because every fix cost something the offer
existed to buy. Granting fewer credits in the discounted year keeps the headline
cut but makes the offer a worse product than the plan beside it. Pricing it at
$39 shrinks the discount to the point where it stops converting. And the whole
mechanism was designed for a two-tier grid that no longer exists.

**What replaces it: the weekly plan.** The single ladder was supposed to make
weekly the low-commitment entry, and at $5.99 it is — a genuine try-it price that
does not need a countdown, cannot expire, and is profitable at every story shape
(71% at the worst). A user who declines the yearly now sees a plan, not a
liquidation.

**Consequences that follow from the removal:**

| | Before | After |
|---|---|---|
| Onboarding path | Paywall → one-time offer → welcome | **Paywall → welcome** |
| Welcome bonus trigger | On declining the offer | **On declining the paywall** |
| Countdown timers in the product | One permitted exception (§7) | **None. The ban is now absolute** |
| SKU `ai.katha.sub.yearly.offer` | Configured | **Not created** |

**The countdown ban becoming absolute is worth more than the offer was.** §7's
prohibition on false scarcity carried a single carve-out that had to be defended,
audited and kept honest; removing the offer removes the carve-out. There is now no
surface in Katha where a clock pressures a purchase, which is a simpler promise to
keep and a simpler one to state.

> **Revisit only with a reason to.** A first-year discount is a legitimate
> instrument; it failed here because it landed on a 12%-margin row. If the yearly
> ever prices high enough to carry one — or if a genuinely cheaper tier returns —
> this decision is worth reopening. It is not a principle, it is arithmetic.


### Character portraits

**Decided 2026-09-10: 4 free character images per account, then 1 credit each.
Generating and editing both count against the same four.**

> **Amended 2026-09-11: subscribers get unlimited character portraits, and the
> four are the free tier's allowance.** The cap was written before there was a
> plan to attach it to, and "4 per account, lifetime" is not a rung on a ladder —
> it is a wall that a paying user hits in their second week and then pays twice
> for. A portrait is $0.039, the same as any other image, so a subscriber drawing
> them is spending the grant they already bought; making it unlimited moves a
> $0.039 action off the credit meter and onto the plan.
>
> This is an **exception to the entitlement rule**, and §5's *Plan entitlements*
> section records it as one rather than pretending the rule was never written.
> The bound is the existing rate limit of 12 requests per hour
> (`claim_character_portrait_request`), which caps a subscriber at ~$3.51/hour of
> images against $4.18/month of net revenue. **That is not a real bound and the
> section below says so.** Server-side enforcement of both the subscriber
> exemption and the free tier's four is a stated follow-up; neither exists in
> `generate-character-image` today, which charges nothing and counts nothing.

> **Anonymous and named are two different bounds, and only one of them is
> built. Decided 2026-09-11.** An **anonymous** identity gets **4 portraits for
> the life of that identity, reimagines included** — enforced server-side today
> by migration 00084 (`claim_guest_portrait_request`), because onboarding draws
> its portrait before the email is asked for and nothing else stands between a
> brand-new session and a paid provider call. At the cap the endpoint answers
> **403 `guest_portrait_cap`** with "Sign in to keep making characters.", which
> is the honest ask: the wall is there to be converted, not waited out. A
> **named** user is unchanged for now — still only 00055's 12-per-hour window,
> with the 4-free-then-1-credit ledger and the subscriber exemption above still
> the stated follow-up. The two counters are separate and the guest one is never
> carried across on sign-in (§9 control 6); a named user is not charged for work
> done before they had an account. **Neither counter is keyed on a device.**

**Why the counter is on the account and not the character or the story.** Saved
characters are cross-story now (migration 00057) — the same character is used in
as many stories as the user likes. A per-story allowance would reset every time
they start one; a per-character allowance would reset every time they make a new
one. Neither bounds anything. **The account is the only level at which four means
four.**

**Editing counts because editing costs.** A portrait is generated from the Name,
Description and Appearance fields, so an edit that changes any of them is a fresh
image and a fresh paid API call. Counting the generation and not the edit would
make "edit the appearance" a free regeneration button, which is the same loophole
under a different label.

| | Free | Any paid plan |
|---|---|---|
| Create or edit a character image — first 4, per account | **0** | **0**, unlimited |
| Every one after that | **1** | **0**, unlimited |
| Reusing a saved character in a new story | **0** — the portrait already exists | **0** |

**This is the pricing decision migration 00055 deferred**, and it closes a live
hole. `generate-character-image` charges nothing today; it is bounded only by a
rate limit of 12 requests/hour, and the migration says so in its own comments —
*"This is a rate limit, not pricing... inventing one in a migration would be making
a pricing decision in the wrong place."* One call can walk two providers across
three safety levels, so a single request is **up to six paid generations**. Today's
worst case is therefore **~$2.80–$5.50 per user per hour, unbounded over time.** A
four-per-account cap makes the lifetime worst case **~$0.92–$1.85**, and the
typical case $0.156. The rate limit stays — it bounds a loop; the cap bounds a
user.

> **The four are scoped to the standalone character path**, not to the cast
> generated inside a story start. A story start's cast of three is already paid
> for by its credit; it does not consume the free four, and the free four do not
> subsidise it. Without this, one story start would eat three of four before the
> user had touched the character sheet.

> **Written as a lifetime allowance**, like the welcome bonus and the streak
> ladder, both of which terminate rather than recur. If it should instead refresh
> monthly, the cost is 4 × $0.039 = **$0.156/month** per active user against a
> yearly credit netting $0.0836 — affordable, but it is a different decision and
> is **not** the one recorded here.

### Saved characters make the story start cheaper, and that changes the risk model

The §2 story-start cost of **$0.178** assumes a cast of **three new portraits**
($0.117 of it). A user who reuses saved characters generates none of them.

| A 3-chapter words-only story | Cost | $/credit |
|---|---|---|
| All-new cast | $0.221 | **$0.0738** |
| All-saved cast | $0.104 | **$0.0348** |

**The worst story shape more than halves when the cast is reused**, and the yearly
plan's margin at that shape goes from **12% to 58%** — $29.27 of profit against
$5.87.

That is worth stating as a finding rather than a footnote: **the thin row in this
document is thin only for first-time creators.** The margin improves with exactly
the behaviour the product wants — a user building a recurring cast and writing
more stories with it. Saved characters are not only a retention feature; they are
the mechanism by which a heavy user becomes *cheaper* to serve rather than dearer.

**It also means the free four are an investment, not a giveaway.** Four portraits
is a cast the user keeps. Every story they write with it afterwards costs us
$0.117 less than one written with strangers.

### Reimagining a chapter

Shipped 2026-09-09 as `reimagine-chapter`. **Priced here for the first time** —
until now its price lived in a comment in the edge function.

**What it is.** The reader picks a chapter, optionally swaps characters for saved
ones or brand-new ones, types what should change, and the chapter is written
again. A **non-author gets a fork first**: `fork_story` (migration 00057) copies
the story, its chapters and its cast into a private story owned by the caller, and
the rewrite happens there — keyed on (source story, caller), so a reader who
reimagines three chapters ends up with one copy rather than three.

**Price, revised 2026-09-11. The 2026-09-10 rule was 2 free per chapter, then 1
credit each, and it carried two ⚠ open holes. Both are resolved here.**

| | Free | Any paid plan |
|---|---|---|
| Reimagine a chapter of a story **you created** | **1 free** per chapter, then the plan is offered | **Unlimited**, never charged |
| Reimagine a chapter of **somebody else's** story | **1 credit**, from the first | **Unlimited**, never charged |
| A brand-new character who needs a portrait | **1** (the portrait) | **0** — portraits are unlimited on a plan |
| Renaming a character across other chapters | **0** — substitution, no model call | **0** |

**Subscribers are never charged and never counted**, which is the single largest
simplification available here: there is no counter to scope, no fork to copy it
across, and no per-chapter state to reconcile for anyone on a plan. The counter
exists only on the free tier, where the allowance is one.

**Hole 1, resolved: free reimagines apply only to chapters in stories the caller
created.** The 2026-09-10 recommendation is adopted. A reader may reimagine any
chapter of any published story, so a *global* per-chapter allowance gave every
free user 2N reimagines against a catalogue of N chapters — $43.60 a user at a
thousand chapters, an order of magnitude larger than every other free surface in
the product combined. Reimagining a stranger's chapter **forks** it, and a fork
is a new story, which is generation rather than editing. **Non-author reimagine
costs 1 credit from the first**, on the free tier, and is unlimited on a plan.

*(The 2026-09-10 version of this argument cited §1's 3 free redrafts and 20 free
paragraph rewrites as the precedent for "your own draft and nobody else's". Those
allowances were retired 2026-09-11 because the actions do not exist — §1a. The
line they drew is still the right line; it simply has to stand on its own
reasoning, which it does: a fork produces a story, and stories are priced.)*

**Hole 2, resolved: the free allowance is 1, and it is per chapter of your own
story, so the fork counter problem disappears.** The unbounded case was *two free
reimagines produce a forked chapter carrying two more*. There is now nothing to
copy across a fork: a fork is somebody else's story becoming yours, and the free
allowance on **your own** chapters is one. `fork_story` still must not
reinitialise the counter on the forked rows — a forked chapter you then reimagine
again is a chapter of a story you created, and it gets exactly one free pass like
any other.

**Cost.** One chapter text call, **$0.0218** streamed. One free per chapter on
your own stories is **$0.0218** given away per chapter authored — about a quarter
of a yearly credit's net revenue, against the $0.0436 unbounded-across-the-
catalogue figure the old rule implied per chapter *read*. `apply_to_all_chapters`
renames rather than regenerates
(`_shared/character-substitution.ts`: whole-word, case-preserving, never a
pronoun), so it is genuinely free.

**Why free at all on the free tier, when it was 1 credit from the first?**
Because the first reimagine is usually the user discovering what the feature
*is*, and charging for the discovery of a feature suppresses the feature. One is
enough to learn it. The second one is where the plan is offered — **as the plan,
not as a price**. "Reimagine again with Katha" converts; "that will be 1 credit"
teaches the person to stop.

**Shipped state, which contradicts all of the above:** `reimagine-chapter`
reserves a credit through `reserve_generation_operation` on every call, for
everyone, with no subscriber check and no counter of any kind. The server-side
subscriber exemption and the free tier's one-per-chapter counter are both
follow-ups, and until they land the code charges from the first reimagine for
every user on every tier.

> **Both ⚠ open holes that stood here are resolved above, 2026-09-11.** They were
> *the free allowance has no scope* and *the counter must survive the fork, or the
> allowance is infinite*. The first is answered by scoping free reimagines to
> stories the caller created and pricing a non-author reimagine at 1 credit from
> the first; the second dissolves once subscribers are exempt and the free
> allowance is one per chapter of your own story. The analysis that produced both
> answers is in the section above rather than duplicated here.

### Credit packs

For users who skip the paywall entirely, and for subscribers who exhaust a
month's grant before the month ends. No subscription required.

| Pack | Price | $/credit | Net after 15% | vs. yearly |
|---|---|---|---|---|
| **5** | $1.99 | $0.398 | $1.69 | 4.0× |
| **10** | $3.49 | $0.349 | $2.97 | 3.5× |
| **30** | $9.99 | $0.333 | $8.49 | 3.4× |
| **100** | $24.99 | $0.250 | $21.24 | 2.5× |
| **300** | $64.99 | $0.217 | $55.24 | 2.2× |
| **1000** | $119.99 | $0.120 | $101.99 | **1.2×** |

**The 10 exists to close the gap between 5 and 30**, which was a 6× jump in size
and a $8 jump in price with nothing between. It is the second-cheapest thing to
buy in the product and the natural second purchase after a 5-pack ran out.

The yearly plan is **$0.0983/credit**. Every pack prices above it, monotonically,
so principle 6 holds at every rung: **the subscription is always the best price
per credit**, and that claim can be made on the paywall as a fact rather than a
slogan.

**The 5-credit pack exists for the blocked moment** (§7), not for value. At
$0.398/credit it is four times the yearly rate, and that is the point: it unblocks
someone mid-chapter who does not want a subscription conversation right now. It is
the most expensive credit in the product and the one most likely to be bought
without comparing anything.

**The 1000-credit pack is deliberately close to the yearly rate**, at 1.2×. It is
not competing with the subscription — 1000 credits is more than a year's grant
bought in one transaction, so its buyer is a power user who has already exhausted
a plan, not a prospect choosing between the two. Pricing it near parity is what
keeps that user from feeling punished for volume.

**Margins**, at the $0.0738 worst-case blended credit cost (3-chapter words-only
story, the shape that amortises the cast and cover over the fewest credits):

| Pack | Cost at worst shape | Profit | Margin |
|---|---|---|---|
| 5 | $0.37 | $1.32 | 78% |
| 10 | $0.74 | $2.23 | 75% |
| 30 | $2.21 | $6.28 | 74% |
| 100 | $7.38 | $13.86 | 65% |
| 300 | $22.14 | $33.10 | 60% |
| 1000 | $73.80 | **$28.19** | **28%** |

**The top pack's 28% is the carry-over risk, and it is real.** Pack credits do not
expire monthly, so a 1000-credit buyer can spend the lot on the most expensive
shape whenever they choose. It is still the largest single profit line in the
price list at $28.19, and 58% on blended shapes. Watch it; do not enlarge it.

### Carry-over is the pack's real product, not its price

**Subscription credits refresh monthly and do not stack. Pack credits do not
expire monthly.** Exhaust a month's 50 and the plan makes you wait for the next
cycle; pack credits sit in the balance until spent. That is the honest reason to
buy one, and it is what a pack sells that a cheaper subscription credit cannot.

This is already how the ledger is built — `credit_balance_buckets` separates
`subscription_grant_balance` from `purchased_balance`, and
`credit_spend_allocations` records which bucket funded a debit so a refund returns
to the right one (migration 00026).

**It also creates a tension with principle 6 that should be named rather than
finessed.** Principle 6 is a *price-per-credit* rule, and carry-over is a value
dimension that sits outside price. A pack credit that never expires is worth more
than a grant credit that does, so at anything approaching parity the pack becomes
the better buy for a user who does not consume 50/month. The 1.2× floor on the
top pack is what pays for that difference. **Do not close the gap further.**

> ⚠ **This forces §8's open item, and the answer is now clear.** §8 currently
> voids the *entire* balance on lapse, including purchased packs, and flags two
> problems with that: voiding a separate consumable IAP because a *different*
> product lapsed is a plausible App Store guideline issue, and it produces an
> asymmetry where a never-subscribed pack buyer keeps credits forever while an
> ex-subscriber who bought the identical pack loses theirs.
>
> **Selling carry-over as the pack's headline feature makes voiding packs on
> lapse indefensible** — we would be advertising permanence and then removing it,
> which is the exact failure the entitlements section above was written to avoid.
> **Recommendation: packs survive lapse; subscription grants and earned credits do
> not.** The bucket separation to implement it already exists. **Not yet
> decided** — it is §8's call, and it needs the App Review confirmation §12 item 8
> already asks for.

**Do not resize a pack without re-running the inversion check** (§4).

### The 3-day trial, and the hole in it

A 3-day trial that grants the full 50 credits is a **$3.69 giveaway with a cancel
button attached** at the worst story shape, and trial abuse is the most mechanical
form of fraud available on a subscription app.

> **Onboarding no longer offers the trial** *(2026-09-11, the W7 hand-off)*. The
> onboarding paywall sells weekly and yearly at their prices; the trial remains
> a store configuration on the yearly SKU for the in-app surfaces that use it,
> so the grant rule below still governs wherever a trial is actually started.
> The first cohort through the new onboarding will start no trials at all, which
> is the intended reading of any drop in trial starts.

**The trial grant is reduced to 10 credits. The full 50 lands on the first
successful charge.** Ten credits is ten chapters, or three short illustrated
stories — more than enough to judge the product in 3 days — and it caps the
downside at **$0.74**.

### Store SKUs

| SKU | Product |
|---|---|
| `ai.katha.sub.weekly` | Weekly — $5.99 · 20 credits |
| `ai.katha.sub.monthly` | Monthly — $12.99 · 50/mo |
| `ai.katha.sub.yearly` | Yearly — $59 · 50/mo, 3-day trial |
| `ai.katha.credits.5` | 5 credits — $1.99 |
| `ai.katha.credits.10` | 10 credits — $3.49 |
| `ai.katha.credits.30` | 30 credits — $9.99 |
| `ai.katha.credits.100` | 100 credits — $24.99 |
| `ai.katha.credits.300` | 300 credits — $64.99 |
| `ai.katha.credits.1000` | 1000 credits — $119.99 |

> **The `reader.*` and `writer.*` SKU families are retired** with the two-audience
> grid. Nothing has shipped to a store under them, so this is a rename rather than
> a migration — but confirm that before creating the new ones.

The client must read price, renewal terms, trial eligibility and offer copy from
RevenueCat product data. The values above are the configuration, not hardcoded
strings.

---

## 4. Unit economics

> **Rebuilt 2026-09-10** against the single ladder and the $0.0322-$0.0738 cost
> range from §2. Every margin below is computed at the **worst** story shape
> ($0.0738/credit — a 3-chapter words-only story), not a blended figure. Apple's
> Small Business Program commission of 15% is applied throughout; at 30% every
> profit below falls ~18%.

| SKU | $/credit | Net/credit | Margin at worst shape |
|---|---|---|---|
| Pack 5 / $1.99 | $0.398 | $0.338 | **78%** |
| Pack 10 / $3.49 | $0.349 | $0.297 | **75%** |
| Pack 30 / $9.99 | $0.333 | $0.283 | **74%** |
| Weekly $5.99 / 20 | $0.300 | $0.255 | **71%** |
| Monthly $12.99 / 50 | $0.260 | $0.221 | **67%** |
| Pack 100 / $24.99 | $0.250 | $0.212 | **65%** |
| Pack 300 / $64.99 | $0.217 | $0.184 | **60%** |
| Pack 1000 / $119.99 | $0.120 | $0.102 | **28%** |
| **Yearly $59 / 600** | **$0.0983** | **$0.0836** | **12%** ← constraint |

**Every SKU clears cost at every story shape.** That has not been true of any
previous version of this price list — the retired $49.99/600 row was **−$1.79/yr**
at the worst shape. It is true now with no row to apologise for, and it is true
without relying on subscribers under-using what they paid for.

### Profit per subscription

The number to run the business on is not margin per credit but profit per
subscriber, at full grant consumption:

| | Worst shape | Blended (7-ch, mixed art) |
|---|---|---|
| **Weekly** | **+$3.61** (71%) | +$4.23 (83%) |
| **Monthly** | **+$7.35** (67%) | +$8.89 (81%) |
| **Yearly** | **+$5.87** (12%) | +$24.35 (49%) |

### The inversion check

Principle 6 says a subscription must always beat the packs it competes with. Run
this whenever any price or grant changes — against the **weekly** rung, which is
the cheapest subscription a pack buyer is choosing between:

| Pack | Gross $/cr | vs weekly $0.300 |
|---|---|---|
| 5 / $1.99 | $0.398 | ✅ |
| 10 / $3.49 | $0.349 | ✅ |
| 30 / $9.99 | $0.333 | ✅ |
| 100 / $24.99 | $0.250 | ⚠ below weekly, above monthly |
| 300 / $64.99 | $0.217 | ⚠ below weekly, below monthly |
| 1000 / $119.99 | $0.120 | ⚠ below both, above yearly |

**The three large packs sit below the weekly rung, and that is correct rather than
a violation.** Weekly is a 20-credit product; nobody weighing a 300-credit pack is
weighing it against 20 credits a week. Every pack stays above the **yearly** rate,
which is the subscription that actually competes for a bulk buyer, so the claim
"a plan is always the best price per credit" holds where a user could act on it.

**The trap this check exists to catch** is a pack that dominates the plan sitting
next to it on the paywall. The retired $14.99/40 pack next to a $12.99/50 plan was
that trap in the other direction — more money for fewer credits — and the sizes
above are set to keep a clear gap in both directions.

### The yearly row is the risk model

At $59/yr the subscriber nets **$4.18/month** against **$3.69/month** if they burn
all 50 credits on the worst story shape. That is 12% at *maximum* burn on the
*worst* shape, 49% at a realistic mix, and 76% at a 50% burn rate.

This row matters more than any other because **the yearly tier self-selects for
high burn.** Its entire pitch is the credit count; people who buy it intend to use
it. Every other SKU can lean on under-utilisation; this one cannot.

Three consequences, all load-bearing:

- **Monthly grants do not roll over.** Without this a yearly subscriber banks 600
  credits and can dump them in any pattern. With it, exposure is bounded to
  50/month and hoard-then-dump is impossible. Standard practice (Canva,
  ElevenLabs, Midjourney) and it takes nothing anyone paid for — purchased packs
  are the carry-over product and are governed separately (§8).
- **There is no cushion left for a new free allowance.** 12% at the worst shape is
  what removing the free image retry bought back; a second free allowance spends
  it again. Price every future giveaway against $0.178 (a story start), not
  against $0.0218 (a chapter).
- **Credit utilisation is the #1 launch metric** (§11).


### Audio depends entirely on catalog narration

The yearly plan nets **$4.18/month**. An audio unlock is 1 credit like any other,
so what it costs us depends entirely on whether that chapter has been narrated
before:

| If an audio credit hits… | Our cost | Result |
|---|---|---|
| Audio we already narrated | ~$0 | **~100% margin** |
| A chapter needing fresh MiniMax narration | ~$0.22 ⚠ | **loses money from the 1st unlock** |

**A single fresh MiniMax narration costs 2.6× what a yearly credit nets.** There
is no burn rate at which unmetered fresh narration works — it is only ever viable
against a pre-narrated catalogue, where one narration serves every listener.

> **Edge-tts was the cheap path and it is currently blocked.** Microsoft's
> consumer endpoint returns 403 to a direct connection, and `_shared/edge-tts.ts`
> routes through a worker at `EDGE_TTS_SERVICE_URL` that does not exist. Every
> edge-tts figure below is contingent on standing that worker up; until then
> MiniMax is the only provider that works, and the $0.22 is itself an estimate
> from published rates that **has never been measured** (§12).

### Catalog narration — the decision that makes audio work

**A narration is paid once and replayed for $0 forever after.** It is cached in
the public `audio` bucket and every subsequent listen, by anyone, is free. So the
cost is **per chapter narrated**, never per listen.

**We narrate the top ~500 chapters ourselves, proactively — a one-time
~$0.50-$3.00 on edge-tts, or ~$110+ on MiniMax fallback.**

That single spend:

- Turns audio from a per-unlock loss into ~100% margin.
- Makes audio **instant** instead of a 60-second generation wait, which is the
  difference between a feature people use and one they try once.
- Amortizes across every listener: 500 chapters against 100k listens is
  **$0.001 per listen**.

Selection is by read volume, refreshed weekly. On-demand narration remains the
fallback for the long tail.

### Free tier exposure

A maximally engaged free user earns **17 credits in month one** (3 welcome, once
+ 14 from streak milestones at days 2, 5 and 10) and **nothing thereafter** — a
one-time $0.50 blended, $1.80 if every credit starts a story. *(Was 24 while the
welcome bonus was 10; reduced to 3 on 2026-09-11, §6.)*

**Zero in steady state is trivially inside the principle-7 ceiling of 50%.** The
milestone ladder needs no monthly cap because it does not recur at all: it pays
three times, inside the first ten days, and is then exhausted. That is its
advantage over a flat daily grant, which needed an explicit ceiling to stop it
reaching 30/month and out-earning the paid tier. The cost is that a retained free
user has no ongoing earn — see the open item in §5.

The headroom is deliberate. If free-tier engagement turns out too thin — the
signal being D7 retention on free users tracking below subscribers by more than
2× — the lever is to add a recurring rung (§5's open item) or shorten the gap
days to 5, not to raise the per-milestone amount.

---

## 5. Earning credits

The earn side is deliberately small. It only has to fund *creation* for free
users — reading is free and unlimited, so it carries no consumption burden.

| Source | Credits | Cadence | Cap | `reason` | Ship |
|---|---|---|---|---|---|
| **Reading streak** | **2 / 7 / 5** | milestones at day 2, day 5, day 10 | 14 lifetime — nothing repeats | `streak` | Launch |
| **Welcome bonus** | **3** | once, on declining the paywall (§6) | once per authenticated account | `welcome` | Launch |
| **Guest bootstrap** | **3** | once, on first guest bootstrap (§9) | once per anonymous account, 3 per network prefix / 24h | `guest_bootstrap` | Launch |
| **Referral — referrer** | **10** | on invited user's 1st generation | 3/month, 10 lifetime | `referral` | v1.1 |
| **Referral — invited** | **5** | on own 1st generation | once | `referral` | v1.1 |
| **Streak repair** | **0** — restores the streak | day after a missed day, on 30 min of reading | 2/month | — | Launch |

**Steady state for a free user: zero.** The streak ladder pays **14 credits
once**, all of it inside the first ten days, and then stops. With the welcome
bonus a free user's lifetime earn is **17 credits** — against **50/month, every
month**, on every paid plan. The earn side is an activation mechanism, not an
income.

> **Resolved 2026-09-10.** §§1-4 have now been rebuilt against the decided
> ladder — one product at three durations, weekly $5.99 · 20, monthly $12.99 · 50,
> yearly $59 · 50/month, with a **1-credit bundled story start**. The drift
> warning that stood here is retired; the whole document is on one basis again.

### The streak ladder

> **Rebuilt to the milestone shape, 2026-09-10.** The rungs used to sit at day 2,
> day 5, day 7 and every 7 days after. They are now **milestones at day 2, day 5
> and day 10**, matching the *Your journey* screen, which shows exactly these and
> renders them as locked achievements. This replaced a briefly-held plan to pay
> daily through the first week: paying on days 3, 4 and 6 while celebrating only
> 2, 5 and 10 would hand out credits with no milestone on screen to explain them.
> A rung the user cannot see is a rung that cannot motivate.

| Milestone | Credits | Cumulative |
|---|---|---|
| Day 2 | **2** | 2 |
| Day 5 | **7** | 9 |
| Day 10 | **5** | 14 |

**The ladder pays 14 credits, once, and then stops.** With the welcome bonus a
free user's lifetime earn is **17 credits**. There is no recurring rung.

**The mass sits at day 5, deliberately.** Seven credits is the largest single
grant in the earn table and it lands inside the D1-to-D7 cliff (below) rather
than after it. At the bundled 1-credit story start that is seven whole stories
arriving at the exact moment a wavering user decides whether this app is a habit.
The earn side is an **activation** mechanism here, not an income.

> ⚠ **Two open items, both deliberate rather than overlooked.**
>
> 1. **Day 10 pays less than day 5** (5 against 7). Every other ladder in this
>    file rises. This one peaks at day 5 and steps down, which is the
>    front-loading argument taken to its end — but it will read as a mistake to
>    anyone meeting the table cold, and it means the *last* milestone is the
>    *smallest*. Recorded as intended, flagged as worth re-reading.
> 2. **Nothing repeats.** Past day 10 the streak pays nothing and every milestone
>    on *Your journey* is unlocked, so a retained free user has no further reason
>    to hold the streak and no ongoing earn. That is the cheapest possible earn
>    side and a defensible position; it is also a visible dead end in a screen
>    built around progress. A repeating rung — *every 10 days, 2* — would cost
>    ~6/month (12% of the 50 grant, $0.31/month blended) and close it. **Not
>    decided.**

**Cost of the whole ladder: $0.60 blended, $2.49 if all 14 credits start
stories** — one-time, per free user who reaches day 10. It is the cheapest earn
side this document has ever costed.

**A streak is consecutive days with reading activity**, server-recorded: one
chapter finished, or ≥60s of dwell. Miss a day and it resets to zero, and the
rewards restart at day 2.

**Why day 2 is the right first rung.** Median mobile retention falls from **D1
26% to D7 13%** ([Adjust 2026, via UXCam](https://uxcam.com/blog/mobile-app-retention-benchmarks/))
— the cliff is between day one and day seven, so the first reward has to land
before a user is already gone. Day 2 catches them at the top of the fall. The
day-5 and day-7 rungs then bracket the steepest part of it.

**Why it beats a flat daily grant.** A flat "1 credit per app open" pays 30
credits/month uncapped — 60% of the 50/month paid grant — so it needs an
artificial monthly ceiling bolted on to stop the free tier dominating the paid
one. The milestone ladder needs no ceiling because it terminates: 14 credits,
once, and never again. One rule instead of two, and it rewards *consecutive* days
rather than sporadic opens, which is the behavior actually worth paying for. The
full cost comparison is in *The daily credit, re-examined* below.

**Activity is reading**, and that is the point. Reading is free, so a reading
streak is precisely the mechanism that converts readers into creators — it pays
credits for the free behavior and those credits are only spendable on the paid
one.

### Streak repair — the missed day

**The ladder's one weakness is that it is unforgiving.** Miss a single day and
the streak resets to zero and the rewards restart at day 2. For a user on day 40
that is a punishing loss for one bad evening, and the rational response to it is
not to try again — it is to stop.

**Observed on a competitor, 2026-09-10** *(second-hand, not verified against
their published terms)*: after a missed day, the app offers to cancel the miss in
exchange for roughly thirty minutes of reading that day.

**It fits Katha better than it fits them, because reading here is free.** A
repair costs us **exactly nothing** — no API call, no generation, no narration —
and it buys a thirty-minute reading session, which is the top-of-funnel behaviour
we want regardless. This is the rare mechanic where the anti-abuse question is
"what if they do it every week?" and the honest answer is "then they read for
thirty minutes every week."

| Rule | Value |
|---|---|
| **Offered** | Only on the day *after* a single missed day |
| **Requirement** | 30 minutes of reading, accumulated that day |
| **What it grants** | The streak, restored to where it stood. **Not** the missed day's credit |
| **Cap** | 2 per month |
| **Two missed days** | No repair. That is a lapse, not a slip |
| **Idempotency** | `streak_repair:{user_id}:{missed_date}` |

**Reading time is the same signal the streak already uses** — a chapter finished,
or ≥60s of dwell — accumulated to 30 minutes and recorded server-side. Client
reported dwell is not trusted for this any more than it is anywhere else (§9).

**Repair restores the streak but does not pay the missed credit.** The user keeps
a ladder worth ~4 credits/month rather than being sent back to day 2; they do not
also get paid for a day they missed. Paying it as well is defensible and would
cost ~$0.04 a repair — it is a tuning question, not a structural one, and the cap
bounds it either way.

### The daily credit, re-examined

The flat daily grant has now been rejected twice on cost. **It is rejected a
third time, and the bundled story start is a new reason rather than a restated
one.**

Priced against the decided ladder — a paying annual subscriber nets **$50.15/yr**
after the 15% store commission:

| Model | Credits/mo | Cost/yr at blended $0.043 | Cost/yr if spent starting stories ($0.178) |
|---|---|---|---|
| **Flat daily credit** | 30, forever | $15.48/yr | **$64.08/yr** |
| Milestone ladder (shipped) | 14 **once**, then 0 | **$0.60 once** | $2.49 once |
| Retired day-2/5/7 ladder | ~4 | $2.06/yr | $8.54/yr |

**The old argument, unchanged.** 30 credits/month is **60% of the 50/month paid
grant**, over the 50% ceiling in governing principle 7. The free tier would sit
above the line the principle exists to hold.

**The new argument, and it is the serious one.** Bundling the story start into a
single credit — cast, chapter 1 and its cover for one — makes **starting a story
the most expensive credit in the product at $0.178**, and simultaneously the most
attractive thing to spend one on. Free credits flow to their highest-value use,
so they flow there. A daily-credit user who spends every credit starting stories
costs **$64.08/year against the $50.15 an annual subscription nets**. The flat
daily credit would not merely be uneconomic — under the bundle it would be worth
**more than the subscription it exists to sell**.

This coupling is worth stating plainly because it is not obvious and it will
outlive this decision: **the more we bundle into one credit, the more expensive
every free credit becomes.** Any future bundling change re-opens the earn table,
and any future earn-table change has to be priced against the *most* expensive
action a credit can buy, never the blended one.

**What ships instead: the milestone ladder plus repair.** Together they answer
what the daily credit was reaching for — a reason to open the app tomorrow, and
forgiveness when you don't — for **$0.60 once** instead of $15.48-$64.08 every
year. The gap is three orders of magnitude, which is the whole argument.

### Referral

10 + 5 = **$0.63 per activated referral**, cheap against any paid acquisition
channel. Payout is gated on the invited user's **first generation**, not on
signup, which is the right anti-farm design — it requires a real account doing a
real thing. Caps of 3/month and 10 lifetime for the referrer.

Deferred to v1.1 because it needs deep-link attribution that does not exist yet.

**There is no code field on the paywall, and there never will be.** *(Decided
2026-09-05.)* Three reasons, in order of weight:

1. **It is a conversion leak.** A "Have a promo code?" field tells every user
   without one that somebody else is paying less. A measurable share leave the
   purchase flow to go looking for a code, and on mobile that means leaving to a
   browser, which is a bounce.
2. **The referral pays credits, not a discount.** The paywall sells
   subscriptions. A credit grant does not make a subscription cheaper, so a code
   entered there has nothing to act on, and putting one there conflates the two.
3. **Attribution is the mechanism, not redemption.** The payout is already gated
   on the invited user's first generation, which is what makes it anti-farm. A
   code typed at purchase time would pay before that gate or duplicate it.

**What ships instead:**

| Layer | Behaviour |
|---|---|
| **Primary** | Deferred deep link: `katha.ai/i/{code}` → install → referrer resolved on first launch → attribution stored → both grants fire on the invited user's first generation. No UI in the main path. |
| **Fallback** | A code field in **Profile**, labelled *Have an invite code?* — never on the paywall, never in onboarding. Deferred deep links fail for a real share of installs: links opened in the WhatsApp or Instagram in-app browser, iOS clipboard permission, Android install-referrer edge cases. Without a recovery path those referrals are lost and the **referrer** blames us, which is what actually breaks the loop. |
| **The code** | The code and the link are one artifact. 6 to 8 human-typeable characters, no ambiguous glyphs (no `0/O`, `1/l/I`), so the same string works pasted or typed. |
| **Disclosure** | The invited user learns their balance from the in-app message after WELCOME, per decision 29a. Not on the paywall, not on the welcome screen. |

**The invited bonus reads weaker against a 10-credit welcome than it did against
3** — a 50% bump rather than a 167% one. Not a launch problem, because referral
is v1.1, but rebalance the 5 when it actually ships rather than inheriting it.

### Deliberately removed

| Mechanic | Why it's gone |
|---|---|
| **Comment for a credit** | Shipped code grants a credit for a **one-character** comment on any public story, daily, forever, with no requirement the user read it. Rather than harden it, remove it — paying for comments buys comment spam, not community. **This is live in `create_feedback` today and must be disabled before launch.** |
| **Social post reward** | A manual moderation queue to pay out one credit is not worth building. |
| **Reader earnings** | The highest-abuse surface in the app, requiring the full anti-gaming pipeline, and there is no reader volume to calibrate against pre-launch. The front-loaded curve in `strategic-decisions.md` §6 is well designed and can return in v1.2 once there is real traffic. |
| **Rewarded ads** | Rewarded video clears $15–40 eCPM in tier-1 gaming ([RevenueFlex](https://revenueflex.com/blog/app-ad-revenue-benchmarks-2026/), [Business of Apps](https://www.businessofapps.com/ads/rewarded-video/)); *inference:* a global reading app should plan on $6–12 eCPM = **$0.006–$0.012 per impression** against $0.0322-$0.0738 for the credit it buys. Rewarded ads lose money as a credit source at any plausible eCPM. Whether to run **non-rewarded** ads as free-tier revenue is a separate question, deferred. |
| **Flat daily app-open credit** | Rejected three times, most recently 2026-09-10 against the bundled story start — see *The daily credit, re-examined* above. Pays 30/month uncapped (60% of the 50/month paid grant, over principle 7's ceiling) and costs up to **$64.08/year** against the **$50.15** an annual subscription nets. The milestone ladder terminates instead of capping — 14 credits once, then nothing — rewards consecutive days rather than sporadic opens, and with streak repair answers the same product pull for **$0.60, once**. |
| **Premium voice tier** | ~~Every voice is available on every tier including free.~~ **Reversed 2026-09-10, then qualified the same day.** The original reasoning held while every voice was MiniMax, where voice choice is not a cost lever — the same $0.22 either way. `_shared/voices.ts` ships two *providers*: `edge_tts` and `runpod_minimax` (~$0.22 ⚠ unmeasured), and tiering across two engines is a real economic line rather than packaging. **But `edge_tts` does not work and is not free.** Microsoft's consumer endpoint returns 403 to a direct connection (verified 2026-09-10: Deno's `WebSocket` cannot set the required `Origin`/`User-Agent`, and a manual TLS handshake that does set them is refused anyway). `_shared/edge-tts.ts` therefore calls an external worker at `EDGE_TTS_SERVICE_URL` **which does not exist** — Spanish voices already fail as `edge_tts_service_missing`. So the design stands and the price does not: free-tier narration costs whatever hosting a Python worker costs, and **ships only once that worker exists**. Paid MiniMax voices are unlimited on the pre-narrated catalog, where one narration serves every listener, and metered on your own new chapters, where that $0.22 amortizes across exactly one person. |
| **Carry-over cap (2×)** | Replaced by non-rolling monthly grants (§8). |
| **Generation refund as a grant table row** | It is not earning, so it is not on the earn table. The **auto-refund behavior stays** — a failed generation returns every credit it reserved, per principle 4, already implemented as `refund_generation_operation`. It is documented in §1 as a guarantee, not as a way to earn. |

### Plan entitlements — the second thing a plan sells

**Decided 2026-09-10: Download PDF is premium-only.** It is the first entitlement
in the product, so what follows records the *category*, not just the feature.

**Why it cannot be a credit.** Principle 2 draws the line: if we call a paid API
on the user's behalf, that is a credit; if we do not, it is free. **A PDF export
calls no paid API.** Rendering a story we already hold into a file is our own
compute and costs effectively nothing per export. So under principle 2 it cannot
honestly be priced in credits — the choice was only ever *free* or *entitlement*,
and we chose entitlement.

**That opens a second axis, and it should be opened deliberately.** This document
is architected around one currency and one rule — one credit, one AI action. An
entitlement is a different kind of thing: the plan now sells credits **and**
access. That is legitimate, and zero-marginal-cost features are exactly what
belongs on it, because pricing them in credits would be charging for nothing. But
every future entitlement gets tested with the same question first:

> **Does it call a paid API?** If yes, it is a credit and must not be an
> entitlement — gating a metered action by plan hides a real cost behind a flat
> fee. If no, it is a candidate.

| | Free | Any paid plan |
|---|---|---|
| Read, unlimited, forever | ✓ | ✓ |
| Credits every period | — | **50/month**, or 20/week on weekly |
| **Unlimited character portraits** | 4 per account, then 1 credit | **✓** |
| **Unlimited reimagines** | 1 per chapter on your own stories | **✓** |
| **Premium voices** | — | **✓** |
| **Download stories as PDF** | **—** | **✓** |

### Two of those rows fail the "does it call a paid API?" test, and they ship anyway

**Added 2026-09-11, and it is a deliberate exception rather than an oversight.**

Answer the test honestly, row by row:

| Row | Does it call a paid API? | Verdict under the rule |
|---|---|---|
| Download PDF | **No.** Our own compute, ~$0 per export | Legitimate entitlement |
| Premium voices | **No, in the intended design.** The tiering line is `edge_tts` versus `runpod_minimax`, and paid MiniMax voices are unlimited only on the **pre-narrated catalogue**, where one narration serves every listener at ~$0 marginal. Narrating a brand-new chapter is still 1 credit on every tier | Legitimate entitlement, conditional on the edge-tts worker existing (§12 item 8) |
| **Unlimited character portraits** | **Yes.** $0.039 per image, every time | **Fails the rule** |
| **Unlimited reimagines** | **Yes.** $0.0218 of chapter text, every time | **Fails the rule** |

**So two metered actions are being made unlimited for subscribers, and the rule
says that hides a real cost behind a flat fee.** It does. What makes it
defensible here is not that the rule is wrong but that it was written about
*gating*, and this is the opposite move: nothing is being taken from the free
tier, and no free user pays more than they did. A subscriber who would have spent
grant credits on portraits now spends them on chapters instead, so the exposure
is bounded by how fast a human can use the feature rather than by how many
credits they hold.

**What actually bounds it, and it is thin.** Portraits are capped at 12 requests
per hour by `claim_character_portrait_request` (migration 00055) — ~$3.51/hour
against a yearly subscriber's $4.18/month of net revenue. Reimagine is bounded
only by the six-per-user-per-minute generation limit. **Neither is a bound that
survives a determined user**, and the honest statement of the position is that
these two rows are underwritten by the observation that people do not sit and
regenerate portraits for an hour, not by arithmetic.

**Follow-ups, in priority order, and both are server work:**

1. **A server-side ledger enforcement path for both actions.** Today
   `generate-character-image` counts nothing and charges nothing, and
   `reimagine-chapter` charges everyone from the first call. Neither knows what a
   subscriber is. The subscriber exemption and the free tier's counters both have
   to live in the ledger, not the client.
2. **A usage metric on each, with a trigger.** If a p99 subscriber draws more
   than ~30 portraits or ~40 reimagines a month, this exception is repriced —
   most likely to a high monthly ceiling described as unlimited in the ordinary
   way, which is what every comparable product actually ships.

**Do not extend this exception to a third action without re-running the same
honesty pass.** Two rows is an exception; four is a different pricing model.

**It does not break principle 1, but it is close enough that the copy matters.**
Principle 1 says reading is free, always, with no cap. A PDF is a *file*, not a
reading session; reading in the app stays free and uncapped for everyone. The
feature is therefore always "export", never "download to read" — the second
framing would make the gate read as a cap on reading, which is the one thing this
document has never allowed.

**Export ends with the plan, and the paywall must never imply otherwise.**
*(Decided 2026-09-10.)* §1 promises that every story you created stays in your
library on any plan or none — that is about **in-app access**, it still holds
exactly, and it is the only permanence the product promises. Export is not part
of it.

The fix is in the copy, not in the entitlement: **the paywall does not promise
permanence it cannot keep.** No "yours forever", no "keep your stories", no
download iconography next to a permanence claim. The cancellation flow and §8's
lapse warning say plainly that export ends with the plan. A user who is never
told the wrong thing has nothing to be surprised by, which is cheaper and more
honest than engineering a carve-out to satisfy a promise we should not have made.

> **Open: does the free tier get one export?** A PDF carrying cover art is
> genuinely shareable, which makes export a growth vector as well as a feature.
> Gating it completely removes every free user from that vector — the same
> population we make reading free for precisely because they are the top of the
> funnel. One free export, or an unlimited export carrying a Katha footer, keeps
> the growth path open at zero marginal cost. **Not decided.**

> **Placement.** This belongs in §3 (*Pricing and plans*) once §§1-4 are rebuilt
> against the current ladder. It sits here because §5 is where the 2026-09-10
> decisions are currently accurate.

### No unconditional daily free chapter

Google's Gemini free tier gives 20 images/day
([AI Free API](https://www.aifreeapi.com/en/posts/gemini-image-generation-free-api))
because its marginal cost is near zero and it funnels to a $20/month plan.
Katha's creation marginal cost is not near zero, and MiniMax fallback narration
can still be materially higher than text. The entry paid tier is $5.99/week. A
free chapter a day is 90 credits/month — **$46.44/year at the blended $0.043, or
$192/year if those credits start stories at $0.178** — against the $50.15 an
annual subscription nets. It beats every plan we sell by a wide margin. Daily
replenishment is **earned and capped**, never granted.

---

## 6. Onboarding and the paywall flow

**Rebuilt 2026-09-11.** Onboarding no longer branches into a reader path and a
writer path: every purpose makes one character, sees their portrait, and reaches
the same paywall. Screen-level design is specified in
[`ONBOARDING_FLOW.md`](ONBOARDING_FLOW.md), the canonical onboarding
specification; only the money is defined here.

```
Anonymous session at app open, upgraded to a real account
before any purchase and before any grant
│
├─→  PURPOSE  ── read, write, or both ──→ the same character flow
│                                          (reader- or writer-voiced copy)
│                                                │
│              bridge → who → wait → reveal → plan bridge
│              "Their first chapter is 3 credits. A plan keeps them going."
│                                                │
│                                          SAVE {NAME}
│                                       email → 6-digit code
│                                                │
│                                          THE PAYWALL
│                    $5.99/wk · 20 cr          $59/yr · 50 cr/mo
│
│              Two cards, nothing else. Yearly selected by default, badged
│              SAVE 80% (weekly annualised, §3) and noted "$0.16 a day"
│              (59 / 365, derived in code). No trial offered here, no
│              monthly, no More options: monthly stays an in-app SKU, and
│              no monthly-equivalent price appears on the yearly card.
│              Four benefit rows: 50 credits a month, unlimited portraits
│              and reimagines, premium voices, PDF export.
│              Dismiss is large, obvious, present from frame one.
│                    │                                    │
│                    ├─ Subscribes → full grant on charge → app
│                    │                                    │
│                    └─ Declines ──────────┬──────────────┘
│                                          │
│                                          ↓
│                                   3 credits granted
│                                          │
│                                          ↓
│                                    WELCOME  "Welcome to Katha."
│                                    Three gold coins fly to the credits
│                                    pill on Open Katha, which ticks 0 → 3.
│                                    Once per account.
│                                                │
└───────────────────────────────────────────────┴─→  Into the app
```

*(There is no one-time offer step. It was removed 2026-09-10 — §3.)*

**For named onboarding, the welcome bonus is the consolation, not the greeting.**
It is granted only after the user has declined the paywall; subscribers do not
need it and should not be given it.

**Three credits is exactly one story start: the cast, chapter 1's words and its
art, which becomes the cover.** *(Reduced from 10 on 2026-09-11; it had been
raised from 3 on 2026-09-05.)* That is the whole reasoning for the number. A
welcome bonus that buys one complete thing is legible — the person starts a
story, sees a cast and an illustrated first chapter, and knows precisely what a
credit does. Ten bought a story start plus seven further chapters, which is not a
more generous version of the same lesson; it is a week of product given to
somebody who has not yet decided they want it, and it is the single most
expensive free surface in the document because free credits flow to the most
expensive action a credit can buy (§5, *The daily credit, re-examined*).

At the code's 3-credit story start, 10 welcome credits cost up to **$0.59** per
declining user against **$0.178** at three. Combined with free unlimited reading
and the streak ladder, a free user's first day is still a finished, illustrated
first chapter and as much reading as they want — which was the whole of what the
10 was defended on.

**The guest bootstrap is also 3, and it is still a separate grant.** The
sign-in-free client grants a one-time **3**-credit balance to a server-verified
anonymous session under §9's rate limit, keyed `guest_bootstrap:{user_id}`; the
named welcome bonus is keyed `welcome:{user_id}`.

**The two numbers are now equal, and the keys stay separate anyway.** Equality is
a coincidence of this revision, not a merge. They are protected by different
things: the named grant sits behind Apple / Google / email, while the guest grant
is protected only by a salted network-prefix limit of three per 24 hours, so at
3 it permits 9 credits per network per day against an unauthenticated surface and
at 10 it would permit 30, which is a farm. **The guest number is bounded by that
limit and the named number is bounded by conversion economics**, so they answer
to different constraints and will diverge again the moment either is tuned. One
key per grant is also what makes a guest who later signs in receive both, which
is intended, because they converted.

**A guest who signs in keeps their 3 and then receives the named 3, because the
conversion is in place.** `ONBOARDING_FLOW.md` §16 records the verified code
fact: `updateUser({ email })` plus `verifyOtp({ type: "email_change" })` keeps
`auth.users.id`, so the guest balance is the named account's balance and
`bootstrap-user` no longer takes the guest branch, which is what stops a second
guest grant being minted. Six credits, two keys, one identity.

**The one exception is signing into an account that already exists**, where there
is no in-place merge and the guest identity is left behind. The saved character
is re-pointed onto the account (`claim_guest_characters`, migration 00081); **the
3 guest credits are not**. That is deliberate and it is a §9 anti-abuse decision
rather than an oversight: the guest grant is bounded by a salted network-prefix
limit, and letting it ride onto any account the device signs into would turn that
limit into a farm — fresh guest session, sign in, repeat, three credits a time.
A character is the person's own artifact and there is one of it; credits are
money.

**Non-negotiable:** the paywall is skippable at every step, and declining it costs
the user nothing except the plan they declined. Freemium median D35 trial-to-paid
is **2.1%** vs **10.7%** for hard paywalls
([RevenueCat 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026))
— we are choosing the lower-converting structure deliberately, because reading is
free and the funnel is the library, not the paywall.

---

## 7. The blocked moment

Because starting a story costs 3, a further chapter 1 or 2, and audio 1,
partial balances are real and common. The sheet has to handle them well, and it
has to name the action it is blocking rather than assume a single price.

```
User taps a paid action.
│
├─ balance >= cost
│     → Proceed. No interruption. No confirmation dialog.
│
├─ balance < cost                    ── NOT-ENOUGH-CREDITS SHEET
│     Header:  "You have 2 credits. <action> needs <n>."
│              e.g. "Starting a story needs 3." / "This chapter needs 2."
│              The action and its cost are BOTH dynamic - never hardcode 3,
│              which is only ever the story-start price.
│              (always lead with what they HAVE)
│     Sub:     "Reading stays free — always."
│     Footer:  "If a generation fails, your credits come back."
│
│     Options, ordered by TIME-TO-UNBLOCK, not by revenue:
│
│     1. [ MAKE IT WITH WHAT YOU HAVE → ]        ← primary, when possible
│          "Write the chapter now (1 credit), add the cover later."
│          The single best thing about unbundling: a partial balance
│          is usually still enough to do SOMETHING. Offer that first.
│
│     2. Streak row — INFORMATION, not a button:
│          "Day 4 of your streak. Day 5 pays 1 credit."
│          Shown ONLY when the next milestone lands within 48h.
│          Otherwise omitted entirely — never render a 6-day wait
│          as if it were an option.
│
│     3. [ Read something instead → ]            ← deep-links to the feed
│
│     4. [ 10 credits — $3.49 ]                  ← secondary
│
│     5. [ Plans from $5.99/week ]               ← tertiary
│          shown ONLY when lifetime generations >= 2
│
│     6. Dismiss — large, obvious, top-right. Returns to the saved draft.
```

### Why this order

Option 1 exists only because we unbundled, and it is the strongest thing in this
design: **a user with 1 credit is never fully blocked.** They can write the text
now and buy the cover tomorrow. Under a 3-credits-or-nothing model that user hits
a wall; here they make progress. Lead with it.

The free paths rank above the purchase paths deliberately. The Duolingo teardown
finds that **users who convert to remove friction churn faster than users who
convert for positive value** ([Crosley](https://blakecrosley.com/guides/design/duolingo)).
A sheet engineered to make the free path feel bad buys a worse cohort.

Plans are gated behind two lifetime generations because a cold subscription
upsell to someone who has not felt the product is the lowest-converting and most
resentment-generating placement available.

### Continuity rules

- **The draft survives everything.** AsyncStorage persistence already exists
  (500ms debounce, 7-day expiry). Whether the user buys or dismisses, they return
  to their typed premise intact.
- **After a successful top-up, the pending action fires automatically.** No second
  tap. The user was mid-intent; finish the intent.
- **Every paid button shows its price**, and the price is the price of *that*
  action in *that* state: `Create · 3 credits` to start a story, or `Create · 2
  credits` when the user has already uploaded their own cover and chapter 1's
  art will not be generated; `Continue · 1 credit` for the next chapter, or
  `Continue · 2 credits` when chapters are illustrated; `Listen · 1 credit`. The
  blocked moment is anticipated, never sprung.
- **Insufficient balance on entering Create shows an inline banner, never a
  modal.** The user can still type, still browse, still save.

### Never

- Block reading. Ever. On any tier. For any reason.
- Auto-open the paywall on launch or after a generation completes.
- Countdown timers, "only 2 left today!", or scarcity framing **on any in-app
  surface**, with **no exceptions** since the one-time offer was removed (§3).
  The carve-out that used to follow this line — a real, server-enforced
  2-minute clock on that offer — went with the offer it described, and the
  sentence fragment it left behind was still authorizing a countdown one line
  under the ban. There is no exception now. False scarcity remains banned
  everywhere: no "only 2 left", no restock, no recovery push, no second
  showing.
- Hide, shrink, or delay a dismiss control.
- Charge for a retry after our own failure.

---

## 8. Expiry, lapse, and chargebacks

### Subscription grants do not roll over

Each period delivers a fresh 20 or 50. Unused grant credits do not accumulate.
This is what bounds the yearly plan's exposure (§4) and it is standard practice
across every credit-based creative tool. **It replaces the old "carry-over capped
at 2×" rule**, which could not be enforced correctly against a single-balance
ledger without silently penalizing subscribers who also bought packs.

### Credits lapse with the subscription

**When a subscription ends, the credit balance goes to zero.** Not just the
current period's grant — the whole balance, including earned credits and credits
bought as packs while subscribed.

The rationale is that a credit is an entitlement of an active plan rather than a
stored-value token. It removes the win-back liability of a lapsed user sitting on
a bankable balance, and it makes "use them before you cancel" a real reason to
stay subscribed.

**What survives, permanently, on any plan or none:**

- Every story and chapter the user created. Theirs forever.
- Every chapter of audio they unlocked. Still playable.
- **Reading.** Free and unlimited, forever, subscription or not.

So a lapsed user loses spending power, never their library. That distinction has
to be explicit in the cancellation flow and in the "How Credits Work" page — see
§1, which states it plainly rather than burying it.

**⚠ Two consequences that need a decision before launch** (§12, item 8):

1. **Purchased pack credits are a separate consumable IAP.** Voiding them because
   a *different* product lapsed is a plausible App Store guideline problem and a
   direct refund and chargeback trigger. This needs confirming with App Review
   before the SKUs ship, and it may force a carve-out where packs survive lapse
   even though grants do not.
2. **It creates an asymmetry.** A user who never subscribes and only buys packs
   has no subscription to lapse, so their credits last forever — while an
   ex-subscriber who bought the identical pack loses theirs. That is hard to
   explain at a support desk and should be surfaced at purchase time if the rule
   stands.

### Warning before the balance is voided

Lapse must never be silent. Required:

- **A push and an in-app notice 3 days before** a subscription expires, stating
  the exact balance at risk: *"Your 14 credits expire when your plan ends on the
  9th."*
- **The same number in the cancellation flow**, before the cancel is confirmed.
- **A post-lapse notice** stating what was kept: library, unlocked audio, free
  reading.

A user who loses a balance they were never told about writes a one-star review
and files a refund. A user who was told twice does not.

### Chargebacks — shipped behavior

RevenueCat store refunds are processed as `CANCELLATION` events with
`CUSTOMER_SUPPORT` or `DEVELOPER_INITIATED` reasons. The webhook calls the
`'chargeback'` deduction path, which clamps the clawback to the available balance,
records any shortfall, and never drives the balance negative. `REFUND_REVERSED`
re-grants the original product allocation. Plain cancellation reasons remain
no-ops until RevenueCat emits `EXPIRATION`.

## 9. Anti-abuse

Proportionate to a pre-launch app. Seven controls to build, and an explicit list
of what **not** to build.

1. **Require a server-verified Supabase JWT before any grant.** Named-account
   grants require Apple / Google / email. The temporary guest bootstrap is the
   sole exception: it grants 3 credits once per anonymous Supabase user via
   `guest_bootstrap:{user_id}`, with a server-side, salted network-prefix limit of
   three guest grants per 24 hours and a shared ceiling of 300 guest grants per
   UTC day. Only an edge-owned client-address header can establish the network
   scope; missing or malformed scope fails closed. It stays at 3 while the named
   welcome bonus is also 3 — equal since 2026-09-11 and still a separate key, for
   the reason given in §6. It is not a device-local grant,
   and guest accounts cannot publish publicly. Anonymous story shaping is also
   limited to 30 calls per network per 24 hours and 500 calls globally per UTC day,
   in addition to the six-per-user-per-minute limit.
2. **`operation_key = 'welcome:{user_id}'`.** The existing unique index on
   `(user_id, operation_key)` then makes a duplicate welcome grant structurally
   impossible rather than merely against policy.
3. **Streak clock integrity.** Compute `streaks.last_activity_date`
   **server-side from `now()`** in a fixed timezone; never accept a
   client-supplied date, and reject activity timestamps more than one day in the
   future. Grant each milestone with
   `operation_key = 'streak:{user_id}:{milestone_day}'` so a replayed milestone is
   a structural no-op against the existing unique index — that one convention
   defeats most streak farming with no detection logic at all. The ladder is
   self-capping, so no monthly ceiling needs enforcing.
4. **Reduced trial grants.** 10 credits during the 3-day trial; full grant only
   on first successful charge. *(The 15 (Writer) / 5 (Reader) split died with
   the two-audience grid on 2026-09-10; §3 carries the current number.)* **The
   onboarding paywall no longer offers the trial at all** *(2026-09-11)*, so
   this rule now applies only to trials started from the in-app surfaces — which
   also removes the cheapest path to a trial-abuse loop, since a trial can no
   longer be started by a session that has never left onboarding.
5. **Referral gating** (v1.1): payout only after the invited user's first
   generation; invited account ≥24h old at payout; caps of 3/month and 10
   lifetime for the referrer.
6. **Four character portraits per anonymous identity, for the life of that
   identity** (decided 2026-09-11; migration 00084,
   `claim_guest_portrait_request`, enforced in `generate-character-image`).
   Onboarding's aha is now the portrait, and it is drawn **before** the email is
   asked for — so the first thing an unverified identity can do is spend real
   money at the image provider, with no credit reservation and no idempotency
   key in front of it. 00055's 12-per-hour window does not bound that: it bounds
   one session, and a fresh session is one `signInAnonymously` call away, which
   00055 recorded as its own open gap. Four is the number because onboarding
   makes one character and offers one reimagine (two requests), and four leaves
   room for a retry and a second character while staying far under the hourly
   window. It is also the free-tier portrait allowance the paywall already
   promises, so a guest who signs in has spent the allowance they were told
   about and not a hidden second one. **The key is `auth.users.id`, never a
   device identifier** — see the "deliberately not building" list below;
   collecting an IDFV or install UUID is a privacy and store-disclosure
   decision, not a rate-limit detail. The residual hole (mint a new anonymous
   session, get four more) is accepted and stated rather than closed, and is
   bounded on the other side by control 1's three guest bootstraps per network
   per day. A refusal is **403** with `code: "guest_portrait_cap"` and the copy
   "Sign in to keep making characters." — not 429, because there is nothing to
   wait for. A failed generation calls `release_guest_portrait_request` and does
   not burn a slot. The counter stops being consulted the moment `is_anonymous`
   is false; it is **not** carried to a named account by `claim_guest_characters`
   (00082), which moves characters and nothing else.
7. **One monitoring query instead of a prevention system.** Daily: accounts where
   `subsidized_grants / total_grants > 0.9` **and** `lifetime_grants > 15`. Costs
   nothing, catches the farm, and produces the data needed to decide what to build
   next.

**Disable `create_feedback`'s credit grant before launch.** The comment reward is
removed from the economy (§5) but the RPC still pays out in shipped code.

**Deliberately not building pre-launch:** device fingerprinting, IP reputation, ML
fraud scoring, pending-credit clawback buffers, per-device read caps, and
read-ratio anomaly pipelines. All correct eventually; none worth building before
there are users to abuse it. Build the controls when the monitoring query shows
the abuse.

---

## 10. Implementation plan

### What changes where

| Layer | Change | Why |
|---|---|---|
| **Schema** | **None to `credit_ledger.amount`** — stays `integer` | 1 credit = 1 action needs no new representation |
| Schema | Balance zeroing on subscription lapse, plus the 3-day pre-expiry warning job | §8 |
| Schema | Per-chapter free-reimagine counter (author-owned stories only) and cover regens used. **The AI-redraft and paragraph-edit counters are cancelled** — those actions do not exist (§1a) | Enforce §1's free caps |
| Schema | `audio_unlocks (user_id, chapter_id)` — the permanent listen entitlement | §1 |
| **RPC `deduct_credit`** | Extend the reason allowlist beyond `'generation'`; add `'chargeback'` clamped to available balance | **Blocks every spend path in this document today** |
| **RPC `reserve_generation_operation`** | Replace the hardcoded amount `1` with a per-action price lookup | Prices must be data, not literals |
| RPC `create_feedback` | **Remove the credit grant** | §5, §9 |
| RPC (new) | Streak milestone grant keyed `streak:{user_id}:{milestone_day}`; reuses `streaks.next_credit_at`, reinterpreted as "day-count of the next unclaimed milestone" (its default of 3 becomes 2). **Semantic change only, no schema change.** | §5, §9 |
| **Edge functions** | Separate spend paths for text, cover, character set, audio unlock | Unbundling |
| **Edge function (new)** | Catalog narration job — top ~500 chapters by read volume, weekly refresh | §4 |
| **Client** | Not-enough-credits sheet replaces the `Alert.alert` calls in `CreateStudioScreen.tsx:376` and `:683` | §7 |
| Client | Paywall → welcome sequence | §6 |
| Client | Cancellation flow must state the exact balance at risk before confirming | §8 |
| Client | Price label on every paid action | §7 |
| **Copy** | `expo/App.tsx` `CreditsScreen` — the credit explainer still describes the retired bundle (*"one credit each for the text, its cover and its characters"*). It must read: starting a story is 3, each further chapter 1, or 2 illustrated | Unbundling |
| **RevenueCat** | The 10 SKUs in §3, replacing the current 5 | §3 |

**The single most important implementation note:** prices live in **one
server-side price map**, not as literals across edge functions. Every tuning
decision in §11 depends on changing a price in one place. The hardcoded `1` inside
`reserve_generation_operation` is exactly the pattern to remove.

### Phasing

| Phase | Contents |
|---|---|
| **1 — Launch** | Story start bundled at 1 credit, further chapters at 1 (2 illustrated); free unlimited reading; the free tier's 1 reimagine per authored chapter and 4 portraits per account, both unlimited on a plan; streak ladder + repair; 3-credit welcome bonus; lapse warnings; paywall (no offer); 6 packs; 9 SKUs |
| **2 — Audio** | Only after edge-tts cost/reliability is measured (§12): catalog narration job first, then the 1-credit chapter unlock |
| **3 — v1.1** | Referral with deep-link attribution |

Phase 1 is a complete, coherent economy on its own. Audio is the only piece gated
on an unmeasured number, and gating it is deliberate.

---

## 11. Metrics and tuning triggers

Instrument at launch. Each has a threshold that triggers a specific change, so the
economy is tuned on evidence rather than argued about.

| Metric | Why | Trigger → action |
|---|---|---|
| **Credit utilisation, yearly** | The 12%-margin row, and the plan that self-selects for heavy use | Median burn > 40 of 50 → reprice or cut the grant |
| **Pack attach rate among Writer subscribers** | The 50-credit grant is designed to route overflow into 85–90% margin packs | < 15% of Writer subs buying a pack → the grant is too generous |
| **Catalog hit rate on audio unlocks** | Cached audio is instant and keeps replay cost near zero | Fresh rate > 40% → widen the catalog job |
| **Actual $/chapter narration by provider** | Every audio number here is extrapolated until a batch is measured | Edge > $0.01 or MiniMax > $0.30 → re-run the Reader math |
| **D3 / D7 / D30 retention, streak-holders vs not** | Validates the ladder against the 26% / 13% / 7% baseline ([Adjust](https://uxcam.com/blog/mobile-app-retention-benchmarks/)) | No D7 lift after 8 weeks → the ladder is decoration; re-cadence it |
| **Streak milestone claim rate, by rung** | Whether day 2 / 5 / 10 are the right rungs | Day-2 claim < 50% of D2-actives → the first rung lands too late; move it to day 1 |
| **Free → paid conversion at D35** | Benchmark is 2.1% freemium median ([RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)) | < 1% → the paywall sequence is wrong before the earn table is; the free tier earns nothing in steady state, so the paywall is the only lever |
| **Refund/chargeback rate after lapse** | Voiding a purchased balance is the highest-risk rule in this document | Any measurable lift over baseline → carve packs out of the lapse rule |
| **Win-back rate on lapsed users** | Lapsing credits removes the strongest win-back hook we had | Below 5% reactivation at 90 days → reconsider zeroing earned credits |
| **Reader → Writer upgrade rate** | Validates that the price list makes upgrading obvious rather than buying packs | Pack purchases by Readers > upgrades → re-run the §4 inversion check |
| **Partial-balance actions** ("text now, cover later") | Validates the core benefit of unbundling | < 10% of blocked users → the sheet's option 1 is not readable |
| **Cover regeneration rate** | A proxy for cover-prompt quality | > 40% of covers regenerated → fix the prompt, not the price |
| **Reimagines per subscriber per month, p99** | The unlimited-reimagine and unlimited-portrait rows are a deliberate exception to the entitlement rule (§5) and are bounded only by rate limits | p99 > ~40 reimagines or ~30 portraits → reprice the exception to a stated monthly ceiling |
| **Actual $/action: LLM + image + TTS** | Every margin number here is an estimate | Any line > 1.5× the §2 estimate → re-run §4 |

---

## 12. Open items — must resolve before shipping

1. **Actual narration cost per chapter by provider.** Edge-tts is estimated from
   worker/runtime arithmetic, and MiniMax is extrapolated from published rates
   ($0.05–$0.10/1k chars). Our real cost depends on worker duration, throttling,
   endpoint throughput and cold starts, none of which have a measured batch yet.
   **Audio cannot ship broadly until this is measured.** Above ~$0.01/chapter on
   edge-tts or ~$0.30/chapter on MiniMax, the catalog budget and the Reader grant
   both need rework.
2. ~~**Confirm image quality at `low` for character sets.**~~ **Moot** — Gemini
   takes no quality parameter and charges a flat 1,290 output tokens per image, so
   there is no `low` tier to confirm. What replaced it: a cast of three now costs
   **$0.117**, not $0.033, which is why a story start is the most expensive credit
   in the product.
3. **Verify Apple's commission tier — this is now load-bearing.** All margin math
   assumes 15% (Small Business Program). At 30% the yearly nets **$0.0688/credit**
   against **$0.0738** at the worst story shape: **the constraint row goes
   negative.** It still clears 38% blended, but the "no losing rows" property of
   the current price list holds *only* under the 15% commission. Confirm before
   launch.
4. **Decide the non-credit subscriber benefit.** With voice tiers removed, a
   subscription is now purely a credit bundle and survives only on per-credit
   arithmetic that packs constantly nip at. A **priority generation queue** costs
   almost nothing, is standard (Midjourney fast hours, ChatGPT priority) and gives
   the subscription a reason to exist that a pack cannot replicate. **Decide
   before the RevenueCat SKUs are created**, since it changes paywall copy.
5. **Confirm with App Review that voiding purchased pack credits on subscription
   lapse is permitted.** Packs are consumable IAPs; voiding them because a
   separate subscription ended is a plausible guideline problem and a direct
   refund trigger. If it is not permitted, packs are carved out of §8 and only
   granted and earned credits lapse. **Decide before the SKUs ship.**
6. **Create the Supabase `covers` bucket.** Still outstanding, and every
   cover-related price assumes it exists.
7. **Resolved (2026-09-03): no ads of any kind ship in the MVP.** Reading stays
   free, unlimited and uninterrupted; principle 1 and the §7 "never block reading"
   rule stand unchanged. Ads are deferred to `backend/ROADMAP.md` Phase C2, after
   the MVP launch. A proposal to add a house-styled between-chapter break on the
   free tier — so "read without interruptions" could be sold as a paid benefit —
   was **rejected**: house-styled means it earns nothing, so it was friction with
   no revenue, and §7 already cites the finding that users who convert to remove
   friction churn faster than those who convert for positive value.
   **Until ads actually exist, no paywall, onboarding screen, or store listing may
   list "ad-free", "no ads", or "no interruptions" as a paid benefit** — a benefit
   that removes nothing is a misleading-subscription risk at App Review. When ads
   do ship, that benefit line and the two clauses above are amended in the same
   commit, so this document never contradicts itself.
8. **Resolved in code, pending production measurement: `_shared/edge-tts.ts` has
   a worker-backed implementation.** Set `EDGE_TTS_SERVICE_URL` before enabling
   Microsoft voices in production. The first measured batch must record worker
   runtime, MP3 size, failure rate and throttling, then replace the estimate in
   §2.
9. **Decide the OpenRouter data-policy setting, and confirm the chapter figure
   against a bill.** §2 now carries **$0.0160 per chapter** on
   `meta/muse-spark-1.3`, extrapolated from a single **measured** call
   ($0.006099, 957 reasoning tokens of 1,408 completion tokens) rather than from
   a rate card. The extrapolation to a full chapter is not itself measured, so a
   week of real OpenRouter spend divided by chapters generated is still owed.
   The larger open item is a decision, not a measurement: the configured default
   `meta/muse-spark-1.3-contributor` is **17x cheaper** and returns `404` today
   because the account's privacy setting blocks endpoints that train on prompts
   and completions. Enabling it at https://openrouter.ai/settings/privacy sends
   users' story ideas and generated prose to the provider for training. That is
   a product and policy call and it belongs to the product owner.
10. ~~**Recompute §4 against the corrected cost basis.**~~ **Done 2026-09-10.**
    §§1-4 were rebuilt against the flat $0.039 image rate, the $0.117 cast, the
    bundled 1-credit story start and the single plan ladder. §4 is now computed at
    the **worst** story shape ($0.0738/credit) rather than a blended figure, so its
    margins are floors rather than averages.

---

<!-- markdownlint-disable MD029 -->
<!-- Scoped to this block only. The list below is one continuous sequence split
     by sub-headings, so each sub-list starts at 7, 11, 19, 21 and so on. Those
     numbers are cited by number from AGENTS.md, both build logs and
     STORY_GENERATION_FLOW.md, so they must not be renumbered for the linter. -->

## Decisions

### Currency and model

1. **One credit = one AI action.** Not one story. `credit_ledger.amount` stays
   `integer`. No decimals, no fractions, no second currency, no separate
   consumption meter.
2. **Starting a story costs 3 credits** — 1 cast + 1 chapter-1 text + 1 chapter-1
   art, which is the cover. Each further chapter is 1, or 2 illustrated. The
   actions are **separately purchasable** and charged as they happen, so a user
   with 1 credit can still make progress and an abandoned story costs only what
   it wrote.
3. **Reading is free, unlimited, on every tier, forever.** No caps, no metering,
   no daily pass. A permanent commitment, not a launch promo.
4. **Audio is 1 credit per chapter, unlocked permanently.** Re-listens,
   pause/resume and library re-opens are free forever, including for the user's
   own stories.
5. ~~**No voice tiers.** Every voice is available on every tier, including
   free.~~ **Reversed 2026-09-10, and **Premium voices** is a paywall entitlement
   row since 2026-09-11.** The tiering line is `edge_tts` (free) versus
   `runpod_minimax` (paid), which is two engines rather than packaging — but
   `edge_tts` does not work yet, so the row ships only once the worker at
   `EDGE_TTS_SERVICE_URL` exists (§5, *Deliberately removed*; §12 item 8).
6. **Never charge twice for the same thing**, and **never charge for our own
   failure** — failed generations auto-refund the full reservation.

### Creation and drafting

7. **Free forever, uncapped:** read, re-read, browse, search, library, manual text
   editing, save, publish, unpublish, delete, upload your own cover, follow, like,
   comment, share, retry after a failed generation.
8. **Free but capped** *(rewritten 2026-09-11)*: on the **free tier**, **1
   reimagine per chapter of a story you created** and **4 character images per
   account (create or edit)**. Beyond each, 1 credit — except a non-author
   reimagine, which is 1 credit from the first because it forks. On **any paid
   plan**, reimagines and character portraits are **unlimited and never charged**,
   which is a recorded exception to the entitlement rule (§5). ~~**3 AI redrafts
   per chapter**, **20 paragraph AI edits per chapter**~~ — **retired
   2026-09-11**: neither action exists in the shipped product; Reimagine is the
   only AI editing action and hand editing is free and uncapped (§1a). ~~1 cover
   regeneration per paid cover~~ — **removed 2026-09-10**: cover regeneration costs
   1 credit from the first.
9. ~~**Render settings are constraints, not defaults.**~~ **Retired 2026-09-10.**
   The three render tiers (cover $0.063 / chapter art $0.042 / portrait $0.011)
   were derived from `gpt-image-1`'s size×quality matrix. Gemini takes neither
   parameter and charges a **flat $0.039 per image**, so there is nothing to pin
   and no lever to tier on. A cast is still capped at **3** — now a $0.117 cost
   bound as well as a product one. Aspect ratio is carried in the prompt text
   (`ASPECT` in `_shared/image.ts`), so it is a request, not a guarantee.
10. **Chapter art is a priced action, and it is the same feature as the cover.**
    *(Amended 2026-09-02. This decision previously removed chapter illustrations
    entirely. `STORY_GENERATION_FLOW.md` §10.4 made the product case for
    reinstating them; **it does not set the price, and nothing there overrides
    this file.** That document governs the screens, the toggle and when an image
    is generated; this one governs whether an action costs a credit, how many,
    and at what render cost. The margin derivation and its conclusions are in
    §2 and in this decision.)*

    Every chapter may have one image. **Chapter 1's is compulsory and becomes the
    story's cover**; chapters 2–N are optional at 1 ✦ each behind a More-options
    toggle that is **off by default**. A story is not a thing with a cover plus
    pictures — it is a sequence of chapters, the first of which you see on the
    shelf. The creation flow is therefore text, characters, and chapter art.

    **The attach rate is not a launch dependency.** At the §2 tiers, 100% attach
    clears the 40% floor at 3, 7 and 15 chapters. It remains worth instrumenting;
    it does not gate release.

### Pricing

11. **The plan grid** *(revised 2026-09-10; the two-audience Reader/Writer grid is
    retired — one product, three durations):*

    | | Weekly | Monthly | Yearly · 3-day trial |
    |---|---|---|---|
    | **Katha** | **$5.99** · 20 credits | **$12.99** · 50/mo | **$59** · 50/mo |

11a. **Starting a story costs 1 credit and bundles three actions** — the cast,
    chapter 1, and chapter 1's art. Every chapter after is 1; chapter art is 1
    each; a cover regeneration is 1. *(Revised 2026-09-10 from a 3-credit
    unbundled start.)*
12. **Presentation:** weekly and yearly upfront, yearly selected by default,
    weekly without a trial.
12a. **The onboarding paywall shows weekly and yearly only** *(2026-09-11, the
    W7 hand-off)*: **no trial offered, no monthly, no More options disclosure.**
    Monthly stays a live SKU sold in-app; the trial stays a store configuration
    on the yearly SKU. The yearly card's **SAVE 80%** badge is the weekly
    annualised comparison ($311.48 vs $59 = 81%, rounded down), never the 62%
    yearly-vs-monthly discount.
12b. **The yearly card's note is a daily price, not a monthly equivalent**
    *(2026-09-12)*: **"$0.16 a day"**, derived in code as $59 / 365 rounded to
    cents, replacing "$4.92 a month, billed yearly". A monthly equivalent is a
    comparison against the plan this screen withholds, and it is unreadable
    without the price it compares to. Both derived numbers on the card — the
    badge and the note — are recomputed from the plan's price and never typed as
    literals, so a localised price moves them. Neither may be rendered as a price
    in its own right or as a struck-through former price.
13. **The grant is 50 credits, not 100.** At $59/yr, 100 credits loses money at
    every story shape and 50 clears 12% at the worst and 49% blended. The smaller
    grant also routes overflow demand into 60–78% margin packs. A competitor's
    headline credit count is not comparable and must not drive this number.
14. ~~**One-time offer: yearly, $29 first year.**~~ **Removed 2026-09-10.** It lost
    $19.63 at the worst story shape and cleared only 43% blended. The single ladder
    left nothing to discount but the thinnest row in the model. **The weekly plan
    at $5.99 is the low-commitment entry instead** — profitable at every shape, no
    countdown, no expiry. Onboarding is now paywall → welcome, and the welcome
    bonus fires on declining the paywall.
15. **There are no countdown timers anywhere in Katha.** *(Absolute since
    2026-09-10.)* §7's ban on false scarcity previously carried one carve-out for
    the one-time offer; removing the offer removes the carve-out. No surface in the
    product uses a clock to pressure a purchase.
16. **Credit packs: $1.99/5 · $3.49/10 · $9.99/30 · $24.99/100 · $64.99/300 ·
    $119.99/1000.** Every pack prices above the yearly rate, monotonically, so the
    subscription is always the best price per credit. **Pack credits do not expire
    monthly; plan credits do** — carry-over, not price, is what a pack sells.
17. **Reduced trial grant: 10 credits** during the 3-day trial; the full 50 lands
    on first successful charge. Caps trial-abuse downside at $0.74.
18. **Constraint of record:** yearly at $59/600 nets **$0.0836/credit** against
    **$0.0738** at the worst story shape — **12% margin at maximum burn**, 49%
    blended. Every future pricing change is tested against this row **at the worst
    shape**, and against the §4 inversion check.
18a. **There are no free image retries** *(2026-09-10)*. A failed generation still
    auto-refunds; a delivered image you dislike costs a credit to replace.
18b. **Reimagining a chapter is unlimited on any paid plan and never charged;
    on the free tier it is 1 free per chapter of a story you created, then the
    plan is offered rather than a price; a non-author reimagine forks and costs 1
    credit from the first** *(revised 2026-09-11 from "free twice, then 1 credit
    each")*. **Both ⚠ holes the old rule carried are resolved**: the free
    allowance is scoped to authored stories, and the fork-counter problem
    dissolves once subscribers are exempt and the free allowance is one. The
    server-side subscriber exemption and the free counter are **not implemented** —
    `reimagine-chapter` charges everyone from the first call today.
18d. **Character images: unlimited on any paid plan; 4 free per account then 1
    credit each on the free tier** *(2026-09-10, amended 2026-09-11 to add the
    subscriber exemption)*.
    **Generating and editing draw on the same four**, because a portrait is made
    from the Name/Description/Appearance fields and an edit to any of them is a
    fresh paid image. The counter is on the **account** because saved characters
    are cross-story, so no per-story or per-character allowance bounds anything.
    The four are scoped to the standalone character path — a story start's cast of
    three is already paid for by its credit and does not consume them. Written as
    a lifetime allowance. This closes the pricing question migration 00055
    deferred; the 12/hour rate limit stays alongside it.
18e. **Reusing a saved character costs nothing, and that is load-bearing**
    *(2026-09-10)*. A story start with an all-saved cast costs $0.104 rather than
    $0.221, so the worst story shape falls from $0.0738 to $0.0348/credit and the
    yearly margin at that shape rises from 12% to 58%. Never reprice the story
    start without checking which cast it assumes.
18c. **Download PDF is a paid-plan entitlement** *(2026-09-10)*, the first
    entitlement in the product. Export ends with the plan and the paywall must
    never imply otherwise.
18f. **The paywall sells five rows, in this order** *(2026-09-11)*: 50 credits
    every month (20 a week on weekly), unlimited character portraits, unlimited
    reimagines, premium voices, download stories as PDF. Each paid row carries its
    free-tier figure as quiet secondary text. Never "unlimited generation",
    "ad-free", "no interruptions", "priority generation", "yours forever",
    testimonials or star ratings.
18g. **Unlimited portraits and unlimited reimagines are a recorded exception to
    the entitlement rule** *(2026-09-11)*. Both call a paid API, so both fail the
    "does it call a paid API?" test that governs every other entitlement. They
    ship as entitlements anyway because nothing is taken from the free tier and
    the move is un-gating rather than gating. They are bounded only by the
    existing rate limits — 12 portrait requests/hour, 6 generations/minute — which
    is thin, and **server-side ledger enforcement of both the exemption and the
    free tier's counters is a follow-up that does not exist**. Do not extend the
    exception to a third action without re-running the same honesty pass.
18h. **The 3 free AI redrafts and 20 free paragraph edits are retired**
    *(2026-09-11)*. Neither action exists in the shipped product: the only AI
    editing action is **Reimagine** (`ReimagineSheet` → `reimagine-chapter`), and
    hand editing is a plain text editor, free and uncapped. The caps were pricing
    a feature that was never built, and they were being cited — by §3's scoping
    argument, §10's counter columns and §11's p95 metric. All three are corrected.
    If a redraft or paragraph rewrite is ever built it is a text call and returns
    here to be priced (§1a).

### Audio

19. **Platform-funded catalog narration:** narrate the top ~500 chapters by read
    volume proactively, ~$110 one-time, refreshed weekly. On-demand narration
    remains the long-tail fallback.
20. **All audio is blocked on measuring the real per-chapter cost.** Above
    ~$0.01/chapter on edge-tts or ~$0.30/chapter on MiniMax fallback, the catalog
    budget and Reader grant are both re-derived.

### Earning

21. **The grant table:**

    | Source | Credits | Cadence | Cap | Ship |
    |---|---|---|---|---|
    | Reading streak | **2 / 7 / 5** | milestones at day 2, day 5, day 10 | 14 lifetime, nothing repeats | Launch |
    | Streak repair | **0** — restores the streak | day after a missed day, on 30 min reading | 2/month | Launch |
    | Welcome bonus | **3** | on declining the paywall | once per authenticated account | Launch |
    | Guest bootstrap | **3** | on first guest bootstrap (§9) | once per anonymous account | Launch |
    | Referral — referrer | **10** | on invited user's 1st generation | 3/mo, 10 lifetime | v1.1 |
    | Referral — invited | **5** | on own 1st generation | once | v1.1 |

22. **The streak ladder pays 2 at day 2, 7 at day 5, and 5 at day 10** — and then
    nothing. *(Revised 2026-09-10; it previously paid 1 at day 2, day 5, day 7 and
    every 7 days after.)* The rungs match the three milestones on the *Your
    journey* screen, because a rung the user cannot see cannot motivate. A streak
    is consecutive days with reading activity — one chapter finished or ≥60s
    dwell, recorded server-side. Missing a day resets it to zero and the rewards
    restart at day 2, unless repaired (22a).
22a. **A missed day can be repaired by reading 30 minutes the next day**, capped
    at 2/month, offered only after a *single* missed day. Repair restores the
    streak; it does not pay the missed rung. It costs nothing, because reading is
    free, and it buys a 30-minute reading session.
23. **Ceiling: steady-state earnable free credits are zero.** The ladder pays 14
    once, all inside the first ten days; lifetime free earn is 17 with the welcome
    bonus, against 50/month on every paid plan. Trivially inside the 50%
    principle-7 limit. **The ladder terminates rather than capping, so no monthly
    ceiling is needed** — at the cost of a retained free user having no ongoing
    earn, recorded as an open item in §5.
24. **The flat daily app-open credit is rejected.** Uncapped it pays 30/month —
    60% of the 50/month paid grant — and it needs an artificial ceiling bolted on
    to stay sane. The ladder terminates instead and rewards consecutive days rather than
    sporadic opens.
25. **Removed:** the comment/feedback reward, social post rewards, reader
    earnings, rewarded-ad credits, the flat daily app-open credit, premium voice
    tiers, and the 2× carry-over cap.
26. **Disable `create_feedback`'s credit grant before launch** — it currently pays
    a credit for a one-character comment, daily, uncapped.
27. **The generation refund is not on the grant table** — it is not earning. The
    **auto-refund behavior stays**: a failed generation returns every credit it
    reserved, per principle 4, already implemented as
    `refund_generation_operation`. It is stated in §1 as a guarantee.
28. **No unconditional daily free chapter.** Daily replenishment is earned through
    the streak and never granted.

### Onboarding

29. **Sequence: one character flow → one paywall → decline → 3 welcome credits →
    welcome → app.** *(Revised 2026-09-10, the one-time offer step removed;
    revised again 2026-09-11, the reader and writer paths merged and the bonus
    reduced from 10 to 3.)* Every purpose reaches the same paywall after saving a
    character. The welcome bonus is a consolation on the decline path, not a
    greeting; subscribers do not receive it, and it is **3 for everyone**. The
    guest bootstrap is a separate 3-credit grant under a separate key — §6 and
    §9.
29a. **The welcome screen carries no numbers.** It is one shared beat on every
    path, saying only "Welcome to Katha" and "Reading is always free." The
    balance is announced separately by the in-app message system on landing, so
    the screen needs no per-path copy and does not duplicate that message.
30. **The paywall is skippable at every step**, with a large and obvious dismiss,
    and there is no one-time offer.
30a. **The onboarding paywall sells two durations and four benefits**
    *(2026-09-11, the W7 hand-off)*. Weekly and yearly, yearly selected by
    default and badged SAVE 80%; **no trial, no monthly, no More options**. The
    benefit rows are 50 credits a month, unlimited portraits and reimagines,
    premium voices, download as PDF — the character's name is in the portrait
    and voice rows, and the copy drops to a no-character voice ("Katha is ready
    when you are") on the in-app entry, which has no character to promise
    anything about. The only top control is the close. *(Amended 2026-09-12: the
    yearly card carries **"$0.16 a day"** rather than a monthly equivalent —
    decision 12b — and the plan cards are compact, about 92 pt, inside a pinned
    sheet so the price and the button are never scrolled away.
    `ONBOARDING_FLOW.md` §12-13 is canonical for that layout.)*
31. **All grants require a server-verified Supabase JWT.** Named-account grants
    require a named account; the narrowly rate-limited guest bootstrap exception
    is defined in §9 and cannot publish publicly.

### Blocked state

32. **The not-enough-credits sheet** is always headed with what the user *has*
    (*"You have 2 credits. Starting a story needs 3."*), subhead *"Reading stays
    free — always,"* footer *"If a generation fails, your credits come back."*
    Options in order: **(1) make it with what you have** — the partial-progress
    path, primary and full-width whenever any sub-action is affordable; **(2)** the
    streak row as **information, not a button**, and only when the next milestone
    lands within 48h — otherwise omitted entirely; **(3) read something instead**, deep-linked to the feed; **(4) 10
    credits — $3.49**; **(5) plans from $5.99/week**, only when lifetime
    generations ≥ 2; **(6)** a large, obvious dismiss.
33. **Every paid button displays its price**, and an insufficient balance on
    entering Create shows an inline banner, never a modal.
34. **The draft survives the sheet**, and a successful top-up fires the pending
    action automatically without a second tap.
35. **Prohibitions:** never block reading; no launch-time or post-generation
    auto-paywall; no countdown timers or false scarcity **on any in-app
    surface**; no hidden or delayed dismiss control; no charging for a retry
    after our own failure. **The countdown ban is absolute** — the one-time offer
    that carried the single exception was removed 2026-09-10.
35a. ~~**The one exception to the countdown ban is the onboarding one-time offer**
    (§6): a **2-minute** clock on a single screen, shown once ever, carrying the
    line *"You'll never see this again."* It is permitted only because the
    deadline is honestly enforced — at zero the SKU is disabled for that
    `user_id` server-side, there is no recovery push and no second showing, and
    the price genuinely never returns. Ship the timer as a remotely tunable
    value so the duration can be changed without a store review. Any countdown
    whose expiry is not enforced server-side is false scarcity and is banned by
    decision 35.

### Balance rules

36. **Subscription grants do not roll over.** Each period delivers a fresh 20 or
    50; unused grant credits expire with the period. This replaces the 2×
    carry-over cap and is what bounds the yearly plan's exposure.
37. **Credits lapse with the subscription.** When a plan ends the credit balance
    goes to zero — the whole balance, including earned credits and credits bought
    as packs while subscribed. A credit is an entitlement of an active plan, not a
    stored-value token.
38. **What survives lapse, permanently:** every story and chapter the user
    created, every chapter of audio they unlocked, and free unlimited reading. A
    lapsed user loses spending power, never their library, and the cancellation
    flow must say so.
39. **Lapse is never silent.** A push and in-app notice **3 days before expiry**
    stating the exact balance at risk, the same number shown in the cancellation
    flow before the cancel is confirmed, and a post-lapse notice stating what was
    kept.
40. **Open, blocking:** confirm with App Review that voiding **purchased pack**
    credits on subscription lapse is permitted (§12, item 5). Packs are consumable
    IAPs; if it is not permitted, packs are carved out and only granted and earned
    credits lapse. Note the asymmetry either way — a user who never subscribes
    keeps pack credits forever, while an ex-subscriber loses the identical pack.
41. **Add a `'chargeback'` deduction reason clamped to the available balance**, so
    a RevenueCat refund can be reversed. This is impossible today.

### Engineering

42. **Action prices live in one server-side price map**, not as literals in edge
    functions. Remove the hardcoded `1` from `reserve_generation_operation` and
    extend `deduct_credit`'s reason allowlist, which currently blocks every spend
    path in this document.
43. **The five anti-abuse controls plus the monitoring query** in §9:
    authenticated grants; `operation_key = 'welcome:{user_id}'` and
    `'guest_bootstrap:{user_id}'`; server-side streak
    dates with `operation_key = 'streak:{user_id}:{milestone_day}'`; reduced trial grants; referral gating at ≥24h account age with
    3/month and 10 lifetime caps; and one daily query for accounts over 90%
    subsidized grants with more than 15 lifetime grants.
44. **Not building pre-launch:** device fingerprinting, IP reputation, ML fraud
    scoring, pending-credit buffers, or per-device read caps.
45. **Three-phase rollout:** (1) unbundled creation, free reading, streak ladder,
    paywall sequence, packs, all SKUs; (2) audio, after cost measurement, catalog
    job first; (3) referral.
45a. **The welcome bonus is 3, the guest bootstrap is 3, and they are still
    separate grants under separate operation keys** — §6. *(Raised to 10 on
    2026-09-05; returned to 3 on 2026-09-11.)* Three credits is exactly one story
    start, which is the legible unit; ten was a week of product given to someone
    who had not yet decided they wanted it, and free credits flow to the most
    expensive action a credit can buy. The keys stay separate because the two
    numbers are bounded by different things — conversion economics for the named
    grant, a network-prefix rate limit for the guest one — so their equality is a
    coincidence of this revision, not a merge. The open item the 10 carried is
    closed with it.
45b. **Referral redemption is deep-link attribution, with a code field in Profile
    as the fallback. No code field on the paywall, ever** — §5 Referral.
    *(2026-09-05.)*
46. **`expo/App.tsx:953` must change.** *"1 credit creates 1 story or chapter"* is
    now incorrect. It must reflect a 3-credit story start, with each further
    chapter at 1, or 2 when illustrated.
47. **Launch instrumentation per §11**, with the load-bearing triggers being
    Writer-yearly credit utilization, pack attach rate, and the audio catalog hit
    rate.
48. **Superseded (2026-09-08).** This recorded that `_shared/image.ts` used
    `gpt-image-1` at 1024×1536 `quality: "medium"`. The OpenAI credential was
    revoked and the provider removed; every image now comes from
    `google/gemini-2.5-flash-image` ("nano banana") through OpenRouter, with
    `google/gemini-3.1-flash-image` behind it. **This is a live open item, not
    just a substitution:** Gemini charges a flat ~1,290 output tokens per image
    and takes no size or quality parameter, so the per-tier costing above no
    longer has a mechanism behind it. The cover got cheaper ($0.063 → $0.039);
    the character portrait got ~3.5× dearer ($0.011 → $0.039), which is exactly
    the number the "a whole cast is one credit" claim rests on. **Resolved
    2026-09-10:** a cast of three is $0.117 and stays bundled into the 1-credit
    story start; standalone character images are 4 free per account then 1 credit
    each (§3). Reusing a saved character's portrait costs nothing, which is what
    keeps the bundled start affordable for repeat creators.

<!-- markdownlint-enable MD029 -->
