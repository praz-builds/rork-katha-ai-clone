# Writing a Katha Originals brief

Katha is a mobile story app for adults 20-40 (plus a kids mode). Katha Originals
are the house library: the first stories a real reader sees. Every brief here is
sent UNCHANGED to the production story pipeline (`generate-story`), which writes
the prose. The brief is the whole creative input, so it decides whether the story
is gripping or generic.

## Format
Write a JSON file `{"stories": [ ... ]}`. Copy the shape of any entry in
`backend/originals/briefs.json` exactly (read three of them first). Each entry:
- `slug` kebab-case, unique. `title` realistic, the way a bookshop spine or a
  Kindle bestseller reads. No colons-with-subtitles, no "The X of Y" more than once
  per batch, no titles that already exist as famous books.
- `logline` one sentence, a hook a reader would tap on.
- `themes` 3-4 abstract nouns/phrases (they set cover mood).
- `request` fields, all required unless noted:
  `primary_genre`, `genres` (primary first, max 3), `audience_mode`,
  `spice_level` ("sweet" always), `identity_lenses` ([] or ["queer"] where the
  story genuinely centres a queer relationship - include a few across the slate),
  `language` "English", `story_mode` ("standalone" if 1 chapter else "series"),
  `planned_chapter_count`, `chapter_length`, `image_style`, `topic` (the premise,
  60-300 chars), `where_and_when` (<=300), `characters` (2-3), `moments`
  (3-5 concrete scenes, in order), `story_values` (1-2), `avoid` (<=300),
  `writing_style` (<=300, a real voice direction).
- Every text field <= 300 characters. `topic` >= 40.

## Your slots are fixed
Take genre, audience_mode, planned_chapter_count, chapter_length, image_style and
setting_region from your slots in `backend/originals/slots.json` (your agent
letter). Do not change them. Use `setting_region` as the story's world unless the
genre makes that impossible; then pick a region the slate is thin on.

## What makes it engaging (this is the job)
- A premise with a specific, strange, emotionally loaded hook in the first line of
  `topic`: a concrete situation plus what is at stake plus a clock or a pressure.
  "A widow inherits a bakery" is not a premise. "A widow inherits her rival's
  bakery on the condition she enters his sourdough in the county fair he never won"
  is.
- Scale the premise to the length. 1 chapter = one evening, one turn. 3 chapters =
  a clean three-act arc. 8-15 chapters = a real plot with reversals: the moments
  must be spaced across the whole run, and the premise must have enough engine
  (a mystery with layers, a journey with stages, a relationship with real obstacles).
- Kids stories (audience_mode "kids"): ages 6-10, warm, funny, brave, never
  frightening; educational ones teach something TRUE and specific (say what) through
  what the characters do; chapter_length "short".
- Avoid the generic: no chosen ones, no prophecies, no amnesia, no "a mysterious
  stranger", no corporate dystopia, no billionaire romance, no small-town-baker
  cliché, no cosy-witch-cafe. Give each story one detail only it could have.
- Fanfiction slots: the pipeline refuses copyrighted characters and renames them.
  Write an ORIGINAL cast playing the dynamic of a PUBLIC-DOMAIN classic (Austen,
  Dickens, Conan Doyle, the Brontes, Verne, Wilde, Grimm, Arabian Nights, Wodehouse
  pre-1929...). Name the source in the logline ("Pride and Prejudice, but...").

## Characters (be thorough; this is where slates usually fail)
- 2-3 per story; exactly one `"isHero": true`.
- Every name unique across the WHOLE slate - first and last names both. Run the
  checker (below); it fails on any reuse, including names in other agents' files.
- Names must fit the setting precisely (region, era, class, generation) and must
  not be AI-default names (Elara, Kael, Lyra, Aria, Luna, Nova, Seraphina, Thorne,
  Rowan, Zephyr, Elowen, Isolde, Caelum, Evren, Silas, Jasper, Orion, Kai, Maya,
  Zara, Leo, Ethan, Sarah Chen, Marcus). Use real naming conventions.
- Vary them across your batch: ages from children to eighties, genders, bodies,
  professions, class, disability where natural. Not everyone is beautiful and 28.
- `background` (<=300): age, job, what they want, what they hide, one specific
  habit or contradiction.
- `appearance` (<=300): what a painter needs - build, skin, hair, face detail,
  specific clothes, one prop. This drives the cover and portraits, so make it
  visual and distinctive, and dress people in everyday clothes for their setting.
- Supporting characters must matter to the plot (a rival, an ally with a secret,
  an antagonist with reasons), not be decoration.

## Prompt discipline
- No real living people, no real brands, no copyrighted characters.
- Historical figures may appear only in the background, never as the lead.
- sweet spice only; romance runs on tension and tenderness, not explicitness.
- `avoid` lists what this story must not do (gore, cruelty to animals, etc.).

## Check your work
From the repo root `/Users/mac16/Katha-AI-wt-onboarding` run:
    deno run --allow-read --allow-write --allow-env backend/originals/build-cover-prompts.ts --check
It validates every brief through the pipeline's own request validator and fails
on any shared or banned name across all brief files. Fix every problem and rerun
until it passes. Do not edit any file other than your own briefs file.
