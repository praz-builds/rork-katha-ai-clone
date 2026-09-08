#!/usr/bin/env python3
"""
Katha AI app icon generator — the brand "K" mark.

Emits, into expo/assets/:
  icon.png                     1024x1024, opaque, rounded square (r = 22.5%),
                               white K at ~62% of canvas height. Used by
                               `expo.icon` (iOS app icon + Expo fallbacks).
  icon-android-foreground.png  1024x1024, TRANSPARENT, white K at ~48% of
                               canvas height so it survives Android's adaptive
                               icon mask (center 66% safe circle, ~33% crop).
                               The orange lives in app.json's
                               android.adaptiveIcon.backgroundColor.
  icon-notification.png        96x96, TRANSPARENT, SOLID WHITE K at ~70%.
                               Android flattens notification small-icons to a
                               monochrome silhouette, so no colour here.
  favicon.png                  48x48, rounded square, same design as icon.png
                               with the glyph nudged up so the K's counter
                               (the wedge between arm and leg) stays open.

Design is locked: Baloo2-ExtraBold, #FF6B1A ground, #FFFFFF glyph. Everything
is drawn at 4x and downsampled with LANCZOS for clean edges, and the glyph is
centred on its true ink bounds (ImageDraw.textbbox) rather than on the font's
advance/baseline metrics — an optically centred K is the whole job.

Re-run from the expo/ workspace:
    python3 scripts/generate-icons.py

Requires Pillow (`python3 -c "import PIL"`). Overwrites the four files above.
The pre-K book icon is preserved as assets/icon-legacy-book.png.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

EXPO_ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = EXPO_ROOT / "assets" / "fonts" / "Baloo2-ExtraBold.ttf"
ASSETS = EXPO_ROOT / "assets"

BG = (255, 107, 26, 255)      # colors.accent — #FF6B1A
FG = (255, 255, 255, 255)     # #FFFFFF
GLYPH = "K"
SS = 4                        # supersample factor
CORNER_RATIO = 0.225          # rounded-square radius as a fraction of size


def _ink_bbox(font: ImageFont.FreeTypeFont) -> tuple[int, int, int, int]:
    """Ink bounds of GLYPH for `font`, measured on a scratch canvas."""
    probe = Image.new("L", (1, 1))
    return ImageDraw.Draw(probe).textbbox((0, 0), GLYPH, font=font)


def _fit_font(target_ink_height: float) -> tuple[ImageFont.FreeTypeFont, tuple[int, int, int, int]]:
    """Binary-search a font size whose K inks exactly `target_ink_height` px tall."""
    lo, hi = 1, int(target_ink_height * 4) + 8
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        font = ImageFont.truetype(str(FONT_PATH), mid)
        bbox = _ink_bbox(font)
        height = bbox[3] - bbox[1]
        if height <= target_ink_height:
            best = (font, bbox)
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:
        font = ImageFont.truetype(str(FONT_PATH), 1)
        best = (font, _ink_bbox(font))
    return best


def render(
    size: int,
    glyph_ratio: float,
    *,
    rounded_bg: bool,
    optical_y_shift: float = 0.0,
) -> Image.Image:
    """Render the K mark at `size` px.

    glyph_ratio      — ink height of the K as a fraction of the canvas.
    rounded_bg       — True paints the opaque orange rounded square behind it;
                       False leaves the background fully transparent.
    optical_y_shift  — extra vertical nudge as a fraction of the canvas
                       (negative = up), applied after true-ink centring.
    """
    big = size * SS
    font, bbox = _fit_font(big * glyph_ratio)

    # Pass 1: draw the glyph on its own transparent layer, placed by textbbox
    # (subtracting the bbox origin, so the ink — not the advance box or the
    # baseline — is what gets positioned).
    glyph_layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glyph_layer)
    x = (big - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = (big - (bbox[3] - bbox[1])) / 2 - bbox[1] + optical_y_shift * big
    gdraw.text((x, y), GLYPH, font=font, fill=FG)

    # Pass 2: textbbox can include side bearing that the rasteriser does not
    # actually ink, which pushes a K a couple of percent off-centre. Measure
    # the real rendered ink from the alpha channel and correct for it.
    ink = glyph_layer.split()[3].getbbox()
    if ink:
        dx = round((big - (ink[2] - ink[0])) / 2 - ink[0])
        dy = round((big - (ink[3] - ink[1])) / 2 - ink[1] + optical_y_shift * big)
        if dx or dy:
            glyph_layer = ImageChops.offset(glyph_layer, dx, dy)

    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if rounded_bg:
        ImageDraw.Draw(canvas).rounded_rectangle(
            (0, 0, big - 1, big - 1),
            radius=big * CORNER_RATIO,
            fill=BG,
        )
    canvas.alpha_composite(glyph_layer)

    return canvas.resize((size, size), Image.LANCZOS)


def save(image: Image.Image, name: str, *, opaque: bool) -> None:
    path = ASSETS / name
    if opaque:
        flat = Image.new("RGB", image.size, BG[:3])
        flat.paste(image, mask=image.split()[3])
        flat.save(path, "PNG")
    else:
        image.save(path, "PNG")
    print(f"wrote {path.relative_to(EXPO_ROOT)}  {image.size[0]}x{image.size[1]}"
          f"  alpha={'no' if opaque else 'yes'}")


def main() -> None:
    if not FONT_PATH.exists():
        raise SystemExit(f"font not found: {FONT_PATH}")

    # 1. iOS / primary icon — opaque orange rounded square.
    save(render(1024, 0.62, rounded_bg=True), "icon.png", opaque=True)

    # 2. Android adaptive foreground — transparent, glyph inside the safe circle.
    save(
        render(1024, 0.48, rounded_bg=False),
        "icon-android-foreground.png",
        opaque=False,
    )

    # 3. Android notification small-icon — transparent, solid white silhouette.
    save(render(96, 0.70, rounded_bg=False), "icon-notification.png", opaque=False)

    # 4. Web favicon — same design as icon.png. Rendered a touch larger and
    #    nudged up so the K's counter survives the 48px downsample.
    save(
        render(48, 0.66, rounded_bg=True, optical_y_shift=-0.01),
        "favicon.png",
        opaque=True,
    )


if __name__ == "__main__":
    main()
