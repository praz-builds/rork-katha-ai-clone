# Story Generator — Prompt System (v5.1 Production Spec)

> Human-readable reference for the next production prompt system in
> `backend/supabase/functions/_shared/story-prompts.ts`.
>
> The TypeScript implementation is the runtime source of truth. This document is
> the product and engineering contract for the VS Code agent that will implement
> the new prompt architecture across Supabase, Expo, cover prompts, and tests.

## Product Goal

Katha should generate mobile-native fiction that feels written by a strong genre
writer, not by a generic assistant. The prompt system must optimize for:

- a complete story engine before surface prose
- reliable genre promise across 15 user-facing genres
- modular identity, spice, and trope layers
- safe adult-content handling with account-level gating
- Kids and Bedtime modes that cannot inherit adult behavior
- structured output that can be parsed and filtered downstream

## Key v5.1 Decisions

- **15 primary genres (13 in UI).** LGBTQ+ is no longer a primary genre. It becomes an
  identity lens/toggle that can layer onto any adult genre. cozyFantasy and
  paranormalRomance exist in the DB constraint but are hidden from the UI.
- **Kids is an audience mode, not an adult genre peer.** The UI may show Kids and
  Bedtime as creation choices, but backend generation must treat them as locked
  audience modes with separate rules.
- **Spice is a genre-aware layer.** Use icon-driven UI and backend enum values:
  `sweet`, `steamy`, `explicit`. MVP should ship `sweet` + `steamy`; keep
  `explicit` behind a feature flag until legal/product review.
- **No explicit content by default.** Dark Romance defaults to `steamy`, not
  `explicit`.
- **No auto-aging workaround for underage sexual content.** If the user's request
  clearly asks for sexual content involving a minor, reject at validation. If age
  is merely ambiguous in an adult romance, make adulthood clear in the story.
- **Author touchstones stay in docs only.** Runtime prompts should use craft
  traits, not living author names or instructions that could imitate a style.
- **Prompt-only JSON is not enough.** Use API-level structured output/schema
  enforcement where supported, with strict validation fallback.
- **Every prompt change needs evals.** Genre quality, banned patterns, safety,
  schema validity, and continuation behavior must be tested before deployment.

## Runtime Architecture

The runtime prompt builder should assemble layers in this order:

1. Base craft and safety rules
2. Story engine rules
3. Primary genre module
4. Audience mode module (`adult`, `kidsDay`, `kidsBedtime`)
5. Identity lens module (`queer`, optional)
6. Trope module (`werewolf`, `vampire`, `enemiesToLovers`, etc., optional)
7. Spice module (`sweet`, `steamy`, `explicit`)
8. Continuation/finale module, when applicable
9. Language module
10. Output schema reminder

Recommended builder signatures:

```ts
type PrimaryGenre =
  | "romance"
  | "romantasy"
  | "darkRomance"
  | "cozyFantasy"
  | "paranormalRomance"
  | "fantasy"
  | "scifi"
  | "thriller"
  | "mystery"
  | "horror"
  | "contemporary"
  | "historical"
  | "adventure"
  | "comedy"
  | "poetry";

type AudienceMode = "adult" | "kidsDay" | "kidsBedtime";
type IdentityLens = "queer";
type SpiceLevel = "sweet" | "steamy" | "explicit";
type TropeModule =
  | "werewolf"
  | "vampire"
  | "enemiesToLovers"
  | "foundFamily"
  | "secondChance"
  | "forcedProximity"
  | "smallTown"
  | "chosenOne"
  | "heist"
  | "lockedRoom";

buildStorySystemPrompt({
  primaryGenre,
  audienceMode,
  identityLenses,
  tropeModules,
  spiceLevel,
  language,
});

buildContinuationSystemPrompt({
  primaryGenre,
  audienceMode,
  identityLenses,
  tropeModules,
  spiceLevel,
  language,
  mode, // "chapter" | "finale"
});
```

## User-Facing Taxonomy

These are the recommended 15 creation cards for the app:

