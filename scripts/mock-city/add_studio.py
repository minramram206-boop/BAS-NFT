"""Add BAS Studio and its garden to the committed city (D-0099).

`generate_city.py` no longer reproduces the committed city byte for byte (the
mission cells it keeps free have changed since), so the studio is added on top
of the committed pictures instead of by running the whole generator again:
everything outside the studio's ground stays exactly as it is.

What it does, in the hearth district south-west of the plaza:
  * takes away the houses and trees standing on the studio's ground,
  * paints that ground again: lawn, a paved terrace and garden paths,
  * draws the studio (a seven-cell hall with a lit glass front, a marquee
    and a neon note on the roof), an open-air stage, a pond, flower beds,
    benches, hedges, lamps and blossom trees, with their shadows,
  * packs every prop into city-props.png again and writes cityLayout.json,
    with a `studio` entry the scene uses for the label and the click.

The drawing helpers (textures, warps, trees, lamps, outlines) are the
generator's own, loaded from generate_city.py without running its city.

Requires Pillow. Run once from the repository root:
  python3 scripts/mock-city/add_studio.py
"""
import ast
import json
import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
IMAGE_DIR = ROOT / "apps/web/public/images/city"
LAYOUT_FILE = ROOT / "apps/web/src/game/cityLayout.json"

# The studio's ground: three rows beside and behind the hall, then five rows of garden down to the shore.
SITE = {(x, y) for x in range(2, 16) for y in range(31, 34)} | {(x, y) for x in range(2, 19) for y in range(34, 39)}
STUDIO = (6, 31, 7, 3)
DOOR = (9, 34)
STUDIO_HEIGHT = 140
TERRACE = {(x, 34) for x in range(5, 14)}
PATHS = TERRACE | {(9, y) for y in range(35, 39)} | {(x, 36) for x in range(3, 19)}
ZONE = "hearth"


def generator_helpers():
    """Functions and constants of generate_city.py, without the statements that draw its city."""
    source = HERE / "generate_city.py"
    keep = []
    for node in ast.parse(source.read_text()).body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
            keep.append(node)
        elif isinstance(node, ast.Assign):
            names = [t for target in node.targets for t in (target.elts if isinstance(target, ast.Tuple) else [target])]
            if all(isinstance(name, ast.Name) and name.id.isupper() for name in names):
                keep.append(node)
    space = {"__file__": str(source), "__name__": "generate_city_helpers"}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(source), "exec"), space)
    return space


G = generator_helpers()
iso, icenter, shade, mix, jitter, outlined, hull = (G[k] for k in ("iso", "icenter", "shade", "mix", "jitter", "outlined", "hull"))
TW, TH, W, H, OUTLINE = G["TW"], G["TH"], G["W"], G["H"], G["OUTLINE"]

layout = json.loads(LAYOUT_FILE.read_text())
assert "studio" not in layout, "the studio is already in cityLayout.json"

# --- clear the ground -------------------------------------------------------------------


def footprint(prop):
    gx, gy, w, d = prop["cells"]
    return {(x, y) for x in range(gx, gx + w) for y in range(gy, gy + d)}


old_props = layout["props"]
removed = [p for p in old_props if footprint(p) & SITE]
kept = [p for p in old_props if not footprint(p) & SITE]
blocked = {tuple(c) for c in layout["blocked"]}
for prop in removed:
    blocked -= footprint(prop)
assert not (blocked & SITE), f"blocked cells on the site that no prop explains: {sorted(blocked & SITE)}"


def rect(prop):
    x, y = prop["at"]
    return x, y, x + prop["frame"][2], y + prop["frame"][3]


def inside(point, box, pad=0):
    x, y = point
    return box[0] - pad <= x <= box[2] + pad and box[1] - pad <= y <= box[3] + pad


gone = [rect(p) for p in removed]
stay = [rect(p) for p in kept]
lights = [l for l in layout["lights"] if not (any(inside((l["x"], l["y"]), b) for b in gone) and not any(inside((l["x"], l["y"]), b) for b in stay))]
smoke = [s for s in layout["smoke"] if not any(inside((s["x"], s["y"]), b, pad=30) for b in gone)]
print("removed", len(removed), "props,", len(layout["lights"]) - len(lights), "lights,", len(layout["smoke"]) - len(smoke), "smoke spots")

# The generator's helpers record into these.
G["blocked"] = blocked
G["drawables"] = []
G["lights"] = lights
G["smoke"] = smoke
register, light, tree, lamp = G["register"], G["light"], G["tree"], G["lamp"]
random.seed(99)

