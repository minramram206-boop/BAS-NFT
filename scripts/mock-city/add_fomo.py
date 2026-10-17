"""Add the FOMO Office and tidy the city layout across the committed island.

Like `add_studio.py`, this works on top of the committed pictures so existing
districts keep their hand-crafted buildings and BAS Studio remains untouched, while:
  * clearing cluttered crates, cramped filler sheds, orphan wall segments, and trees
    that choke narrow alleys between buildings or crowd the main boulevards,
  * lining the main north-south and east-west avenues with symmetrical lamps and trees,
  * building the seven-cell FOMO Office (`(25, 33, 7, 3)`) on the south-east shore
    with a "FOMO OFFICE" bulb marquee, live candlestick display, rooftop "FOMO"
    billboard, rising-trend gold statue, benches, flower beds, lamps, hedges, and
    stone promenades linking the main avenue and the lighthouse,
  * seamlessly repainting the ground tiles, shadows, and district lock layers
    (`lock-frontier.png`, `lock-watch.png`, `lock-summit.png`), and writing
    `cityLayout.json` with a `fomo` entry.

Requires Pillow. Run from the repository root:
  python3 scripts/mock-city/add_fomo.py
"""
import ast
import json
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
IMAGE_DIR = ROOT / "apps/web/public/images/city"
LAYOUT_FILE = ROOT / "apps/web/src/game/cityLayout.json"

# Frontier south-east shore, symmetrically balancing BAS Studio (6, 31, 7, 3) on the south-west shore.
OFFICE = (25, 33, 7, 3)
DOOR = (28, 36)
OFFICE_HEIGHT = 140
SITE = (
    {(x, y) for x in range(21, 36) for y in range(32, 40)}
    | {(x, 36) for x in range(20, 23)}
)
TERRACE = {(x, 36) for x in range(20, 36)}
PATHS = TERRACE | {(28, y) for y in range(37, 40)}
ZONE = "frontier"

# Cramped filler sheds, houses clipping BAS Studio's roof, and lower diagonal wall blocks next to FOMO Office.
CRAMPED_PROPS = {
    (5, 27, 3, 2),
    (3, 32, 2, 2),
    (0, 39, 2, 1),
    (15, 0, 2, 1),
    (14, 18, 2, 1),
    (22, 7, 2, 1),
    (15, 15, 2, 1),
    (8, 12, 2, 1),
    (13, 9, 2, 1),
    (22, 33, 1, 1),
    (23, 32, 1, 1),
    (24, 31, 1, 1),
    (25, 30, 1, 1),
    (26, 29, 1, 1),
    (21, 23, 3, 3),
}


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
assert "fomo" not in layout, "the FOMO Office is already in cityLayout.json"


def footprint(prop):
    gx, gy, w, d = prop["cells"]
    return {(x, y) for x in range(gx, gx + w) for y in range(gy, gy + d)}


def is_crate(prop):
    fw, fh = prop["frame"][2], prop["frame"][3]
    return prop["cells"][2:] == [1, 1] and fw == 37 and fh in (30, 31)


def is_tree(prop):
    fw, fh = prop["frame"][2], prop["frame"][3]
    return prop["cells"][2:] == [1, 1] and fw in (43, 46, 49) and fh in (58, 62, 68)


def is_small_hut(prop):
    fw, fh = prop["frame"][2], prop["frame"][3]
    return prop["cells"][2:] == [1, 1] and prop["zone"] == "frontier" and fw == 43 and fh >= 64


old_props = layout["props"]

# Multi-cell buildings that remain after removing cramped filler sheds.
kept_buildings = [
    p for p in old_props
    if p["cells"][2] * p["cells"][3] > 1 and tuple(p["cells"]) not in CRAMPED_PROPS and not (footprint(p) & SITE)
]
building_cells = {c for p in kept_buildings for c in footprint(p)}
building_halos = {
    (cx + dx, cy + dy)
    for (cx, cy) in building_cells
    for dx in (-1, 0, 1)
    for dy in (-1, 0, 1)
}

# Preserve BAS Studio's custom garden props in south-west Hearth (gx=2..18, gy=31..39).
STUDIO_GARDEN = {(x, y) for x in range(2, 19) for y in range(31, 40)}

