# Google Play store pack

<!-- markdownlint-disable MD013 -->

Everything that gets pasted or uploaded into Play Console for `ai.katha.createstories`, kept in the repo so it changes in the same pull request as the code it describes. Nothing here is submitted automatically.

| What | File | Play Console location |
|---|---|---|
| App name, short and full description, EN / PT-BR / ES | `metadata/<locale>/title.txt`, `short_description.txt`, `full_description.txt` | Grow → Store presence → Main store listing (EN is the default language; add PT-BR and ES-419 as translations) |
| Length check for the above | `check-listing.mjs` — `node store/android/check-listing.mjs` | — |
| App icon 512 × 512, 32-bit PNG | `graphics/icon-512.png` (source `graphics/icon-512.html`, from `expo/assets/icon.png`) | Main store listing → Graphics → App icon |
| Feature graphic 1024 × 500, one per language | `graphics/feature-graphic-{en,pt,es}.png` (source `graphics/feature-graphic.html`) | Main store listing → Graphics → Feature graphic (per translation) |
| Re-render the graphics | `graphics/render.mjs` (instructions at the top of the file) | — |
| Phone screenshots | `screenshot-plan.md` — captured after the final UI round | Main store listing → Phone screenshots |
| Data safety | `data-safety.md` | Policy → App content → Data safety |
| Content rating, target audience, ads, App access | `content-rating.md` | Policy → App content |

The metadata folders follow fastlane's `supply` layout (`metadata/<locale>/…`), so they can be uploaded with `fastlane supply` later without moving anything. Nobody has set that up; paste by hand for now.

## Other listing fields

| Field | Value |
|---|---|
| App category | **Books & Reference** (Entertainment is the alternative; Books & Reference is where reading and writing apps are browsed) |
| Tags (pick up to five that Play offers) | Books, Fiction, Writing, Storytelling, Audiobooks |
| Contact email | `hi@thetractionlabs.com` (the one monitored inbox today — see decision 4 in the PR) |
| Website | `https://katha.thetractionlabs.com/` |
| Privacy policy URL | `https://katha.thetractionlabs.com/privacy/` |
| Phone | Leave empty (optional). |
| External marketing | Leave "advertise my app outside Google Play" at its default. |

### Release notes for the first build ("What's new")

```text
en-US
The first release of Katha. Start a story from one idea, cast your characters, listen to it narrated, and read what others publish. Reading is free.

pt-BR
A primeira versão do Katha. Comece uma história com uma ideia, escale seus personagens, ouça a narração e leia o que outras pessoas publicam. Ler é grátis.

es-419
La primera versión de Katha. Empieza una historia con una idea, elige a tus personajes, escúchala narrada y lee lo que publican otros. Leer es gratis.
```

## Rules this pack follows

- **Accuracy over marketing.** Every feature in the descriptions exists on `main`. No counts of stories or users, no "best", no prices (they vary by country and come from Google Play).
- **No "kids" anywhere.** The target audience is 18+ only; `check-listing.mjs` fails on the word in any language.
- **English app, translated listing.** The app UI and story generation are English-only today (`CreateBriefFlow.tsx`, `LANGUAGE_OPTIONS`; `expo/src/i18n` is not wired to components). The PT-BR and ES descriptions say so in their "good to know" section. Remove that line in the release that ships the translated UI.
- **When a feature changes, change the listing in the same PR**, and re-run `data-safety.md`'s checks when anything that collects or sends data changes.