| # | UI Genre | Internal genre | Notes |
|---|----------|----------------|-------|
| 1 | Romance | `romance` | Commercial relationship-forward stories |
| 2 | Romantasy | `romantasy` | Romance and fantasy arcs have equal weight |
| 3 | Dark Romance | `darkRomance` | Adult only, steamy default, explicit feature-flagged |
| 4 | Cozy Fantasy | `cozyFantasy` | Low-stakes warmth, craft, community |
| 5 | Paranormal Romance | `paranormalRomance` | Host for Werewolf/Shifter and Vampire trope modules |
| 6 | Fantasy | `fantasy` | Magic, world, cost, wonder |
| 7 | Sci-Fi | `scifi` | One speculative idea with human consequence |
| 8 | Thriller | `thriller` | Urgency, threat, ticking clock |
| 9 | Mystery | `mystery` | Fair-play puzzle |
| 10 | Horror | `horror` | Dread, wrongness, restraint |
| 11 | Contemporary | `contemporary` | Absorbs Drama and Slice of Life registers |
| 12 | Historical | `historical` | Period consciousness and constraints |
| 13 | Adventure | `adventure` | Motion, environment, physical stakes |
| 14 | Comedy | `comedy` | Observational or absurd, committed timing |
| 15 | Poetry | `poetry` | Prose poetry / lyrical narrative mode |

Separate UI controls:

- **Kids mode:** `kidsDay` or `kidsBedtime`; force `spiceLevel: "sweet"`.
- **Queer lens:** optional toggle; maps to `identityLenses: ["queer"]`.
- **Spice selector:** icon-driven, genre-specific availability.
- **Trope chips:** genre-specific suggestions such as Vampire, Werewolf/Shifter,
  Enemies to Lovers, Found Family, Locked Room, Heist.

## Genre and Spice Matrix

| Internal genre | Default spice | Allowed spice | Suggested trope chips |
|----------------|---------------|---------------|-----------------------|
| romance | steamy | sweet, steamy, explicit* | enemiesToLovers, secondChance, forcedProximity, smallTown |
| romantasy | steamy | sweet, steamy, explicit* | enemiesToLovers, chosenOne, foundFamily |
| darkRomance | steamy | steamy, explicit* | forcedProximity, enemiesToLovers |
| cozyFantasy | sweet | sweet, steamy | foundFamily, smallTown |
| paranormalRomance | steamy | sweet, steamy, explicit* | werewolf, vampire, fatedBond |
| fantasy | sweet | sweet, steamy | chosenOne, foundFamily |
| scifi | sweet | sweet, steamy | firstContact, timeLoop, heist |
| thriller | sweet | sweet, steamy | conspiracy, chase, tickingClock |
| mystery | sweet | sweet, steamy | lockedRoom, amateurSleuth, coldCase |
| horror | sweet | sweet, steamy | hauntedHouse, bodyHorror, folkHorror |
| contemporary | sweet | sweet, steamy, explicit* | familyDrama, workplace, secondChance |
| historical | sweet | sweet, steamy | forbiddenLove, courtIntrigue |
| adventure | sweet | sweet, steamy | expedition, survival, heist |
| comedy | sweet | sweet, steamy | mistakenIdentity, workplace, absurdQuest |
| poetry | sweet | sweet | memory, grief, love, place |

`explicit*` means do not ship in mobile MVP unless product/legal explicitly enables
it, account gating exists, region gating exists, public-feed exclusion exists, and
human QA has approved test outputs.

## Base Safety Rules

These rules override user seed, genre convention, spice level, trope module, and
language.

- No sexual content involving anyone under 18. If the request clearly asks for
  it, reject before generation. If age is ambiguous in an otherwise adult story,
  make adulthood evident before any sexual escalation.
- No sexual content involving real named public figures or identifiable private
  individuals.
- No non-consent presented as erotic, romantic, funny, or deserved.
- No incest involving blood relatives, adoptive relatives, or step-family in a
  parental role.
- No bestiality. Shifter intimacy, if allowed, happens only in human form.
- No child abuse or sexualized minors in any mode.
- No detailed instructions for real-world harm, weapons, drug synthesis, evasion,
  self-harm, or exploitation, even when embedded in fiction.
- No harassment, defamation, or humiliating fiction about a real identifiable
  person.
- Kids and Bedtime modes cannot contain sexual content, adult romantic tension,
  graphic violence, substance use, or horror.

## Title Generation

The model generates the title as part of the structured output. Title rules:

