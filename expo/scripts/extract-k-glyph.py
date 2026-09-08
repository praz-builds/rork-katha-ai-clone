#!/usr/bin/env python3
"""
Regenerate `src/brand/kGlyph.ts` from the brand font.

Run this only when the brand face changes. The output is committed, so the app
never parses a font at runtime.

    python3 -m venv /tmp/kglyph && /tmp/kglyph/bin/pip install fonttools shapely
    /tmp/kglyph/bin/python scripts/extract-k-glyph.py

Why the union step exists
-------------------------
Baloo2-ExtraBold draws "K" as FOUR overlapping unmerged contours: stem-top,
stem-bottom, arm, leg. Filled with nonzero winding that renders correctly, which
is why nobody notices. Stroked, it renders as four disconnected rectangles with
seams straight through the letter — useless for a draw-on animation.

So the contours are flattened to polygons, boolean-unioned into one closed
outline, and lightly simplified. The result is a single traceable perimeter.

The perimeter is computed here because React Native has no
`getTotalLength()`; the dash animation needs that number as a constant.
"""

import json
import math
from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "assets/fonts/Baloo2-ExtraBold.ttf"
OUT = ROOT / "src/brand/kGlyph.ts"

CHAR = "K"
BOX = 100.0          # viewBox is 0 0 100 100
FILL = 86.0          # glyph occupies this much of the box, leaving optical margin
CURVE_SAMPLES = 48   # flattening resolution per bezier
SIMPLIFY = 0.12      # in viewBox units; drops flattening noise, keeps the shape


def _bezier(p0, points, u):
    if len(points) == 2:                      # quadratic
        p1, p2 = points
        return (
            (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
            (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1],
        )
    p1, p2, p3 = points                       # cubic
    return (
        (1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0]
        + 3 * (1 - u) * u * u * p2[0] + u ** 3 * p3[0],
        (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1]
        + 3 * (1 - u) * u * u * p2[1] + u ** 3 * p3[1],
    )


def contours(font: TTFont):
    """Flatten the glyph to polygons, normalized and y-flipped into the viewBox."""
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[ord(CHAR)]

    from fontTools.pens.boundsPen import BoundsPen
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    w, h = x1 - x0, y1 - y0

    # Font Y points up, SVG Y points down, hence the negative y scale.
    scale = FILL / max(w, h)
    transform = Transform(
        scale, 0, 0, -scale,
        (BOX - w * scale) / 2 - x0 * scale,
        (BOX - h * scale) / 2 + y1 * scale,
    )

    pen = RecordingPen()
    glyphs[name].draw(TransformPen(pen, transform))

    out, current = [], []
    for op, args in pen.value:
        if op == "moveTo":
            if current:
                out.append(current)
            current = [args[0]]
        elif op == "lineTo":
            current.append(args[0])
        elif op in ("qCurveTo", "curveTo"):
            control = [p for p in args if p is not None]
            start = current[-1]
            for i in range(1, CURVE_SAMPLES + 1):
                current.append(_bezier(start, control, i / CURVE_SAMPLES))
        elif op == "closePath":
            if current:
                out.append(current)
                current = []
    if current:
        out.append(current)
    return out


def main():
    font = TTFont(FONT)
    polys = contours(font)
    print(f"{CHAR}: {len(polys)} raw contours -> union")

    merged = unary_union([Polygon(c).buffer(0) for c in polys])
    if merged.geom_type != "Polygon":
        raise SystemExit(f"expected one polygon, got {merged.geom_type}")
    if merged.interiors:
        raise SystemExit(f"unexpected holes: {len(merged.interiors)}")

    ring = list(merged.simplify(SIMPLIFY, preserve_topology=True).exterior.coords)
    perimeter = sum(math.dist(ring[i], ring[i + 1]) for i in range(len(ring) - 1))
    print(f"  {len(ring)} points, perimeter {perimeter:.2f}")

    d = "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in ring[:-1]) + " Z"

    existing = OUT.read_text()
    head = existing.split("export const K_PATH")[0]
    OUT.write_text(
        f'{head}export const K_PATH =\n  "{d}";\n\n'
        f'/** viewBox the path is authored against. */\n'
        f'export const K_VIEWBOX = "0 0 {BOX:.0f} {BOX:.0f}";\n\n'
        f'/**\n'
        f' * Perimeter of `K_PATH` in viewBox units.\n'
        f' *\n'
        f' * React Native has no `SVGGeometryElement.getTotalLength()`, so the dash array\n'
        f' * the draw animation interpolates cannot be measured at runtime. It is computed\n'
        f' * once at extraction time and asserted in `src/__tests__/katha-mark.test.tsx`.\n'
        f' */\n'
        f'export const K_LENGTH = {perimeter:.2f};\n'
    )
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
