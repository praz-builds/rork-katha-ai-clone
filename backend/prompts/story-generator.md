# Story Generator — Prompt System (v2.0)

> This is the human-readable reference for the prompt system in `backend/supabase/functions/_shared/story-prompts.ts` (571 lines). The TypeScript file is the source of truth; this document explains the design.

## Architecture

| Function | Purpose |
|----------|---------|
| `buildStorySystemPrompt(genre, language)` | ~1100-word system prompt for standalone stories |
| `buildContinuationSystemPrompt(genre, language, mode)` | System prompt for series chapters (`"chapter"` or `"finale"`) |
| `buildUserPrompt(params)` | Structures user input (genre, seed, characters, language) into user message |

Genre and language are normalized to supported enums before interpolation (prompt injection prevention).

## Anti-Slop Rules

These rules exist because AI-generated fiction has recognizable tells (sourced from Wikipedia's "Signs of AI writing" and direct pattern analysis).

### 43 Banned Words

delve, tapestry, testament, pivotal, underscore, landscape, foster, beacon, undeniably, multifaceted, nuanced, intricate, commendable, meticulous, endeavor, realm, paradigm, synergy, ecosystem, framework, robust, streamline, leverage, harness, utilize, embark, unravel, comprehensive, holistic, unprecedented, transformative, groundbreaking, innovative, enhance, crucial, furthermore, moreover, consequently, bustling, labyrinth, crucible, ministrations

### 42 Banned Phrases

"it's not X -- it's Y", "it is important to note", "it is worth mentioning", "in today's world", "at the end of the day", "one of the most", "when it comes to", "at its core", "little did they know", "stands as a testament", "plays a vital role", "rich cultural heritage", "enduring legacy", "a shiver ran down", "a wave of emotion washed over", "the weight of", "time seemed to stand still", "their eyes locked", "heart pounding in", "heart hammered against", "breath caught in", "let out a breath didn't know was holding", "couldn't help but", "voice barely above a whisper", "etched with", "gaze softened", "sent a chill through", "furrowed brow", "jaw tightened", "steeled themselves", "squared their shoulders", "eyes widened", "eyes sparkling", "knot in stomach", "pit in stomach", "air was thick with", and others (see story-prompts.ts for the full list)

### 10 Banned AI-Default Names

Elara, Seraphina, Lysander, Thorne, Elowen, Rowan, Zephyr, Isolde, Caelum, Evren

## Craft Rules

### Show, Don't Tell
- Never name an emotion then describe it
- Never explain subtext -- show lies through behavior
- Never use body language cliches

### Sentence Rhythm
- Vary dramatically: 22-word sentence, 4-word one, fragment, then longer
- Never three consecutive sentences with similar length
- At least 1 fragment per 300 words, 1 sentence over 25 words per 300 words

### Dialogue
- "said" 90%, occasionally "asked." Never "mused," "quipped," "retorted," "breathed," "exclaimed"
- Each character speaks differently
- At least 1 interrupted sentence per dialogue scene
- Characters occasionally don't answer the question asked

### Formatting
- No em dashes (use commas, periods, parentheses)
- No bullet points or lists in story text
- No meta-commentary

### Sensory Grounding
- Every scene: 2+ senses beyond sight
- Specific details ("the sour tang of yesterday's coffee" not "a pleasant smell")

## Dramatic Arc

### Standalone (500-1500 words)
- Setup 30%: ordinary world, disruption, ground in place
- Rising tension 40%: complications, personal stakes
- Climax + aftermath 30%: highest tension, then landing

### Mid-Series Chapter (600-900 words)
- Advance plot, end on hook, don't resolve central conflict

### Finale (600-900 words)
- Resolve central tension, callback to earlier chapter, land every arc
- `MAX_SERIES_CHAPTERS = 7`, auto-finale at 7

## Cultural Context

Infer from character names, traits, and story language. No explicit culture field. "Priya Menon" gets Indian details naturally.

## 16 Genre Voice Modules

| Genre | Voice | Key Rule |
|-------|-------|----------|
| romance | Intimate, warm, grounded | Slow burn, small gestures, no love declarations early |
| fantasy | Rich but controlled | World through details, magic with cost, no exposition |
| romantasy | Lush + emotional | Magic and love entangled, shifting power dynamics |
| mystery | Precise, observational | 3 clues + 1 red herring, clues in plain sight |
| thriller | Urgent, lean, propulsive | Short sentences, ticking clock, end on questions |
| horror | Restrained | Ordinary things wrong, dread over violence |
| scifi | Curious, precise | Technology through use, human story first |
| adventure | Kinetic, sensory | Movement and rest, environment as obstacle |
| historical | Grounded, textured | Period values create tension, no modern slang |
| darkAcademia | Intellectual, claustrophobic | Knowledge as power, text-within-text |
| drama | Honest, measured | Gap between saying and meaning |
| sliceOfLife | Warm, unhurried | Beauty in ordinary, specific domestic details |
| mythology | Elemental, cadenced | Declarative, transformations, origins |
| poetry | Lyrical, compressed | Prose poetry, recurring images, non-linear OK |
| comedy | Specific, observational | Setup-setup-payoff-undercut, rule of three |
| bedtime | Gentle, rhythmic, safe | Sentences slow down, final paragraph = blanket |

## Read-Aloud Quality

- Sentences under 30 words, paragraphs under 120 words
- Simple punctuation (minimize semicolons, colons)

## Input Requirements

- **Seed**: 20-character minimum (client + server)
- **Characters**: at least 1 with name
- **Genre**: single-select from 16
- **Language**: optional, defaults to English. 15 supported languages