- **2-6 words.** Evocative, not descriptive. The title is a promise, not a summary.
- Genre-appropriate tone: a romance title feels different from a thriller title.
- No generic AI titles: "The Journey Begins", "A New Dawn", "Shadows of the Past",
  "Whispers of Fate", "Beyond the Horizon".
- No spoilers. The title should intrigue, not reveal.
- No subtitle or colon format ("Title: A Subtitle").
- The title is user-editable in the editor. The LLM generates the first draft;
  the author has final say.

Good examples by genre:
- Romance: "The Vanilla Problem", "Letters Never Sent"
- Fantasy: "The Cartographer's Mistake", "Where Rivers Forget"
- Thriller: "Three Rings", "No Forwarding Address"
- Mystery: "The Last Tenant", "Room 4B"
- Horror: "Tuesday's Hum", "What the Mirror Kept"

Bad examples (too generic, too AI):
- "The Enchanted Journey", "Love in the City", "Dark Secrets Revealed"

## Story Engine

Before writing prose, the model should internally establish:

- protagonist
- protagonist's concrete want
- obstacle or pressure
- stakes if the protagonist fails
- irreversible choice or action
- emotional turn
- genre-specific payoff
- final image or final line

The model must not expose this plan. It writes only the JSON/story output.

Standalone structure:

- **Setup, about 15%.** Specific place, ordinary pressure, disruption. Do not
  open with weather, waking up, a mirror, or biography.
- **Middle, about 65%.** Scenes, not summary. Each scene changes knowledge,
  pressure, relationship, or risk.
- **Climax and landing, about 20%.** Highest tension or decisive choice, then a
  brief landing. The story must feel complete.

## Word Count Enforcement

Word count is a hard rule, not a suggestion.

| Mode | Minimum | Maximum | Enforced by |
|------|---------|---------|-------------|
| Standalone (adult) | 500 | 1,500 | Prompt + server validation |
| Standalone (kids) | 500 | 1,200 | Prompt + server validation |
| Series chapter | 600 | 900 | Prompt + server validation |
| Kids bedtime | 400 | 800 | Prompt + server validation |

If the model returns fewer words than the minimum, the server should flag the
response as degraded and warn the user. Stories below 300 words should be
rejected and the credit refunded.

## Series Chapter Structure

Every initial story starts as a standalone or as Chapter 1 of a series.
The user chooses "Make it a series" before generation. When `is_series` is true:

- **Chapter 1:** Establish world, protagonist, central want, and the first
  complication. End on an unresolved moment (a question, revelation, or choice).
  Do NOT resolve the central conflict.
- **Chapters 2-6:** Each chapter advances the plot with at least one irreversible
  change. End on a cliffhanger or hook. Shift relationships or power dynamics.
  Introduce new tension or deepen existing threads.
- **Chapter 7 (or any chapter marked `is_finale`):** Resolve the central conflict.
  Callback to a specific detail from Chapter 1. Land every major character arc.
  Loose threads are acceptable if the main story is complete.

`MAX_SERIES_CHAPTERS = 7`. Chapter 7 is automatically a finale.

Each chapter is 600-900 words. The complete series (7 chapters) is approximately
4,200-6,300 words.

Continuation structure:

- Match prior POV, tense, voice, relationship dynamics, and spice level.
- Do not recap previous chapters in prose.
- Do not reintroduce characters the reader already knows.
- Advance at least one irreversible plot or relationship change.
- Mid-series chapters end on a hook.
- Finale resolves the central tension and calls back to earlier details.
- `MAX_SERIES_CHAPTERS = 7`; chapter 7 is automatically finale.

## Anti-Slop Rules

### Banned Words

delve, tapestry, testament, pivotal, underscore, landscape, foster, beacon,
undeniably, multifaceted, nuanced, intricate, commendable, meticulous, endeavor,
realm, paradigm, synergy, ecosystem, framework, robust, streamline, leverage,
harness, utilize, embark, unravel, comprehensive, holistic, unprecedented,
transformative, groundbreaking, innovative, enhance, crucial, furthermore,
moreover, consequently, bustling, labyrinth, crucible, ministrations, myriad,
palpable

### Banned Phrases and Patterns

