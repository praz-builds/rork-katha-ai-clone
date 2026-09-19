# Cover Image System

Canonical reference for cover image generation, focal-point cropping, and display across viewports.

## Architecture

One source image per story, one stored focal point. Three adaptive crops driven by that focal point:

| Placement | Aspect | Crop Rule | Where |
|-----------|--------|-----------|-------|
| **Library card** | 1:1 square | `objectPosition: focalX, focalY - 0.07` | Home feed rail, library grid |
| **Mobile hero** | 3:4 portrait | `objectPosition: 50%, focalY - 0.02` | Reader screen, full-bleed, < 768px |
| **Desktop cover** | 3:4 portrait | `objectPosition: focalX, focalY` | Reader left column, sticky, >= 768px |

## The Focal-Point System

Every cover stores a normalized `{ focalX, focalY }` (0-1) marking the visual anchor. For character covers this is the midpoint between the faces. For scene covers it's the primary subject.

- **Where it lives**: `focalX` / `focalY` on the Story record (floats, default `0.5` / `0.5`).
- **How it's used**: Mapped to CSS `object-position` via the `FocalImage` component. Each placement applies a small Y-offset to optimize the crop for its aspect ratio.
- **Why**: `object-fit: cover` crops toward `object-position`. Anchoring to the faces means faces survive any box ratio.
- **Backfill**: Default `{ 0.5, 0.5 }` (center) for covers without a known focal point.

### Per-Placement Crop Math

```
Library card (square):  y = max(0, focalY - 0.07)   // nudge up so faces sit comfortably in square
Mobile hero (3:4):      y = max(0, focalY - 0.02)   // slight nudge
Desktop cover (3:4):    y = focalY                   // use directly
```

Example for "The Vanilla Problem" (`focalY: 0.22`):
- Library card: `object-position: 50% 15%`
- Mobile hero: `object-position: 50% 20%`
- Desktop cover: `object-position: 50% 22%`

### FocalImage Component