# --- pixel letters for the marquee -------------------------------------------------------

GLYPHS = {
    "B": ("110", "101", "110", "101", "110"),
    "A": ("010", "101", "111", "101", "101"),
    "S": ("011", "100", "010", "001", "110"),
    "T": ("111", "010", "010", "010", "010"),
    "U": ("101", "101", "101", "101", "111"),
    "D": ("110", "101", "101", "101", "110"),
    "I": ("111", "010", "010", "010", "111"),
    "O": ("010", "101", "101", "101", "010"),
    " ": ("000", "000", "000", "000", "000"),
}


def letters(d, text, x, y, scale, color, glow):
    """Bulb letters: each pixel of a 3x5 glyph is a lit square with a darker rim."""
    for char in text:
        for row, bits in enumerate(GLYPHS[char]):
            for col, bit in enumerate(bits):
                if bit == "1":
                    px, py = x + col * scale, y + row * scale
                    d.rectangle([px, py, px + scale - 1, py + scale - 1], fill=glow)
                    d.rectangle([px, py, px + scale - 2, py + scale - 2], fill=color)
        x += 4 * scale
    return x


def text_width(text, scale):
    return len(text) * 4 * scale - scale


# --- the studio -----------------------------------------------------------------------------

INDIGO = (58, 46, 92)
NEON_PINK = (246, 92, 206)
NEON_CYAN = (96, 226, 246)
GOLD = (255, 212, 92)