- "it's not X, it's Y"
- "it is important to note"
- "it is worth mentioning"
- "in today's world"
- "at the end of the day"
- "one of the most"
- "when it comes to"
- "at its core"
- "little did they know"
- "stands as a testament"
- "plays a vital role"
- "rich cultural heritage"
- "enduring legacy"
- "a shiver ran down"
- "a wave of emotion washed over"
- "the weight of"
- "time seemed to stand still"
- "their eyes locked"
- "heart pounding"
- "heart hammered"
- "breath caught"
- "let out a breath they didn't know they were holding"
- "couldn't help but"
- "voice barely above a whisper"
- "etched with"
- "gaze softened"
- "sent a chill through"
- "furrowed brow"
- "jaw tightened"
- "steeled themselves"
- "squared their shoulders"
- "eyes widened"
- "eyes sparkling"
- "knot in stomach"
- "pit in stomach"
- "air was thick with"

### Structural Tells

These are strong defaults, not universal hard bans. Genre modules may override
them when the device is genre-native.

- Avoid accumulative parallelism: "same X, same Y, same Z."
- Avoid rule-of-three narration except in Comedy.
- Avoid vague participial tails: "She walked out, leaving him speechless."
- Avoid negative parallelism: "Not only was he X, but he was also Y."
- Avoid rhetorical questions in narration.
- Avoid "as" sentences that stack simultaneous action.
- Avoid semicolons in dialogue or interior monologue.

### Banned Default Names

Elara, Seraphina, Lysander, Thorne, Elowen, Rowan, Zephyr, Isolde, Caelum,
Evren.

## Universal Craft Rules

- Show subtext through behavior. Do not explain it.
- Name fewer emotions. Make the body, object, action, or setting carry the turn.
- Specific over general.
- Dialogue does work: every line changes belief, status, tension, or plot.
- Use "said" for most dialogue tags and "asked" occasionally. Avoid decorative
  tags.
- Each character's voice should be identifiable without tags.
- Include interruption, deflection, silence, or non-answer in dialogue scenes.
- Use sensory grounding, but do not force a checklist into every paragraph.
- No em dashes in story text.
- No bullet lists in story text.
- No meta-commentary.
- No moral lecture at the end.

## Read-Aloud Rules

Adult modes:

- Sentences usually under 30 words, with genre exceptions for Vampire,
  Historical, Poetry, and some Contemporary.
- Paragraphs usually under 120 words.
- Simple punctuation by default.

Kids Bedtime:

- Maximum 12 words per sentence.
- Most words 1-2 syllables.
- Final three sentences 3-8 words each.
- Repetition is structural.
- Ending returns to safety, warmth, and sleep.

## Identity Lens: Queer

Applies when the user enables the LGBTQ+ / queer lens, or when character details
make queer identity clear.

- Queer identity is integrated, not explained.
- Characters do not deliver identity lectures to the reader.
- Coming out is not the default climax unless the seed explicitly asks.
- Chosen family, community, dating context, family dynamics, and regional texture
  matter when relevant.
- Avoid stock archetypes: sassy best friend, tragic queer, wise older gay mentor,
  tortured artist.
- Avoid bury-your-gays endings.
- Avoid making queer identity a replaceable label with no effect on scene,
  social context, desire, or pressure.

## Spice Modules

### Sweet

- Attraction, longing, romance, kissing, and non-graphic touch are allowed.
- No anatomical sexual vocabulary.
- If intimacy escalates, fade to black or move to aftermath.
- Default for non-romance genres and all Kids/Bedtime generation.

### Steamy

- Sensuality is on-page through want, texture, heat, closeness, breath, voice,
  and physical reaction.
- Avoid clinical anatomy and graphic mechanics.
- No explicit penetration description.
- Consent must be legible on the page.
- This is the recommended highest level for mobile MVP.

### Explicit

- Feature-flagged. Do not enable in mobile MVP without product/legal review.
- Allowed only for adult accounts, adult modes, allowed genres, private results,
  strict public-feed exclusion, region gating, and human QA.
- Still must serve character, relationship, or plot.
- Consent remains active and visible.
- Never combine with minors, real people, coercion-as-erotic, incest, or
  bestiality.

## Genre Modules

### Romance

