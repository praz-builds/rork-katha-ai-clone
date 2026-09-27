# Phone screenshots — capture plan

<!-- markdownlint-disable MD013 -->

Eight screenshots, in listing order. Capture them **after** the final UI feedback round and after the P0 "Kids mode wording" row lands, so no frame shows a "For kids" label. The first three carry the listing: most people never swipe past them.

## Format Play accepts

- **1080 × 1920 PNG or JPEG, portrait, no alpha.** Play allows 320–3840 px per side with an aspect ratio no longer than **2:1**; at least four at ≥1080 px make the app eligible for promotion.
- A modern phone's full screen (1080 × 2400, 20:9) is **too tall** — crop to 1080 × 1920 from the top of the content, or frame it (below).
- **Where to capture:** a real Android device running the closed-test build. Play requires screenshots to show the actual app experience, and the Expo web preview is a different renderer (different fonts, no native pickers, no narration), so it is **not** used for listing screenshots.
- **Captions** go in a band above the phone frame, set in Bricolage Grotesque 800 on the app ground `#F3F2EF`, with the key word in `#FF6B1A` — the same system as `graphics/feature-graphic.html`. A frame template can be added to `graphics/` the same way when the captures exist; until then the raw captures are acceptable on their own.

## Rules for what is on screen

- Only **Katha Originals** or stories written on a house account. No real user's name, handle, avatar, comment or story. No reviewer email.
- **No romance or horror frame that could read as sexual or gory.** Store assets are shown to everyone, whatever the app's rating. Use the lamplighter, the Lisbon café and the hardware-shop covers already in the feature graphic, or similar.
- **No prices.** They vary by country and come from Google Play; a USD figure in a screenshot is wrong in every other market. Hide or crop the paywall price if a credits frame is used.
- Status bar: full battery, a clean time (9:41 is the convention), no notifications.
- Light theme only (dark mode is a P1 row).

## The eight

| # | Screen and state | Caption EN | Caption PT-BR | Caption ES |
|---|---|---|---|---|
| 1 | **Home.** Signed in, a "Your stories" row with two finished stories with covers, then **Katha Originals** below it. Top bar showing the streak and credits pill. | Your next favourite story starts here | Sua próxima história favorita começa aqui | Tu próxima historia favorita empieza aquí |
| 2 | **Create brief.** Genre chosen (Folktale or Mystery), a one-line idea typed in the idea field, a saved character cast as the hero, "Make it public" off. Keyboard dismissed. | Start with one idea | Comece com uma ideia | Empieza con una idea |
| 3 | **Live reader during generation.** The first page of chapter 1 arriving, title and cover in place, a few paragraphs visible. Capture mid-stream so it is clearly being written. | Watch your story being written | Veja sua história sendo escrita | Mira cómo se escribe tu historia |
| 4 | **Craft character.** A finished portrait, name, a short look and history filled in. Use a character made **without** a reference photo, so no real person's photo is in frame. | Cast characters with their own portraits | Crie personagens com retratos próprios | Crea personajes con su propio retrato |
| 5 | **End of a chapter.** The direction chips ("where next") showing under the last paragraph of a chapter. | Choose where the story goes next | Escolha para onde a história vai | Elige hacia dónde va la historia |
| 6 | **Narration playing.** Reader or story page with the listen controls open and playing, progress partway through. | Hear every chapter narrated | Ouça cada capítulo narrado | Escucha cada capítulo narrado |
| 7 | **Story page of a published Original.** Cover, title, author card, like and star counts, two or three comments from **house accounts**. | Publish when you're ready. Readers can reply. | Publique quando quiser. Os leitores respondem. | Publica cuando quieras. Los lectores responden. |
| 8 | **Explore.** Trending tab with a grid of covers across genres. | Read free, as much as you like | Leia de graça, quanto quiser | Lee gratis, todo lo que quieras |

If only six are made, drop 5 and 8. Keep 1–3 in this order.

## Fixture state (2026-09-27)

What production can and cannot produce for these frames, measured rather than
assumed. Captures happen on a real device from the closed-test build, so the
data had to be seeded ahead of the session, not during it.

**Seeded, reversible** — `backend/scripts/seed-screenshot-fixtures.ts`, which is
idempotent and has a `--teardown` that removes exactly what it created:

- Two house reader accounts, `ana_reads` and `tomas_ferreira` (emails at
  `@example.com`, which RFC 2606 reserves, so neither can collide with or
  deliver to a real address), and one comment each on the Original **A Bridge by
  Cockcrow** (`0da6a6bb-8b84-458a-8e89-3da7a8046e0d`). The `comments` table was
  **empty across the whole project**, so frame 7 was not capturable at all. A
  folktale was chosen so the frame carries no romance or horror imagery.
- `stories.comment_count` set to 2 to match. Nothing maintains that counter --
  there is no trigger on it -- so it would otherwise have disagreed with the
  comment list on the same screen.
- A 3-day `streaks` row for the house account, for the streak pill in frame 1.
  It had no streak row at all.

**Already there, nothing to do:** 80 published Katha Originals, all with covers
(frames 1 and 8), and 6 `chapter_audio` rows in `ready` (frame 6).

**Blocked on the paid generation provider** (Gemini `429`, OpenRouter `402`) --
these two cannot be captured until it is funded, and no fixture substitutes for
them because both frames are of the thing being generated:

- **Frame 3, live reader mid-generation.** Needs a real run to photograph.
- **Frame 4, craft character portrait.** The house account has **0** saved
  characters with a portrait. Thirteen portraits exist in the project but all
  belong to test accounts, so using one would mean attributing another account's
  art to the house account.

**Frame 7 has no house-author reply, and cannot have one yet.** Every comment
renders the handle rather than the name its author chose:
`supabase/functions/comments/index.ts:350` returns
`author_display_name: profile?.username ?? null`, so a comment shows
`profiles.username` while a profile shows `display_name` everywhere else. That is
a bug for every author, not just this account -- a reader whose name is "Ana" is
credited as their handle the moment they comment. Here it means the house account
would appear as `vivid_lantern_51`, and renaming cannot fix it: `katha`, `kathaai`
and `katha_ai` are all in the `profiles_username_not_reserved` list added by
migration 00060. The two reader comments read correctly as handles, so capture
frame 7 with those two; add the author's reply only after the name/handle decision
is made and shipped.

## Checklist for the capture session

- [ ] Production build (or the final closed-test build) on a real Android phone, light theme, English UI.
- [ ] A house account with two finished, published stories with covers, one saved character with a portrait, a streak of at least three days, and a narrated chapter.
- [ ] Two or three friendly comments on one Original, left from house accounts.
- [ ] Each capture cropped to 1080 × 1920, checked for names, emails and prices.
- [ ] Captions added (or raw captures uploaded as they are).
- [ ] PT-BR and ES listings: the same captures with the translated captions. The app UI stays English in every locale — the listings say so.