kept = []
removed = []
kept_tree_cells = set()
for prop in old_props:
    cells_tuple = tuple(prop["cells"])
    fp = footprint(prop)
    gx, gy, w, d = cells_tuple
    drop = False
    if fp & SITE:
        drop = True
    elif cells_tuple in CRAMPED_PROPS:
        drop = True
    elif fp <= STUDIO_GARDEN:
        drop = False
    elif is_crate(prop):
        drop = True
    elif is_small_hut(prop) and gx < 36:
        drop = True
    elif is_tree(prop):
        # Remove trees wedged against buildings, crowding main avenues, or clumping with other trees.
        near_building = (gx, gy) in building_halos
        on_avenue_margin = gx in (18, 21) or gy in (18, 21) or (16 <= gx <= 23 and 16 <= gy <= 23)
        near_other_tree = any(abs(gx - tx) + abs(gy - ty) <= 1 for (tx, ty) in kept_tree_cells)
        if near_building or on_avenue_margin or near_other_tree:
            drop = True
        else:
            kept_tree_cells.add((gx, gy))
    if drop:
        removed.append(prop)
    else:
        kept.append(prop)

blocked = {tuple(c) for c in layout["blocked"]}
for prop in removed:
    blocked -= footprint(prop)


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
random.seed(123)

# --- pixel letters for the marquee -------------------------------------------------------

