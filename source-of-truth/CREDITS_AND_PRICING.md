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
> Last revised 2026-09-02. Cost figures are computed from the shipped code;
> external rates are cited inline. Sentences that are inference rather than a
> cited fact say so.

---

## Summary

**One credit = one AI action.** Not one story — one *action*. A story is a
sequence of chapters, and **starting one costs 3 credits**:

| Its cast | + | Chapter 1's words | + | Chapter 1's art *(this is the cover)* | = | **3 credits** |
|---|---|---|---|---|---|---|

Every chapter after that is **1 credit**, or 2 if you illustrate it. A 3-chapter
story is 5 credits; a 15-chapter story is 17. You are charged as each chapter is
written, so a story you abandon costs what it wrote.

Reading is **free and unlimited on every tier, forever**. Audio is **1 credit per
chapter, unlocked permanently**. Drafting is unlimited by hand and generously
capped on AI.

Two subscription audiences, because the product has two:

| | Weekly | Monthly | Yearly · 3-day trial |
|---|---|---|---|
| **Reader** | **$4.99** · 5 credits | **$8.99** · 20/mo | **$29.99** · 20/mo |
| **Writer** | **$6.99** · 10 credits | **$12.99** · 50/mo | **$49.99** · 50/mo |

The five findings that shape the numbers:

1. **Unbundling the chapter is what makes whole-number credits honest.** The
   three image actions sit within a factor of two of one another — cover
   $0.063, chapter art $0.042, a cast of three $0.033 — so each is fairly one
   credit. **Text stopped being the outlier on 2026-09-05.** At **$0.0160** on
   `meta/muse-spark-1.3` it is 3.9× cheaper than a cover rather than 16×, and it
   is the cheapest of four actions rather than a rounding error against three.
   It is still one credit. Creation cost is still mostly images, but text is now
   a real share of it — see §2, and note the figure falls to $0.0009 if the
   contributor tier is ever unblocked.
2. **The Writer yearly tier is the binding constraint on everything.** At
   $49.99/yr for 50 credits/month it nets **$0.0708/credit** against
   **$0.0198–$0.0326** of creation cost depending on story shape (§2). Every
   future price or grant change is tested against this row first. *(§4's tables
   still compute against the retired $0.0423 basis and therefore understate every
   margin — §12 item 10.)*
3. **A 50-credit Writer grant is more profitable than a 100-credit one**, and not
   only because of margin. 50 credits is ~16 chapters/month against a working
   writer's ~63-credit appetite, so overflow demand routes into credit packs at
   85–90% margin instead of being absorbed by a 40%-margin subscription.
4. **Audio only works as a catalog investment, not a per-user cost.** A narration
   costs ~$0.22 to generate and $0 to replay. Narrating the top ~500 chapters
   ourselves is a **one-time ~$110** and turns the Reader tier from a
   32%-breakeven gamble into a ~100%-margin product.
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
4. **Never charge for our own failure.** Failed generations auto-refund. Every
   paid image gets one free retry.
5. **Never charge twice for the same thing.** An unlocked chapter stays unlocked
   forever — re-reads, re-listens, pause/resume and library re-opens are free.
6. **A subscription must always be the best price per credit** against any pack
   it competes with. A pack that undercuts the plan it sits next to is a bug in
   the price list, not a promotion.
7. **Steady-state earnable free credits stay at or below 50% of the cheapest paid
   grant** — the streak ladder pays ~4/month against the Reader plan's 20 (20%),
   leaving real headroom rather than sitting on the line.

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
| Its characters — the whole cast, once | 1 |
| Write a chapter | 1 each |
| Chapter 1's art — this becomes the cover | 1 |
| Art for any other chapter — optional, off by default | 1 each |

| Your story | Just the words | Every chapter illustrated |
|---|---|---|
| 3 chapters | **5** | **7** |
| 7 chapters | **9** | **15** |
| 15 chapters | **17** | **31** |

**You pay as each chapter is written**, so a story you stop halfway costs what
it wrote, not what it planned.

**Bringing your own cover is free, and it replaces chapter 1's art rather than
sitting on top of it.** Upload before you generate and chapter 1's image is
never made: starting the story costs **2**, not 3. Upload afterwards and it
replaces the generated cover — but the credit that made it is not refunded,
because that generation was delivered. Keeping the free typographic concept card
is also a legitimate published look, and also costs nothing.

**Listening — 1 credit**

| | Credits |
|---|---|
| Unlock a chapter's audio | 1 |
| Re-listen to it, forever | **0** |

One credit unlocks that chapter's audio permanently. Pause it, come back
tomorrow, listen ten more times — it's yours. Every voice is available on every
plan; we don't lock voices behind a tier.

**Editing — free**

| | Credits |
|---|---|
| Type, rewrite, restructure your draft by hand | **0**, unlimited |
| Ask AI to redraft a chapter | **0** — 3 free per chapter |
| Ask AI to rewrite a paragraph | **0** — 20 free per chapter |
| Regenerate a cover you paid for | **0** — 1 free retry |

Past those limits, each further AI action is 1 credit.

**If a paid action fails, its credit comes back automatically.** Text failure
refunds the complete start reservation. After text succeeds, cast and cover are
tracked independently: either missing component receives its own idempotent
one-credit refund without discarding the completed chapter. Every time.

### Where credits come from

**Free, every month**

| | Credits |
|---|---|
| Keep a reading streak | **1** at day 2, day 5, day 7, then every 7 days |
| Invite a friend who creates something | **10** to you, **5** to them |
| Welcome bonus | **10**, once |