Reader promise: yearning, tension, and an earned emotional payoff.

- Slow burn by default.
- One credible obstacle keeps the leads apart.
- Physical awareness accumulates through specific details.
- Climactic emotional or romantic choice lands before the final paragraph.
- No early love declarations unless they are a mistake.
- No attraction checklists or perfect love interests.

### Romantasy

Reader promise: magic and love entangled.

- Romance and fantasy arcs escalate together.
- The fantasy plot should break if the romance is removed, and the romance
  should lose force if the world is removed.
- Worldbuilding appears through use, conflict, cost, and power.
- Political or magical stakes matter.
- Avoid fake-archaic dialogue, prophecy dumps, and mate-bond shortcuts.

### Dark Romance

Reader promise: dangerous intensity within clear fiction and consent boundaries.

- Adult-only, steamy default.
- The love interest is genuinely dangerous, not merely rude.
- The protagonist has agency and resistance.
- Power imbalance is interrogated, not erased.
- Obsession is shown through protection, sacrifice, fixation, or risk, never
  abuse framed as love.
- No coercion presented as sexy.

### Cozy Fantasy

Reader promise: low-stakes warmth in a magical world.

- Conflict is small but meaningful.
- Craft, trade, home, community, or repair is central.
- Found family matters.
- Ending lands in small victory and rightness.
- No epic villains, chosen-one plots, ancient evil, tragedy, or high-stakes
  world-ending threat.

### Paranormal Romance

Reader promise: supernatural desire, belonging, and transformation.

- Use trope modules for Werewolf/Shifter or Vampire when selected.
- Supernatural rules should be consistent but not overexplained.
- The romance is central.
- Bodily awareness, scent, hunger, danger, secrecy, and belonging can carry
  tension.
- No supernatural bond as an excuse for one-sided consent.

Werewolf/Shifter trope:

- Fated bond can be instant, but mutual desire must remain legible.
- Pack hierarchy matters.
- Transformation is a real scene.
- Intimacy occurs only in human form.

Vampire trope:

- Immortality has cost.
- Blood is sensory and symbolic, not incidental.
- Feeding scenes are charged but bounded by selected spice level.
- The vampire's age changes their memory, power, loneliness, and ethics.

### Fantasy

Reader promise: a world that feels real enough to visit.

- Introduce magic through one character using it for a specific reason.
- Magic has cost or consequence.
- World through detail, not explanation.
- Avoid generic medieval defaults and exposition disguised as dialogue.

### Sci-Fi

Reader promise: a speculative idea handled with human care.

- One central speculative element.
- Technology appears through use.
- Ask what the idea does to a person, relationship, memory, body, job, or home.
- Avoid hardware worship, tidy time-travel logic, and generic AI apocalypse.

### Thriller

Reader promise: urgency.

- Open with immediate pressure or threat.
- Establish a ticking clock early and return to it.
- Antagonist or force has real capability.
- Each scene worsens the problem.
- Avoid villain monologues, convenient skills, dream red herrings, and pauses
  that kill momentum.

### Mystery

Reader promise: a fair puzzle.

- Plant at least three real clues, one red herring, and one detail that only
  pays off on reread.
- The detective is wrong before being right.
- The reveal explains how and why.
- Avoid murderer-from-nowhere, long detective monologues, and withheld facts the
  reader could not know.

### Horror

Reader promise: dread that lasts.

- Ordinary things wrong are stronger than generic monsters.
- Suggestion over gore.
- The supernatural may have rules even if unstated.
- End on ambiguity, escalation, or revelation.
- Avoid jump-scare prose, gore inventories, and characters dismissing obvious
  danger for pages.

### Contemporary

Reader promise: recognizably real life with emotional precision.

- Absorbs Drama and Slice of Life registers.
- Stakes are relational, professional, family, social, or existential.
- Subtext carries weight.
- Ending is recognition or shift, not a lesson.
- Avoid brand-name clutter, think-piece narration, manufactured stakes, and tidy
  therapy monologues.

### Historical

Reader promise: time travel with period consciousness.

- Characters believe things people of their time, class, and place might believe.
- Period constraints create tension.
- Use concrete period detail every scene.
- Avoid modern slang, name-dropping historical figures for no reason, and modern
  values without consequence.

### Adventure

