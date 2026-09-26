# Source of truth

<!-- markdownlint-disable MD013 -->

Five canonical documents. **If any other file in this repository disagrees with
one of these, the file here is right and the other is stale** — including
`AGENTS.md`, the build logs, the roadmap, and anything under
`backend/references/`.

| File | Canonical for | Governs |
|---|---|---|
| [`CREDITS_AND_PRICING.md`](CREDITS_AND_PRICING.md) | Every credit price, plan price, grant, store SKU, earn mechanic, render tier and unit cost | `_shared/credits.ts`, the RevenueCat SKUs, every paywall and price label |
| [`STORY_GENERATION_FLOW.md`](STORY_GENERATION_FLOW.md) | The create flow — every field, label, placeholder, ordering rule, mode behaviour and post-generation step | `expo/src/screens/CreateStudioScreen.tsx`, the story view, drafts |
| [`STORY_PROMPT_SYSTEM.md`](STORY_PROMPT_SYSTEM.md) | The prompt architecture — layers, genres, safety rules, anti-slop rules, output schema | `backend/supabase/functions/_shared/story-prompts.ts` |
| [`ONBOARDING_FLOW.md`](ONBOARDING_FLOW.md) | Onboarding, both paywalls, the one-time offer, the blocked-credits sheet | `expo/src/screens/onboarding/`, the paywall surfaces |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | The visual language — type, colour, elevation, radius, the semantic spacing rhythm, and the control recipes built from them | `expo/src/theme/`, every component and screen |

## Precedence between them

They overlap deliberately, so the order matters:

1. **`CREDITS_AND_PRICING.md` wins on anything involving money.** The other four
   quote it; none of them may set a price. A flow document that needs a price
   changed says so and waits.
2. **`STORY_GENERATION_FLOW.md` wins on what the create flow does**, including
   what the prompt system must accept as input.
3. **`STORY_PROMPT_SYSTEM.md` wins on how a generation is composed**, but the
   TypeScript implementation is the runtime authority — where the two differ, the
   code is what ships and the document is the bug.
4. **`ONBOARDING_FLOW.md` wins on everything before a user reaches Home.**
5. **`DESIGN_SYSTEM.md` wins on how anything looks**, across all four of the
   above: a flow document may say a screen has a heading, not what face or
   weight that heading is in. Where a flow document draws a specific control,
   the recipe here is the one it draws.

## Changing one

- A change that crosses two of them changes both **in the same commit**. These
  files contradicting each other is the failure mode this folder exists to
  prevent.
- Working memos live in `research/`, which is gitignored. A memo is an argument,
  not an authority: nothing takes effect until its Decisions block is copied into
  one of the five files above.
- Every one of these documents dates its own revisions. Superseded reasoning is
  marked rather than deleted, so a reader can see what changed and why.