`expo/src/components/KathaPrimitives.tsx` exports `FocalImage`, which renders:
- **Web**: A native `<img>` element with `object-fit: cover` and `object-position` (React Native Web's `Image` component ignores `objectPosition`, so a raw `<img>` is required).
- **Native**: Standard RN `Image` with `resizeMode="cover"` (center crop; focal anchoring is web-only for now).

## Image Generation

### Model & Output

- **Provider**: OpenRouter only — `google/gemini-2.5-flash-image` ("nano banana"), with `google/gemini-3.1-flash-image` behind it. **Higgsfield and any provider not named here remain banned.** See `AGENTS.md` for why the single-provider rule changed on 2026-09-03, and note that providers disagree on output format — content type is sniffed from magic bytes rather than assumed.
- **Model**: `google/gemini-2.5-flash-image`, known as "nano banana". OpenAI `gpt-image-1` was removed on 2026-09-08 when its credential was revoked; see `AGENTS.md`.
- **Output size**: `1024x1536` portrait (2:3 ratio, native book cover format).
- **Quality**: not a parameter. Gemini takes no `size` or `quality` field, so the aspect ratio rides in the prompt text (`ASPECT` in `_shared/image.ts`).
- **Response format**: OpenRouter returns a `data:` URL on `choices[0].message.images[0].image_url.url`. The format of the decoded bytes is sniffed, never assumed — see `AGENTS.md`.

```typescript
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
  },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash-image",
    modalities: ["image", "text"],
    messages: [{ role: "user", content: prompt }],
  }),
});
// Response: { choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,..." } }] } }] }
```

### Prompt Construction

The `buildCoverPrompt()` function in `_shared/cover-prompts.ts` assembles the prompt from four layers:

1. **Genre config** (static per genre, from `GENRE_PROMPTS` dict)
   - `style`: Art direction
   - `palette`: Color guidance
   - `composition`: Layout/framing rules
   - `mood`: Emotional keywords
   - `characterApproach`: `"scene"` | `"silhouette"` | `"portrait"`

2. **Story-specific context** (dynamic)
   - Title referenced for thematic direction
   - Themes (up to 4) woven into scene description

3. **Character integration** (dynamic, when characters provided)
   - `scene`: Lead character placed within the scene, not posed for a portrait
   - `silhouette`: Mid-distance full figure, read by shape, clothing and props (no longer called a silhouette -- see `buildCharacterNote`)
   - `portrait`: Three-quarter or shoulder-up view of protagonist

4. **Invariant suffix** (always appended)
   - No text, titles, words, letters, or watermarks
   - Portrait orientation, centered composition
   - Professional book cover art quality

### Prompt Template

> Superseded in detail by `buildCoverPrompt` in `_shared/cover-prompts.ts`, which is the source of truth. Since 2026-09-18 it also carries a cover safe zone (top 15% clear, face between 20% and 50% of the height), a no-border/no-frame clause, "a"/"an" by genre, a lower-cased leading article on where-and-when, and a picked art style stated first and last. The template below is the original shape, kept for orientation.

```
Book cover illustration for a {genre} story.
Visual style: {genre.style}.
Color palette: {genre.palette}.
Composition: {genre.composition}. Subject centered in frame for multi-crop display.
Mood: {genre.mood}.
Inspired by the story "{title}", with themes of {themes[0..3]}.
{characterNote}.
The image must contain NO text, NO titles, NO words, NO letters, NO watermarks.
Pure illustration only.
Portrait orientation, centered composition, high quality, professional book cover art.
```

### Retry Strategy (Moderation Rejection)

| Attempt | Strategy |
|---------|----------|
| 0 | Full prompt: genre + title + themes + characters |
| 1 | Simplified: genre + title + 2 themes, no characters |
| 2 | Generic: genre + title only |

After 3 failures, returns `null`. Story publishing is never blocked.

## Display Layouts (Strategy 1c)

### Library Card

- Square (1:1) tile, no text overlay on image. Title + meta below.
- `width: 172px`, `borderRadius: 20px`, `box-shadow: 0 10px 26px rgba(80,50,20,0.20)`.
- Title: display font, 16px, `#3f342b`, `margin-top: 12px`.
- Meta: UI font, 13px, `#d9601f`, format: `Genre . Xk reads`.
- Focal-point anchored: `object-position: focalX%, max(0, focalY - 0.07)%`.

### Reader — Mobile (< 768px)

Full-bleed 3:4 hero fading into page background:
- Container: `width: 100%`, `aspectRatio: 3/4`, `overflow: hidden`.
- Fade overlay: `LinearGradient` from transparent to page bg (`colors.sepia`) at bottom.
- Floating back button: white pill, top-left, `rgba(255,255,255,0.92)`, `borderRadius: 999`.
- Below hero (slight negative `marginTop` to overlap fade): genre (centered, uppercase), title (24px, centered), author, controls row (centered).

### Reader — Desktop (>= 768px)

Two-column layout:
- Container: `maxWidth: 700px`, centered.
- Left: cover `200px` wide, `aspectRatio: 3/4`, `borderRadius: 16`, shadow, `position: sticky; top: 20px` (web only).
- Right: genre, title (26px), author, controls (left-aligned), body text (16px, `lineHeight: 26`).

## Genre Prompt Configs (16 Genres)

| Genre | Style | Palette | Composition | Mood | Characters |
|-------|-------|---------|-------------|------|------------|
| romance | warm illustrated, soft painterly, intimate lighting | warm corals, sunset oranges, blush pinks, soft gold | close framing, meaningful object, two figures, bokeh | intimate, tender, yearning | portrait |
| fantasy | epic illustration, rich painterly, ornate elements | deep emerald, royal purple, antique gold, moonlit silver | sweeping landscape, lone figure, magical sky | mystical, grand, wonder | silhouette |
| romantasy | lush fantasy with romantic warmth, jewel-tone | deep amethyst, rose gold, midnight blue, candlelight amber | figure amid magical elements, enchanted setting | enchanted, passionate, mythic | portrait |
| mystery | noir, high contrast, chiaroscuro, cinematic tension | dark slate, deep navy, single red accent, warm lamplight | ominous object, shadowed doorway, deep perspective, fog | tension, intrigue, foreboding | silhouette |
| thriller | stark cinematic, bold angular shadows, photorealistic | pure black, bright crimson, cold steel grey, harsh white | isolated figure/object, diagonal urgency, claustrophobic | danger, adrenaline, high stakes | silhouette |
| horror | dark atmospheric, desaturated, unsettling undertones | near-monochromatic greys, sickly green or blood red | shadows, negative space, partially hidden forms, fog | dread, unease, visceral | silhouette |
| scifi | retro-futuristic, clean geometric, neon glow, metallic | deep space black, electric cyan, neon magenta, chrome | cosmic vista, character against tech backdrop, geometric | wonder, vast, alien | silhouette |
| adventure | bold cinematic, dynamic energy, saturated color | warm amber, sunset orange, ocean teal, jungle green | sweeping landscape, tiny figure against vast environment | excitement, exploration, discovery | silhouette |
| historical | rich period illustration, ornamental, aged paper | warm sepia, aged gold, burgundy wine, ivory, earth tones | layered historical scene, period architecture, ornament within the scene | atmospheric, dignified, evocative | portrait |
| darkAcademia | moody gothic, candlelit interiors, oil painting | deep mahogany, aged ivory, forest green, antique gold | shadowed hallway, candlelit study, leather books, ivy | intellectual, brooding, secretive | silhouette |
| drama | emotional painterly, expressive brushwork, literary | muted earth tones, overcast greys, warm accent | contemplative scene, negative space, meaningful object | reflective, bittersweet, human | scene |
| sliceOfLife | warm cozy, gentle watercolor, soft afternoon light | warm caramel, soft sage, dusty rose, cream, golden hour | intimate everyday scene, kitchen table, warm interior | warm, nostalgic, comforting | scene |
| mythology | mythological, bold ancient art, temple fresco | deep terracotta, burnished bronze, saffron, temple red | deity/creature in powerful pose, celestial, sacred geometry | epic, ancient, sacred | portrait |
| poetry | ethereal abstract, dreamy watercolor, minimalist | soft lavender, misty grey-blue, pale rose, ink black | abstract forms, flowing shapes, generous white space | ethereal, contemplative, luminous | scene |
| comedy | vibrant pop, bold outlines, playful exaggeration | sunshine yellow, electric blue, hot pink, lime green | absurd scene, exaggerated proportions, playful arrangement | joyful, witty, irreverent | scene |
| bedtime | soft dreamy, gentle moonlit glow, soothing shapes | midnight navy, moonlight silver, warm amber, lavender | nightscape, gentle moon, warm lamp, starlit sky | calm, soothing, magical | scene |

## Storage

- **Bucket**: `covers` (Supabase Storage, public read, service role upload)
- **Path**: `covers/{story_id}/cover.png`
- **Format**: PNG (decoded from base64 response)

## Implementation Files

| File | Purpose |
|------|---------|
| `backend/supabase/functions/_shared/image.ts` | OpenAI API call, retry logic, storage upload |
| `backend/supabase/functions/_shared/cover-prompts.ts` | Genre configs, `buildCoverPrompt()` |
| `expo/src/components/KathaPrimitives.tsx` | `FocalImage`, `Cover`, `StoryCard` |
| `expo/src/types/domain.ts` | `focalX`, `focalY` on Story type |

## Checklist for New Genres

1. Add genre voice module to `_shared/story-prompts.ts`
2. Add genre prompt config to `_shared/cover-prompts.ts` (style, palette, composition, mood, characterApproach)
3. Add genre to `expo/src/types/domain.ts` GENRES array
4. Add genre label to `expo/src/theme/theme.ts` genreLabels
5. Add genre gradient to `expo/src/theme/theme.ts` genreGradients
6. Add genre to `expo/src/data/seed.ts` genres array