A streak is consecutive days with reading activity. Miss a day and it resets to
zero — the rewards start again from day 2.

**Plans**

| | Weekly | Monthly | Yearly |
|---|---|---|---|
| **Reader** | $4.99 · 5 credits | $8.99 · 20/mo | $29.99 · 20/mo |
| **Writer** | $6.99 · 10 credits | $12.99 · 50/mo | $49.99 · 50/mo |

Yearly plans start with a **3-day free trial**. Reading stays free whether you
subscribe or not — plans are for creating and listening.

**Credit packs** — no subscription needed

| | |
|---|---|
| 10 credits | $4.99 |
| 40 credits | $14.99 |
| 90 credits | $29.99 |

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
> as a live constraint**, and the per-cast portrait arithmetic in §10.6 needs
> redoing against a flat rate before the portrait path is priced. Aspect ratio
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

**Audio.** MiniMax `speech-02-hd` via RunPod. Official MiniMax rate **$0.10/1k
chars** ([MiniMax](https://minimax-ai.chat/pricing/)); third parties $0.05–$0.10/1k
([WaveSpeed](https://wavespeed.ai/models/minimax/speech-02-hd),
[fal](https://fal.ai/models/fal-ai/minimax/speech-02-hd/api)). A RunPod A100
serverless worker is ~$2.72/hr of active compute
([RunPod](https://www.runpod.io/pricing)). ElevenLabs, for comparison, charges
$0.05–$0.10/1k chars ([Flexprice](https://flexprice.io/blog/elevenlabs-pricing-breakdown)).

An 800-word chapter ≈ 4,500 chars → **$0.22 at $0.05/1k, $0.45 at $0.10/1k**.

**⚠ We have not measured our actual RunPod cost.** The endpoint's throughput
determines it and nobody has instrumented it. Every audio number here is an
estimate from published rates. **Measure before enabling narration** (§12).

### The credit's cost basis

| Action | Cost | Credits |
|---|---|---|
| Chapter text — live, `meta/muse-spark-1.3` | $0.0160 | 1 |
| Chapter text — if the contributor tier is enabled | $0.0009 | 1 |
| Cover @ 1024×1536 medium | $0.063 | 1 |
| Chapter art @ 1024×1024 medium | $0.042 | 1 |
| Character set — 3 @ 1024×1024 low | $0.033 | 1 |
| Audio unlock — cached chapter | **~$0** | 1 |
| Audio unlock — triggers fresh narration | ~$0.22 ⚠ | 1 |

**A story, not a chapter, is the unit that matters** — the blended cost per
credit depends on its shape, because the cast and the cover are paid once and
amortise across every chapter after them.

**Live basis, `meta/muse-spark-1.3` at $0.0160 per chapter:**

| Story | Credits | Cost | **Blended $/credit** |
|---|---|---|---|
| 3 chapters, words only | 5 | $0.144 | $0.0288 |
| 7 chapters, words only | 9 | $0.208 | $0.0231 |
| 15 chapters, words only | 17 | $0.336 | $0.0198 |
| 3 chapters, illustrated | 7 | $0.228 | **$0.0326** |
| 7 chapters, illustrated | 15 | $0.460 | $0.0307 |
| 15 chapters, illustrated | 31 | $0.924 | $0.0298 |

**If the contributor tier is enabled, $0.0009 per chapter:**

| Story | Credits | Cost | **Blended $/credit** |
|---|---|---|---|
| 3 chapters, words only | 5 | $0.0987 | $0.0197 |
| 7 chapters, words only | 9 | $0.1023 | $0.0114 |
| 15 chapters, words only | 17 | $0.1095 | **$0.0064** |
| 3 chapters, illustrated | 7 | $0.1827 | $0.0261 |
| 7 chapters, illustrated | 15 | $0.3543 | $0.0236 |
| 15 chapters, illustrated | 31 | $0.6975 | $0.0225 |

**Creation costs between $0.0198 and $0.0326 per credit today**, and would cost
between $0.0064 and $0.0261 on the contributor tier. The shape of the conclusion
has not changed — images are still the majority of the cost and longer stories
are still cheaper per credit, not dearer — but text is no longer close to free.
On the live basis a 15-chapter words-only story is **71% text**, where under the
superseded $0.004 figure it was 39%.

> **The superseded range was $0.0092 to $0.0274**, computed against $0.004 text.
> It is recorded here because §4 and several later sections were written while it
> was current.

**The §4 margins are still conservative, and that was checked rather than
assumed.** Every margin below is computed against **$0.0423**. The worst case on
the live basis is **$0.0326**, which is still under it, so no margin in this file
is overstated by the new cost basis. The gap has narrowed from 4.6x to 1.3x, so
the next text-model change is much likelier to break that guarantee than this one
was, and §4 should be recomputed before the following one.

> ⚠ **§4 below is stale.** Every margin in the plan table is still computed
> against the old **$0.0423**, which descended from the retired Anthropic text
> cost. Those margins are therefore **understated**, though by less than they
> were: the live worst case is now $0.0326 rather than $0.0274, so the cushion
> is 1.3x rather than 1.5x. Correcting §4 is its own pass and is listed in §12;
> nothing in this section depends on it, and no margin below is *overstated*, so
> the constraint the business is run on remains conservative rather than wrong.

---

## 3. Pricing and plans

### The grid

| | Weekly | Monthly | Yearly · 3-day trial |
|---|---|---|---|
| **Reader** | **$4.99** · 5 credits | **$8.99** · 20/mo | **$29.99** · 20/mo |
| **Writer** | **$6.99** · 10 credits | **$12.99** · 50/mo | **$49.99** · 50/mo |

**Presentation order: weekly and yearly upfront; monthly disclosed below them.**
Weekly is the impulse entry, yearly is the value anchor, monthly exists for the
user who wants it but is not the plan we lead with. Yearly is selected by
default and carries the free trial; weekly has no trial.

Yearly discounts are **72%** (Reader) and **68%** (Writer) against the monthly
price. Both are steep but inside the normal band for consumer subscription apps.

### Why 50 credits and not 100

A 100-credit Writer grant at $49.99/yr is **−20% margin**. The same grant at
$69.99/yr is 15%. Fifty credits at $49.99 is **40%**. You can have the $49.99
price point or the 100-credit headline, not both.

Fifty is the better product decision independently of margin. It buys ~16 full
chapters a month, against a working writer's appetite of ~63 credits (three
7-chapter novels). A grant deliberately set below the heavy user's appetite
routes overflow demand into **credit packs at 85–90% margin** rather than
absorbing it inside a 40%-margin subscription. A 100-credit grant swallows that
demand and you never see the pack revenue.

### The one-time offer

Shown once, after the user declines the main paywall, before they land in the
app:

> **Reader, yearly — $19.99 for your first year**, then $29.99/yr.

**Why the Reader plan and not the Writer plan.** The obvious move is to discount
the headline tier, and it is wrong here for a hard arithmetic reason: the Writer
yearly is the thinnest row in the model, so a discount on it while keeping 50
credits erodes the one margin we just fixed. The Reader plan has the opposite
shape — its cost is dominated by cached audio at ~$0 marginal, so $19.99 still
clears ~100%.

It is also the correct *product* answer: a user who has just declined both plans
is, by revealed preference, not a writer. Discount the thing they might want.

**It renews at full price** ($29.99), so lifetime value recovers in year two, and
it is a single option with no second decision — the user has already made two.

**It carries a 2-minute countdown**, the only countdown permitted anywhere in the
product (§7). The clock is legitimate rather than theatrical: at zero the offer
SKU is disabled for that `user_id` server-side, the screen auto-advances, and the
price never returns — no Home banner, no recovery push, no second showing. The
on-screen line is *"You'll never see this again,"* and it is a statement of fact
the backend enforces. Leaving the screen ends the offer exactly as expiry does.
The duration is a remotely tunable value, so it can be retuned without a store
review; 2 minutes is a starting value, not a finding.

**Both paths reach it.** A reader who declines the Reader paywall and a writer
who declines the Writer paywall see the same screen and the same SKU. Offering
the Reader plan to a writer decliner is the revealed-preference argument above,
and it keeps the Writer yearly undiscounted per decision 15.

### Credit packs

For users who skip the paywall entirely. No subscription required.

| Pack | Price | $/credit | Net after 15% | Margin |
|---|---|---|---|---|
| 10 credits | $4.99 | $0.499 | $0.4242 | **90%** |
| 40 credits | $14.99 | $0.375 | $0.3185 | **87%** |
| 90 credits | $29.99 | $0.333 | $0.2832 | **85%** |

**Packs are top-ups, not alternatives to subscribing**, and the sizes are set by
principle 6 rather than by round numbers. The Writer monthly plan nets
$0.2208/credit, so every pack must price above that — and the 40-pack is
deliberately *dominated* by the Writer monthly plan on both axes ($14.99 for 40
one-time versus $12.99 for 50 recurring), so anyone comparing them upgrades
rather than tops up.

**Do not resize a pack without re-running the inversion check** (§4).

### The 3-day trial, and the hole in it

A 3-day Writer trial that grants the full 50 credits is a **$2.12 giveaway with a
cancel button attached**, and trial abuse is the most mechanical form of fraud
available on a subscription app.

**Trial grants are reduced: 15 credits (Writer) or 5 (Reader) for the trial
period. The full grant lands on the first successful charge.** 15 credits is 5
full chapters — more than enough to judge the product in 3 days — and it caps the
downside at $0.63.

### Store SKUs

| SKU | Product |
|---|---|
| `ai.katha.sub.reader.weekly` | Reader weekly — $4.99 |
| `ai.katha.sub.reader.monthly` | Reader monthly — $8.99 |
| `ai.katha.sub.reader.yearly` | Reader yearly — $29.99, 3-day trial |
| `ai.katha.sub.reader.yearly.offer` | One-time offer — $19.99 first year |
| `ai.katha.sub.writer.weekly` | Writer weekly — $6.99 |
| `ai.katha.sub.writer.monthly` | Writer monthly — $12.99 |
| `ai.katha.sub.writer.yearly` | Writer yearly — $49.99, 3-day trial |
| `ai.katha.credits.small` | 10 credits — $4.99 |
| `ai.katha.credits.medium` | 40 credits — $14.99 |
| `ai.katha.credits.large` | 90 credits — $29.99 |

The client must read price, renewal terms, trial eligibility and offer copy from
RevenueCat product data. The values above are the configuration, not hardcoded
strings.

---

## 4. Unit economics

Revenue per credit and margin against the $0.0423 blended creation cost. Apple's
Small Business Program commission of 15% is applied throughout.

| Plan | $/credit | Net/credit | Margin at max burn |
|---|---|---|---|
| Reader weekly $4.99 / 5 | $0.998 | $0.8483 | **95%** |
| Writer weekly $6.99 / 10 | $0.699 | $0.5942 | **93%** |
| Pack $4.99 / 10 | $0.499 | $0.4242 | **90%** |
| Reader monthly $8.99 / 20 | $0.450 | $0.3821 | **89%** |
| Pack $14.99 / 40 | $0.375 | $0.3185 | **87%** |
| Pack $29.99 / 90 | $0.333 | $0.2832 | **85%** |
| Writer monthly $12.99 / 50 | $0.260 | $0.2208 | **81%** |
| Reader yearly $29.99 / 240 | $0.125 | $0.1062 | **60%** |
| **Writer yearly $49.99 / 600** | **$0.083** | **$0.0708** | **40%** ← constraint |

**Every tier clears 40% at maximum burn.** That is the point of the 50-credit
grant: the model no longer depends on subscribers under-using what they paid for.

### The inversion check

Principle 6 says a subscription must always beat the packs it competes with. Run
this whenever any price or grant changes:

| Pack | Net $/cr | vs Writer monthly $0.2208 |
|---|---|---|
| $4.99 / 10 | $0.4242 | ✅ |
| $14.99 / 40 | $0.3185 | ✅ |
| $29.99 / 90 | $0.2832 | ✅ |

Reader monthly nets $0.3821/credit, above two of the three packs — and that is
correct, not a violation. Reader is the **low-volume** tier; a Reader who needs
more credits should upgrade to Writer ($0.2208/credit, cheaper than every pack),
not buy a pack. The upgrade path is Reader → Writer, and the price list makes
that the obvious move.

**The trap this check exists to catch:** the earlier $6.99/25 and $15.99/60 packs
priced at $0.2377 and $0.2265 — below Reader monthly. A $6.99 pack buying 25
credits next to an $8.99 plan buying 20 makes the entry plan pointless. Cutting
the Reader grant from 30 to 20 is what exposed it.

### The Writer yearly row is the risk model

At $49.99/yr the subscriber nets **$4.25/month** against **$2.12/month** if they
spend all 50 credits on chapters. That is 40% at *maximum* burn and 70% at a
realistic 50% burn.

This row matters more than any other because **the Writer tier self-selects for
high burn.** Its entire pitch is the credit count; people who buy it intend to use
it. Every other tier can rely on under-utilization; this one cannot.

Two consequences, both load-bearing:

- **Monthly grants do not roll over.** Without this a yearly subscriber banks 600
  credits and can dump them in any pattern. With it, exposure is bounded to
  50/month and hoard-then-dump is impossible. This is standard practice (Canva,
  ElevenLabs, Midjourney) and takes nothing anyone paid for — purchased packs
  still expire only with the subscription (§8).
- **Credit utilization by tier is the #1 launch metric** (§11).

### The Reader tier depends entirely on catalog audio

Reader yearly nets **$2.12/month** for 20 audio unlocks.

| If a Reader's credit hits… | Our cost | Result |
|---|---|---|
| Audio we already narrated | ~$0 | **~100% margin** |
| A chapter needing fresh narration | $0.22 | **breaks even at a 48% fresh rate** |

Above a 48% fresh-narration rate, Reader yearly loses money. That is not a
tolerance to leave to chance, which is why catalog narration below is a
commitment rather than an optimization.

### Catalog narration — the decision that makes audio work

**A narration costs ~$0.22 once and $0 forever after.** It is cached in the
public `audio` bucket and every subsequent listen, by anyone, is free. So the
cost is **per chapter narrated**, never per listen.

**We narrate the top ~500 chapters ourselves, proactively — a one-time ~$110.**

That single spend:

- Turns the Reader tier from a 48%-breakeven gamble into ~100% margin.
- Makes audio **instant** instead of a 60-second generation wait, which is the
  difference between a feature people use and one they try once.
- Amortizes across every listener: 500 chapters against 100k listens is
  **$0.001 per listen**.

Selection is by read volume, refreshed weekly. On-demand narration remains the
fallback for the long tail.

### Free tier exposure

A maximally engaged free user earns **16 credits in month one** (10 welcome, once
+ 6 from streak milestones at days 2, 5, 7, 14, 21, 28) and **4/month in steady
state** — $0.17/month if spent on creation, ~$0 if spent on cached audio.

**Four is 20% of the Reader plan's 20**, comfortably inside the principle-7
ceiling of 50%. The streak ladder self-caps: it pays six times in the first month
and four times a month thereafter, so no separate monthly cap is needed. That is
its main advantage over a flat daily grant, which needed an explicit ceiling to
stop it reaching 30/month and out-earning the paid tier.

The headroom is deliberate. If free-tier engagement turns out too thin — the
signal being D7 retention on free users tracking below subscribers by more than
2× — the lever is to add a day-3 rung or shorten the recurring interval from 7
days to 5, not to raise the per-milestone amount.

---

## 5. Earning credits

The earn side is deliberately small. It only has to fund *creation* for free
users — reading is free and unlimited, so it carries no consumption burden.

| Source | Credits | Cadence | Cap | `reason` | Ship |
|---|---|---|---|---|---|
| **Reading streak** | **1** | day 2, day 5, day 7, then every 7 days | self-capping at ~4/month | `streak` | Launch |
| **Welcome bonus** | **10** | once, on declining the offer (§6) | once per authenticated account | `welcome` | Launch |
| **Guest bootstrap** | **3** | once, on first guest bootstrap (§9) | once per anonymous account, 3 per network prefix / 24h | `guest_bootstrap` | Launch |
| **Referral — referrer** | **10** | on invited user's 1st generation | 3/month, 10 lifetime | `referral` | v1.1 |
| **Referral — invited** | **5** | on own 1st generation | once | `referral` | v1.1 |

**Steady state for a free user: 4 credits/month.** One full chapter plus an audio
unlock, or four chapters of audio. Against 20 in the $8.99 Reader plan and 50 in
the $12.99 Writer plan. Month one pays 16 with the welcome bonus.

### The streak ladder

| Milestone | Credits | Cumulative |
|---|---|---|
| Day 2 | **1** | 1 |
| Day 5 | **1** | 2 |
| Day 7 | **1** | 3 |
| Every 7 days thereafter | **1** | +1/week |

**A streak is consecutive days with reading activity**, server-recorded: one
chapter finished, or ≥60s of dwell. Miss a day and it resets to zero, and the
rewards restart at day 2.

**Why day 2 is the right first rung.** Median mobile retention falls from **D1
26% to D7 13%** ([Adjust 2026, via UXCam](https://uxcam.com/blog/mobile-app-retention-benchmarks/))
— the cliff is between day one and day seven, so the first reward has to land
before a user is already gone. Day 2 catches them at the top of the fall. The
day-5 and day-7 rungs then bracket the steepest part of it.

**Why it beats a flat daily grant.** A flat "1 credit per app open" pays 30
credits/month uncapped — 150% of the Reader plan's entire grant — so it needs an
artificial monthly ceiling bolted on to stop the free tier dominating the paid
one. The ladder needs no ceiling: its own cadence caps it at ~4/month. One rule
instead of two, and it rewards *consecutive* days rather than sporadic opens,
which is the behavior actually worth paying for.

**Activity is reading**, and that is the point. Reading is free, so a reading
streak is precisely the mechanism that converts readers into creators — it pays
credits for the free behavior and those credits are only spendable on the paid
one.

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
| **Rewarded ads** | Rewarded video clears $15–40 eCPM in tier-1 gaming ([RevenueFlex](https://revenueflex.com/blog/app-ad-revenue-benchmarks-2026/), [Business of Apps](https://www.businessofapps.com/ads/rewarded-video/)); *inference:* a global reading app should plan on $6–12 eCPM = **$0.006–$0.012 per impression** against $0.0423 for the credit it buys. Rewarded ads lose money as a credit source at any plausible eCPM. Whether to run **non-rewarded** ads as free-tier revenue is a separate question, deferred. |
| **Flat daily app-open credit** | Paid 30/month uncapped — 150% of the Reader grant — and needed an artificial 10/month ceiling to stay sane. The streak ladder self-caps at ~4/month and rewards consecutive days rather than sporadic opens. |
| **Premium voice tier** | Every voice is available on every tier including free. Voice quality is not a paywall. |
| **Carry-over cap (2×)** | Replaced by non-rolling monthly grants (§8). |
| **Generation refund as a grant table row** | It is not earning, so it is not on the earn table. The **auto-refund behavior stays** — a failed generation returns every credit it reserved, per principle 4, already implemented as `refund_generation_operation`. It is documented in §1 as a guarantee, not as a way to earn. |

### No unconditional daily free chapter

Google's Gemini free tier gives 20 images/day
([AI Free API](https://www.aifreeapi.com/en/posts/gemini-image-generation-free-api))
because its marginal cost is near zero and it funnels to a $20/month plan.
Katha's marginal cost is $0.0423–$0.22 per action and the entry paid tier is
$4.99. A free chapter a day is 90 credits/month ≈ $3.81 of subsidy — it beats
every plan we sell. Daily replenishment is **earned and capped**, never granted.

---

## 6. Onboarding and the paywall flow

Onboarding branches on a purpose question and the two paths meet again at the
offer. Screen-level design is specified in
[`ONBOARDING_FLOW.md`](ONBOARDING_FLOW.md), the canonical onboarding specification;
only the money is defined here.

```
Anonymous session at app open, upgraded to a real account
before any purchase and before any grant
│
├─→  PURPOSE  ── read, or both ──→ genres → taste → shelf reveal
│         │                              │
│         └─ write ─→ goal → friction → idea → blueprint → preview
│                                              │
│                    ┌─────────────────────────┴──────────┐
│                    ↓                                    ↓
│              READER PAYWALL                      WRITER PAYWALL
│              $4.99/wk · $29.99/yr                $6.99/wk · $49.99/yr
│              5 cr      · 20 cr/mo                10 cr    · 50 cr/mo
│              Sells audio and creation.           Outcome-framed, shows
│              States plainly that reading         the user's own blueprint.
│              is and stays free.                  "Your story is ready
│                                                   to be created."
│              Yearly selected by default, carries the 3-day trial badge.
│              Monthly disclosed below, not led with. Weekly has no trial.
│              Dismiss is large, obvious, always present.
│                    │                                    │
│                    ├─ Subscribes → trial grant, or full grant on charge → app
│                    │                                    │
│                    └─ Declines ──────────┬──────────────┘
│                                          │
│                                          ↓
│                    ONE-TIME OFFER  (shown once, ever, both paths)
│                     "Reader, yearly — $19.99 for your first year"
│                     Single option. No second choice to make.
│                     ⏳ 2:00 countdown. At zero the SKU is disabled
│                        for this user_id and the price never returns.
│                     "You'll never see this again."
│                     Dismiss is equally obvious, full size from frame one.
│                                          │
│                                          ├─ Accepts → into the app
│                                          │
│                                          └─ Declines or expires
│                                                │
│                                                ↓
│                                        10 credits granted
│                                                │
│                                                ↓
│                                    WELCOME  "Reading is always free."
│                                    No numbers on this screen; the
│                                    balance is announced by the in-app
│                                    message system on landing.
│                                                │
└───────────────────────────────────────────────┴─→  Into the app
```

**For named onboarding, the welcome bonus is the consolation, not the greeting.**
It is granted only after the user has declined twice — subscribers do not need it
and should not be given it.

**Ten credits is one complete story start, plus room to keep going.** A start is
3 — the cast, chapter 1's words, and chapter 1's art, which becomes the cover —
leaving 7 for further chapters at 1 each, or three further illustrated chapters.
Combined with free unlimited reading and the streak ladder, a free user's first
day is a finished, illustrated first chapter and as much reading as they want.
*(Raised from 3 on 2026-09-05. The Writer-yearly 40%-margin row in §2 has **not**
yet been re-run against this figure at a range of chapter-art attach rates; that
is the open item this change carries.)*

**The guest bootstrap stays at 3, and is now a separate grant.** The sign-in-free
client grants a one-time **3**-credit balance to a server-verified anonymous
session under §9's rate limit, keyed `guest_bootstrap:{user_id}`. It does not
follow the welcome bonus up to 10: the named grant is protected by Apple / Google
/ email, while the guest grant is protected only by a salted network-prefix limit
of three per 24 hours. At 10 that limit permits 30 credits per network per day
against an unauthenticated surface, which is a farm, and at 3 it permits 9, which
is not. A guest who later signs in receives the named welcome bonus as well; the
two keys are distinct, and that is intended, because they converted.

**The bonus is 10 for everyone.** There is no reader/writer split on it; the 15/5
split belongs to the *trial* grant (§3), which is a different thing and lands on
a different path.

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
│     4. [ 10 credits — $4.99 ]                  ← secondary
│
│     5. [ Plans from $4.99/week ]               ← tertiary
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
  surface**. The onboarding one-time offer (§6) is the single exception, and it
  is an exception only because its deadline is real: a 2-minute clock, enforced
  server-side, after which the SKU is disabled for that user and the price never
  returns. False scarcity stays banned everywhere, including there — no
  "only 2 left", no restock, no recovery push, no second showing.
- Hide, shrink, or delay a dismiss control.
- Charge for a retry after our own failure.
- Show the one-time offer more than once.

---

## 8. Expiry, lapse, and chargebacks

### Subscription grants do not roll over

Each period delivers a fresh 20 or 50. Unused grant credits do not accumulate.
This is what bounds the Writer yearly's exposure (§4) and it is standard practice
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

Proportionate to a pre-launch app. Six controls to build, and an explicit list of
what **not** to build.

1. **Require a server-verified Supabase JWT before any grant.** Named-account
   grants require Apple / Google / email. The temporary guest bootstrap is the
   sole exception: it grants 3 credits once per anonymous Supabase user via
   `guest_bootstrap:{user_id}`, with a server-side, salted network-prefix limit of
   three guest grants per 24 hours and a shared ceiling of 300 guest grants per
   UTC day. Only an edge-owned client-address header can establish the network
   scope; missing or malformed scope fails closed. It stays at 3 while the named
   welcome bonus is 10, for the reason given in §6. It is not a device-local grant,
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
4. **Reduced trial grants.** 15 credits (Writer) / 5 (Reader) during the 3-day
   trial; full grant only on first successful charge.
5. **Referral gating** (v1.1): payout only after the invited user's first
   generation; invited account ≥24h old at payout; caps of 3/month and 10
   lifetime for the referrer.
6. **One monitoring query instead of a prevention system.** Daily: accounts where
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
| Schema | Per-chapter counters: AI redrafts used, paragraph edits used, cover regens used | Enforce §1's free caps |
| Schema | `audio_unlocks (user_id, chapter_id)` — the permanent listen entitlement | §1 |
| **RPC `deduct_credit`** | Extend the reason allowlist beyond `'generation'`; add `'chargeback'` clamped to available balance | **Blocks every spend path in this document today** |
| **RPC `reserve_generation_operation`** | Replace the hardcoded amount `1` with a per-action price lookup | Prices must be data, not literals |
| RPC `create_feedback` | **Remove the credit grant** | §5, §9 |
| RPC (new) | Streak milestone grant keyed `streak:{user_id}:{milestone_day}`; reuses `streaks.next_credit_at`, reinterpreted as "day-count of the next unclaimed milestone" (its default of 3 becomes 2). **Semantic change only, no schema change.** | §5, §9 |
| **Edge functions** | Separate spend paths for text, cover, character set, audio unlock | Unbundling |
| **Edge function (new)** | Catalog narration job — top ~500 chapters by read volume, weekly refresh | §4 |
| **Client** | Not-enough-credits sheet replaces the `Alert.alert` calls in `CreateStudioScreen.tsx:376` and `:683` | §7 |
| Client | Paywall → one-time offer → welcome sequence | §6 |
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
| **1 — Launch** | Story start unbundled at 3 credits, further chapters at 1 (2 illustrated); free unlimited reading; free caps on drafting; streak ladder; welcome bonus; lapse warnings; paywall + one-time offer; packs; all 10 SKUs |
| **2 — Audio** | Only after RunPod cost is measured (§12): catalog narration job first, then the 1-credit chapter unlock |
| **3 — v1.1** | Referral with deep-link attribution |

Phase 1 is a complete, coherent economy on its own. Audio is the only piece gated
on an unmeasured number, and gating it is deliberate.

---

## 11. Metrics and tuning triggers

Instrument at launch. Each has a threshold that triggers a specific change, so the
economy is tuned on evidence rather than argued about.

| Metric | Why | Trigger → action |
|---|---|---|
| **Credit utilization, Writer yearly** | The 40%-margin row, and the tier that self-selects for heavy use | Median burn > 40 of 50 → reprice or cut the grant |
| **Pack attach rate among Writer subscribers** | The 50-credit grant is designed to route overflow into 85–90% margin packs | < 15% of Writer subs buying a pack → the grant is too generous |
| **Catalog hit rate on audio unlocks** | Reader yearly breaks even at a 48% fresh-narration rate | Fresh rate > 40% → widen the catalog job |
| **Actual $/chapter narration on RunPod** | Every audio number here is extrapolated from published rates | > $0.30 → narration becomes subscriber-only |
| **D3 / D7 / D30 retention, streak-holders vs not** | Validates the ladder against the 26% / 13% / 7% baseline ([Adjust](https://uxcam.com/blog/mobile-app-retention-benchmarks/)) | No D7 lift after 8 weeks → the ladder is decoration; re-cadence it |
| **Streak milestone claim rate, by rung** | Whether day 2 / 5 / 7 are the right rungs | Day-2 claim < 50% of D2-actives → the first rung lands too late; move it to day 1 |
| **Free → paid conversion at D35** | Benchmark is 2.1% freemium median ([RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)) | < 1% → the paywall sequence is wrong before the earn table is; the free tier is already at 20% of the Reader grant |
| **One-time-offer take rate** | Whether the second ask earns its friction | < 3% → drop the step entirely |
| **Refund/chargeback rate after lapse** | Voiding a purchased balance is the highest-risk rule in this document | Any measurable lift over baseline → carve packs out of the lapse rule |
| **Win-back rate on lapsed users** | Lapsing credits removes the strongest win-back hook we had | Below 5% reactivation at 90 days → reconsider zeroing earned credits |
| **Reader → Writer upgrade rate** | Validates that the price list makes upgrading obvious rather than buying packs | Pack purchases by Readers > upgrades → re-run the §4 inversion check |
| **Partial-balance actions** ("text now, cover later") | Validates the core benefit of unbundling | < 10% of blocked users → the sheet's option 1 is not readable |
| **Cover regeneration rate** | A proxy for cover-prompt quality | > 40% of covers regenerated → fix the prompt, not the price |
| **AI redrafts per chapter, p95** | Validates the 3-redraft cap | p95 ≥ 3 → raise it; the cap should never bind on normal use |
| **Actual $/action: LLM + image + TTS** | Every margin number here is an estimate | Any line > 1.5× the §2 estimate → re-run §4 |

---

## 12. Open items — must resolve before shipping

1. **RunPod `minimax-speech-02-hd` actual cost per chapter.** Every audio number
   is extrapolated from published rates ($0.05–$0.10/1k chars). Our real cost
   depends on endpoint throughput and cold starts, which nobody has instrumented.
   **Audio cannot ship until this is measured.** Above ~$0.30/chapter, the catalog
   budget and the Reader grant both need rework.
2. **Confirm image quality at `low` for character sets.** The $0.011 setting
   assumes quality is acceptable at inline display sizes. Generate a dozen and
   look at them before committing.
3. **Verify Apple's commission tier.** All margin math assumes 15% (Small Business
   Program). At 30%, Writer yearly nets $0.0583/credit. Against the corrected §2
   cost basis ($0.0198–$0.0326) that is still **44–66%**; against the stale
   $0.0423 used throughout §4 it would read as 27%. Recompute when §4 is
   corrected. *(This read 53–84% against the superseded $0.0092–$0.0274 basis.)*
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
8. **`_shared/edge-tts.ts` returns `null`** — an interface with no implementation.
   MiniMax HD is currently the only voice. Since we are not tiering voices (§1),
   this is acceptable at launch but means every narration carries premium cost.
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
10. **Recompute §4 against the corrected cost basis.** Every margin in the plan
    table, the inversion check and the Writer-yearly risk model is computed
    against **$0.0423**, which descended from the retired Anthropic text cost.
    Real creation cost is **$0.0198–$0.0326** per credit (§2), so every figure in
    §4 is understated. Conservative rather than wrong — no margin is overstated —
    but it is **the largest known inaccuracy in this file** and it makes the
    "constraint of record" framing read as far tighter than it is.

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
5. **No voice tiers.** Every voice is available on every tier, including free.
6. **Never charge twice for the same thing**, and **never charge for our own
   failure** — failed generations auto-refund the full reservation.

### Creation and drafting

7. **Free forever, uncapped:** read, re-read, browse, search, library, manual text
   editing, save, publish, unpublish, delete, upload your own cover, follow, like,
   comment, share, retry after a failed generation.
8. **Free but capped:** **3 AI redrafts per chapter**, **20 paragraph AI edits per
   chapter**, **1 cover regeneration per paid cover**. Beyond each cap, 1 credit.
9. **Render settings are constraints, not defaults**, each pinned in code with a
   test **as each path lands**: covers at 1024×1536 `medium` ($0.063); **chapter
   art at 1024×1024 `medium` ($0.042)**; character sets at 1024×1024 `low`
   ($0.011 each, $0.033 for a set of three). A cast is capped at **3**. Only the
   cover tier exists in code today, and `generateCoverImage()` is called by no
   edge function — see §2. The other two are the contract for the image
   pipeline, not a description of shipped behaviour.
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

11. **The plan grid:**

    | | Weekly | Monthly | Yearly · 3-day trial |
    |---|---|---|---|
    | **Reader** | **$4.99** · 5 credits | **$8.99** · 20/mo | **$29.99** · 20/mo |
    | **Writer** | **$6.99** · 10 credits | **$12.99** · 50/mo | **$49.99** · 50/mo |

12. **Presentation:** weekly and yearly upfront, yearly selected by default with
    the 3-day trial, monthly disclosed below, weekly without a trial. Read-first
    and write-first users see different value propositions.
13. **The Writer grant is 50 credits, not 100.** At $49.99/yr, 100 credits is −20%
    margin and 50 is +40%. The smaller grant also routes overflow demand into
    85–90% margin packs.
14. **One-time offer: Reader yearly, $19.99 first year, renewing at $29.99.**
    Shown once, ever, after either paywall is declined, as a single option, on
    **both paths** — a writer who declines the Writer paywall sees the same
    Reader offer, on the revealed-preference argument in §3. It carries a
    **2-minute countdown**, the only countdown permitted in the product, and at
    zero the SKU is disabled for that `user_id` and the price never returns.
15. **The Writer yearly is never discounted.** At 40% it is the thinnest row in
    the model; the offer sits on the Reader tier instead.
16. **Credit packs: $4.99 / 10 · $14.99 / 40 · $29.99 / 90.** Sized so every pack
    prices above the Writer monthly rate, and so the 40-pack is dominated by the
    Writer monthly plan on both price and volume.
17. **Reduced trial grants:** 15 credits (Writer) / 5 (Reader) during the 3-day
    trial; the full grant lands on first successful charge.
18. **Constraint of record:** Writer yearly at $49.99/600 nets $0.0708/credit
    against $0.0423 of cost — **40% margin at maximum burn.** Every future pricing
    change is tested against this row, and against the §4 inversion check.

### Audio

19. **Platform-funded catalog narration:** narrate the top ~500 chapters by read
    volume proactively, ~$110 one-time, refreshed weekly. On-demand narration
    remains the long-tail fallback.
20. **All audio is blocked on measuring the real RunPod per-chapter cost.** Above
    ~$0.30/chapter, the catalog budget and Reader grant are both re-derived.

### Earning

21. **The grant table:**

    | Source | Credits | Cadence | Cap | Ship |
    |---|---|---|---|---|
    | Reading streak | **1** | day 2, day 5, day 7, then every 7 days | self-capping at ~4/month | Launch |
    | Welcome bonus | **10** | on declining the one-time offer | once per authenticated account | Launch |
    | Guest bootstrap | **3** | on first guest bootstrap (§9) | once per anonymous account | Launch |
    | Referral — referrer | **10** | on invited user's 1st generation | 3/mo, 10 lifetime | v1.1 |
    | Referral — invited | **5** | on own 1st generation | once | v1.1 |

22. **The streak ladder pays at day 2, day 5, day 7, then every 7 days**, 1 credit
    per milestone. A streak is consecutive days with reading activity — one chapter
    finished or ≥60s dwell, recorded server-side. Missing a day resets it to zero
    and the rewards restart at day 2.
23. **Ceiling: steady-state earnable free credits ~4/month**, 20% of the Reader
    plan's 20 and well inside the 50% principle-7 limit. Month one is 16 including
    the one-time welcome bonus. **The ladder is self-capping; no separate monthly
    ceiling is needed.**
24. **The flat daily app-open credit is rejected.** Uncapped it pays 30/month —
    150% of the Reader grant — and it needs an artificial ceiling bolted on to
    stay sane. The ladder caps itself and rewards consecutive days rather than
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

29. **Sequence: purpose branch → path-specific paywall → decline → one-time
    offer → decline or expiry → 10 welcome credits → welcome → app.** Readers
    reach their paywall after the shelf reveal; writers reach theirs after the
    blueprint and preview. The welcome bonus is a consolation on the decline
    path, not a greeting; subscribers do not receive it, and it is **10 for
    everyone** with no reader/writer split. The guest bootstrap is a separate
    3-credit grant under a separate key — §6 and §9.
29a. **The welcome screen carries no numbers.** It is one shared beat on every
    path, saying only "Welcome to Katha" and "Reading is always free." The
    balance is announced separately by the in-app message system on landing, so
    the screen needs no per-path copy and does not duplicate that message.
30. **The paywall is skippable at every step**, with a large and obvious dismiss,
    and the one-time offer is shown once ever.
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
    credits — $4.99**; **(5) plans from $4.99/week**, only when lifetime
    generations ≥ 2; **(6)** a large, obvious dismiss.
33. **Every paid button displays its price**, and an insufficient balance on
    entering Create shows an inline banner, never a modal.
34. **The draft survives the sheet**, and a successful top-up fires the pending
    action automatically without a second tap.
35. **Prohibitions:** never block reading; no launch-time or post-generation
    auto-paywall; no countdown timers or false scarcity **on any in-app
    surface**; no hidden or delayed dismiss control; no charging for a retry
    after our own failure; never re-show the one-time offer.
35a. **The one exception to the countdown ban is the onboarding one-time offer**
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
    carry-over cap and is what bounds the Writer yearly's exposure.
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
45a. **The welcome bonus is 10, the guest bootstrap is 3, and they are separate
    grants under separate operation keys** — §6. *(2026-09-05.)* The §2
    Writer-yearly 40%-margin row has not been re-run against 10 and that is the
    open item this decision carries; nothing else in this file assumes the old 3.
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
    the number the "a whole cast is one credit" claim rests on. Re-run §10.6
    before the portrait path is priced.

<!-- markdownlint-enable MD029 -->
