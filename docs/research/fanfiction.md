# Fanfiction: craft research and a verdict on the grounding hypothesis

Scope: this is research and a proposal only. No code was changed. The subject
is the `fanfiction` entry in `GENRE_VOICES`
(`backend/supabase/functions/_shared/story-prompts.ts`) and whether the
product's entity-grounding pipeline
(`grounding-types.ts`, `entity-classify.ts`, `grounding-card.ts`,
`grounding-pipeline.ts`) is the right place to solve what fanfiction actually
needs.

## 1. Findings

### 1.1 The one word fandom uses for "bad": OOC

"Out of character" (OOC) is the fandom's own name for the single most common
failure mode in fanfiction, and it is a craft judgment, not a taste
preference. Fanlore's definition and the general fandom glossary both frame it
the same way: a character behaving in a way that contradicts how they were
established, most often flagged as unintentional failure rather than
deliberate device. Calling a fic OOC is understood as criticism of the writer's
grasp of the character, and the debate about whether a given portrayal is OOC
is described by Fanlore itself as fandom's "eternal argument," because it
depends on whose reading of canon a reader accepts.
([Fanlore: Out of Character](https://fanlore.org/wiki/Out_of_Character),
[ao3wiki glossary: OOC](https://ao3wiki.com/glossary/ooc/))

That eternal-argument quality matters for a generator: there is rarely one
"correct" characterization, but there is a real difference between a writer
(or model) who has clearly internalized a specific character's speech
patterns, values and relationship history, and one producing a generic
protagonist wearing that character's name. Readers detect the second
instantly and it is the number one thing fandom communities organize their
critical vocabulary around.

### 1.2 Canon compliance and canon divergence are a spectrum, not a binary

AO3's own collection and tagging infrastructure treats "canon compliant"
and "canon divergence" / "fix-it" as a normal, expected axis of every story,
not an exception. A fix-it fic openly changes what happened in canon
(undoing a death, a breakup, a betrayal) and is tagged as doing so; a
canon-divergence fic branches from a specific point and follows its own
logic from there. Both are respected forms, and both depend on the writer
knowing canon well enough to deviate from it on purpose rather than by
accident.
([AO3: Canon Divergence and Fix-It](https://archive.transformativeworks.org/collections/Canon_Divergence_Fix_it),
[AO3 Tags FAQ](https://archiveofourown.org/faq/tags?language_id=en))

The craft implication: "canon divergence" is not permission to be loose with
canon, it is a declared, specific point of departure. A story that is vague
about what it is diverging from reads as ignorance, not as a choice.

### 1.3 Tags and warnings are a contract, not metadata

AO3's Archive Warnings are mandatory for what the community calls "the big
four": underage sexual content, non-con/rape, graphic violence, and character
death. Beyond the mandatory warnings, the additional-tags culture around
"No Beta We Die Like Men," "Dead Dove: Do Not Eat," and per-fandom tagging
conventions exists because readers use tags to select stories by trope,
dynamic and content level before they read a word of prose.
([Tags FAQ](https://archiveofourown.org/faq/tags?language_id=en),
[AO3 tags 101](https://www.tumblr.com/saltoftheao3/183746143086/ao3-tags-101))

This is a discovery and consent layer sitting outside the prose itself. It
is not something a voice module can produce, because it is metadata about
the story, not a quality of its sentences.

### 1.4 Tropes are the point, not a shortcut around craft

"Enemies to lovers" and "found family" are the two tropes that come up
constantly in both fan-facing and critical writing about why fanfiction
works. The appeal is described consistently: enemies-to-lovers works because
the starting emotional intensity (anger, rivalry, distrust) is already close
in charge to romantic love, so the writer is redirecting an existing current
rather than generating one from nothing; found family works because it
promises unconditional belonging without negating a reader's actual
family situation, and fanfiction in particular is credited with normalizing
"low-stakes intimacy" between characters (finishing each other's sentences,
knowing a coffee order) as its own reward, separate from plot stakes.
([Syfy: Origins of Fanfiction Tropes](https://www.syfy.com/syfy-wire/enemies-to-lovers-fanfiction-trope-origins),
[Fansplaining: Five Tropes Fanfic Readers Love](https://www.fansplaining.com/articles/five-tropes-fanfic-readers-love-and-one-they-hate),
[racheldoak: found family](https://racheldoak.substack.com/p/found-family-owns-my-entire-soul))

The craft consequence is specific: a trope is a known shape the reader
already wants, and the writer's job is to deliver its known pleasure with a
fresh specific beat, not to subvert or apologize for it. Playing a trope
straight, well, is harder than avoiding it and is what a strong fandom
writer is actually praised for.

### 1.5 What "bad" looks like, historically: the Mary Sue

Long before AI generation, fandom had already named the failure mode of a
protagonist who is idealized, effortlessly good at everything, and adored by
the cast without earning it: the "Mary Sue." Fanlore traces the term to
1970s Star Trek zine culture and documents that it has since become both a
useful critical shorthand and, in its overuse, a source of moral panic that
discourages new (often young) writers from writing self-insert or
wish-fulfillment stories at all.
([Fanlore: Mary Sue](https://fanlore.org/wiki/Mary_Sue),
[Fansplaining: Mary Sue](https://fansplaining.com/mary-sue/))

This is the generation-specific risk to flag: an LLM's default tendencies
(protagonist competence, frictionless resolution, universal cast approval)
are structurally the Mary Sue pattern. A genre module that does not actively
counter this will produce exactly the shape fandom has spent fifty years
naming as its own worst case.

### 1.6 Voice fidelity is old fandom's central technical argument, not a new one

Pre-internet Star Trek K/S (Kirk/Spock) zine culture is a second, independent
fandom tradition (not AO3-era, not Anglophone-internet-era) that shows the
same value held for decades: zine editors and readers argued explicitly
about whether a given portrayal was "in character" for Spock given his
established restraint, and documented regional differences (American zines
writing Kirk direct and Spock restrained; British zines writing both leads
as indirect and restrained) as a live craft debate about voice, not plot.
([Fanlore: History of Slash Fandom](https://fanlore.org/wiki/History_of_Slash_Fandom))

Two fandom cultures forty years apart, with entirely different technology
and no shared membership, independently organized their quality judgment
around the same thing: does this sound like the character. That convergence
is the strongest single piece of evidence for what this genre actually is.

### 1.7 Real-person fiction (RPF) has its own, separate norm structure

Fandom does not treat "real person" fiction as an extension of character
fiction with the names changed. Fansplaining and academic treatments of RPF
describe an ongoing, decades-long internal ethics debate specifically about
consent, the subject's aliveness, and the boundary between a public persona
and a private person, a debate that simply does not exist for a fictional
character because a fictional character has no personhood to violate.
([Fansplaining: The RPF Question](https://www.fansplaining.com/articles/the-rpf-question),
[Persona Studies: Real Person Fanfiction](https://ojs.deakin.edu.au/index.php/ps/article/view/2064))

This matters here because it draws the line this product has already drawn
elsewhere in the same file: the existing `fanfiction` module's
`whatToAvoid` already excludes "real named public figures or identifiable
private individuals, in any pairing or scenario." The research confirms that
line is not overcautious. It is the one boundary fandom itself has never
fully resolved, which makes it the wrong one for a commercial product to
attempt to navigate case by case.

### 1.8 AI-generated fanfiction: fandom's own reaction is contested and unresolved

The Organization for Transformative Works (OTW), which runs AO3, took a
public position in 2023 that AI-assisted fanworks fall within its mandate of
"maximum inclusivity of content" and are a type of work it exists to
preserve. That position was, and remains, controversial inside the fandom it
serves: a substantial part of the community sees AI-generated fanfiction as
close to plagiarism, partly because fanfiction itself is known to be part of
the training data such models were built from, and partly because it
collapses the labor and voice-study described in 1.6 into a prompt. Other
parts of fandom point out enforcement is close to impossible, since AI
authorship usually cannot be reliably detected unless self-disclosed.
([Fanlore: AI Generated Content](https://fanlore.org/wiki/AI_Generated_Content),
[OTW: AI and Data Scraping on the Archive](https://www.transformativeworks.org/ai-and-data-scraping-on-the-archive/),
[Silmarillion Writers' Guild: Fandom Draws the Line](https://www.silmarillionwritersguild.org/node/9087))

Separately, and concretely: Wattpad terminated 17 creator accounts and
removed 212 stories in May 2024, almost all romance and fantasy fanfiction
cross-posted from TikTok AI writing tools, specifically for non-disclosure
of AI use rather than for the fanfiction itself.
([platform policy summary](https://www.alibaba.com/product-insights/is-using-ai-to-write-fanfiction-violating-platform-tos-ao3-fanfiction-net-and-wattpad-policy-updates.html))

Read plainly: this is not a hypothetical reputational risk. It is a thing
that has already happened, on a comparably-shaped consumer product, in the
same content category this feature ships into.

## 2. Verdict on the hypothesis

**The hypothesis holds, and more strongly than the brief states it.**
Fanfiction is a grounding problem first. But it is not *only* a grounding
problem, and the reason is worth being precise about, because it changes
what ships.

The evidence across five independent sources spanning fifty years and
several fandom cultures (K/S zines, AO3 tagging infrastructure, trope
essays, Mary Sue criticism, RPF ethics debates) converges on one claim:
fandom's quality judgment is almost entirely about fidelity to something
external to the sentence being written; a specific character's voice, a
specific canon's facts, a specific relationship's history. None of that
external material can live in a genre module, because a genre module is one
paragraph shared by every fanfiction story the product will ever generate,
and the thing that makes one fanfic good and another bad is different in
every single instance, by fandom, and often by character. A voice module can
teach a model how fanfiction *behaves as a form* (compressed table-setting,
trope commitment, heightened emotional register). It cannot teach a model
who Draco Malfoy is, and 1.1 and 1.6 both say that is the actual bar.

Where the brief's framing needs sharpening: this is not "grounding OR voice."
It is grounding for the fidelity, and a (much shorter, more honest) voice
module for the handful of genre-shaped things that really are per-genre:
compression, trope delivery, the assumption of shared history with the
reader. Section 5 proposes exactly that split. The voice module should stop
pretending it can deliver characterization fidelity, because right now
(see the current `GENRE_VOICES.fanfiction` in `story-prompts.ts`) it
partially tries to, with language like "voice and mannerism consistency for
an established dynamic," a promise the module has no mechanism to keep.

## 3. If grounding: what it needs

The existing pipeline is close, but not compatible with fanfiction as built.
Read literally, it is closed against exactly this use case. The most direct
evidence is in `grounding-types.ts` itself, in the comment on
`fictional_character`:

> `fictional_character` never grounded. The model knows Spider-Man, and
> this product does not owe anyone canon fidelity.

And `entity-classify.ts`'s system prompt states the same thing as a rule the
classifier is told to apply:

> The entity is fictional. The model knows published fiction well, and this
> product does not require canon fidelity. Spider-Man, Sherlock Holmes,
> Zeus: no grounding.

And `selectGroundingCandidates` enforces it in code, not just in the prompt:
it filters out any entity whose `entityClass` is `"fictional_character"`
before a card is ever built. This is not an oversight to patch. It is a
previous, deliberate decision (correct for every other genre, where a
Spider-Man cameo is set dressing) that fanfiction is the one genre where it
is exactly backwards. The product does not currently owe anyone canon
fidelity, except in the one genre defined by owing it.

### 3.1 What has to change in `EntityClass`

The current seven-member `EntityClass` in `grounding-types.ts`
(`historical_public_figure`, `living_public_figure`, `fictional_character`,
`real_place`, `real_event`, `organization_brand`, `private_individual`) has
no member that means "a specific character from a specific, identifiable
work of fiction, where canon fidelity is the point." `fictional_character`
today means the opposite: "fictional, therefore no fidelity owed." Reusing
it would mean either quietly changing its meaning for every other genre
(risky: comedy and adventure lean on the current, correct "no grounding"
behavior when they mention a fictional character in passing) or special-casing
it by `primaryGenre`, which the type itself cannot express since
`EntityClass` carries no notion of which story it came from.

The clean fix is a new member, something like `fandom_canon_character`
(a specific character from an identified, named work), sitting beside
`fictional_character` (an incidental fictional reference that still needs
no fidelity). The distinction the classifier would need to draw is not
"is this fictional" but "is this fandom-genre content whose entire point is
this specific character," which the classifier can determine cheaply since
it already receives `primaryGenre`-adjacent context indirectly through the
idea text, and could receive it directly as a parameter the way
`characterNames` already is.

A second gap: none of the seven classes represents the *source work itself*
(the show, book, game, or fandom as a whole) as opposed to a character in
it. A grounding request for "a story where Hermione and Draco are stuck
in detention together" needs a card about Hermione and a card about Draco,
but a request for "a story set during the Triwizard Tournament" needs
grounding about an *event within the canon*, not a character. The existing
`real_event` class means a real historical event; it has no fictional
counterpart. Whether this is worth a dedicated `fandom_canon_event`/
`fandom_setting` class or whether it is acceptable to fold canon-world facts
into the character card's `details` field is a real design choice, not
answered by this research; see the open question in Section 6.

`SEARCHABLE_ENTITY_CLASSES` would also need the new class added, since
fandom wikis and episode transcripts are exactly the kind of public,
non-private source `grounding-search.ts` already fetches for historical
figures, and a niche fandom is precisely the "long-tail, model half-knows
it" case the whole pipeline was built to catch (see 3.2).

### 3.2 What the classifier's decision rule needs to add

`entity-classify.ts`'s `needs_grounding` heuristic is keyed on obscurity,
staleness past the knowledge cutoff, and verifiable factual risk (dates,
titles, geography). None of those three tests is what makes a fandom
character risky. A wildly popular, heavily-documented character (Spock,
Draco Malfoy, Loki) is exactly as likely to be written OOC by a
general-purpose model as an obscure one, per 1.1 and 1.6, because the
failure is about *voice and relational history*, not training-data
coverage. The rule for this class needs to be closer to: "would a
general-purpose model, given only this character's name, reproduce their
specific speech pattern, established relationships, and canon-specific
mannerisms, or would it produce a generic version wearing their name?" That
is a different, harder judgment than the existing three tests, and it may
need a fourth test added specifically for this class rather than folded
into the existing three.

### 3.3 What a fandom fact card would need that the current `GroundingCard` shape does not have

`GroundingCard` (`era`, `role`, `nameForms`, `details`, `pitfalls`, `source`)
was authored for a novelist staging a historical figure in a scene: when
and where, what they did, how they are addressed, sensory texture, named
errors. Fidelity to a fictional character needs most of that shape, plus
at least three things it currently has no field for:

- **Speech pattern / voice**, not covered by `role` (one line, what they
  are) or `details` (sensory, material facts about their world). This is
  the single field 1.1 and 1.6 both say matters most, and the current card
  schema has no home for it. `nameForms` covers *what they are called*, not
  *how they talk*.
- **Relationship state between named characters**, when more than one card
  is being built for the same story (which the classifier's
  `MAX_GROUNDING_CARDS = 3` already anticipates for other classes). A card
  for Draco alone cannot carry "he and Harry have history that shapes every
  line of banter between them"; that fact belongs to the pair, not to
  either character's card.
- **Canon-versus-fanon flag**, unique to this class. Every long-running
  fandom accumulates widely-believed "fanon" (fan-invented headcanon so
  common it gets mistaken for canon, the exact shape of the "Maharaj is a
  surname" bug this pipeline was built to prevent, but generated by the
  fandom itself rather than by the model). A fandom card needs a field
  distinguishing "this is stated in the source" from "this is popular fan
  interpretation, use only if the story wants it," or the model will
  confidently assert fanon as canon fact, the same failure this whole
  system exists to stop, just relocated one layer up.

`pitfalls` maps directly (fandom-specific OOC complaints are exactly
"named, specific errors" in the sense the field already asks for) and
`details` maps directly for world texture. `era` is close to irrelevant for
most fandom characters and would likely be repurposed as "point in the
story's own timeline" (pre- or post- a specific canon event, since a
character's voice can shift across their own arc).

## 4. IP and platform risk

This section reports the landscape. It is not legal advice, and the
decision it describes belongs to the product owner, not to this document.

- **Fanfiction's own legal footing is "fair use, mostly untested, mostly
  tolerated."** US courts have found transformative works, including
  derivative fiction that adds new expression or meaning, protected under
  fair use, and multiple summaries describe fanfiction as sitting in this
  gray zone specifically because the vast majority of it is
  non-commercial, small-scale, and never litigated.
  ([OTW: Fanworks, Fair Use, and Fair Dealing](https://www.transformativeworks.org/fanworks-fair-use-and-fair-dealing/),
  [NYU JIPEL: Is Fanfiction Legal?](https://jipel.law.nyu.edu/is-fanfiction-legal/),
  [VLAA: The Role of Copyright Law in Fanfiction](https://vlaa.org/the-role-of-copyright-law-in-fanfiction/))

- **"Non-commercial" is the load-bearing word, and this product is
  commercial.** Every source above draws the same line: rights holders
  have historically tolerated free fan writing and gone after anyone
  charging money for derivative work built on their characters. Katha AI
  sells credits for generation. A feature that lets a paying user generate
  a scene between two characters from a named, identifiable, still-in-
  copyright work is commercial use of those characters by the ordinary
  meaning rights holders and courts have used to draw this line, regardless
  of how the underlying model was trained.

- **There is a directly on-point precedent for what happens when a platform
  tries to commercialize fanfiction at scale: Amazon Kindle Worlds.**
  Amazon ran a licensed commercial fanfiction marketplace from 2013 to
  2018, paying authors 20 to 35 percent of net sales, and shut it down
  entirely. It is the clearest real-world data point that even a company
  with Amazon's licensing leverage found commercial fanfiction hard to
  sustain as a business, and every world on it required an individually
  negotiated license from the specific rights holder; there was no general
  mechanism that made "fanfiction" commercially safe as a category.
  ([Fanlore: Kindle Worlds](https://fanlore.org/wiki/Kindle_Worlds),
  [Wikipedia: Kindle Worlds](https://en.wikipedia.org/wiki/Kindle_Worlds))

- **AI-generated fanfiction is not obviously worse off legally than
  human-written fanfiction, but it carries an additional, separate
  exposure the human version does not: the training-data question.**
  Whether the underlying model was trained on copyrighted fiction
  (including fanfiction itself) without license is a live, unresolved
  legal fight in the broader AI industry, entirely independent of what any
  individual user generates. A product built on top of a third-party model
  inherits that exposure without controlling it.
  ([Lexology: Copyright Law & Fanfiction](https://www.lexology.com/library/detail.aspx?g=a70d9f53-14c7-4f25-adf2-aa7736e16578))

- **Fandom itself has not made peace with AI-generated fanfiction, and a
  comparable consumer product has already been publicly penalized for it.**
  OTW's own 2023 stance ("within our mandate to preserve") is contested
  inside the community it serves, with a real faction treating
  AI-generated fanworks as something close to plagiarism against the
  fanwriters whose work trained the models. Separately, Wattpad terminated
  17 creators and pulled 212 stories in May 2024 for undisclosed AI-written
  romance and fantasy fanfiction cross-posted from TikTok tools. That is
  not a copyright action; it is the platform itself deciding undisclosed
  AI fanfiction damaged trust with its community.
  ([Fanlore: AI Generated Content](https://fanlore.org/wiki/AI_Generated_Content),
  [platform policy summary](https://www.alibaba.com/product-insights/is-using-ai-to-write-fanfiction-violating-platform-tos-ao3-fanfiction-net-and-wattpad-policy-updates.html))

**The decision this creates for the product owner:** whether Katha AI is
willing to let paying users generate scenes centered on named, identifiable,
in-copyright characters at all, and if so, whether that is scoped down
(public-domain and sufficiently-old works only; user-original characters in
a fan-style register instead of named canon characters; no named living
authors' universes) or accepted as an open general-purpose risk the same
way any other user-generated-content platform accepts it. This document
takes no position on which answer is right. It flags that the current
`fanfiction` genre, as shipped, does not appear to have made this decision
explicitly; it simply excludes "real named public figures or identifiable
private individuals" (RPF) in `whatToAvoid`, which addresses 1.7 but says
nothing about copyrighted fictional characters, which is the far larger
share of what "fanfiction" means to the people who use that word.

## 5. Proposed voice module

Same four fields as every other entry in `GENRE_VOICES`. This version is
narrower than the one currently in `story-prompts.ts`: it stops claiming
credit for characterization fidelity, states plainly what the module cannot
do, and confines itself to the things that are genuinely genre-shaped
(compression, trope delivery, the assumption of shared history). It assumes
Section 3's grounding work ships alongside it; without grounding, the
honest thing to say is that this module cannot deliver the one thing this
genre is judged on, and the module below says exactly that in its own
whatToAvoid, so nobody downstream mistakes prose polish for fidelity.

```typescript
fanfiction: {
  voice:
    "Heightened, compressed, and written for a reader who already loves this cast. Skip the introductions a debut story would need and go straight to the dynamic the reader came for. This voice module cannot tell you how a specific character talks, what they call each other, or what already happened between them. That knowledge has to come from the grounding layer or from what the user wrote. Without it, name the characters and write a strong original scene rather than guessing at a voice you do not actually have.",
  pacing:
    "Get to the charged moment fast. A fanfic reader is not here for a slow first act, they are here for the reunion, the rivalry, the one bed, the missing scene, so spend little time on setup and dwell hard once you are inside the scene that was promised. Emotional beats can land closer together and bigger than in original fiction, because the reader arrived already invested in these people.",
  whatWorks:
    "Committing fully to the chosen trope (enemies to lovers, found family, canon divergence, one bed) and delivering its known pleasure with one fresh, specific detail, rather than winking at the reader or apologizing for the trope. A callback or in-joke that rewards a reader who already knows this cast. Letting an established relationship's history show through small, unexplained shorthand instead of re-introducing it. A clean, stated point of divergence when the story departs from canon, so the departure reads as a choice.",
  whatToAvoid:
    "Guessing at a character's voice, mannerisms, or relationship history when nothing in the prompt actually supplies them. That produces a generic protagonist wearing a familiar name, which is the single most common complaint fandom readers make about a story. A flawless, universally adored version of any character. Real named public figures or identifiable private individuals, in any pairing or scenario. Explaining canon the reader already knows. A wink at the reader that breaks the fourth wall. Treating the trope as a joke instead of playing it straight.",
},
```

## 6. Decisions

Flat statements for the product owner to approve or reject.

1. **The hypothesis is confirmed.** Fanfiction's quality bar is fidelity to
   external, per-fandom material (character voice, canon facts, relationship
   history), not genre-level prose craft. A shared voice module cannot
   supply that. It can only supply the form-level things that are genuinely
   generic to the genre: compression, trope delivery, the assumption of
   shared history with the reader.

2. **Recommend: this genre should not ship claiming characterization
   fidelity until the grounding pipeline supports it.** As it stands today,
   `selectGroundingCandidates` explicitly excludes `fictional_character`
   from grounding, so `fanfiction` currently generates with zero fidelity
   support, while its existing voice module's `whatWorks` promises "voice
   and mannerism consistency for an established dynamic," a promise the
   pipeline has no mechanism to keep. That gap should be closed one of two
   ways: ship the module in Section 5, which states the limitation
   honestly, or hold the genre back until grounding support (Section 3)
   ships.

3. **Grounding support for this genre needs a new `EntityClass` member**
   (proposed: `fandom_canon_character`) distinct from the existing
   `fictional_character`, whose current meaning ("fictional, therefore no
   fidelity owed") is correct for every other genre and should not change
   for them. This is a type and classifier-prompt change, not a
   reinterpretation of an existing value.

4. **The classifier's `needs_grounding` heuristic needs a fourth test
   specific to this class.** The existing three tests (obscurity,
   post-cutoff staleness, verifiable factual risk) do not predict OOC risk;
   a famous, heavily-documented character is exactly as likely to be
   written generically as an obscure one. This is a prompt-design task, not
   a type change, but it is a real one and should not be treated as a
   drop-in reuse of the existing rule.

5. **The `GroundingCard` shape needs at least one new field (speech
   pattern / voice) to be useful for this class**, and probably two more
   (a canon-versus-fanon flag, and a way to carry relationship state
   between two named characters in the same story). Shipping fandom
   grounding on the current five-field card without a voice field would
   reproduce the same failure this document argues against: a
   structurally-correct fact card that still cannot fix OOC writing,
   because the one field that would have fixed it does not exist yet.

6. **The IP question is unresolved and is the product owner's to make, not
   engineering's or this document's.** The specific decision: is Katha AI
   willing to let paying users generate scenes built on named,
   identifiable, in-copyright fictional characters, and if so, at what
   scope (public-domain works only, no named living authors' universes,
   user-original characters in a fan-style register instead of named canon
   figures, or fully open). Kindle Worlds is the closest real-world
   precedent for what commercializing this space actually costs, and it
   ran on individually negotiated per-property licenses, not a general
   "fanfiction is fine" policy. Wattpad's 2024 enforcement action shows
   platform-level, non-legal risk (community trust, creator account
   termination) exists independently of the copyright question.

7. **The RPF boundary already in the shipped module (`whatToAvoid`:
   "Real named public figures or identifiable private individuals, in any
   pairing or scenario") is correct and should stay, unchanged, regardless
   of how Decisions 2 to 6 resolve.** Research finding 1.7 shows this is
   the one line fandom itself has spent decades failing to agree on. It is
   the right line for a commercial product to hold rather than adjudicate.

8. **Open question, not resolved by this research:** whether canon-world
   facts (the rules of a setting, a specific in-universe event) belong in a
   new `fandom_canon_event`/`fandom_setting` `EntityClass`, or can be folded
   into the `details` field of a character card tied to that work. This is
   a real design choice for whoever implements Section 3, and this
   document deliberately does not answer it.
