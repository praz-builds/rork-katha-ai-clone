# Craft research: educational

Status note before anything else: `educational` already ships. It exists in
`GENRE_VOICES` (`backend/supabase/functions/_shared/story-prompts.ts`), in the
`PrimaryGenre` union and genre lists (`types.ts`), and in the cover-prompt
config (`cover-prompts.ts`), covered by tests in `story-prompts.test.ts`,
`types.test.ts`, `validation.test.ts`, and `cover-prompts.test.ts`. This
research was scoped as if proposing a new module, so section 5 below is
written as a revision to paste over the existing entry, not a from-scratch
pitch. Section 6 flags what the current shipped version is missing.

## 1. Findings

**The core craft distinction is discovery versus delivery, not presence versus
absence of fact.** The clearest formulation: didactic writing tells an
audience what to think, so a reader's honest reaction is "that's the
presenter's idea, and I'm skeptical of it." Narrative leads a reader to
arrive at the same idea themselves, so their reaction is "that's my idea." The
information can be identical. What changes is who appears to have done the
thinking. (The Moral Premise, "How to Change the World at Bedtime,"
http://moralpremise.blogspot.com/2018/07/how-to-change-world-at-bedtime-art-of.html)

**"Faction" is the named failure mode, and it comes from the goal, not the
execution.** New Zealand science-education researchers use "faction" for the
specific way narrative curdles when a story's actual job is delivering
curriculum content: the plot survives only as long as it takes to justify the
next fact, characters exist to ask questions an expert answers, and the story
is structurally a slideshow wearing character names. Their finding is that
this happens even to writers who know better, because the brief itself
("teach photosynthesis") points at content instead of at a character who
wants something. (NZCER, "Faction or fiction: using narrative pedagogy in
school science education,"
https://www.nzcer.org.nz/research/publications/faction-or-fiction-using-narrative-pedagogy-school-science-education)

**Two named techniques for smuggling information in without a stop-and-explain
beat.** "Incluing" (a term coined by novelist Jo Walton for genre fiction, and
applicable directly here) is the discipline of scattering necessary
information across dialogue, action, and interior thought so thinly that a
reader absorbs it without registering a lesson. Its opposite, the expository
lump, is what the existing `educational` module in this codebase is already
gesturing at with "if you can delete a sentence and the plot still works, it
was a lesson." The companion craft move from general fiction advice: make
information an obstacle the character has to want, not a fact the narration
volunteers — a character asking a question because not knowing costs them
something right now, not because the scene needs an information delivery
vehicle. (Reedsy / general craft consensus on exposition and "show don't
tell," https://reedsy.com/blog/guide/elements-of-plot/exposition/,
https://reedsy.com/blog/show-dont-tell/)

**The best-executed commercial example separates fact from story explicitly, in
the text, rather than trying to make the story itself carry the entire truth
burden.** The Magic School Bus books put fantastical events in the story
(a bus shrinking to the size of a blood cell) but close every book with a
page, in a different register, stating plainly which parts were real science
and which were invented for the story. The series also models epistemic
honesty inside the narrative itself — a child character writes "scientists
think X" rather than "X is true," teaching the reader that scientific
knowledge is provisional, not just teaching the fact. This is a structural
answer to the truth problem, not a prose-style answer: it does not ask the
story to be perfectly accurate everywhere, it asks the product to draw a
visible line between story and fact. (Scholastic /
NSF, https://www.nsf.gov/science-matters/nsfstories-what-magic-school-bus-can-teach-us,
https://www.scholastic.com/parents/books-and-reading/book-lists-and-recommendations/series-characters-authors/magic-school-bus-classics.html)

**Fiction is a disproportionately effective vector for misinformation, and the
mechanism is well studied.** Readers who are "transported" into a story —
which is the entire goal of good fiction craft — show measurably reduced
access to their own prior knowledge while reading, meaning they are worse,
not better, at catching an embedded factual error than they would be reading
the same claim in a lecture. Multiple studies (Marsh, Fazio, and others) found
that readers absorb false claims from fiction even when they have the
correct knowledge already and even when they are told in advance the story
contains errors and instructed to watch for them; the effect is reduced by
active error-flagging but never eliminated. Historical fiction and
"realistic" narrative produce more confident false belief than fantastical
narrative, because plausibility of the frame transfers to plausibility of the
embedded claim. This is the single most important fact for a product owner in
this whole document: the same craft quality that makes a story good is the
mechanism that makes a wrong fact inside it more convincing than the same
wrong fact stated plainly. (Fazio, Barber, Rand, Marsh, et al., summarized at
https://pubmed.ncbi.nlm.nih.gov/24499200/ and
https://link.springer.com/article/10.3758/BF03193260; PDF at
https://static1.squarespace.com/static/5c8baca1e5f7d136349ea789/t/5da48d1c54dbe63e71009ddf/1571065116242/Fazio,+Dolan,+Marsh,+2015.pdf)

**Non-Western traditions separate two things this brief conflates: teaching a
value/behavior versus teaching a verifiable fact, and they use different
fidelity mechanisms for each.**

- The Panchatantra and Jataka tales teach worldly conduct and ethics through
  animal-archetype fables. Their pedagogical claim is behavioral ("act with
  foresight," "cruelty returns on the cruel"), not factual, and the craft
  answer to accuracy is irrelevant there because there is no external fact to
  get wrong — the lesson is validated by the story's internal logic, not by
  the outside world. This is exactly what this codebase's separate `folktale`
  module already covers, and it is a useful negative case: `folktale` proves
  the product already knows how to teach without a truth obligation, because
  there is nothing to be true about. `educational` is the harder sibling
  precisely because it claims real facts. (Summarized across
  https://www.anhayafoundation.com/post/what-the-panchatantra-knew-about-children-that-modern-psychology-is-only-just-confirming,
  https://studyvalue.education/application-support-skills/teaching-values-through-panchatantra-tales/)

- Aboriginal Australian songlines are the strongest non-Western case of oral
  narrative carrying literal, checkable factual content — geography,
  seasonal ecology, navigation, and in some documented cases geological
  events (coastline positions from before postglacial sea-level rise,
  correct across many thousands of years of oral-only transmission). What
  makes them reliable is not that the storytellers were careful in the way a
  fact-checker is careful; it is structural: fixed melodic and rhythmic
  patterns, physical rehearsal by walking the actual land the song describes,
  and layered content where a full, exact version is reserved for
  initiated listeners while a simplified, story-forward version circulates
  more widely. The lesson transfers directly: fidelity is best guaranteed by
  a structure external to the prose (repetition, an authoritative source
  walked/checked against, a distinction between the public-facing version and
  the fully verified one) rather than by asking each individual telling to be
  perfectly careful. (SAPIENS, "The Oldest True Stories in the World,"
  https://www.sapiens.org/language/oral-tradition/; overview at
  https://arxiv.org/pdf/1607.02215)

- Chinese literary history supplies the clearest cautionary tale for what
  happens when a product does not draw the Magic-School-Bus-style line. The
  fourteenth-century novel *Romance of the Three Kingdoms* is traditionally
  described by its own critics as "seven parts fact, three parts fiction."
  Qing-dynasty commentators explicitly blamed this ratio for public
  misunderstanding of real history: because the factual majority earns the
  reader's trust, the invented minority is absorbed as fact too, and for
  centuries most Chinese readers' working knowledge of the Three Kingdoms
  period came from the novel's inventions rather than the historical record.
  This is the failure mode of a "mostly true" educational story: mostly true
  is not a safety margin, it is a delivery mechanism that makes the untrue
  part harder to detect, not easier. (Summarized across
  https://kongming.net/novel/intro/ and
  https://pressbooks.nvcc.edu/eng255/chapter/the-romance-of-the-three-kingdoms/)

## 2. Genre or mode?

**Verdict: mode, wearing a genre's clothes for taxonomy convenience. Ship it
as a mode as soon as the product can afford the migration; until then, treat
its genre slot as a compatibility shim, not a design commitment.**

Argument. Every other entry in `GENRE_VOICES` answers the question "what
should this story feel like reading" — romance's felt experience is
intimacy-under-tension, horror's is dread, mystery's is controlled
information asymmetry. `educational` cannot answer that question on its own,
because its actual claim is orthogonal to felt experience: "this story is
also required to leave the reader knowing something true." A user could want
that requirement layered onto a mystery (a detective story that also
correctly teaches forensic entomology), an adventure (a survival story that
correctly teaches wilderness medicine), a historical (already handles real
period detail, but without the explicit truth-obligation and closing-note
machinery this document proposes), or even a romance (two chemists falling in
love, where the chemistry has to be right). The shipped `educational` module
already backs into this by writing generic, genre-agnostic pacing advice —
"a protagonist attempts something, gets it wrong for a real reason" — which
is compatible with essentially any plot shape, unlike, say, thriller's
ticking-clock pacing rule, which is genre-specific by design.

The counter-argument for keeping it a genre slot, and why it does not win:
`audience_mode` in this codebase is currently reserved for `adult` / `kids`
(see `types.ts`), a different axis (age-appropriateness) from what
`educational` needs (a truth obligation plus closing disclosure). Turning
`educational` into a true mode means either overloading `audience_mode` with
an unrelated concern or adding a new axis (e.g. a boolean or an
`educational: true` flag that can combine with any `primaryGenre`), a
migration real enough that "leave it as a genre for now" is a defensible
short-term call. That is a scoping decision for engineering, not a reason to
believe it actually belongs in the genre list conceptually.

## 3. The truth problem

This is the section that matters most. Three positions, stated flatly:

**Position 1: Grounding as currently built does not solve this, and cannot,
without new scope.** The grounding pipeline
(`grounding-types.ts`, `grounding-pipeline.ts`, `grounding-card.ts`) is
entity-scoped: it classifies named real people, places, events, organizations,
and brands, and builds fact cards for the subset the model is likely to get
wrong. It has no mechanism for a bare factual claim that names no entity —
"photosynthesis converts light into chemical energy," "the Krebs cycle
happens in mitochondria," "a lever multiplies force," "penicillin was
discovered from mold." These are exactly the claims a general educational
story about science, math, or how something works is built from, and none of
them trip the entity classifier. An `educational` story about Marie Curie
gets real grounding today; an `educational` story about radioactivity itself
gets none. The pipeline should not be expanded to catch this — that is a
different, much larger system (a claim extractor plus a science/fact
retrieval and verification layer) — but the gap has to be named so nobody
assumes grounding already covers educational content because both words
start with "the model might be wrong."

**Position 2: yes, require it, but scoped to what it can actually do.**
`educational` generations should always run the existing grounding
classifier over the idea and character sheets, exactly as every other genre
already can. When the idea names a real entity (a historical figure, a real
place, a real event), grounding must run and the resulting card must be
honored — this is the one case where declining grounding for cost reasons is
not acceptable, because `educational` is the one genre whose entire premise
is "you can trust what this says." For the far larger space of ungrounded,
non-entity factual claims (science, math, mechanisms, procedures), the
product does not have a verification layer today, and building one is out of
scope for this research. What is in scope is craft: the voice module below
is written so the model polices its own confidence — stating only what it
would state in a plain non-fiction answer, and reaching for the load-bearing
detail it can commit to fully rather than the impressive-sounding one it is
guessing at.

**Position 3: vague-but-true beats specific-but-wrong, stated as policy, not
just as a style preference.** This is where `educational` collides hardest
with "Anti-Slop Rules" elsewhere in the base prompt, which push every other
genre toward specificity as a matter of course ("not 'a pleasant smell' but
'the sour tang of yesterday's coffee'"). For every other genre a specific
invented detail costs nothing, because there is no reader relying on the
detail being real. For `educational`, an invented specific (a fabricated
date, a made-up mechanism, a plausible-sounding but wrong number) is worse
than a true generality, because — per the Fazio/Marsh findings above — the
more concrete and confident a false claim sounds inside a well-told story,
the more likely a transported reader is to absorb it as fact and the less
likely they are to notice it was wrong. The rule this product should adopt:
inside `educational`, specificity is earned only by things the model is
actually sure of; everywhere else in the prompt "be more specific" is
unconditionally good advice, and inside `educational` alone it is
conditional on truth. That conditional needs to be stated explicitly in the
educational module, or the model will default to the base-layer instinct to
invent a convincing specific.

**Position 4: adopt the Magic School Bus disclosure pattern as the actual
truth mechanism, because prose alone cannot fully carry this.** No amount of
prompt engineering makes a language model's prose infallible, and this
product should not pretend it does. The practical fix that has already been
proven at scale is structural, not stylistic: every `educational` story
should ship with a short, separately labeled closing note — outside the
story's voice, in a plain non-fiction register — stating what in the story
is a real, checkable fact and what was invented or dramatized for the story
(a composite character, a compressed timeline, an invented dialogue). This
is a product and schema decision (a new field on the story, not prose inside
it), and this document does not attempt to design it, but the research
answer is unambiguous enough to name here as the load-bearing recommendation:
craft can reduce how often the model states something false with confidence;
only a visible fact/fiction seam, read separately from the immersive prose,
protects the reader who cannot tell the difference from inside the story.

## 4. The collision

Each global rule, how `educational` wants to break it, and which side wins.

- **Show, don't tell** vs. **the reader needs the actual mechanism stated.**
  A story that only shows a character being cold cannot teach why insulation
  works; at some point something closer to a stated mechanism has to appear.
  Winner: show don't tell wins on emotion and interiority (never state "she
  felt determined"), but a factual mechanism is not an emotion — it can be
  spoken by a character who has a reason to say it out loud (teaching a
  student, arguing a point, explaining a plan before acting on it), which
  keeps it inside dialogue-with-a-stake rather than inside narration. This is
  what the existing module already gets right with "dialogue with a stake in
  it," and it should stay the load-bearing craft move.

- **No exposition dumps** vs. **the reader arrived to learn something and a
  single embedded detail is not enough to actually teach it.** Winner:
  no exposition dumps wins, but the fix is incluing (spreading the fact
  across several small moments the plot needs anyway) rather than removing
  the fact. If the concept genuinely cannot survive being broken into three
  or four load-bearing beats, the concept was too large for a short story
  and should be narrowed, not exempted from the rule.

- **No meta-commentary / no moral at the end** vs. **educational content
  often wants a takeaway the reader can name.** Winner: no meta-commentary
  wins inside the story. The takeaway belongs in the closing disclosure note
  from Position 4 above, in its own plain register, not smuggled into the
  story's final paragraph as a stated lesson. This actually resolves the
  collision rather than picking a side: the story stays a story, and the
  fact/lesson gets an honest, separately labeled home instead of an
  in-character mouthpiece.

- **Anti-Slop specificity push** vs. **the truth obligation.** Already
  covered in full under Position 3. Truth wins inside `educational`; this is
  the one genre where the base layer's "always more specific" instinct must
  be overridden, and the module needs to say so directly or the base layer's
  gravity will win by default.

- **Sentence rhythm / read-aloud rules** vs. **nothing.** No real collision.
  These are prose-mechanics rules and apply the same way regardless of genre.

- **"An irreversible choice" / genre payoff from the Story Engine layer** vs.
  **the felt shape of a "lesson learned" story is often a realization, not an
  irreversible external choice.** Minor friction, not a real collision:
  the character choosing to apply the new understanding (use the correct
  technique, share the correct information, act on the corrected
  misconception) is itself the irreversible choice the engine wants. Winner:
  the Story Engine layer, satisfied by treating "acting on what was learned"
  as the irreversible beat.

## 5. Proposed voice module

Ready to paste over the existing `educational` entry in `GENRE_VOICES`
(`backend/supabase/functions/_shared/story-prompts.ts`, currently lines
583-592). Matches the length and register of the existing modules. No em
dashes, no banned words, no banned phrases.

```
educational: {
  voice:
    "A real story first. A fact, a mechanism, or a skill lives inside what the protagonist does to get what they want, and the character needs it to solve the actual problem, not to fill a pause in the narration. State a mechanism only when you are certain of it. When you are not certain, choose the truer, plainer version over the more impressive, more specific one. A vague sentence that holds up is worth more here than a vivid one that doesn't.",
  pacing:
    "Let the protagonist attempt something, get it wrong for a real reason, and reach the correct approach through consequence, not through a mentor explaining it in one paragraph. Break a large idea into the two or three moments the plot already needs, rather than one scene carrying the whole concept. Curiosity should drive the story the way a clue drives a mystery: a specific question the character must answer before they can act.",
  whatWorks:
    "A protagonist whose gap in knowledge costs them something concrete before they close it. Information spoken by a character who has an actual reason to say it out loud right now, not one who exists to ask the question an expert then answers. A mistake with a fair, visible cause, and a fix the reader can follow. A closing image or action that shows what the character can now do, instead of a line that states what they learned.",
  whatToAvoid:
    "A narrator who stops the story to explain a concept to the reader. A precise-sounding number, date, or claim you are not sure of; say less instead of guessing more. A quiz disguised as dialogue, where one character asks only so another can answer. A moral or 'lesson' paragraph at the end. Textbook diction (delve, understand that, it is important to know). If it reads like a worksheet with a plot bolted on, it has failed.",
},
```

Changes from the shipped version, and why: added the certainty instruction to
`voice` (this is the single biggest gap in the current module — it says
nothing about what to do when the model is unsure of a fact, and the base
layer's specificity push will fill that silence with confident invention).
Added "break a large idea into two or three moments" to `pacing` as the
concrete incluing instruction, replacing an implicit assumption with a
stated technique. Tightened `whatToAvoid`'s first item from "explains a
concept directly" to "stops the story to explain," which is more falsifiable
for a model to check against its own output. Everything else is close to the
shipped text because the shipped text already earns its place.

## 6. Decisions

Flat statements for a product owner to approve or reject.

1. **`educational` should be re-architected as a mode (combinable with any
   primary genre) rather than a standalone genre, but this is not urgent
   enough to block anything else.** Approve the direction now; schedule the
   `types.ts` / `audience_mode`-adjacent migration separately.

2. **Approve: grounding should run unconditionally for `educational`
   generations whenever the idea or character sheets name a real entity,**
   using the existing classifier and cards with no genre-specific exception.
   This costs nothing new to build.

3. **Reject the assumption that grounding "covers" educational truth.** It
   covers named real entities only. General factual and scientific claims
   (the actual majority of likely educational content) have zero
   verification today. State this limitation to users, do not silently ship
   past it.

4. **Do not ship `educational` stories that make science, math, or
   mechanism-level factual claims without a closing fact/fiction disclosure
   note, separate from the story's prose, in the pattern the Magic School
   Bus books use.** This is the single highest-leverage recommendation in
   this document. It is a schema and product change (a new field, rendered
   outside the reading experience), not a prompt change, and it is
   recommended specifically because prompt-level craft cannot fully close
   this gap on its own.

5. **Recommend `educational` NOT expand into open-ended factual domains
   (general science, history, "how things work") for unauthenticated or
   low-trust flows until decision 4 ships.** Until there is a visible seam
   between story and fact, a confidently wrong `educational` story is a
   product liability in a way a bad romance never is, and the failure is
   worse specifically because the story is well written, per the
   transportation-effect research in section 1. It is safe to ship
   `educational` scoped to entities that pass through the existing grounding
   pipeline (real historical/living figures, places, events) sooner, because
   that subset already has a verification path.

6. **Approve the distinction between `educational` (verifiable factual or
   procedural claims) and `folktale` (behavioral or moral teaching with no
   external fact to check).** They should stay separate modules. Do not
   merge them or let `educational` absorb moral-teaching stories; the truth
   obligation in this document applies to one and not the other, and
   collapsing them would either over-apply the truth machinery to fables
   that don't need it or under-apply it to facts that do.

### Genuinely unsure

- Whether the "certainty" instruction in the proposed voice module (section
  5) is something a language model can reliably self-police, versus an
  instruction that sounds satisfiable in a prompt and fails silently at
  generation time. Craft language can shift the model's average behavior; it
  cannot guarantee it, and this document has no way to test that gap without
  running actual generations against a held-out set of checkable claims.
- Where the line sits between "a mechanism a character can plausibly say out
  loud" and exposition wearing dialogue's clothes. The collision section
  resolves this in principle (a stated reason to say it right now); in
  practice this is a craft judgment call that will vary story to story and
  is hard to make into a checkable rule the way the banned-word list is.