GLYPHS = {
    "F": ("111", "100", "110", "100", "100"),
    "O": ("010", "101", "101", "101", "010"),
    "M": ("101", "111", "111", "101", "101"),
    "E": ("111", "100", "110", "100", "111"),
    "I": ("111", "010", "010", "010", "111"),
    "C": ("011", "100", "100", "100", "011"),
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


# --- the office -----------------------------------------------------------------------------

CHARCOAL = (46, 50, 68)
ORANGE = (255, 138, 48)
RED = (255, 84, 84)
LIME = (110, 240, 150)
CYAN = (96, 226, 246)
GOLD = (255, 212, 92)


def candles(d, x0, y0, x1, y1):
    """A lit board of candlesticks climbing to the right, with a dashed trend line."""
    d.rectangle([x0, y0, x1, y1], fill=(20, 22, 32), outline=ORANGE, width=2)
    d.rectangle([x0 + 3, y0 + 3, x1 - 3, y1 - 3], outline=(80, 54, 40))
    n = (x1 - x0 - 12) // 7
    for k in range(n):
        up = random.random() < 0.7
        base = y1 - 8 - int(k * (y1 - y0 - 20) / n * 0.8) - random.randint(0, 5)
        body = random.randint(5, 11)
        color = LIME if up else RED
        cx = x0 + 8 + k * 7
        d.line([(cx + 1, base - body - 4), (cx + 1, base + 4)], fill=shade(color, 0.7))
        d.rectangle([cx - 1, base - body, cx + 3, base], fill=color)
    d.line([(x0 + 6, y1 - 8), (x1 - 6, y0 + 8)], fill=(255, 244, 200), width=1)
    d.polygon([(x1 - 6, y0 + 6), (x1 - 14, y0 + 8), (x1 - 8, y0 + 14)], fill=(255, 244, 200))


def facade(wpx, h):
    """The south face as a flat picture, top-left at (0, 0); returns it with its lit spots."""
    tex = Image.new("RGBA", (wpx, h), CHARCOAL + (255,))
    d = ImageDraw.Draw(tex)
    spots = []
    for x in range(0, wpx, 20):
        d.line([(x, 8), (x, h - 8)], fill=shade(CHARCOAL, 0.8))
        d.line([(x + 1, 8), (x + 1, h - 8)], fill=shade(CHARCOAL, 1.2))
    for _ in range(wpx * h // 9):
        d.point((random.randrange(wpx), random.randrange(8, h - 8)), fill=jitter(CHARCOAL, 0.92, 1.08))
    # parapet
    d.rectangle([0, 0, wpx, 7], fill=(120, 126, 150))
    d.line([(0, 0), (wpx, 0)], fill=(184, 190, 212))
    d.line([(0, 7), (wpx, 7)], fill=(34, 36, 52))
    # upper floor: tall lit window strips either side of the board
    for x in (14, 40, 66, 204, 230, 256):
        d.rectangle([x - 1, 15, x + 12, 61], fill=(28, 30, 44))
        for y in range(16, 61):
            t = (y - 16) / 44
            d.line([(x, y), (x + 11, y)], fill=mix((255, 214, 150), (214, 120, 70), t))
        d.line([(x + 5, 16), (x + 5, 60)], fill=(70, 50, 48))
        d.line([(x, 38), (x + 11, 38)], fill=(70, 50, 48))
        d.line([(x + 1, 17), (x + 1, 30)], fill=(255, 240, 214))
        spots.append(("window", x + 6, 27))
        spots.append(("window", x + 6, 50))
    # the candlestick board between the windows
    candles(d, wpx // 2 - 54, 14, wpx // 2 + 54, 62)
    spots.append(("lantern", wpx // 2, 38))
    # neon bands
    d.line([(0, 68), (wpx, 68)], fill=ORANGE, width=2)
    d.line([(0, 71), (wpx, 71)], fill=RED)
    # marquee: a dark board with bulb letters, lit edges and a canopy
    text = "FOMO OFFICE"
    scale = 3
    bw = text_width(text, scale) + 20
    bx = (wpx - bw) // 2
    d.rectangle([bx, 74, bx + bw, 98], fill=(24, 20, 30), outline=ORANGE)
    d.rectangle([bx + 2, 76, bx + bw - 2, 96], outline=(130, 70, 30))
    letters(d, text, bx + 10, 78, scale, (255, 220, 160), ORANGE)
    for x in range(bx + 4, bx + bw - 2, 6):
        d.point((x, 75), fill=(255, 240, 210))
        d.point((x, 97), fill=(255, 240, 210))
    for k in range(5):
        spots.append(("lantern", bx + 10 + k * (bw - 20) // 4, 86))
    # ground floor: a glass front with a warm glow, and the doors in the middle
    for x0, x1 in ((6, bx - 4), (bx + bw + 4, wpx - 6)):
        d.rectangle([x0 - 1, 101, x1 + 1, h - 7], fill=(30, 24, 36))
        for y in range(102, h - 7):
            t = (y - 102) / (h - 9 - 102)
            d.line([(x0, y), (x1, y)], fill=mix((255, 214, 150), (214, 130, 84), t))
        for x in range(x0, x1, 14):
            d.line([(x, 102), (x, h - 8)], fill=(56, 42, 50))
        d.line([(x0, 112), (x1, 112)], fill=(56, 42, 50))
        for x in range(x0 + 4, x1 - 8, 28):
            d.line([(x, h - 10), (x + 8, 104)], fill=(255, 244, 214))
        # people inside, as dark shapes against the light
        for x in range(x0 + 10, x1 - 6, 23):
            d.ellipse([x, 116, x + 5, 121], fill=(92, 62, 60))
            d.rectangle([x - 1, 122, x + 6, h - 8], fill=(92, 62, 60))
        spots.append(("window", (x0 + x1) // 2 - 20, 118))
        spots.append(("window", (x0 + x1) // 2 + 20, 118))
    dx0, dx1 = bx + 18, bx + bw - 18
    d.rectangle([dx0 - 3, 102, dx1 + 3, h - 6], fill=(30, 24, 36))
    for y in range(104, h - 6):
        t = (y - 104) / (h - 110)
        d.line([(dx0, y), (dx1, y)], fill=mix((176, 240, 248), (94, 168, 196), t))
    mid = (dx0 + dx1) // 2
    d.line([(mid, 104), (mid, h - 6)], fill=(30, 24, 36), width=2)
    d.line([(mid - 4, 116), (mid - 4, 124)], fill=GOLD)
    d.line([(mid + 3, 116), (mid + 3, 124)], fill=GOLD)
    d.rectangle([dx0 - 8, h - 6, dx1 + 8, h - 4], fill=(150, 142, 160))
    # corner neon
    for x in (0, wpx - 3):
        d.rectangle([x, 8, x + 2, h - 8], fill=ORANGE)
        d.line([(x + 1, 8), (x + 1, h - 8)], fill=(255, 226, 190))
    # plinth
    d.rectangle([0, h - 6, wpx, h], fill=(96, 90, 108))
    d.line([(0, h - 6), (wpx, h - 6)], fill=(150, 144, 166))
    for x in range(0, wpx, 12):
        d.line([(x, h - 6), (x, h)], fill=(70, 64, 82))
    return tex, spots


def roof(d, x0, y0, x1, y1):
    """The flat roof seen from above, with a rim, a skylight, plants and machines."""
    d.rectangle([x0, y0, x1, y1], fill=(124, 124, 138))
    for x in range(x0, x1, 10):
        d.line([(x, y0), (x, y1)], fill=(112, 112, 126))
    for y in range(y0, y1, 10):
        d.line([(x0, y), (x1, y)], fill=(112, 112, 126))
    for _ in range((x1 - x0) * (y1 - y0) // 14):
        d.point((random.randrange(x0, x1), random.randrange(y0, y1)), fill=jitter((124, 124, 138), 0.88, 1.12))
    d.rectangle([x0, y0, x1, y1], outline=(160, 160, 182), width=4)
    d.rectangle([x0 + 4, y0 + 4, x1 - 4, y1 - 4], outline=(92, 92, 106))
    for x in range(x0 + 10, x1 - 20, 22):
        d.rectangle([x, y0 + 8, x + 16, y0 + 16], fill=(120, 84, 56), outline=OUTLINE)
        for k in range(5):
            px = x + 2 + k * 3
            d.ellipse([px - 2, y0 + 3, px + 3, y0 + 10], fill=random.choice(((70, 140, 72), (88, 160, 80), (250, 170, 90))))
    sx0, sx1, sy0, sy1 = (x0 + x1) // 2 - 46, (x0 + x1) // 2 + 46, y0 + 30, y0 + 74
    d.rectangle([sx0, sy0, sx1, sy1], fill=(50, 44, 60), outline=OUTLINE)
    for y in range(sy0 + 2, sy1 - 1):
        t = (y - sy0) / (sy1 - sy0)
        d.line([(sx0 + 2, y), (sx1 - 2, y)], fill=mix((150, 210, 236), (84, 120, 176), t))
    for x in range(sx0 + 2, sx1, 15):
        d.line([(x, sy0 + 2), (x, sy1 - 2)], fill=(60, 70, 100))
    d.line([(sx0 + 2, (sy0 + sy1) // 2), (sx1 - 2, (sy0 + sy1) // 2)], fill=(60, 70, 100))
    d.line([(sx0 + 4, sy0 + 4), (sx0 + 22, sy0 + 4)], fill=(230, 246, 255))
    for k in range(2):
        ux, uy = x0 + 18 + k * 30, y1 - 34
        d.rectangle([ux, uy, ux + 22, uy + 18], fill=(170, 168, 182), outline=OUTLINE)
        d.ellipse([ux + 4, uy + 3, ux + 18, uy + 15], fill=(110, 108, 124))
        d.line([(ux + 11, uy + 4), (ux + 11, uy + 14)], fill=(70, 68, 84))
        d.line([(ux + 5, uy + 9), (ux + 17, uy + 9)], fill=(70, 68, 84))


def billboard(d, x, base):
    """A neon FOMO board with a rising arrow, on two posts at the roof's front edge."""
    for px in (x - 22, x + 22):
        d.rectangle([px, base - 22, px + 2, base], fill=(70, 66, 84), outline=OUTLINE)
    d.rectangle([x - 34, base - 66, x + 36, base - 20], fill=(26, 20, 32), outline=OUTLINE)
    d.rectangle([x - 32, base - 64, x + 34, base - 22], outline=(120, 70, 40))
    letters(d, "FOMO", x - 24, base - 60, 4, (255, 220, 160), ORANGE)
    d.line([(x - 24, base - 30), (x + 6, base - 30)], fill=LIME, width=2)
    d.line([(x + 6, base - 30), (x + 22, base - 40)], fill=LIME, width=2)
    d.polygon([(x + 28, base - 44), (x + 18, base - 44), (x + 24, base - 36)], fill=LIME)


def office():
    gx, gy, w, dep = OFFICE
    for cx in range(gx, gx + w):
        for cy in range(gy, gy + dep):
            blocked.add((cx, cy))
    h = OFFICE_HEIGHT

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x0, yb = iso(gx, gy)
        x1, yf = iso(gx + w, gy + dep)
        roof(d, x0, yb - h, x1, yf - h)
        tex, spots = facade(x1 - x0, h)
        layer.alpha_composite(tex, (x0, yf - h))
        for kind, sx, sy in spots:
            light(kind, x0 + sx, yf - h + sy, 30 if kind == "lantern" else 18, ZONE)
        billboard(d, x1 - 52, yf - h + 2)
        light("lamp", x1 - 52, yf - h - 48, 70, ZONE)
        # potted trees either side of the doors
        mid = (x0 + x1) // 2
        for px in (mid - 48, mid + 48):
            d.rectangle([px - 6, yf - 12, px + 6, yf], fill=(150, 96, 62), outline=OUTLINE)
            d.ellipse([px - 9, yf - 34, px + 9, yf - 12], fill=(70, 140, 72), outline=OUTLINE)
            d.ellipse([px - 5, yf - 31, px + 6, yf - 20], fill=(104, 176, 90))

    register((gx, gy, w, dep), ZONE, draw, ("box", gx, gy, w, dep, h + 20))


# --- the plaza --------------------------------------------------------------------------------


def trend_statue(gx, gy):
    """A gold rising arrow on a stone pedestal, lit at night."""
    blocked.add((gx, gy))
    cx, cy = icenter(gx, gy)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        d.rectangle([cx - 10, cy - 14, cx + 10, cy + 6], fill=(196, 192, 184), outline=OUTLINE)
        d.rectangle([cx - 10, cy - 14, cx + 10, cy - 10], fill=(222, 218, 210))
        d.rectangle([cx + 4, cy - 10, cx + 10, cy + 6], fill=(168, 164, 158))
        d.line([(cx - 9, cy - 20), (cx - 3, cy - 30), (cx + 2, cy - 25), (cx + 9, cy - 44)], fill=GOLD, width=3)
        d.polygon([(cx + 13, cy - 50), (cx + 3, cy - 46), (cx + 11, cy - 38)], fill=GOLD, outline=OUTLINE)
        d.point((cx - 7, cy - 24), fill=(255, 248, 220))
        light("lantern", cx, cy - 34, 30, ZONE)

    register((gx, gy, 1, 1), ZONE, draw, ("round", cx - 5, cy + 6, 14, 6))


def hedge(gx, gy):
    blocked.add((gx, gy))
    x0, yb = iso(gx, gy)
    x1, yf = iso(gx + 1, gy + 1)

    def draw(layer):
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


GREEN = (66, 134, 62)
LEAF = (104, 168, 72)
BEDS = ((255, 150, 60), (250, 214, 90), (250, 250, 250), (255, 96, 96))

office()
trend_statue(24, 38)
for gx, gy, color in (
    (23, 33, GREEN),
    (33, 33, LEAF),
    (23, 39, LEAF),
    (33, 37, GREEN),
):
    if (gx, gy) not in blocked and (gx, gy) not in PATHS:
        tree(gx, gy, color)
for gx, gy in ((24, 35), (32, 35), (31, 37), (25, 37)):
    flower_bed(gx, gy, BEDS)
for gx, gy in ((26, 38), (30, 38)):
    bench(gx, gy)
for gx, gy in ((24, 37), (32, 37), (23, 35), (33, 35)):
    if (gx, gy) not in blocked and (gx, gy) not in PATHS:
        lamp(gx, gy)
for gx in (25, 26, 27, 29, 30, 31, 32):
    hedge(gx, 39)

drawables = G["drawables"]
assert not any(cell in PATHS for cells, *_ in drawables for cell in footprint({"cells": cells})), "a prop stands on a path"

# every mission cell and every district spot must still be reachable from the plaza
spots = layout["spots"]
spots[ZONE] = [c for c in spots[ZONE] if tuple(c) not in blocked and tuple(c) not in SITE] + [[24, 36], [28, 37], [32, 36]]
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
assert DOOR in reach and all(c in reach for c in PATHS), "the office's door and paths must be reachable"
catalog = (ROOT / "apps/mission-server/src/catalog.ts").read_text()
for a, b in re.findall(r"kind: 'goto', cell: \[(\d+), (\d+)\]", catalog):
    assert (int(a), int(b)) in reach, f"mission cell {(a, b)} cannot be reached"
print("reachable cells", len(reach))

# --- ground -------------------------------------------------------------------------------

base = Image.open(IMAGE_DIR / "city-base.png").convert("RGBA")
SAND = (212, 184, 124)
GROUND = dict(G["GROUND"])
GROUND["hearth"] = (100, 166, 84)  # Matches BAS Studio's lawn tone seamlessly

# Repaint all non-plaza, non-studio-garden ground tiles so every district has uniform turf and accurate shadows.
PLAZA_CELLS = {(x, y) for x in range(17, 23) for y in range(17, 23)}
STUDIO_SITE = {(x, y) for x in range(2, 19) for y in range(31, 39)}
repainted_cells = {
    (gx, gy)
    for gy in range(N)
    for gx in range(N)
    if (gx, gy) not in PLAZA_CELLS and (gx, gy) not in STUDIO_SITE
}


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
    for name, (dx, dy) in G["NEIGHBOURS"].items():
        if (gx + dx, gy + dy) in PATHS or (gx + dx, gy + dy) not in SITE:
            continue
        (ax, ay), (bx, by) = G["EDGES"][name]
        d.line([(ax, ay), (bx, by)], fill=shade(SAND, 0.7), width=2)
    return tile


def natural_tile(gx, gy):
    z = layout["cells"][gy][gx]
    col = GROUND[z]
    tile = Image.new("RGBA", (TW, TH), (0, 0, 0, 255))
    d = ImageDraw.Draw(tile)
    if z == "road":
        G["cobble_tile"](d, shade(col, random.choice((0.94, 1.0, 1.06))))
        for name, (dx, dy) in G["NEIGHBOURS"].items():
            nx, ny = gx + dx, gy + dy
            if not (0 <= nx < N and 0 <= ny < N) or layout["cells"][ny][nx] in ("road", "plaza"):
                continue
            (x0, y0), (x1, y1) = G["EDGES"][name]
            ix, iy = G["INWARD"][name]
            d.line([(x0, y0), (x1, y1)], fill=(206, 200, 184), width=2)
            d.line([(x0 + ix, y0 + iy), (x1 + ix, y1 + iy)], fill=(92, 84, 74))
    elif z == "forge":
        d.rectangle([0, 0, TW, TH], fill=shade(col, random.choice((0.94, 1.0, 1.04))))
        G["dirt_tile"](d, col)
    elif z == "frontier":
        d.rectangle([0, 0, TW, TH], fill=shade(col, random.choice((0.97, 1.0, 1.03))))
        G["sand_tile"](d, col)
    else:
        d.rectangle([0, 0, TW, TH], fill=shade(col, random.choice((0.96, 1.0, 1.0, 1.04))))
        G["grass_tile"](d, z, col)
    return tile


for gx, gy in sorted(repainted_cells):
    tile = paved_tile(gx, gy) if (gx, gy) in PATHS else natural_tile(gx, gy)
    x, y = iso(gx, gy)
    base.paste(tile, (int(x), int(y)))

# Re-cast shadows onto repainted cells from all kept and newly added props.
repaint_mask = Image.new("L", (W, H), 0)
md = ImageDraw.Draw(repaint_mask)
for gx, gy in repainted_cells:
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
    fw, fh = prop["frame"][2], prop["frame"][3]
    if w * dep > 1 or fh > 70:
        cast(("box", gx, gy, w, dep, max(fh - dep * TH - 2, 20)))
    else:
        cx, cy = icenter(gx, gy)
        cast(("round", cx - 6, cy + 4, 20 if fw > 30 else 6, 8 if fw > 30 else 3))
for _cells, _z, _fn, shadow in drawables:
    cast(shadow)
clipped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
clipped.paste(shadow_layer, (0, 0), repaint_mask)
base.alpha_composite(clipped)

# Update dimmed ground overlays for lockable districts where cells were repainted.
dimmed_base = G["dim"](base.convert("RGB"))
for lock_zone in ("frontier", "watch", "summit"):
    lock_img = Image.open(IMAGE_DIR / f"lock-{lock_zone}.png").convert("RGBA")
    zone_mask = Image.new("L", (W, H), 0)
    zmd = ImageDraw.Draw(zone_mask)
    for gx, gy in repainted_cells:
        if layout["cells"][gy][gx] == lock_zone:
            x, y = iso(gx, gy)
            zmd.rectangle([x, y, x + TW - 1, y + TH - 1], fill=255)
    lock_img.paste(dimmed_base, (0, 0), zone_mask)
    lock_img.save(IMAGE_DIR / f"lock-{lock_zone}.png", optimize=True)

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
    picture = layer.crop(box)
    pieces.append({"image": picture, "dimmed": G["dim"](picture), "at": [box[0], box[1]], "cells": list(cells), "zone": z})
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
gx, gy, w, dep = OFFICE
layout.update(
    blocked=sorted([list(c) for c in blocked]),
    spots=spots,
    lights=lights,
    smoke=smoke,
    props=[{k: p[k] for k in ("frame", "dimmedFrame", "at", "cells", "zone") if k in p} for p in pieces],
    fomo={"cells": [gx, gy, w, dep], "door": list(DOOR), "label": [round(iso(gx + w / 2, gy)[0]), iso(gx, gy)[1] - OFFICE_HEIGHT - 8]},
)
LAYOUT_FILE.write_text(json.dumps(layout, separators=(",", ":")) + "\n")
print("wrote", IMAGE_DIR, LAYOUT_FILE, "props", len(pieces), "lights", len(lights))
