# Folktale: craft research

Research pass for the folktale voice module in the modular story generation
system (`backend/supabase/functions/_shared/story-prompts.ts`, `GENRE_VOICES`).
A `folktale` entry already exists in that file (it replaced `poetry` as a
primary genre; see `GENRE_MIGRATION_MAP` and `source-of-truth/STORY_PROMPT_SYSTEM.md`).
This document evaluates that entry against actual folklore scholarship, flags
where the product's global craft rules fight the genre, and proposes a
revised module. No backend files were touched to produce this.

## 1. Findings

### 1.1 Folktales run on a small, ordered inventory of structural moves, not psychology

Vladimir Propp's *Morphology of the Folktale* (1928) analyzed one hundred
Russian wonder tales and found that despite wildly different casts and
settings, the tales share a common sequence of 31 narrative "functions"
(villainy, lack, departure, testing, acquisition of a magical agent,
struggle, victory, return, recognition, and so on). Not every tale uses
every function, but the ones present always appear in the same relative
order, and the functions attach to narrative roles, not to specific
characters or their inner lives. A function can be performed by the hero,
a helper, or the villain depending on the tale, because the plot is built
from actions-in-sequence, not from anyone's psychology.
(https://web.mit.edu/allanmc/www/propp.pdf,
https://www.researchgate.net/publication/319293980_The_Thirty-One_Functions_in_Vladimir_Propp's_Morphology_of_the_Folktale)

The Aarne-Thompson-Uther (ATU) index, the standard cross-cultural
classification system for folk narrative (Aarne 1910, revised by Thompson
1928 and by Uther in 2004), groups tens of thousands of recorded tales from
around the world into repeating tale-types by plot shape rather than by
culture of origin. Uther's 2004 revision specifically corrected the earlier
indices' overweighting of European material and added tale types from
Eastern and Southern Europe and smaller narrative forms; the whole point of
the index is that the same plot skeleton (the youngest of three siblings
succeeding where the elder two failed, an animal helper repaying a debt of
kindness, a riddle that must be answered correctly to survive) recurs
across unrelated oral cultures. This is direct evidence that folktale craft
is combinatorial and skeletal by design, not a failure to individuate.
(https://guides.library.harvard.edu/folk_and_myth/indices,
https://handwiki.org/wiki/Social:Aarne%E2%80%93Thompson_classification_systems)

### 1.2 Flatness is a named, deliberate style, not an absence of skill

Max Lüthi's *The European Folktale: Form and Nature* names five defining
traits of the form: one-dimensionality (the hero moves between the
ordinary and the magical without registering any wonder or category
distinction), depthlessness (people, objects, and relationships are
described without interior or physical depth), abstraction (a "lack of
realism," described in terms of a flat, plain surface rather than shaded,
dimensional description), isolation, and sublimation. Lüthi's own phrase
for folktale figures is that they are "the original flat characters" who
"experience no development." This is a scholarly, load-bearing term of art
in the field, not a synonym for lazy writing.
(https://en.wikipedia.org/wiki/Max_L%C3%BCthi,
https://www.coursehero.com/file/37452759/4-Luthi-TheAbstract-Stylepptx/)

### 1.3 Repetition is a transmission mechanism, not filler

Propp identified three variants of what folklorists call "trebling" or the
rule of three: uniform repetition (three brothers each attempt the same
task), accumulation (each of three attempts is harder or more consequential
than the last), and the negative-negative-positive pattern (two failures,
then a success on the third try, which is by far the most common shape).
Multiple sources note this is very likely an artifact of oral
transmission: a story told and retold from memory, with no fixed written
text to check against, is far easier to hold and reproduce correctly when
its middle section is a known, patterned scaffold rather than a unique
sequence of unrepeated events. The pattern is a mnemonic for the teller as
much as a rhythm for the listener.
(https://thewritepractice.com/the-rule-of-three/,
https://tvtropes.org/pmwiki/pmwiki.php/Main/RuleOfThree)

This connects to Milman Parry and Albert Lord's oral-formulaic theory,
developed first from Homer and then confirmed by fieldwork recording living
oral epic performance in the Balkans. Parry's core finding was that oral
poets do not memorize a fixed text; they compose in performance from a
stock of ready-made formulas and patterns sized to fit the metrical or
narrative slot they need, which is what makes it possible to perform
narratives of enormous length fluently and consistently. The folktale's
repeated phrases and formulaic openings and closings are the prose
equivalent of this: pre-built units that let a teller reproduce a tale
reliably across many performances and many tellers, not evidence of
insufficient invention.
(https://publish.iupress.indiana.edu/projects/the-theory-of-oral-composition,
https://en.wikipedia.org/wiki/Oral-formulaic_composition)

### 1.4 The narrator is a performer addressing a present listener, and this varies by tradition in specific, citable ways

Folktale scholarship treats opening and closing formulas as functional
markers that bracket the tale as a performance event, not as throwaway
decoration. This is documented cross-culturally with real textual
variation:

- Tswana folktales open and close with fixed structural formulas whose
  function has been studied directly as a "structural and functional"
  device bracketing the performance
  (https://www.researchgate.net/publication/270030012_Opening_and_closing_formulae_in_Tswana_folktales_A_structural_and_functional_analysis).
- Tamil bedtime tales conventionally open with "In that only place..." and
  Telugu narrators with a phrase that translates roughly to "Having been
  said and said and said..." — a formula that itself names the tale's
  transmission history inside its own opening line
  (https://theinnisherald.com/the-other-once-upon-a-times-a-history-of-beginnings).
- In parts of the Caribbean the story does not start until the teller and
  audience perform a call-and-response ("Krik?" / "Krak!") that consents to
  the telling — the listener is not a passive recipient, they license the
  story to begin.
  (https://theinnisherald.com/the-other-once-upon-a-times-a-history-of-beginnings)
- West African griot performance is built on call-and-response throughout,
  not just at the edges: the griot leads a line, the audience answers it,
  and the audience's live reaction visibly steers what the griot does next.
  The audience is a co-author of the specific performance, not a silent
  reader.
  (https://fiveable.me/myth-and-literature/unit-8/african-griots-storytelling/study-guide/04DAkqIwo6UvMu16,
  https://www.connollycove.com/storytelling-tradition-of-west-africa-griots/)

The product generates a written, silent-reading artifact, so literal
call-and-response cannot be implemented. But the underlying craft fact
these sources establish, that the narrator is a felt, present "someone
telling this to you right now" rather than an invisible camera, is portable
to prose and is precisely what "oral and cadenced" in the existing module
is reaching for.

### 1.5 Morality lives in consequence, and the fable/folktale line is exactly about whether it gets said out loud

There is a real, citable distinction between fable and folktale on this
point. A fable (Aesop, and in the South Asian tradition the Panchatantra's
individual tales, which are themselves fables strung on a frame story) is
built to end in an explicitly stated moral. Folktales more broadly are
usually not built that way: the consequence the tale delivers (the greedy
sister punished by the same magic that rewarded the kind one, the boastful
suitor humiliated by the exact trick he tried to play) carries the lesson
without a narrator stepping outside the story to name it.
(https://pediaa.com/difference-between-folktale-and-fable/,
https://tagvault.org/blog/fables-vs-folktales-explained/)

This distinction is not universal, though, which matters for a product
claiming a global register. Jataka tales (the Buddhist birth-story
tradition, hundreds of tales, each recounting one of the Buddha's past
lives) use a frame in which the present-life Buddha tells the past-life
story and then explicitly identifies which character in it he was and
what the moral import is. The moral-naming is baked into the form itself
in that specific tradition, unlike the Grimm-style European wonder tale.
So "morality is embedded, never stated" is true of the ATU wonder-tale
tradition the existing module is implicitly modeled on, but it is not a
universal law of "folktale" as a global category. The product's decision
to ban stated morals is a defensible choice for the register it wants, but
it should be understood as picking one tradition's convention, not
describing an inviolable property of oral narrative everywhere.
(https://www.exoticindiaart.com/blog/panchatantra-jataka-and-hitopadesha/,
https://grokipedia.com/page/Jataka_tales)

### 1.6 Three regional traditions, concretely

- **South Asia (Panchatantra, c. 3rd century BCE, and the Jataka tales).**
  The Panchatantra is a frame narrative: animal fables nested inside a
  larger frame story (a tutor teaching princes statecraft), with tales
  sometimes nested inside tales told by characters inside other tales. It
  originated in oral tradition, was fixed in Sanskrit, and from there
  traveled into Persian, Arabic, and eventually European tradition (a
  documented case of oral/literary tale migration across cultures, which is
  exactly what the ATU index is built to track). Jataka tales, by contrast,
  use a simpler two-part shape: a frame from the Buddha's present life,
  then the past-birth story, then explicit moral identification. Both
  traditions use animals as stand-ins for human social types, which is a
  different device from the wonder tale's use of youngest sons and
  stepdaughters, but does the same archetype work.
  (https://www.eduzonejournal.com/index.php/eiprmj/article/download/537/472,
  https://grokipedia.com/page/Jataka_tales)
- **West Africa and its diaspora (Anansi tales).** Originating with the
  Akan/Ashanti people of what is now Ghana and spreading through West
  Africa and, via the transatlantic slave trade, into Caribbean and
  African-American oral tradition, Anansi stories are trickster tales: a
  physically small, weak spider defeats larger, stronger, prouder animals
  through cleverness, not force, and his own greed periodically causes his
  schemes to backfire on him. The tales are frequently etiological (they
  double as explanations for some feature of the natural world) and were
  historically read, especially in their enslaved-diaspora retellings, as
  narratives of resistance: the small, powerless figure who outwits the
  powerful one carried an obvious charge for an enslaved audience.
  (https://oriire.com/article/the-trickster-across-africa,
  https://cjids.in/anansi-myth-and-resistance-exploring-anansi-folklore-as-trangressive-culture-during-slavery/)
- **Latin America (cuentos populares).** The region's folk tradition is
  explicitly a braid of pre-Columbian indigenous narrative, Spanish
  colonial (and through Spain, Near Eastern and medieval European)
  material, and African heritage carried by the enslaved and their
  descendants; a single collection can contain a tale that predates
  European contact sitting next to one shaped by the colonial encounter.
  Figures like La Llorona, El Cucuy, and Juan Bobo are the closest
  equivalent to the wonder tale's stock cast, and one documented
  performance context is the velorio (wake), where storytelling was one of
  the customary activities of a night spent with the dead. This is a
  useful corrective on its own: it is a tradition defined by hybridity, not
  a single lineage, so "the Latin American folktale" is already several
  traditions overlapping.
  (https://www.penguinrandomhouse.com/books/13445/,
  https://guides.loc.gov/folktales-oral-storytelling/Latinx-storytelling-US)

## 2. The collision

This is the part that matters most. Below is every place I found the
product's existing global craft rules (the base layer in
`story-prompts.ts`, applied to every genre) actively fighting what the
research above says good folktale craft is, with a call on which one
should win.

1. **Flat archetypes vs. "Show, Don't Tell" interiority.**
   The base rules require: "NEVER name an emotion and then describe it,"
   and demand the model "find the specific physical detail unique to this
   character and moment." Lüthi's depthlessness and one-dimensionality say
   the opposite: folktale figures are supposed to be without psychological
   or physical depth, defined by role and action, not by an interior life
   the prose excavates. A youngest son who gets a paragraph of interiority
   about why he feels overlooked by his father stops being a folktale
   archetype and starts being a short-story protagonist.
   **Folktale should win.** Interiority should be replaced by demonstrated
   trait: what the character does, once, distinctively, when the tale gives
   them their moment (the fool takes the literal meaning of an instruction
   and it works; the youngest child shares their bread with the beggar the
   older two ignored). That is showing, not telling, but it is showing a
   type's defining choice, not a psychology.

2. **Structural repetition vs. sentence-rhythm variation.**
   The base rules say: "Never let three consecutive sentences have similar
   length or structure," and treat repeated phrasing as an anti-slop
   failure elsewhere in the same layer. Trebling and oral-formulaic
   composition require exactly the opposite in the tale's patterned
   moments: the same sentence, or a sentence with one deliberately changed
   word, returning three times is the mechanism, not an accident.
   **Folktale should win, explicitly and by name.** The module needs to say
   outright that the sentence-rhythm rule is suspended inside a formula or
   a rule-of-three sequence, because a model instructed elsewhere in the
   same prompt to vary sentence structure will "fix" a deliberate refrain
   if it isn't told not to.

3. **Formulaic open/close vs. the general anti-cliché instinct.**
   Nothing on the literal banned-phrase list touches "once upon a time" or
   "and so it was ever after." But the surrounding anti-slop framing
   ("Anti-Slop Rules (CRITICAL)... AI-generated fiction has recognizable
   tells") trains the model to treat any stock opening as a tell to avoid,
   and a model that has just been told to open contemporary or thriller
   stories with a specific, ungeneric first line may generalize that
   instinct into folktale and open with invented, "fresh" cold-open prose
   instead of the formula.
   **Folktale should win, and needs an explicit carve-out.** The formulaic
   opening and closing are the genre promise here, the same way "the
   magic and the love story should be entangled" is romantasy's promise.
   The module should say plainly that a stock opening formula is not a
   cliché in this genre, it is the doorway.

4. **Clean, closed endings vs. "don't resolve tension too neatly."**
   The base pacing rules say: "Don't resolve tension too neatly. Real
   stories have loose threads," and warn against the "standalone vignette"
   feel, wanting every story to read as "a slice of something larger."
   Folktale endings are the opposite on purpose: they close hard, often on
   a formula, and Lüthi's isolation/all-inclusiveness traits describe the
   tale as a complete, self-sufficient world that does not gesture at a
   larger continuous reality the way a slice-of-life or literary story
   does.
   **Folktale should win.** A folktale that ends on an unresolved thread
   reads as an unfinished draft, not as literary restraint.

5. **Type-consistent dialogue vs. per-character voice individuation.**
   The base dialogue rules demand real differentiation: "A teenager
   doesn't use the same vocabulary as a professor... Each character must
   speak differently." Folktale dialogue is typically role-consistent
   rather than individually realistic: the trickster always boasts in the
   same register every time he appears across tales, the fool always
   answers literally, characters often speak in the same elevated
   storytelling register as the narrator rather than in distinct realistic
   idiolects.
   **Partial win for the base rule, softened.** Full novelistic voice
   differentiation would fight the archetype, but characters should still
   sound distinguishable by role (the wicked stepmother's flattery reads
   differently from the youngest child's plainness) rather than
   interchangeable. This is the one collision I'd resolve as a blend
   rather than a clean override; see Decisions.

6. **Minimal, abstract setting vs. mandatory dual-sense grounding.**
   The base rules require "at least 2 senses beyond sight" per scene with
   specific, non-generic sensory detail. Lüthi's abstract style
   deliberately keeps the world undescribed (a "certain kingdom," a forest
   with no particular texture) so the tale reads as pattern rather than as
   a specific, inhabited place. A folktale rewritten with the sensory
   density this product demands elsewhere risks turning into a
   contemporary-style scene with folktale furniture.
   **Genuine tension, no clean winner. I am flagging this rather than
   deciding it** (see Decisions item 6). My inclination is a light-touch
   compromise: allow the setting itself to stay spare and archetypal (no
   demand for a fully realized, particularized world) while still asking
   for one or two vivid, concrete sensory anchors at the tale's key
   dramatic beats, since prose written for silent modern reading benefits
   from some grounding that a live oral performance gets for free from the
   teller's voice and the room.

7. **Symmetrical, sometimes harsh consequence vs. the sweet-only spice
   floor.** `GENRE_ALLOWED_SPICE` restricts folktale to `sweet`, which
   governs romantic/sexual heat, not violence. This is not actually a
   collision, but it is worth naming because a naive reading of "keep it
   family-friendly" could flatten the genre's real edge: folk justice is
   often sharp (the wicked are not gently redirected, they are undone by
   the exact mechanism of their own greed or cruelty, sometimes
   graphically in source material). The existing module's whatWorks line
   about "consequences that fit the crime with folkloric symmetry" is
   already the right instinct.
   **No rule change needed, but worth confirming explicitly**: "sweet"
   should be read as no romantic/sexual heat, not as no teeth in the
   ending.

## 3. Proposed voice module

For `GENRE_VOICES.folktale` in `backend/supabase/functions/_shared/story-prompts.ts`.
This revises the module already in the file to make the collisions above
explicit rather than implied, and adds the listener-facing narrator and the
formula carve-outs that the current version doesn't state.

```
voice:
  "Oral, cadenced, and told by someone in the room with the listener, not
  read off a page. Address the listener directly at least once (a 'you
  know how this goes' or 'and if you had been there' aside is welcome).
  Characters are archetypes on purpose: the youngest child, the clever
  fool, the trickster animal, the proud king. Do not give them
  interiority or a psychology to explore. Give each one exactly one
  distinctive trait or habit and let it play out through what they do at
  the moment the tale turns on them. Depth is not the goal here; a clean,
  memorable shape is.",

pacing:
  "Move in patterned units: three brothers, three trials, three attempts
  at the riddle. Repeat the phrasing across the pattern on purpose, not
  as an editing miss, changing exactly one detail each time so the third
  instance lands differently from the first two. The usual instruction
  to vary sentence rhythm and avoid repeating structure does not apply
  inside one of these patterns; a refrain that returns nearly word for
  word is the tale doing its job. Keep exposition minimal and the world
  sparsely furnished. Trust the listener to infer the setting from what
  characters do in it rather than describing it.",

whatWorks:
  "A stock opening and closing formula used straight, without irony
  ('once there was,' 'and that is how it has been told ever since'). A
  concrete task, riddle, or bargain with a fair rule the listener could
  in principle solve alongside the hero. A small, overlooked figure
  outwitting a larger or prouder one through wit rather than force. An
  ending that closes hard, on a single clean image or turn of phrase,
  with nothing left dangling: this genre does not owe the reader loose
  threads or an implied larger world. Consequence that mirrors the
  offense (the greedy sibling undone by the same magic that rewarded the
  kind one).",

whatToAvoid:
  "Interiority. A character who reflects on their own feelings or
  motives stops being an archetype and starts being a short story
  protagonist in the wrong genre. Narrating the moral outright ('and so
  we learn that'), the consequence has to demonstrate the lesson or the
  tale becomes a fable with the teeth pulled. Treating the formulaic
  opening or a repeated refrain as a cliche to be freshened up; it is
  the frame the genre is built on, not a lapse. Modern slang, brand
  names, or technology breaking the timeless setting. A trickster who
  wins by force instead of by wit. An ending that trails off or leaves a
  question open."
```

## 4. Decisions

Flat statements for a product owner to approve or reject one at a time.

1. **Approve or reject:** For the folktale genre, suspend the global
   "vary sentence length / never let three consecutive sentences share a
   structure" rule inside a deliberate rule-of-three or refrain, and say
   so explicitly in the module rather than relying on the model to infer
   an exception.
2. **Approve or reject:** For the folktale genre, suspend the global
   "show don't tell" instruction to the extent that it demands character
   interiority. Keep "show, don't tell" for consequence and action; drop
   it for feeling.
3. **Approve or reject:** For the folktale genre, explicitly permit and
   encourage a stock opening formula and a stock closing formula, framed
   as the genre's structural signature rather than as something the
   general anti-cliche instinct should suppress.
4. **Approve or reject:** For the folktale genre, suspend the global
   "don't resolve too neatly / avoid the standalone vignette feel"
   pacing rule. Folktales should close hard and stand alone; that is not
   a craft failure in this genre.
5. **Approve or reject:** For the folktale genre, soften (not remove)
   the global per-character voice-individuation rule to role-consistency
   rather than novelistic idiolect: characters should be distinguishable
   by type and function, not necessarily by realistic personal speech
   patterns.
6. **Needs a decision, not just an approval:** how much sensory grounding
   to require. Options are (a) keep the global 2-senses-per-scene rule
   as is, accepting that it pushes folktale prose toward more physical
   density than the abstract style calls for, (b) drop the requirement
   for folktale entirely and let the setting stay spare, or (c) my
   proposed middle path: no per-scene sensory quota, but ask for one or
   two vivid concrete sensory anchors at the tale's key beats. I have a
   mild preference for (c) but flagged it above as genuinely contestable
   rather than deciding it myself.
7. **Approve or reject:** Treat the existing "sweet" spice ceiling for
   folktale as governing romantic/sexual content only, not violence or
   harshness of consequence, and confirm the module's language ("folk
   justice" hitting hard) is not blocked by that ceiling. This appears
   to already be the intent; this decision just makes it explicit so a
   future editor doesn't soften folktale endings by mistake.
8. **Approve or reject:** Adopt the "narrator addresses the listener
   directly at least once" line in the voice field. This is new relative
   to the current module and is the single most direct way to carry the
   present-teller quality that the oral-formulaic and griot research
   describes, without requiring the actual call-and-response mechanics
   (which a silent-reading product cannot implement).
9. **Approve or reject:** Do not attempt to encode region-specific
   opening formulas (Tamil, Telugu, Tswana, Caribbean krik-krak, and so
   on) into the module itself. The existing global "Cultural Context"
   rule (infer culture from character names and setting) should be left
   to do that work implicitly per story, since hard-coding one region's
   formula into the genre module would bias every folktale toward that
   region's specific convention.

## What I'm genuinely unsure about

- Item 6 above (sensory grounding density) is a real craft tension I
  could not resolve cleanly from the research; it depends on how literary
  vs. how performative the product wants its written folktales to feel,
  which is a product taste call, not a scholarship question.
- Item 5 (dialogue individuation) is a blend rather than a clean win for
  either side, and reasonable people could push further toward flat,
  uniform, narrator-mediated speech than I proposed. I erred toward
  keeping a small amount of differentiation because the product's stories
  are read silently by a modern adult audience, not performed aloud, and
  a small amount of dialogue individuation may matter more for felt
  quality on the page than it did in a live oral performance.
- I was not able to verify the exact original scholarly source of the
  Tamil "In that only place" and Telugu formula (I found it through a
  secondary blog piece, https://theinnisherald.com/the-other-once-upon-a-times-a-history-of-beginnings,
  not a primary folklore-studies citation). It is directionally reliable
  and consistent with how ATU-style scholarship talks about
  culture-specific opening formulas, but I would not treat that specific
  wording as gospel if it ever needs to appear verbatim in a story.
- I deliberately did not propose adding an explicit Jataka-style
  "explicit moral" option to the module, since the product's own
  cross-genre convention (state consequence, never state the lesson) is
  a defensible, consistent house style choice, but Decision 8's framing
  should make clear to a future editor that this is a choice about house
  register, not a universal truth about what "folktale" always means.