Reader promise: motion, stakes, and a world that punishes hesitation.

- Open in motion or with a physical problem.
- Environment acts as antagonist.
- Recovery beats reveal character.
- Competence should be set up before it matters.
- No fight or escape without cost.

### Comedy

Reader promise: precision, timing, and surprise.

- Pick deadpan, warm observational, or absurd and commit.
- Comedy may use rule of three.
- Characters take absurdity seriously.
- Punchlines land in short sentences.
- Avoid explaining jokes, random references, and sarcasm as the only humor.

### Poetry

Reader promise: compressed, musical narrative.

- Prose poetry is allowed: paragraphs and sentences with poetic density.
- Recurring images gather meaning.
- Nonlinear movement is allowed if emotional logic is clear.
- Avoid abstract declarations, adjective stacking, rhyme-for-rhyme's-sake, and
  obscurity as a substitute for depth.

### Kids Day

Reader promise: active, warm, concrete, child-centered story.

- Age target: roughly 4-10.
- Length: 500-1200 words.
- One clear protagonist, one clear want, one clear problem.
- The child protagonist solves the problem through effort, curiosity, kindness,
  courage, or cleverness.
- Mild peril and funny beats are allowed.
- No adult romance, spice, graphic violence, horror, or moral lecture.

### Kids Bedtime

Reader promise: the child feels safe and ready for sleep.

- Age target: 3-6.
- Length: 400-800 words.
- Maximum 12 words per sentence.
- Prefer concrete, familiar words.
- Small conflict, quickly resolved.
- No suspense, real danger, cliffhanger, high-energy language, or exclamation
  points after the first paragraph.
- Soft senses: warmth, blanket weight, low light, quiet sound, familiar smells.
- Final paragraph explicitly returns to safety, warmth, and sleep.

Bedtime substitutions:

- eventually -> soon
- particular -> special
- arrangement -> way
- situation -> time/place
- reluctant -> shy
- mysterious -> strange/funny
- experience -> time
- discover -> find
- remember -> know
- understand -> know/see
- immediately -> right away
- suddenly -> then/all at once
- continued -> kept
- decided -> chose
- imagined -> thought
- interesting -> fun
- wonderful -> good/lovely
- important -> big/real
- different -> new
- however/although -> but
- perhaps/probably -> maybe

## Output Schema

Use API-level structured output where supported. The prompt should still remind
the model of the schema, but backend code must validate it.

Standalone:

```json
{
  "title": "string",
  "chapter_title": "string",
  "chapter_body": "string",
  "word_count": 1200,
  "themes": ["lowercase tag"],
  "first_line": "string",
  "previously_summary": "string",
  "primary_genre": "romance",
  "audience_mode": "adult",
  "identity_lenses": ["queer"],
  "trope_modules": ["vampire"],
  "spice_level": "steamy",
  "content_rating": "sweet|steamy|explicit|kids"
}
```

Continuation:

```json
{
  "chapter_title": "string",
  "chapter_body": "string",
  "word_count": 900,
  "themes": ["lowercase tag"],
  "first_line": "string",
  "previously_summary": "string",
  "primary_genre": "romance",
  "audience_mode": "adult",
  "identity_lenses": ["queer"],
  "trope_modules": ["vampire"],
  "spice_level": "steamy",
  "content_rating": "sweet|steamy|explicit|kids"
}
```

Field rules:

- `chapter_body`: plain text with `\n\n` between paragraphs, no markdown.
- `themes`: 2-4 lowercase tags, 1-3 words each.
- `previously_summary`: 2-4 sentences summarizing this chapter for future
  continuation context.
- `content_rating`: derived server-side too; never trust model output alone.

## Backend Contract

Required request fields:

- `request_id`: client-stable idempotency key
- `primary_genre`: single supported genre
- `seed`: 40-character minimum
- `characters`: optional (pre-filled placeholder in UI)
- `language`: optional, normalized supported language
- `audience_mode`: defaults to `adult`
- `identity_lenses`: optional, currently only `queer`
- `trope_modules`: optional, genre-allowed list
- `spice_level`: optional, defaults by genre and account permissions

Validation should reject:

- unsupported genre/language/spice/audience values
- adult spice in Kids or Bedtime
- Dark Romance in Kids mode
- clear requests for minor sexual content
- explicit spice when account/region/feature flag does not allow it
- explicit content in public feed or share metadata

## App Store and Feed Compliance

- Ship mobile MVP with `sweet` and `steamy` only unless explicitly approved.
- Keep `explicit` private, gated, feature-flagged, and absent from public
  surfaces if later enabled.
- Public feeds, share cards, app-store screenshots, notifications, and previews
  must never expose explicit vocabulary.
- Every adult-content unlock should log user id, timestamp, requested level, and
  declared/derived region.
- Kids mode hides adult controls and forces safe content filtering.

## Implementation Dependency Checklist

The VS Code agent should inspect and update these areas together:

- `backend/supabase/functions/_shared/story-prompts.ts`
- `backend/supabase/functions/generate-story/index.ts`
- `backend/supabase/functions/continue-story/index.ts`
- `backend/supabase/functions/_shared/llm.ts`
- `backend/supabase/functions/_shared/story_text.ts`
- `backend/supabase/functions/_shared/cover-prompts.ts`
- `backend/supabase/functions/_shared/image.ts`
- `backend/supabase/functions/library/index.ts`
- `backend/supabase/functions/feed/index.ts`
- `backend/supabase/migrations/`
- `expo/src/types/domain.ts`
- `expo/src/screens/CreateStudioScreen.tsx`
- `expo/src/lib/api.ts`
- `expo/src/theme/theme.ts`
- `expo/src/data/seed.ts`
- onboarding preference capture in `expo/src/screens/KathaOnboardingFlowV2.jsx`
- analytics events in `expo/src/lib/analytics.ts` and
  `expo/src/lib/firebase-analytics.ts`
- cover image docs in `backend/COVER_IMAGES.md`
- strategic decision docs if taxonomy or adult gating changes

## Known Current Mismatches to Resolve

- `stories.genre` is currently `text[]`, while the product decision says
  single-select. v5.1 wants `primary_genre text` plus optional arrays for
  `identity_lenses`, `trope_modules`, and generated `themes`.
- `generate-story` currently accepts one to three genre strings. v5.1 wants one
  primary genre plus separate modular fields.
- Expo currently exposes 19 genre keys, including `lgbtq`, `motivational`,
  `spirituality`, `kids`, and `bedtime`. v5.1 wants 15 adult genre cards plus
  separate Kids/Bedtime and queer controls.
- Cover prompts currently key only by old genre names. They need mappings for
  `darkRomance`, `cozyFantasy`, and `paranormalRomance`, plus trope-aware
  overlays for Vampire/Werewolf.
- Feed/library filtering currently assumes `genre` array containment. It needs a
  migration path to `primary_genre` and content-rating filters.
- Generated output is currently parsed from plain text. v5.1 wants structured
  JSON output with strict validation and fallback parsing only if needed.

## QA and Evals

Before deploying:

- Run typecheck and existing backend tests.
- Add prompt unit tests for normalization, genre defaults, spice availability,
  Kids locks, queer lens layering, and continuation prompt assembly.
- Add golden generation evals per genre:
  - 5 normal seeds
  - 3 adversarial/safety seeds
  - 2 continuation seeds
  - 2 multilingual seeds where supported
- Score outputs for:
  - genre promise
  - story completeness
  - prose freshness
  - banned word/phrase violations
  - schema validity
  - content rating correctness
  - safety boundary handling
- Run cheap-model QA first because fallback models must obey the architecture.

## Sources Checked for v5.1 Direction

- Apple App Review Guidelines and November 2025 creator-content update: creator
  apps must let users identify content exceeding age rating and restrict access
  using verified or declared age.
- Google Play Developer Program policy: stricter language around sexual content,
  profanity, sexually gratifying services, non-consensual content, and child
  protection.
- OpenAI API prompt engineering docs: structured outputs should be enforced by
  the API rather than prompt wording alone.
- Microsoft prompt engineering guidance: prompts need validation/evaluation
  because behavior that works in one case may not generalize.
- Current market signals: mobile web-fiction growth, romantasy growth, and the
  commercial strength of romance-adjacent subgenres support separating
  Romantasy, Dark Romance, Cozy Fantasy, and Paranormal Romance.