def facade(wpx, h):
    """The south face as a flat picture, top-left at (0, 0); returns it with its lit spots."""
    tex = Image.new("RGBA", (wpx, h), INDIGO + (255,))
    d = ImageDraw.Draw(tex)
    spots = []
    for x in range(0, wpx, 20):
        d.line([(x, 8), (x, h - 8)], fill=shade(INDIGO, 0.8))
        d.line([(x + 1, 8), (x + 1, h - 8)], fill=shade(INDIGO, 1.15))
    for _ in range(wpx * h // 9):
        d.point((random.randrange(wpx), random.randrange(8, h - 8)), fill=jitter(INDIGO, 0.92, 1.08))
    # parapet
    d.rectangle([0, 0, wpx, 7], fill=(132, 120, 168))
    d.line([(0, 0), (wpx, 0)], fill=(186, 176, 214))
    d.line([(0, 7), (wpx, 7)], fill=(40, 32, 66))
    # upper floor: tall lit window strips either side of the record
    for x in (14, 40, 66, 204, 230, 256):
        d.rectangle([x - 1, 15, x + 12, 61], fill=(34, 26, 54))
        for y in range(16, 61):
            t = (y - 16) / 44
            d.line([(x, y), (x + 11, y)], fill=mix((182, 160, 250), (92, 70, 178), t))
        d.line([(x + 5, 16), (x + 5, 60)], fill=(60, 46, 104))
        d.line([(x, 38), (x + 11, 38)], fill=(60, 46, 104))
        d.line([(x + 1, 17), (x + 1, 30)], fill=(230, 222, 255))
        spots.append(("window", x + 6, 27))
        spots.append(("window", x + 6, 50))
    # the record: a black disc with grooves, a gold label and a pink neon ring
    cx, cy, r = wpx // 2, 37, 25
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], outline=NEON_PINK, width=2)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(22, 18, 28))
    for k in range(4, r, 4):
        d.ellipse([cx - r + k, cy - r + k, cx + r - k, cy + r - k], outline=(44, 40, 56))
    d.arc([cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3], 200, 250, fill=(140, 136, 160), width=2)
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=GOLD)
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(176, 128, 40))
    d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(22, 18, 28))
    spots.append(("lantern", cx, cy))
    # neon bands
    d.line([(0, 68), (wpx, 68)], fill=NEON_PINK, width=2)
    d.line([(0, 71), (wpx, 71)], fill=NEON_CYAN)
    # marquee: a dark board with bulb letters, lit edges and a canopy
    text = "BAS STUDIO"
    scale = 3
    bw = text_width(text, scale) + 20
    bx = (wpx - bw) // 2
    d.rectangle([bx, 74, bx + bw, 98], fill=(26, 20, 36), outline=GOLD)
    d.rectangle([bx + 2, 76, bx + bw - 2, 96], outline=(120, 86, 30))
    letters(d, text, bx + 10, 78, scale, (255, 236, 150), GOLD)
    for x in range(bx + 4, bx + bw - 2, 6):
        d.point((x, 75), fill=(255, 246, 200))
        d.point((x, 97), fill=(255, 246, 200))
    for k in range(5):
        spots.append(("lantern", bx + 10 + k * (bw - 20) // 4, 86))
    # ground floor: a glass front with a warm glow, and the doors in the middle
    for x0, x1 in ((6, bx - 4), (bx + bw + 4, wpx - 6)):
        d.rectangle([x0 - 1, 101, x1 + 1, h - 7], fill=(30, 24, 40))
        for y in range(102, h - 7):
            t = (y - 102) / (h - 9 - 102)
            d.line([(x0, y), (x1, y)], fill=mix((255, 222, 150), (214, 140, 84), t))
        for x in range(x0, x1, 14):
            d.line([(x, 102), (x, h - 8)], fill=(52, 40, 58))
        d.line([(x0, 112), (x1, 112)], fill=(52, 40, 58))
        for x in range(x0 + 4, x1 - 8, 28):
            d.line([(x, h - 10), (x + 8, 104)], fill=(255, 244, 214))
        # people inside, as dark shapes against the light
        for x in range(x0 + 10, x1 - 6, 23):
            d.ellipse([x, 116, x + 5, 121], fill=(92, 62, 60))
            d.rectangle([x - 1, 122, x + 6, h - 8], fill=(92, 62, 60))
        spots.append(("window", (x0 + x1) // 2 - 20, 118))
        spots.append(("window", (x0 + x1) // 2 + 20, 118))
    dx0, dx1 = bx + 18, bx + bw - 18
    d.rectangle([dx0 - 3, 102, dx1 + 3, h - 6], fill=(30, 24, 40))
    for y in range(104, h - 6):
        t = (y - 104) / (h - 110)
        d.line([(dx0, y), (dx1, y)], fill=mix((176, 240, 248), (94, 168, 196), t))
    mid = (dx0 + dx1) // 2
    d.line([(mid, 104), (mid, h - 6)], fill=(30, 24, 40), width=2)
    d.line([(mid - 4, 116), (mid - 4, 124)], fill=GOLD)
    d.line([(mid + 3, 116), (mid + 3, 124)], fill=GOLD)
    d.rectangle([dx0 - 8, h - 6, dx1 + 8, h - 4], fill=(150, 142, 160))
    # corner neon
    for x in (0, wpx - 3):
        d.rectangle([x, 8, x + 2, h - 8], fill=NEON_CYAN)
        d.line([(x + 1, 8), (x + 1, h - 8)], fill=(214, 252, 255))
    # plinth
    d.rectangle([0, h - 6, wpx, h], fill=(96, 90, 108))
    d.line([(0, h - 6), (wpx, h - 6)], fill=(150, 144, 166))
    for x in range(0, wpx, 12):
        d.line([(x, h - 6), (x, h)], fill=(70, 64, 82))
    return tex, spots


def roof(d, x0, y0, x1, y1):
    """The flat roof seen from above, with a rim, a skylight, plants and machines."""
    d.rectangle([x0, y0, x1, y1], fill=(124, 120, 138))
    for x in range(x0, x1, 10):
        d.line([(x, y0), (x, y1)], fill=(112, 108, 126))
    for y in range(y0, y1, 10):
        d.line([(x0, y), (x1, y)], fill=(112, 108, 126))
    for _ in range((x1 - x0) * (y1 - y0) // 14):
        d.point((random.randrange(x0, x1), random.randrange(y0, y1)), fill=jitter((124, 120, 138), 0.88, 1.12))
    d.rectangle([x0, y0, x1, y1], outline=(160, 154, 182), width=4)
    d.rectangle([x0 + 4, y0 + 4, x1 - 4, y1 - 4], outline=(92, 88, 106))
    # planters along the back edge
    for x in range(x0 + 10, x1 - 20, 22):
        d.rectangle([x, y0 + 8, x + 16, y0 + 16], fill=(120, 84, 56), outline=OUTLINE)
        for k in range(5):
            px = x + 2 + k * 3
            d.ellipse([px - 2, y0 + 3, px + 3, y0 + 10], fill=random.choice(((70, 140, 72), (88, 160, 80), (232, 140, 186))))
    # a glass skylight in the middle
    sx0, sx1, sy0, sy1 = (x0 + x1) // 2 - 46, (x0 + x1) // 2 + 46, y0 + 30, y0 + 74
    d.rectangle([sx0, sy0, sx1, sy1], fill=(50, 44, 70), outline=OUTLINE)
    for y in range(sy0 + 2, sy1 - 1):
        t = (y - sy0) / (sy1 - sy0)
        d.line([(sx0 + 2, y), (sx1 - 2, y)], fill=mix((150, 210, 236), (84, 120, 176), t))
    for x in range(sx0 + 2, sx1, 15):
        d.line([(x, sy0 + 2), (x, sy1 - 2)], fill=(60, 70, 100))
    d.line([(sx0 + 2, (sy0 + sy1) // 2), (sx1 - 2, (sy0 + sy1) // 2)], fill=(60, 70, 100))
    d.line([(sx0 + 4, sy0 + 4), (sx0 + 22, sy0 + 4)], fill=(230, 246, 255))
    # air units on the left, a dish on the right
    for k in range(2):
        ux, uy = x0 + 18 + k * 30, y1 - 34
        d.rectangle([ux, uy, ux + 22, uy + 18], fill=(170, 168, 182), outline=OUTLINE)
        d.ellipse([ux + 4, uy + 3, ux + 18, uy + 15], fill=(110, 108, 124))
        d.line([(ux + 11, uy + 4), (ux + 11, uy + 14)], fill=(70, 68, 84))
        d.line([(ux + 5, uy + 9), (ux + 17, uy + 9)], fill=(70, 68, 84))
    dx, dy = x1 - 46, y1 - 40
    d.line([(dx, dy + 18), (dx + 4, dy + 6)], fill=OUTLINE, width=2)
    d.ellipse([dx - 12, dy - 10, dx + 16, dy + 12], fill=(206, 206, 218), outline=OUTLINE)
    d.ellipse([dx - 6, dy - 5, dx + 10, dy + 7], fill=(176, 176, 192))
    d.line([(dx + 2, dy + 1), (dx + 12, dy - 12)], fill=OUTLINE)
    d.ellipse([dx + 10, dy - 15, dx + 15, dy - 10], fill=NEON_PINK)


def note_sign(d, x, base):
    """A neon eighth note on two posts, standing on the roof's front edge."""
    for px in (x - 10, x + 14):
        d.rectangle([px, base - 22, px + 2, base], fill=(70, 66, 84), outline=OUTLINE)
    d.rectangle([x - 18, base - 74, x + 26, base - 20], fill=(28, 22, 40), outline=OUTLINE)
    d.rectangle([x - 16, base - 72, x + 24, base - 22], outline=(80, 60, 110))
    # the note itself, a pink head and stem with a cyan flag
    d.ellipse([x - 9, base - 40, x + 5, base - 29], fill=NEON_PINK, outline=(255, 210, 246))
    d.line([(x + 4, base - 35), (x + 4, base - 66)], fill=NEON_PINK, width=3)
    d.line([(x + 5, base - 66), (x + 15, base - 58)], fill=NEON_CYAN, width=3)
    d.line([(x + 15, base - 58), (x + 13, base - 50)], fill=NEON_CYAN, width=3)
    d.point((x - 5, base - 37), fill=(255, 244, 252))


def studio():
    gx, gy, w, dep = STUDIO
    for cx in range(gx, gx + w):
        for cy in range(gy, gy + dep):
            blocked.add((cx, cy))
    h = STUDIO_HEIGHT

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x0, yb = iso(gx, gy)
        x1, yf = iso(gx + w, gy + dep)
        roof(d, x0, yb - h, x1, yf - h)
        tex, spots = facade(x1 - x0, h)
        layer.alpha_composite(tex, (x0, yf - h))
        for kind, sx, sy in spots:
            light(kind, x0 + sx, yf - h + sy, 30 if kind == "lantern" else 18, ZONE)
        note_sign(d, x1 - 40, yf - h + 2)
        light("lamp", x1 - 36, yf - h - 48, 70, ZONE)
        # potted trees either side of the doors
        mid = (x0 + x1) // 2
        for px in (mid - 48, mid + 48):
            d.rectangle([px - 6, yf - 12, px + 6, yf], fill=(150, 96, 62), outline=OUTLINE)
            d.ellipse([px - 9, yf - 34, px + 9, yf - 12], fill=(70, 140, 72), outline=OUTLINE)
            d.ellipse([px - 5, yf - 31, px + 6, yf - 20], fill=(104, 176, 90))

    register((gx, gy, w, dep), ZONE, draw, ("box", gx, gy, w, dep, h + 20))


# --- the garden ---------------------------------------------------------------------------


def stage(gx, gy):
    """An open-air stage: a round wooden floor, four white columns and a teal dome."""
    for cx in range(gx, gx + 2):
        for cy in range(gy, gy + 2):
            blocked.add((cx, cy))
    x0, yb = iso(gx, gy)
    x1, yf = iso(gx + 2, gy + 2)
    cx, cy = (x0 + x1) // 2, (yb + yf) // 2

    def draw(layer):
        d = ImageDraw.Draw(layer)
        rx, ry = 36, 30
        d.ellipse([cx - rx, cy - ry + 8, cx + rx, cy + ry + 8], fill=(110, 92, 80))
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(196, 150, 100), outline=OUTLINE)
        for k in range(-rx + 6, rx, 8):
            d.line([(cx + k, cy - ry + 6), (cx + k, cy + ry - 6)], fill=(170, 126, 84))
        # a microphone and a little keyboard on the floor
        d.line([(cx - 8, cy + 6), (cx - 8, cy - 18)], fill=OUTLINE, width=2)
        d.ellipse([cx - 11, cy - 23, cx - 5, cy - 17], fill=(60, 60, 72))
        d.rectangle([cx + 4, cy - 6, cx + 24, cy + 2], fill=(30, 28, 36), outline=OUTLINE)
        for k in range(cx + 5, cx + 24, 3):
            d.line([(k, cy - 5), (k, cy - 2)], fill=(240, 240, 244))
        top = cy - 52
        for px, py in ((cx - rx + 6, cy - ry + 10), (cx + rx - 9, cy - ry + 10), (cx - rx + 6, cy + ry - 6), (cx + rx - 9, cy + ry - 6)):
            d.rectangle([px, top + (py - cy) * 0.3, px + 4, py], fill=(238, 236, 228), outline=OUTLINE)
            d.line([(px + 3, top + (py - cy) * 0.3 + 1), (px + 3, py - 1)], fill=(255, 255, 255))
        # string lights between the columns
        for k in range(9):
            px = cx - rx + 8 + k * (2 * rx - 16) / 8
            d.point((px, top + 14 + abs(k - 4)), fill=GOLD)
        d.polygon([(cx - rx - 6, top + 4), (cx + rx + 6, top + 4), (cx, top - 30)], fill=(64, 156, 150), outline=OUTLINE)
        d.polygon([(cx, top + 4), (cx + rx + 6, top + 4), (cx, top - 30)], fill=(92, 186, 176))
        for k in range(1, 4):
            y = top + 4 - k * 8
            half = (rx + 6) * (1 - k * 8 / 34)
            d.line([(cx - half, y), (cx + half, y)], fill=(48, 124, 120))
        d.ellipse([cx - 4, top - 36, cx + 4, top - 28], fill=GOLD, outline=OUTLINE)
        light("lantern", cx, top + 16, 34, ZONE)

    register((gx, gy, 2, 2), ZONE, draw, ("round", cx - 6, cy + 12, 40, 18))


def pond(gx, gy):
    for cx in range(gx, gx + 2):
        for cy in range(gy, gy + 2):
            blocked.add((cx, cy))
    x0, yb = iso(gx, gy)
    x1, yf = iso(gx + 2, gy + 2)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle([x0 + 3, yb + 5, x1 - 3, yf - 3], radius=16, fill=(176, 172, 164), outline=OUTLINE)
        d.rounded_rectangle([x0 + 8, yb + 10, x1 - 8, yf - 8], radius=12, fill=(70, 150, 200))
        for k, tone in enumerate(((86, 166, 214), (110, 184, 226))):
            d.arc([x0 + 16 + k * 8, yb + 18 + k * 6, x1 - 16 - k * 8, yf - 16 - k * 6], 180, 330, fill=tone)
        for px, py in ((x0 + 22, yb + 26), (x1 - 26, yf - 24), (x0 + 30, yf - 20)):
            d.ellipse([px - 6, py - 4, px + 6, py + 4], fill=(70, 150, 82), outline=(40, 100, 56))
            d.point((px + 2, py - 1), fill=(244, 170, 210))
        for k in range(4):
            fx, fy = x0 + 46 + k * 4, yb + 34
            d.ellipse([fx, fy, fx + 4, fy + 2], fill=(242, 130, 60))

    register((gx, gy, 2, 2), ZONE, draw, ("round", (x0 + x1) / 2 - 4, (yb + yf) / 2 + 6, 38, 20))


def hedge(gx, gy):
    blocked.add((gx, gy))
    x0, yb = iso(gx, gy)
    x1, yf = iso(gx + 1, gy + 1)

    def draw(layer):
        # a clipped hedge across the middle of the cell: a leafy top, a darker front, a bumpy crown
        d = ImageDraw.Draw(layer)
        h, back, front = 18, yb + 12, yb + 30
        top = (84, 150, 76)
        d.rectangle([x0, back - h, x1 - 1, front - h], fill=top)
        d.rectangle([x0, front - h, x1 - 1, front], fill=shade(top, 0.66))
        for k in range(5):
            bx = x0 + 4 + k * 8
            d.ellipse([bx - 5, back - h - 4, bx + 5, back - h + 4], fill=top)
            d.ellipse([bx - 3, back - h - 3, bx + 2, back - h + 1], fill=shade(top, 1.22))
        for _ in range(40):
            px, py = random.randrange(x0 + 1, x1 - 1), random.randrange(back - h, front)
            d.point((px, py), fill=shade(top, random.choice((0.6, 0.8, 1.2, 1.3))))
        d.line([(x0, front - h), (x1 - 1, front - h)], fill=shade(top, 1.3))
        d.line([(x0, front), (x1 - 1, front)], fill=shade(top, 0.45))

    register((gx, gy, 1, 1), ZONE, draw, ("round", (x0 + x1) / 2 + 6, yb + 30, 22, 5))


def flower_bed(gx, gy, colors):
    blocked.add((gx, gy))
    x0, yb = iso(gx, gy)
    x1, yf = iso(gx + 1, gy + 1)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        d.rectangle([x0 + 3, yb + 8, x1 - 3, yf - 6], fill=(108, 74, 50), outline=OUTLINE)
        d.rectangle([x0 + 5, yb + 10, x1 - 5, yf - 10], fill=(84, 58, 44))
        d.rectangle([x0 + 3, yf - 10, x1 - 3, yf - 6], fill=(140, 98, 64))
        for _ in range(16):
            px, py = random.randrange(x0 + 7, x1 - 7), random.randrange(yb + 8, yf - 12)
            d.line([(px, py), (px, py + 4)], fill=(60, 120, 64))
            petal = random.choice(colors)
            d.rectangle([px - 1, py - 2, px + 1, py], fill=petal)
            d.point((px, py - 1), fill=(255, 236, 140))

    register((gx, gy, 1, 1), ZONE, draw, ("round", (x0 + x1) / 2 - 4, yf - 8, 18, 6))


def bench(gx, gy):
    blocked.add((gx, gy))
    cx, cy = icenter(gx, gy)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        for px in (cx - 13, cx + 11):
            d.rectangle([px, cy - 4, px + 2, cy + 6], fill=(50, 48, 60))
        d.rectangle([cx - 16, cy - 16, cx + 16, cy - 8], fill=(150, 98, 60), outline=OUTLINE)
        d.line([(cx - 15, cy - 12), (cx + 15, cy - 12)], fill=(112, 72, 46))
        d.rectangle([cx - 16, cy - 6, cx + 16, cy - 2], fill=(176, 118, 72), outline=OUTLINE)

    register((gx, gy, 1, 1), ZONE, draw, ("round", cx - 4, cy + 6, 18, 5))


def note_statue(gx, gy):
    """A gold note on a stone pedestal, lit at night."""
    blocked.add((gx, gy))
    cx, cy = icenter(gx, gy)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        d.rectangle([cx - 10, cy - 14, cx + 10, cy + 6], fill=(196, 192, 184), outline=OUTLINE)
        d.rectangle([cx - 10, cy - 14, cx + 10, cy - 10], fill=(222, 218, 210))
        d.rectangle([cx + 4, cy - 10, cx + 10, cy + 6], fill=(168, 164, 158))
        d.ellipse([cx - 11, cy - 30, cx + 1, cy - 20], fill=GOLD, outline=OUTLINE)
        d.line([(cx, cy - 25), (cx, cy - 54)], fill=(214, 170, 60), width=3)
        d.line([(cx + 1, cy - 54), (cx + 11, cy - 46)], fill=GOLD, width=3)
        d.line([(cx + 11, cy - 46), (cx + 9, cy - 38)], fill=GOLD, width=3)
        d.point((cx - 7, cy - 28), fill=(255, 248, 220))
        light("lantern", cx, cy - 34, 30, ZONE)

    register((gx, gy, 1, 1), ZONE, draw, ("round", cx - 5, cy + 6, 14, 6))


BLOSSOM = (236, 150, 196)
GREEN = (66, 134, 62)
BEDS = ((244, 96, 132), (250, 214, 90), (250, 250, 250), (170, 130, 240))

studio()
stage(3, 32)
pond(13, 37)
note_statue(14, 32)
for gx, gy, color in ((2, 31, BLOSSOM), (5, 31, BLOSSOM), (2, 33, GREEN), (13, 31, BLOSSOM), (15, 31, GREEN),
                      (15, 34, BLOSSOM), (6, 37, BLOSSOM), (16, 37, GREEN), (11, 38, BLOSSOM)):
    tree(gx, gy, color)
for gx, gy in ((5, 33), (13, 33), (15, 33), (3, 35), (4, 35), (14, 35), (15, 35), (11, 37), (7, 37)):
    flower_bed(gx, gy, BEDS)
for gx, gy in ((7, 35), (11, 35), (5, 37)):
    bench(gx, gy)
for gx, gy in ((4, 34), (14, 34), (17, 35), (17, 37)):
    lamp(gx, gy)
for gx, gy in [(2, y) for y in range(35, 39)] + [(x, 38) for x in (3, 4, 5, 6, 7, 8, 10, 15, 16, 17, 18)]:
    hedge(gx, gy)

drawables = G["drawables"]
assert not any(cell in PATHS for cells, *_ in drawables for cell in footprint({"cells": cells})), "a prop stands on a path"

# every mission cell and every district spot must still be reachable from the plaza
spots = layout["spots"]
spots[ZONE] = [c for c in spots[ZONE] if tuple(c) not in blocked and tuple(c) not in SITE] + [[9, 35], [6, 36]]
reach = set()
queue = [(18, 18)]
N = layout["size"]
while queue:
    c = queue.pop()
    if c in reach or not (0 <= c[0] < N and 0 <= c[1] < N) or c in blocked:
        continue
    reach.add(c)
    queue.extend(((c[0] + 1, c[1]), (c[0] - 1, c[1]), (c[0], c[1] + 1), (c[0], c[1] - 1)))
for name, cells in spots.items():
    for c in cells:
        assert tuple(c) in reach, f"{name} spot {c} cannot be reached"
assert DOOR in reach and all(c in reach for c in PATHS), "the studio's door and paths must be reachable"
catalog = (ROOT / "apps/mission-server/src/catalog.ts").read_text()
for a, b in re.findall(r"kind: 'goto', cell: \[(\d+), (\d+)\]", catalog):
    assert (int(a), int(b)) in reach, f"mission cell {(a, b)} cannot be reached"
print("reachable cells", len(reach))

# --- ground -------------------------------------------------------------------------------

base = Image.open(IMAGE_DIR / "city-base.png").convert("RGBA")
GRASS = (100, 166, 84)


def paved_tile(gx, gy):
    """Warm stone slabs, two by two, with a lighter edge toward the light."""
    tile = Image.new("RGBA", (TW, TH), (150, 138, 124, 255))
    d = ImageDraw.Draw(tile)
    for sx in (0, 20):
        for sy in (0, 20):
            stone = jitter((214, 202, 182), 0.92, 1.06)
            d.rectangle([sx + 1, sy + 1, sx + 18, sy + 18], fill=stone)
            d.line([(sx + 1, sy + 1), (sx + 18, sy + 1)], fill=shade(stone, 1.1))
            d.line([(sx + 18, sy + 1), (sx + 18, sy + 18)], fill=shade(stone, 0.86))
            for _ in range(6):
                d.point((sx + random.randrange(3, 17), sy + random.randrange(3, 17)), fill=shade(stone, random.choice((0.9, 1.08))))
    # grass edges where the path meets the lawn
    for name, (dx, dy) in G["NEIGHBOURS"].items():
        if (gx + dx, gy + dy) in PATHS or (gx + dx, gy + dy) not in SITE:
            continue
        (ax, ay), (bx, by) = G["EDGES"][name]
        d.line([(ax, ay), (bx, by)], fill=shade(GRASS, 0.7), width=2)
    return tile


for gx, gy in sorted(SITE):
    if (gx, gy) in PATHS:
        tile = paved_tile(gx, gy)
    else:
        tile = Image.new("RGBA", (TW, TH), shade(GRASS, random.choice((0.96, 1.0, 1.04))) + (255,))
        G["grass_tile"](ImageDraw.Draw(tile), ZONE, GRASS)
    x, y = iso(gx, gy)
    base.paste(tile, (int(x), int(y)))

# Shadows on the repainted ground: the new props', and the old props' next to it whose
# shadows the new grass covered. The latter are estimated from the size of their picture.
site_mask = Image.new("L", (W, H), 0)
md = ImageDraw.Draw(site_mask)
for gx, gy in SITE:
    x, y = iso(gx, gy)
    md.rectangle([x, y, x + TW - 1, y + TH - 1], fill=255)
shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow_layer)


def cast(shadow):
    if shadow[0] == "box":
        _, gx, gy, w, dep, total = shadow
        corners = [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + dep), iso(gx, gy + dep)]
        length = min(total * 0.62, 60)
        moved = [(x + length * 0.9, y + length * 0.2) for x, y in corners]
        sd.polygon(hull(corners + moved), fill=(10, 18, 34, 78))
    else:
        _, sx, sy, rx, ry = shadow
        sd.ellipse([sx - rx, sy - ry, sx + rx, sy + ry], fill=(10, 18, 34, 78))


for prop in kept:
    gx, gy, w, dep = prop["cells"]
    near = any((x, y) in SITE for x in range(gx, gx + w + 2) for y in range(gy, gy + dep + 1))
    if not near:
        continue
    fw, fh = prop["frame"][2], prop["frame"][3]
    if w * dep > 1 or fh > 70:
        cast(("box", gx, gy, w, dep, max(fh - dep * TH - 2, 20)))
    else:
        cx, cy = icenter(gx, gy)
        cast(("round", cx - 6, cy + 4, 20 if fw > 30 else 6, 8 if fw > 30 else 3))
for _cells, _z, _fn, shadow in drawables:
    cast(shadow)
clipped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
clipped.paste(shadow_layer, (0, 0), site_mask)
base.alpha_composite(clipped)

# --- props -----------------------------------------------------------------------------------

old_sheet = Image.open(IMAGE_DIR / "city-props.png").convert("RGBA")
pieces = []
for prop in kept:
    entry = {k: prop[k] for k in ("at", "cells", "zone")}
    fx, fy, fw, fh = prop["frame"]
    entry["image"] = old_sheet.crop((fx, fy, fx + fw, fy + fh))
    if "dimmedFrame" in prop:
        dx, dy, dw, dh = prop["dimmedFrame"]
        entry["dimmed"] = old_sheet.crop((dx, dy, dx + dw, dy + dh))
    pieces.append(entry)
for cells, z, fn, _shadow in drawables:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fn(layer)
    layer = outlined(layer)
    box = layer.getbbox()
    pieces.append({"image": layer.crop(box), "at": [box[0], box[1]], "cells": list(cells), "zone": z})
pieces.sort(key=lambda p: sum(p["cells"]))

SHEET_WIDTH = 2048
x = y = row = 0
placed = []
for piece in pieces:
    for image_key, frame_key in (("image", "frame"), ("dimmed", "dimmedFrame")):
        if image_key not in piece:
            continue
        pw, ph = piece[image_key].size
        if x + pw > SHEET_WIDTH:
            x, y, row = 0, y + row + 1, 0
        piece[frame_key] = [x, y, pw, ph]
        placed.append((piece[image_key], (x, y)))
        x, row = x + pw + 1, max(row, ph)
sheet = Image.new("RGBA", (SHEET_WIDTH, y + row), (0, 0, 0, 0))
for picture, position in placed:
    sheet.paste(picture, position)

# --- export ------------------------------------------------------------------------------------

sheet.save(IMAGE_DIR / "city-props.png", optimize=True)
base.convert("RGB").save(IMAGE_DIR / "city-base.png", optimize=True)
gx, gy, w, dep = STUDIO
# The district's name stood where the studio's roof is now; it moves up among the houses.
layout["labels"][ZONE] = [5.0, 25.5]
layout.update(
    blocked=sorted([list(c) for c in blocked]),
    spots=spots,
    lights=lights,
    smoke=smoke,
    props=[{k: p[k] for k in ("frame", "dimmedFrame", "at", "cells", "zone") if k in p} for p in pieces],
    studio={"cells": [gx, gy, w, dep], "door": list(DOOR), "label": [round(iso(gx + w / 2, gy)[0]), iso(gx, gy)[1] - STUDIO_HEIGHT - 8]},
)
LAYOUT_FILE.write_text(json.dumps(layout, separators=(",", ":")) + "\n")
print("wrote", IMAGE_DIR, LAYOUT_FILE, "props", len(pieces), "lights", len(lights))
