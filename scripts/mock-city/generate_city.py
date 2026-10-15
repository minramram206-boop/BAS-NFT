"""Generate the mock isometric city used until the final tileset exists (D-0021, D-0024, D-0028).

Outputs, all committed:
  apps/web/public/images/city/city-base.png         the ground and the sea, nothing dimmed
  apps/web/public/images/city/city-props.png        buildings, trees, lamps and walls packed in one sheet
  apps/web/public/images/city/lock-<district>.png   dimmed ground of one district, transparent elsewhere
  apps/web/src/game/cityLayout.json                  grid, districts, blocked cells, spots, labels, props,
                                                     and the anchors the scene animates (lights, smoke, water)

Props are separate from the ground so the scene can sort them against the
citizens: someone walking behind a house is hidden by it instead of being
drawn on its roof.

Buildings are drawn as flat textures (brick, stone, plaster, timber, shingles,
windows, doors) and sheared onto the isometric faces with an affine warp, so
every detail keeps one pixel size. Light comes from the right: right faces and
right slopes are bright, left ones dark, and every prop casts a shadow on the
ground to its left.

Requires Pillow. Run from the repository root:
  python3 scripts/mock-city/generate_city.py
"""
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
IMAGE_DIR = ROOT / "apps/web/public/images/city"
LAYOUT_FILE = ROOT / "apps/web/src/game/cityLayout.json"

W, H = 1920, 1960        # drawn at final size
TW, TH = 40, 40          # square tile; the view looks down from the south
OX, OY = 160, 200         # position of the top-left corner of cell (0, 0)
N = 40
SCALE = 1
EDGE = 16                # thickness of the island's cliff
SHIFT = 8                # the original 26x26 town sits this many cells in from the north and west edges
GATE = {(27, 28), (28, 27)}
LOCKABLE = ("watch", "frontier", "summit")
DISTRICTS = ("plaza", "archive", "hearth", "forge", "watch", "frontier", "summit")
ZONE_IDS = {name: index + 1 for index, name in enumerate(("road",) + DISTRICTS)}
BG = (23, 38, 45)        # the game's background colour; the sea fades into it
random.seed(7)



def iso(gx, gy):
    """Screen position of a cell corner. The view is oblique: x runs east, y runs south."""
    return OX + gx * TW, OY + gy * TH


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3])


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def jitter(c, lo=0.9, hi=1.1):
    return shade(c, random.uniform(lo, hi))


def zone(gx, gy):
    """Logical zone of a cell."""
    if 17 <= gx <= 22 and 17 <= gy <= 22:
        return "plaza"
    if gx + gy >= 56:
        return "frontier"
    if gx in (19, 20) or gy in (19, 20):
        return "road"
    if gx <= 11 and gy <= 11:
        return "summit"
    if gx < 19 and gy < 19:
        return "archive"
    if gx > 20 and gy < 19:
        return "forge"
    if gx < 19 and gy > 20:
        return "hearth"
    return "watch"


def icenter(gx, gy):
    """Screen position of the middle of a cell."""
    return iso(gx + 0.5, gy + 0.5)


def solve3(points, values):
    """Coefficients (a, b, c) with a*x + b*y + c == value at each of the three points."""
    (x0, y0), (x1, y1), (x2, y2) = points
    det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)
    a = (values[0] * (y1 - y2) + values[1] * (y2 - y0) + values[2] * (y0 - y1)) / det
    b = (values[0] * (x2 - x1) + values[1] * (x0 - x2) + values[2] * (x1 - x0)) / det
    c = (values[0] * (x1 * y2 - x2 * y1) + values[1] * (x2 * y0 - x0 * y2) + values[2] * (x0 * y1 - x1 * y0)) / det
    return a, b, c


def warp(layer, tex, tex_points, screen_points):
    """Draws `tex` on `layer` so its three `tex_points` land on `screen_points` (an affine map)."""
    ax, bx, cx = solve3(screen_points, [p[0] for p in tex_points])
    ay, by, cy = solve3(screen_points, [p[1] for p in tex_points])
    out = tex.transform(layer.size, Image.AFFINE, (ax, bx, cx, ay, by, cy), resample=Image.NEAREST)
    layer.alpha_composite(out)


def outlined(layer, color=(30, 26, 38, 255)):
    alpha = layer.getchannel("A")
    ring = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(3)), alpha)
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", layer.size, color), (0, 0), ring)
    out.alpha_composite(layer)
    return out


def hull(points):
    pts = sorted(set((round(x), round(y)) for x, y in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


# --- ground -----------------------------------------------------------------------

GROUND = {
    "plaza": (200, 198, 190), "road": (150, 140, 128), "archive": (92, 148, 88),
    "hearth": (104, 160, 84), "forge": (126, 108, 84), "watch": (88, 124, 88),
    "frontier": (212, 184, 124), "summit": (136, 160, 128),
}
FLOWERS = {
    "archive": ((235, 235, 245), (150, 170, 240)),
    "hearth": ((250, 220, 90), (240, 150, 190), (255, 255, 255)),
    "summit": ((240, 240, 250),),
}

ground = Image.new("RGBA", (W, H), BG + (255,))
ids = Image.new("L", (W, H), 0)
di = ImageDraw.Draw(ids)
shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow_layer)
blocked = set()

DIAMOND = Image.new("L", (TW, TH), 255)   # tiles are squares now; the name is kept for the paste mask
EDGES = {
    "n": ((1, 1), (TW - 2, 1)),
    "s": ((1, TH - 2), (TW - 2, TH - 2)),
    "w": ((1, 1), (1, TH - 2)),
    "e": ((TW - 2, 1), (TW - 2, TH - 2)),
}
NEIGHBOURS = {"n": (0, -1), "s": (0, 1), "w": (-1, 0), "e": (1, 0)}
INWARD = {"n": (0, 2), "s": (0, -2), "w": (2, 0), "e": (-2, 0)}


def tile_noise(d, color, count, lo=0.88, hi=1.1, wide=False):
    for _ in range(count):
        px, py = random.randrange(2, TW - 2), random.randrange(2, TH - 2)
        c = jitter(color, lo, hi)
        d.rectangle([px, py, px + (1 if wide else 0), py], fill=c)


def grass_tile(d, z, base):
    tile_noise(d, base, 26, 0.86, 1.14, True)
    for _ in range(7):
        px, py = random.randrange(4, TW - 6), random.randrange(5, TH - 3)
        dark = shade(base, 0.72)
        light = shade(base, 1.22)
        d.line([(px, py), (px, py - 3)], fill=dark)
        d.line([(px + 1, py), (px + 2, py - 2)], fill=light)
    if z in FLOWERS and random.random() < 0.55:
        for _ in range(random.randint(1, 3)):
            px, py = random.randrange(8, TW - 8), random.randrange(6, TH - 4)
            petal = random.choice(FLOWERS[z])
            d.point((px, py), fill=petal)
            d.point((px + 1, py), fill=petal)
            d.point((px, py - 1), fill=(250, 210, 80))
    if z in ("watch", "summit") and random.random() < 0.28:
        px, py = random.randrange(10, TW - 12), random.randrange(7, TH - 6)
        d.ellipse([px, py, px + 6, py + 3], fill=(124, 128, 134))
        d.ellipse([px + 1, py, px + 4, py + 1], fill=(168, 172, 178))


def dirt_tile(d, base):
    tile_noise(d, base, 40, 0.8, 1.15, True)
    for _ in range(5):
        px, py = random.randrange(6, TW - 8), random.randrange(5, TH - 4)
        d.point((px, py), fill=shade(base, 0.55))
        d.point((px + 1, py + 1), fill=shade(base, 0.55))
    if random.random() < 0.3:
        px, py = random.randrange(8, TW - 12), random.randrange(6, TH - 6)
        d.ellipse([px, py, px + 4, py + 2], fill=(98, 90, 84))
        d.point((px + 1, py), fill=(150, 142, 134))
    if random.random() < 0.2:
        px, py = random.randrange(8, TW - 14), random.randrange(6, TH - 6)
        d.ellipse([px, py, px + 9, py + 4], fill=shade(base, 0.62))


def sand_tile(d, base):
    tile_noise(d, base, 24, 0.94, 1.06, True)
    for _ in range(3):
        px, py = random.randrange(6, TW - 14), random.randrange(5, TH - 4)
        d.line([(px, py), (px + 7, py)], fill=shade(base, 1.1))
        d.line([(px + 1, py + 1), (px + 6, py + 1)], fill=shade(base, 0.85))
    for _ in range(3):
        d.point((random.randrange(6, TW - 6), random.randrange(4, TH - 3)), fill=(150, 140, 120))


def cobble_tile(d, base, size=(7, 4)):
    sw, sh = size
    d.rectangle([0, 0, TW, TH], fill=shade(base, 0.62))
    for row, y in enumerate(range(0, TH, sh)):
        shift = (row % 2) * (sw // 2 + 1)
        for x in range(-shift, TW, sw):
            stone = jitter(base, 0.88, 1.1)
            d.rectangle([x + 1, y, x + sw - 1, y + sh - 2], fill=stone)
            d.line([(x + 1, y), (x + sw - 1, y)], fill=shade(stone, 1.18))
            d.line([(x + 1, y + sh - 2), (x + sw - 1, y + sh - 2)], fill=shade(stone, 0.8))


def plaza_tile(d, gx, gy, base):
    tone = shade(base, 0.93) if (gx + gy) % 2 else base
    d.rectangle([0, 0, TW, TH], fill=tone)
    tile_noise(d, tone, 16, 0.92, 1.06, True)
    d.line([EDGES["n"][0], EDGES["n"][1]], fill=shade(tone, 1.12))
    d.line([EDGES["w"][0], EDGES["w"][1]], fill=shade(tone, 1.12))
    d.line([EDGES["s"][0], EDGES["s"][1]], fill=shade(tone, 0.78))
    d.line([EDGES["e"][0], EDGES["e"][1]], fill=shade(tone, 0.78))


def paint_cell(gx, gy):
    z = zone(gx, gy)
    base = GROUND[z]
    tile = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    if z == "plaza":
        plaza_tile(d, gx, gy, base)
    elif z == "road":
        cobble_tile(d, shade(base, random.choice((0.94, 1.0, 1.06))))
        for name, (dx, dy) in NEIGHBOURS.items():
            if not (0 <= gx + dx < N and 0 <= gy + dy < N) or zone(gx + dx, gy + dy) in ("road", "plaza"):
                continue
            (x0, y0), (x1, y1) = EDGES[name]
            ix, iy = INWARD[name]
            d.line([(x0, y0), (x1, y1)], fill=(206, 200, 184), width=2)
            d.line([(x0 + ix, y0 + iy), (x1 + ix, y1 + iy)], fill=(92, 84, 74))
    elif z == "forge":
        d.rectangle([0, 0, TW, TH], fill=shade(base, random.choice((0.94, 1.0, 1.04))))
        dirt_tile(d, base)
    elif z == "frontier":
        d.rectangle([0, 0, TW, TH], fill=shade(base, random.choice((0.97, 1.0, 1.03))))
        sand_tile(d, base)
    else:
        d.rectangle([0, 0, TW, TH], fill=shade(base, random.choice((0.94, 1.0, 1.0, 1.06))))
        grass_tile(d, z, base)
    x, y = iso(gx, gy)
    ground.paste(tile, (int(x), int(y)), DIAMOND)
    di.rectangle([x, y, x + TW - 1, y + TH - 1], fill=ZONE_IDS[z])


# sea first: a lit patch around the island fading to the page background
sea = Image.composite(
    Image.new("RGB", (W, H), BG),
    Image.new("RGB", (W, H), (36, 92, 112)),
    Image.radial_gradient("L").resize((W, H), Image.BILINEAR),
).convert("RGBA")
ground.alpha_composite(sea)
sea_draw = ImageDraw.Draw(ground)
for _ in range(W * H // 380):
    wx, wy = random.randrange(W), random.randrange(H)
    length = random.choice((4, 6, 8, 12))
    sea_draw.line([(wx, wy), (wx + length, wy)], fill=(58, 128, 148, 120))

for gy in range(N):
    for gx in range(N):
        paint_cell(gx, gy)


def cliff(gx):
    """Rock face under the island's south shore, with a grass lip."""
    x, y = iso(gx, N)
    z = zone(gx, N - 1)
    quad = [(x, y), (x + TW, y), (x + TW, y + EDGE), (x, y + EDGE)]
    base = (104, 86, 70)
    face = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(face)
    fd.polygon(quad, fill=base)
    for _ in range(14):
        px = random.randrange(int(x), int(x + TW))
        py = random.randrange(int(y), int(y + EDGE))
        fd.line([(px, py), (px + random.choice((0, 1, 2)), py + random.choice((2, 3, 5)))], fill=shade(base, random.choice((0.7, 1.2))))
    lip = Image.new("L", (W, H), 0)
    ImageDraw.Draw(lip).polygon(quad, fill=255)
    top = ImageChops.subtract(lip, ImageChops.offset(lip, 0, 4))
    green = Image.new("RGBA", (W, H), shade(GROUND[z] if z != "plaza" else GROUND["archive"], 0.82) + (255,))
    face.paste(green, (0, 0), top)
    alpha = face.getchannel("A")
    clipped = ImageChops.multiply(alpha, lip)
    face.putalpha(clipped)
    ground.alpha_composite(face)
    di.polygon(quad, fill=ZONE_IDS[z])


for i in range(N):
    cliff(i)

# the plaza's inlay: rings and spokes around the fountain
rosette = ImageDraw.Draw(ground)
fx, fy = iso(20, 20)
for rx, color in ((74, (186, 156, 92)), (66, (96, 128, 166)), (58, (186, 156, 92))):
    rosette.ellipse([fx - rx, fy - rx, fx + rx, fy + rx], outline=color, width=2)
for k in range(12):
    angle = k * math.pi / 6
    rosette.line(
        [(fx + math.cos(angle) * 50, fy + math.sin(angle) * 50), (fx + math.cos(angle) * 72, fy + math.sin(angle) * 72)],
        fill=(186, 156, 92),
    )

# --- props --------------------------------------------------------------------------

drawables = []     # (cells, zone, draw(layer), shadow)
lights = []        # {"x", "y", "r", "kind", "zone"} in world pixels
smoke = []         # {"x", "y", "zone"}
water = {}
OUTLINE = (30, 26, 38)


def roof_rise(w, d):
    return 8 + 7 * min(w, d)


def register(cells, z, fn, shadow):
    gx, gy, w, d = cells
    open_cells = [(cx, cy) for cx in range(gx, gx + w) for cy in range(gy, gy + d) if (cx, cy) not in blocked]
    # A prop on a walkable cell is one citizens walk straight through, so mark its cells first.
    assert not open_cells, f"prop at {cells} stands on walkable cells {open_cells}"
    drawables.append((cells, z, fn, shadow))


def light(kind, x, y, r, z):
    lights.append({"x": round(x), "y": round(y), "r": r, "kind": kind, "zone": z})


def stone_plinth(d, wpx, ht, f):
    d.rectangle([0, ht - 5, wpx, ht], fill=shade((104, 98, 94), f))
    for x in range(0, wpx, 9):
        d.line([(x, ht - 5), (x, ht)], fill=shade((70, 66, 64), f))
    d.line([(0, ht - 5), (wpx, ht - 5)], fill=shade((140, 134, 128), f))


def draw_window(d, cx, cy, ww, wh, f, accent, shutters, flowers, slit=False):
    x0, y0 = int(cx - ww / 2), int(cy - wh / 2)
    x1, y1 = x0 + ww - 1, y0 + wh - 1
    frame = shade((70, 52, 42), f)
    d.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], fill=frame)
    for yy in range(y0, y1 + 1):
        t = (yy - y0) / max(wh - 1, 1)
        d.line([(x0, yy), (x1, yy)], fill=shade(mix((176, 214, 236), (62, 92, 130), t), f))
    if not slit:
        d.line([((x0 + x1) // 2, y0), ((x0 + x1) // 2, y1)], fill=frame)
        d.line([(x0, (y0 + y1) // 2), (x1, (y0 + y1) // 2)], fill=frame)
        d.point((x0 + 1, y0 + 1), fill=shade((240, 250, 255), f))
        d.point((x0 + 2, y0 + 2), fill=shade((220, 240, 252), f))
        d.rectangle([x0 - 2, y1 + 1, x1 + 2, y1 + 2], fill=shade((196, 188, 176), f))
        d.line([(x0 - 2, y1 + 2), (x1 + 2, y1 + 2)], fill=shade((120, 112, 104), f))
    if shutters and accent and not slit:
        for sx in (x0 - 3, x1 + 2):
            d.rectangle([sx, y0 - 1, sx + 1, y1 + 1], fill=shade(accent, f))
            d.line([(sx, y0), (sx, y1)], fill=shade(accent, f * 0.7))
    if flowers and not slit:
        d.rectangle([x0 - 1, y1 + 3, x1 + 1, y1 + 5], fill=shade((96, 66, 44), f))
        for k in range(x0, x1 + 1, 2):
            d.point((k, y1 + 2), fill=shade(random.choice(((236, 90, 120), (250, 214, 90), (250, 250, 250))), f))
            d.point((k, y1 + 3), fill=shade((70, 130, 70), f))


def draw_door(d, cx, bottom, dh, f):
    dw = 10
    x0, x1 = int(cx - dw / 2), int(cx + dw / 2) - 1
    top = bottom - dh
    d.rectangle([x0 - 2, top - 3, x1 + 2, bottom], fill=shade((200, 192, 178), f))
    d.rectangle([x0, top, x1, bottom], fill=shade((104, 68, 42), f))
    d.ellipse([x0 - 1, top - 4, x1 + 1, top + 4], fill=shade((200, 192, 178), f))
    d.ellipse([x0, top - 3, x1, top + 3], fill=shade((104, 68, 42), f))
    for x in range(x0 + 2, x1, 3):
        d.line([(x, top + 1), (x, bottom)], fill=shade((72, 46, 30), f))
    d.point((x1 - 1, bottom - dh // 2), fill=shade((236, 204, 100), f))
    d.rectangle([x0 - 3, bottom + 1, x1 + 3, bottom + 2], fill=shade((140, 134, 128), f))
    return cx + dw / 2 + 5, top + 3


def wall_tex(wpx, h, rh, style, color, accent, roof, f, door, stories, windows, flowers, slits):
    """One wall as a flat picture; returns (image, window centres, lantern centre). `rh > 0` adds a gable."""
    ht = h + rh
    y0 = rh
    body = Image.new("RGB", (wpx, ht), shade(color, f))
    d = ImageDraw.Draw(body)
    fh = max(18, (h - 9) / stories)
    if style == "brick":
        d.rectangle([0, 0, wpx, ht], fill=shade(mix(color, (60, 50, 46), 0.55), f))
        for row, y in enumerate(range(0, ht, 4)):
            shift = 3 if row % 2 else 0
            for x in range(-shift, wpx, 7):
                d.rectangle([x, y, x + 5, y + 2], fill=shade(jitter(color, 0.84, 1.12), f))
    elif style == "stone":
        d.rectangle([0, 0, wpx, ht], fill=shade(mix(color, (50, 50, 56), 0.5), f))
        for row, y in enumerate(range(0, ht, 7)):
            x = -random.randrange(0, 8) if row % 2 else 0
            while x < wpx:
                bw = random.randint(10, 16)
                stone = shade(jitter(color, 0.9, 1.1), f)
                d.rectangle([x + 1, y + 1, x + bw - 1, y + 6], fill=stone)
                d.line([(x + 1, y + 1), (x + bw - 1, y + 1)], fill=shade(stone, 1.16))
                x += bw
    else:
        for _ in range(wpx * ht // 7):
            d.point((random.randrange(wpx), random.randrange(ht)), fill=shade(jitter(color, 0.92, 1.06), f))
        if style == "timber":
            beam = shade((86, 58, 40), f)
            for s in range(stories + 1):
                by = int(y0 + h - 5 - fh * s)
                if y0 <= by < ht:
                    d.line([(0, by), (wpx, by)], fill=beam, width=2)
            for x in range(0, wpx + 1, 16):
                d.line([(x, y0), (x, ht)], fill=beam, width=2)
            for s in range(stories):
                for x in range(0, wpx - 8, 16):
                    by = int(y0 + h - 5 - fh * s)
                    d.line([(x + 2, by - 2), (x + 14, int(by - fh + 2))], fill=beam)
    d.line([(0, y0), (0, ht)], fill=shade(color, 0.55 * f))
    if rh == 0:
        d.rectangle([0, 0, wpx, 2], fill=shade(color, 0.6 * f))
    stone_plinth(d, wpx, ht - 1, f)
    mask = Image.new("L", (wpx, ht), 0)
    ImageDraw.Draw(mask).polygon([(0, ht), (0, y0), ((wpx - 1) / 2, 0), (wpx - 1, y0), (wpx - 1, ht)], fill=255)
    tex = body.convert("RGBA")
    tex.putalpha(mask)
    d = ImageDraw.Draw(tex)
    if rh:
        d.line([(0, y0), ((wpx - 1) / 2, 0)], fill=shade(roof, f), width=2)
        d.line([((wpx - 1) / 2, 0), (wpx - 1, y0)], fill=shade(roof, f * 0.8), width=2)
        if rh >= 18:
            cy = y0 - rh * 0.45
            d.ellipse([wpx / 2 - 4, cy - 4, wpx / 2 + 4, cy + 4], fill=shade((70, 52, 42), f))
            d.ellipse([wpx / 2 - 2, cy - 2, wpx / 2 + 2, cy + 2], fill=shade((190, 220, 240), f))

    found = []
    lantern = None
    if windows:
        cols = max(1, wpx // 20)
        ww, wh = (3, 10) if slits else (7, max(7, min(12, int(fh * 0.5))))
        for story in range(stories):
            cy = y0 + h - 5 - fh * (story + 0.5)
            for k in range(cols):
                cx = (k + 0.5) * wpx / cols
                if door and story == 0 and abs(cx - wpx / 2) < max(7, wpx / (2 * cols) * 0.9):
                    continue
                draw_window(d, cx, cy, ww, wh, f, accent, style != "stone", flowers and story == 0, slits)
                found.append((cx, cy))
    if door:
        dh = max(11, min(16, int(fh * 0.8)))
        lantern = draw_door(d, wpx / 2, y0 + h - 6, dh, f)
        lx, ly = int(lantern[0]), int(lantern[1])
        d.rectangle([lx - 1, ly - 2, lx + 1, ly + 2], fill=(255, 226, 140))
        d.point((lx, ly - 3), fill=(60, 52, 48))
    return tex, found, lantern


def roof_tex(wpx, hpx, color, f, triangle=False, cap=True):
    tex = Image.new("RGBA", (wpx, hpx), shade(color, f) + (255,))
    d = ImageDraw.Draw(tex)
    for row, y in enumerate(range(0, hpx, 5)):
        d.rectangle([0, y, wpx, y + 4], fill=shade(jitter(color, 0.9, 1.08), f))
        d.line([(0, y + 4), (wpx, y + 4)], fill=shade(color, 0.62 * f))
        shift = 4 if row % 2 else 0
        for x in range(-shift, wpx, 8):
            d.line([(x, y), (x, y + 3)], fill=shade(color, 0.72 * f))
    for _ in range(wpx * hpx // 40):
        d.point((random.randrange(wpx), random.randrange(hpx)), fill=shade(jitter(color, 0.8, 1.2), f))
    if cap:
        d.rectangle([0, 0, wpx, 2], fill=shade(color, 1.3 * f))
    if triangle:
        mask = Image.new("L", (wpx, hpx), 0)
        ImageDraw.Draw(mask).polygon([(0, hpx), (wpx, hpx), (wpx / 2, 0)], fill=255)
        tex.putalpha(mask)
    return tex


def chimney(d, x, y):
    d.rectangle([x - 4, y - 14, x + 4, y + 5], fill=(122, 84, 68))
    d.rectangle([x - 4, y - 14, x - 2, y + 5], fill=(92, 62, 52))
    for k in range(-12, 4, 4):
        d.line([(x - 4, y + k), (x + 4, y + k)], fill=(86, 58, 48))
    d.rectangle([x - 6, y - 17, x + 6, y - 14], fill=(150, 146, 140))
    d.rectangle([x - 6, y - 17, x - 3, y - 14], fill=(112, 108, 104))
    d.rectangle([x - 3, y - 17, x + 3, y - 16], fill=(40, 34, 36))


def flag(d, x, y, color):
    d.line([(x, y), (x, y - 26)], fill=OUTLINE, width=2)
    d.polygon([(x + 1, y - 26), (x + 13, y - 24), (x + 16, y - 21), (x + 13, y - 18), (x + 1, y - 17)], fill=color, outline=OUTLINE)
    d.line([(x + 3, y - 23), (x + 12, y - 22)], fill=shade(color, 1.3))
    d.ellipse([x - 2, y - 29, x + 2, y - 25], fill=(240, 210, 90))


# Walls are drawn this much taller than the numbers below, so citizens (about 46 px) stay clearly
# smaller than a house. The grand hall at (0, 0) is the limit: any taller and its flag leaves the picture.
HEIGHT_SCALE = 1.5


def building(gx, gy, w, dep, h, color, roof, style="plaster", accent=None, roof_kind=None, stories=None,
             windows=True, door=True, chimney_on=False, flag_color=None, flowers=False, slits=False, rh=None, beacon=False):
    z = zone(gx + w // 2, gy + dep // 2)
    for cx in range(gx, gx + w):
        for cy in range(gy, gy + dep):
            blocked.add((cx, cy))
    kind = roof_kind or ("pyramid" if w == dep else "gable")
    ridge_ew = w >= dep                       # a gable ridge runs along the longer side
    h = round(h * HEIGHT_SCALE)
    rise = rh if rh is not None else roof_rise(w, dep)
    if kind == "gable" and ridge_ew:
        rise = min(rise, dep * TH // 2 - 8)   # the back slope must stay visible above the front one
    n_stories = stories or max(1, round(h / 30))
    total = h + rise

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x0, yb = iso(gx, gy)                  # back-left corner on the ground
        x1, yf = iso(gx + w, gy + dep)        # front-right corner on the ground
        xc, ym = (x0 + x1) / 2, (yb + yf) / 2
        wpx = w * TW
        gh = rise if (kind == "gable" and not ridge_ew) else 0
        tex, wins, lantern = wall_tex(
            wpx, h, gh, style, color, accent, roof, 1.0,
            door=door, stories=n_stories, windows=windows, flowers=flowers, slits=slits,
        )
        height = h + gh
        warp(layer, tex, [(0, height), (wpx, height), (0, 0)], [(x0, yf), (x1, yf), (x0, yf - height)])
        for cx, cy in wins:
            light("window", x0 + cx, yf - (height - cy), 18, z)
        if lantern:
            light("lantern", x0 + lantern[0], yf - (height - lantern[1]), 30, z)
        eave_back, eave_front = yb - h, yf - h
        if kind == "pyramid":
            apex = (xc, ym - h - rise)
            facets = (
                ((x0, eave_back), (x1, eave_back), wpx, 0.7),
                ((x0, eave_front), (x0, eave_back), dep * TH, 0.8),
                ((x1, eave_back), (x1, eave_front), dep * TH, 0.9),
                ((x0, eave_front), (x1, eave_front), wpx, 1.0),
            )
            for a, b, length, f in facets:
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                hpx = int(math.hypot(apex[0] - mid[0], apex[1] - mid[1])) + 1
                warp(layer, roof_tex(length, hpx, roof, f, triangle=True, cap=False),
                     [(0, hpx), (length, hpx), (length / 2, 0)], [a, b, apex])
            d.line([(x0, eave_front), (x1, eave_front)], fill=shade(roof, 0.45), width=2)
            ridge = apex
        elif ridge_ew:
            yr = ym - h - rise
            hs = int(eave_front - yr)
            hn = max(int(yr - eave_back), 1)
            warp(layer, roof_tex(wpx, hn, roof, 0.78), [(0, hn), (wpx, hn), (0, 0)], [(x0, eave_back), (x1, eave_back), (x0, yr)])
            warp(layer, roof_tex(wpx, hs, roof, 1.0), [(0, hs), (wpx, hs), (0, 0)], [(x0, eave_front), (x1, eave_front), (x0, yr)])
            d.line([(x0, yr), (x1, yr)], fill=shade(roof, 1.3), width=1)
            d.line([(x0, eave_front), (x1, eave_front)], fill=shade(roof, 0.45), width=2)
            ridge = (x0 + (x1 - x0) * 0.7, yr)
        else:
            run = int(xc - x0)
            length = dep * TH
            warp(layer, roof_tex(length, run, roof, 0.8), [(0, run), (length, run), (0, 0)], [(x0, eave_back), (x0, eave_front), (xc, eave_back - rise)])
            warp(layer, roof_tex(length, run, roof, 1.0), [(0, run), (length, run), (0, 0)], [(x1, eave_back), (x1, eave_front), (xc, eave_back - rise)])
            d.line([(xc, eave_back - rise), (xc, eave_front - rise)], fill=shade(roof, 1.3), width=1)
            d.line([(x0, eave_front), (x1, eave_front)], fill=shade(roof, 0.45), width=2)
            ridge = (xc, eave_back - rise + (eave_front - eave_back) * 0.3)
        d.line([(x0, yf), (x1, yf)], fill=shade(color, 0.5), width=1)
        if chimney_on:
            cx, cy = ridge[0], ridge[1] + (6 if kind == "pyramid" else 2)
            chimney(d, cx, cy)
            smoke.append({"x": round(cx), "y": round(cy - 19), "zone": z})
        if flag_color:
            flag(d, ridge[0], ridge[1] + 2, flag_color)
        if beacon:
            light("lamp", xc, ym - h - rise + 6, 110, z)

    register((gx, gy, w, dep), z, draw, ("box", gx, gy, w, dep, total))


def tree(gx, gy, color=(58, 126, 66), pine=False):
    z = zone(gx, gy)
    blocked.add((gx, gy))
    cx0, cy0 = icenter(gx, gy)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x, y = cx0, cy0 + 4
        d.polygon([(x - 4, y + 3), (x + 4, y + 3), (x + 2, y - 16), (x - 2, y - 16)], fill=(92, 62, 42))
        d.polygon([(x, y + 3), (x + 4, y + 3), (x + 2, y - 16), (x, y - 16)], fill=(120, 84, 56))
        if pine:
            for i, (ty, half) in enumerate(((-12, 20), (-26, 16), (-40, 11))):
                for sign, tone in ((-1, shade(color, 0.62)), (1, shade(color, 0.95))):
                    d.polygon([(x, y + ty - 22 + i * 3), (x, y + ty), (x + sign * half, y + ty)], fill=tone)
                d.line([(x - half, y + ty), (x + half, y + ty)], fill=shade(color, 0.45))
            return
        blobs = [(0, -30, 16), (-10, -23, 11), (10, -23, 11), (0, -16, 12), (-5, -40, 10), (7, -37, 9)]
        for dx, dy, r in blobs:
            d.ellipse([x + dx - r, y + dy - r, x + dx + r, y + dy + r], fill=shade(color, 0.62))
        for dx, dy, r in blobs:
            d.ellipse([x + dx - r + 2, y + dy - r - 1, x + dx + r + 1, y + dy + r - 3], fill=shade(color, 0.95))
        for dx, dy, r in blobs:
            d.ellipse([x + dx - r // 2 + 4, y + dy - r - 2, x + dx + r // 2 + 5, y + dy - r // 3], fill=shade(color, 1.28))
        alpha = layer.getchannel("A")
        for _ in range(70):
            px, py = int(x + random.randint(-24, 24)), int(y + random.randint(-52, -8))
            if alpha.getpixel((px, py)) == 255:
                d.point((px, py), fill=shade(color, random.choice((0.7, 1.35))))

    register((gx, gy, 1, 1), z, draw, ("round", cx0 - 6, cy0 + 4, 20 if not pine else 14, 8))


def lamp(gx, gy):
    z = zone(gx, gy)
    blocked.add((gx, gy))
    cx0, cy0 = icenter(gx, gy)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x, y = cx0, cy0 + 2
        d.rectangle([x - 3, y - 2, x + 3, y + 2], fill=(60, 60, 74))
        d.rectangle([x - 1, y - 32, x + 1, y - 2], fill=(50, 50, 64))
        d.line([(x + 1, y - 32), (x + 1, y - 2)], fill=(86, 86, 102))
        d.polygon([(x - 5, y - 40), (x + 5, y - 40), (x + 3, y - 44), (x - 3, y - 44)], fill=(50, 50, 64))
        d.rectangle([x - 4, y - 40, x + 4, y - 31], fill=(255, 226, 140), outline=(50, 50, 64))
        d.line([(x - 2, y - 39), (x - 2, y - 33)], fill=(255, 250, 220))
        light("lamp", x, y - 36, 64, z)

    register((gx, gy, 1, 1), z, draw, ("round", cx0 - 3, cy0 + 3, 6, 3))


def fountain():
    for cell in ((19, 19), (19, 20), (20, 19), (20, 20)):
        blocked.add(cell)
    x, y = iso(20, 20)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        d.ellipse([x - 46, y - 18 + 8, x + 46, y + 20 + 8], fill=(98, 100, 112))
        d.ellipse([x - 46, y - 18, x + 46, y + 20], fill=(176, 180, 190), outline=(60, 64, 80))
        d.ellipse([x - 40, y - 14, x + 40, y + 16], fill=(120, 124, 136))
        d.ellipse([x - 37, y - 12, x + 37, y + 13], fill=(70, 150, 208))
        for k, tone in enumerate(((84, 164, 218), (100, 178, 228), (120, 192, 238))):
            d.ellipse([x - 30 + k * 6, y - 9 + k * 2, x + 30 - k * 6, y + 10 - k * 2], outline=tone)
        d.rectangle([x - 8, y - 30, x + 8, y - 2], fill=(150, 154, 166), outline=(60, 64, 80))
        d.rectangle([x + 1, y - 30, x + 8, y - 2], fill=(190, 194, 204))
        d.ellipse([x - 20, y - 24, x + 20, y - 8], fill=(170, 174, 186), outline=(60, 64, 80))
        d.ellipse([x - 16, y - 22, x + 16, y - 11], fill=(96, 168, 220))
        d.rectangle([x - 3, y - 50, x + 3, y - 24], fill=(150, 154, 166), outline=(60, 64, 80))
        d.ellipse([x - 10, y - 56, x + 10, y - 46], fill=(190, 226, 248), outline=(80, 130, 180))
        for dx in (-14, -8, 8, 14):
            d.line([(x + dx // 3, y - 50), (x + dx, y - 22)], fill=(214, 238, 252))

    water.update({"x": round(x), "y": round(y - 12)})
    register((19, 19, 2, 2), "plaza", draw, ("round", x - 8, y + 10, 46, 17))


def board():
    blocked.add((17, 17))
    cx0, cy0 = icenter(17, 17)

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x, y = cx0, cy0 + 4
        for px in (x - 12, x + 12):
            d.rectangle([px - 2, y - 28, px + 2, y + 2], fill=(86, 58, 40), outline=OUTLINE)
        d.rectangle([x - 18, y - 36, x + 18, y - 12], fill=(160, 110, 66), outline=OUTLINE)
        d.rectangle([x - 16, y - 34, x + 16, y - 14], fill=(130, 88, 54))
        for k, tone in enumerate(((240, 224, 184), (230, 210, 160), (244, 236, 210))):
            nx = x - 14 + k * 10
            off = (k % 2) * 2
            d.rectangle([nx, y - 32 + off, nx + 7, y - 20 + off], fill=tone, outline=(120, 96, 70))
            d.line([(nx + 1, y - 29 + off), (nx + 6, y - 29 + off)], fill=(110, 90, 70))
            d.line([(nx + 1, y - 26 + off), (nx + 5, y - 26 + off)], fill=(110, 90, 70))
        d.polygon([(x - 22, y - 36), (x + 22, y - 36), (x + 14, y - 44), (x - 14, y - 44)], fill=(120, 60, 54), outline=OUTLINE)

    register((17, 17, 1, 1), "plaza", draw, ("round", cx0 - 8, cy0 + 5, 20, 7))


def stall(gx, gy, awning):
    z = zone(gx, gy)
    blocked.add((gx, gy))
    cx0, cy0 = icenter(gx, gy)

    def draw(layer):
        wpx, ht = 44, 52
        tex = Image.new("RGBA", (wpx, ht), (0, 0, 0, 0))
        d = ImageDraw.Draw(tex)
        d.rectangle([0, 14, wpx, ht - 1], fill=(40, 34, 40))
        for px in (2, wpx - 4):
            d.rectangle([px, 8, px + 2, ht - 1], fill=(96, 66, 44))
        for x in range(0, wpx, 4):
            tone = awning if (x // 4) % 2 == 0 else (240, 236, 224)
            d.rectangle([x, 0, x + 3, 16], fill=tone)
            d.polygon([(x, 16), (x + 3, 16), (x + 1, 20)], fill=tone)
        d.line([(0, 0), (wpx, 0)], fill=shade(awning, 0.6))
        d.rectangle([0, 30, wpx, ht - 1], fill=(150, 104, 62), outline=OUTLINE)
        d.line([(0, 31), (wpx, 31)], fill=(190, 140, 90))
        for k in range(7):
            gxp = 4 + k * 6
            d.ellipse([gxp, 24, gxp + 4, 29], fill=random.choice(((220, 70, 60), (240, 190, 60), (110, 180, 80), (230, 120, 50))))
        for k in range(1, 6):
            d.line([(k * 7, 32), (k * 7, ht - 2)], fill=(110, 76, 46))
        s0 = (cx0 - 22, cy0 + 4)
        warp(layer, tex, [(0, ht), (wpx, ht), (0, 0)], [s0, (s0[0] + wpx, s0[1]), (s0[0], s0[1] - ht)])
        light("lantern", s0[0] + 30, s0[1] + 14 - ht + 4, 26, z)

    register((gx, gy, 1, 1), z, draw, ("round", cx0 - 8, cy0 + 6, 24, 9))


def crates(gx, gy):
    z = zone(gx, gy)
    blocked.add((gx, gy))
    cx0, cy0 = icenter(gx, gy)

    def cube(d, cx, cy, size, height, color):
        top = [(cx, cy - height - size / 2), (cx + size, cy - height), (cx, cy - height + size / 2), (cx - size, cy - height)]
        d.polygon([(cx - size, cy - height), (cx, cy - height + size / 2), (cx, cy + size / 2), (cx - size, cy)], fill=shade(color, 0.72), outline=OUTLINE)
        d.polygon([(cx, cy - height + size / 2), (cx + size, cy - height), (cx + size, cy), (cx, cy + size / 2)], fill=color, outline=OUTLINE)
        d.polygon(top, fill=shade(color, 1.2), outline=OUTLINE)
        d.line([(cx - size, cy - height / 2), (cx, cy - height / 2 + size / 2)], fill=shade(color, 0.5))
        d.line([(cx, cy - height / 2 + size / 2), (cx + size, cy - height / 2)], fill=shade(color, 0.7))

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x, y = cx0, cy0
        cube(d, x - 7, y + 3, 9, 11, (176, 128, 76))
        cube(d, x + 7, y + 5, 8, 9, (156, 112, 68))
        cube(d, x - 2, y - 3, 8, 11, (190, 142, 84))
        d.ellipse([x + 4, y - 10, x + 18, y - 4], fill=(120, 80, 50), outline=OUTLINE)
        d.rectangle([x + 4, y - 5, x + 18, y + 4], fill=(110, 74, 46), outline=OUTLINE)
        d.line([(x + 4, y - 1), (x + 18, y - 1)], fill=(60, 56, 64))
        d.line([(x + 4, y + 2), (x + 18, y + 2)], fill=(60, 56, 64))

    register((gx, gy, 1, 1), z, draw, ("round", cx0 - 6, cy0 + 7, 20, 7))


def wall(gx, gy):
    blocked.add((gx, gy))

    def draw(layer):
        d = ImageDraw.Draw(layer)
        x0, yb = iso(gx, gy)
        x1, yf = iso(gx + 1, gy + 1)
        h = 22
        tex, _, _ = wall_tex(TW, h, 0, "stone", (156, 156, 164), None, (150, 150, 158), 1.0, False, 1, False, False, False)
        warp(layer, tex, [(0, h), (TW, h), (0, 0)], [(x0, yf), (x1, yf), (x0, yf - h)])
        d.rectangle([x0, yb - h, x1, yf - h], fill=(182, 182, 190), outline=(100, 100, 112))
        for px in (x0, x1):
            d.rectangle([px - 3, yb - h - 4, px + 3, yb - h], fill=(170, 170, 178), outline=(90, 92, 104))

    register((gx, gy, 1, 1), "road", draw, ("box", gx, gy, 1, 1, 24))


# --- the layout --------------------------------------------------------------------


def mission_cells():
    """Cells the mock missions send citizens to; nothing may be built on or next to them."""
    import re

    text = (ROOT / "apps/web/src/lib/data/mock/mockSnapshot.ts").read_text()
    return {(int(a), int(b)) for a, b in re.findall(r"cell: \[(\d+), (\d+)\]", text)}


RESERVED = mission_cells()
rng = random.Random(11)


def old(gx, gy, *args, **kwargs):
    """A building of the original 26x26 town, moved to its place on the larger island."""
    building(gx + SHIFT, gy + SHIFT, *args, **kwargs)


def can_place(gx, gy, w, d, zones, margin=1):
    for cx in range(gx, gx + w):
        for cy in range(gy, gy + d):
            if not (0 <= cx < N and 0 <= cy < N) or zone(cx, cy) not in zones or (cx, cy) in blocked:
                return False
            if any((cx + dx, cy + dy) in RESERVED for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                return False
    for cx in range(gx - margin, gx + w + margin):
        for cy in range(gy - margin, gy + d + margin):
            if (cx, cy) in blocked:
                return False
    return True


# the size of a house sets its height before HEIGHT_SCALE: (width, depth, lowest, highest)
SIZES = ((2, 2, 30, 40), (2, 2, 30, 40), (3, 2, 36, 46), (2, 3, 36, 46), (3, 3, 50, 60), (2, 1, 22, 28))
PALETTE = {
    "hearth": dict(styles=("timber", "plaster", "plaster"), walls=((224, 200, 164), (230, 210, 172), (238, 216, 178), (220, 196, 160)),
                   roofs=((176, 84, 60), (196, 110, 70), (210, 140, 70), (170, 80, 66)),
                   accents=((60, 100, 70), (70, 110, 150), (150, 60, 60), (70, 120, 90)), flowers=True, chimney=0.45),
    "archive": dict(styles=("stone", "stone", "plaster"), walls=((176, 168, 150), (172, 164, 148), (182, 172, 154)),
                    roofs=((62, 104, 156), (70, 112, 162), (84, 124, 170)), accents=((60, 90, 140),), flowers=False, chimney=0.1),
    "forge": dict(styles=("brick",), walls=((158, 118, 98), (164, 124, 100), (170, 130, 104)),
                  roofs=((92, 72, 64), (104, 80, 66), (124, 94, 70)), accents=((60, 50, 46),), flowers=False, chimney=0.7),
    "watch": dict(styles=("stone",), walls=((160, 160, 170), (168, 168, 176)),
                  roofs=((92, 98, 116), (84, 88, 104), (176, 66, 66)), accents=((90, 92, 110),), flowers=False, chimney=0.0),
    "summit": dict(styles=("stone",), walls=((226, 222, 210), (218, 214, 204)),
                   roofs=((150, 60, 66), (176, 66, 66), (200, 160, 70)), accents=((150, 60, 66),), flowers=False, chimney=0.0),
}
GREENS = ((58, 126, 66), (66, 134, 62), (50, 112, 70), (78, 140, 60))


def scatter(zone_name, count, sizes=SIZES, tries=4000):
    palette = PALETTE[zone_name]
    placed = 0
    for _ in range(tries):
        if placed >= count:
            break
        w, d, lo, hi = rng.choice(sizes)
        gx, gy = rng.randrange(N - w + 1), rng.randrange(N - d + 1)
        if not can_place(gx, gy, w, d, (zone_name,)):
            continue
        building(
            gx, gy, w, d, rng.randint(lo, hi), rng.choice(palette["walls"]), rng.choice(palette["roofs"]),
            style=rng.choice(palette["styles"]), accent=rng.choice(palette["accents"]),
            roof_kind=rng.choice(("gable", "gable", "pyramid")) if w == d else "gable",
            stories=2 if hi >= 36 else 1, flowers=palette["flowers"] and rng.random() < 0.6,
            chimney_on=rng.random() < palette["chimney"], slits=zone_name == "watch" and rng.random() < 0.3,
        )
        placed += 1
    print("placed", placed, zone_name, "buildings")


def scatter_trees(zones, count, pine=False, colors=GREENS, tries=6000):
    placed = 0
    for _ in range(tries):
        if placed >= count:
            break
        gx, gy = rng.randrange(N), rng.randrange(N)
        if not can_place(gx, gy, 1, 1, zones, margin=0):
            continue
        tree(gx, gy, rng.choice(colors), pine=pine)
        placed += 1


def scatter_crates(zones, count, tries=3000):
    placed = 0
    for _ in range(tries):
        if placed >= count:
            break
        gx, gy = rng.randrange(N), rng.randrange(N)
        if not can_place(gx, gy, 1, 1, zones, margin=0):
            continue
        crates(gx, gy)
        placed += 1


# the wall between the watch and the frontier, with its gate
for gx in range(22, N):
    gy = 55 - gx
    if 21 <= gy < N and (gx, gy) not in GATE:
        wall(gx, gy)

# plaza
fountain()
board()
stall(21, 21, (200, 60, 56))
stall(21, 17, (60, 110, 190))
stall(17, 21, (80, 160, 90))

# the original town
old(5, 5, 3, 3, 56, (176, 168, 150), (62, 104, 156), style="stone", accent=(60, 90, 140), stories=3, flag_color=(240, 210, 90))
old(8, 2, 2, 2, 38, (172, 164, 148), (70, 112, 162), style="stone", accent=(60, 90, 140), stories=2, roof_kind="gable")
old(2, 7, 2, 2, 34, (172, 164, 148), (70, 112, 162), style="stone", accent=(60, 90, 140), stories=2, roof_kind="gable")
old(7, 7, 2, 1, 26, (182, 172, 154), (84, 124, 170), style="plaster", accent=(60, 90, 140), stories=1)
old(0, 0, 3, 3, 64, (226, 222, 210), (150, 60, 66), style="stone", accent=(150, 60, 66), stories=3, flag_color=(250, 220, 90), rh=34)
old(2, 14, 2, 2, 34, (224, 200, 164), (176, 84, 60), style="timber", accent=(60, 100, 70), stories=2, chimney_on=True, flowers=True, roof_kind="gable")
old(5, 14, 2, 2, 30, (230, 210, 172), (196, 110, 70), style="plaster", accent=(70, 110, 150), stories=2, flowers=True, roof_kind="gable")
old(2, 18, 2, 2, 34, (224, 200, 164), (170, 80, 66), style="timber", accent=(150, 60, 60), stories=2, chimney_on=True, roof_kind="gable")
old(7, 17, 3, 2, 38, (238, 216, 178), (210, 140, 70), style="plaster", accent=(70, 120, 90), stories=2, flowers=True)
old(14, 2, 3, 2, 46, (158, 118, 98), (92, 72, 64), style="brick", accent=(60, 50, 46), stories=2, chimney_on=True)
old(18, 3, 2, 3, 42, (164, 124, 100), (104, 80, 66), style="brick", accent=(60, 50, 46), stories=2, chimney_on=True)
old(15, 6, 2, 2, 30, (170, 130, 104), (124, 94, 70), style="brick", accent=(60, 50, 46), stories=1, roof_kind="gable")
old(21, 7, 2, 2, 34, (158, 118, 98), (92, 72, 64), style="brick", accent=(60, 50, 46), stories=2, chimney_on=True, roof_kind="gable")
old(17, 17, 2, 2, 84, (168, 168, 176), (176, 66, 66), style="stone", slits=True, stories=4, flag_color=(236, 236, 240), rh=30)
old(14, 19, 2, 2, 30, (160, 160, 170), (92, 98, 116), style="stone", accent=(90, 92, 110), stories=1, roof_kind="gable")
for gx, gy, hh in ((21, 22, 14), (23, 19, 20), (19, 24, 26), (24, 23, 14)):
    old(gx, gy, 1, 1, hh, (186, 164, 124), (160, 132, 84), style="plaster", windows=False, rh=12)

# the lighthouse on the far point of the beach, and the beach huts around it
building(36, 36, 2, 2, 78, (240, 238, 232), (176, 66, 66), style="stone", slits=True, stories=4, rh=26, beacon=True,
         flag_color=(236, 236, 240))
huts = 0
for _ in range(400):
    gx, gy = rng.randrange(N), rng.randrange(N)
    if not can_place(gx, gy, 1, 1, ("frontier",)):
        continue
    huts += 1
    if huts > 18:
        break
    building(gx, gy, 1, 1, rng.choice((14, 20, 26)), (186, 164, 124), (160, 132, 84), style="plaster", windows=False, rh=12)

# houses, halls and workshops filling every district
scatter("archive", 11)
scatter("hearth", 14)
scatter("forge", 14)
scatter("watch", 8)
scatter("summit", 7, sizes=((3, 3, 50, 60), (3, 2, 40, 50), (2, 2, 34, 42), (3, 3, 50, 60)))

# green, from orchards to pines on the heights
scatter_trees(("archive",), 40)
scatter_trees(("hearth",), 55)
scatter_trees(("forge",), 18, colors=((66, 112, 62), (90, 124, 62)))
scatter_trees(("watch",), 24)
scatter_trees(("summit", "archive"), 26, pine=True, colors=((46, 96, 70), (40, 86, 64)))
scatter_trees(("forge", "watch"), 12, pine=True, colors=((46, 96, 70),))
scatter_trees(("frontier",), 14, colors=((120, 140, 70), (132, 150, 76)))
scatter_crates(("forge",), 5)
scatter_crates(("hearth",), 4)
scatter_crates(("watch",), 3)
scatter_crates(("frontier",), 6)

# lamps beside both roads and around the plaza
for gx, gy in ((18, 17), (22, 18), (17, 22), (22, 22), (19, 14), (26, 21), (21, 26), (14, 21)):
    lamp(gx, gy)
for i in range(2, N - 2, 4):
    for gx, gy in ((i, 18), (i, 21), (18, i), (21, i)):
        if zone(gx, gy) in ("plaza", "road", "frontier") or (gx, gy) in blocked or (gx, gy) in RESERVED:
            continue
        lamp(gx, gy)

# the district must stay one connected space: report what a citizen could not reach
reach = set()
queue = [(18, 18)]
while queue:
    cx, cy = queue.pop()
    if (cx, cy) in reach or not (0 <= cx < N and 0 <= cy < N) or (cx, cy) in blocked:
        continue
    reach.add((cx, cy))
    queue.extend(((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)))
cut_off = [c for c in RESERVED if c not in reach]
assert not cut_off, f"mission cells cut off from the plaza: {cut_off}"
print("reachable cells", len(reach), "of", N * N - len(blocked))

# --- shadows ------------------------------------------------------------------------

for cells, z, fn, shadow in drawables:
    if shadow[0] == "box":
        _, gx, gy, w, dep, total = shadow
        base = [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + dep), iso(gx, gy + dep)]
        length = min(total * 0.62, 60)
        moved = [(x + length * 0.9, y + length * 0.2) for x, y in base]
        shadow_draw.polygon(hull(base + moved), fill=(10, 18, 34, 78))
    else:
        _, sx, sy, rx, ry = shadow
        shadow_draw.ellipse([sx - rx, sy - ry, sx + rx, sy + ry], fill=(10, 18, 34, 78))
ground.alpha_composite(shadow_layer)

# shore foam around the island
island = ids.point(lambda v: 255 if v else 0)
ring = ImageChops.subtract(island.filter(ImageFilter.MaxFilter(9)), island)
speck = Image.new("L", (W, H), 0)
sd = ImageDraw.Draw(speck)
for _ in range(W * H // 110):
    sd.point((random.randrange(W), random.randrange(H)), fill=255)
foam = ImageChops.multiply(ring, speck)
ground.paste(Image.new("RGBA", (W, H), (150, 206, 214, 255)), (0, 0), foam)

# --- lock tint ----------------------------------------------------------------------


def dim(picture):
    """The locked look: grey, darkened toward blue-black. Used for the ground and the props."""
    gray = picture.convert("L")
    rgb = Image.merge("RGB", (
        Image.blend(gray, Image.new("L", picture.size, 18), 0.5),
        Image.blend(gray, Image.new("L", picture.size, 26), 0.5),
        Image.blend(gray, Image.new("L", picture.size, 40), 0.5),
    ))
    if picture.mode == "RGBA":
        rgb.putalpha(picture.getchannel("A"))
    return rgb


# --- props: each drawable alone on a transparent layer, packed into one sheet ----------
pieces = []
for (fx, fy, fw, fd), z, fn, _shadow in sorted(drawables, key=lambda t: sum(t[0])):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fn(layer)
    layer = outlined(layer)
    bbox = layer.getbbox()
    if not bbox:
        continue
    piece = layer.crop(bbox)
    entry = {"image": piece, "at": [bbox[0], bbox[1]], "cells": [fx, fy, fw, fd], "zone": z}
    if z in LOCKABLE:
        entry["dimmed"] = dim(piece)
    pieces.append(entry)

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

# --- export -------------------------------------------------------------------------
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
sheet.save(IMAGE_DIR / "city-props.png", optimize=True)
big = ground.convert("RGB")
big.save(IMAGE_DIR / "city-base.png", optimize=True)
dimmed = dim(big)
for name in LOCKABLE:
    mask = ids.point(lambda v, z=ZONE_IDS[name]: 255 if v == z else 0)
    layer = Image.new("RGBA", big.size, (0, 0, 0, 0))
    layer.paste(dimmed, (0, 0), mask)
    layer.save(IMAGE_DIR / f"lock-{name}.png", optimize=True)

cells = [[zone(gx, gy) for gx in range(N)] for gy in range(N)]
spots = {}
labels = {}
for name in DISTRICTS:
    members = [(gx, gy) for gy in range(N) for gx in range(N) if cells[gy][gx] == name]
    cx = sum(c[0] for c in members) / len(members)
    cy = sum(c[1] for c in members) / len(members)
    free = sorted((c for c in members if c not in blocked), key=lambda c: (c[0] - cx) ** 2 + (c[1] - cy) ** 2)
    chosen = []
    for c in free:
        if c not in reach:
            continue
        if all(abs(c[0] - o[0]) + abs(c[1] - o[1]) >= 4 for o in chosen):
            chosen.append(c)
        if len(chosen) == 6:
            break
    spots[name] = [list(c) for c in (chosen or free[:4])]
    labels[name] = [round(cx, 2), round(cy, 2)]

layout = {
    "image": {"width": W * SCALE, "height": H * SCALE},
    "tile": {"width": TW * SCALE, "height": TH * SCALE},
    "origin": {"x": OX * SCALE, "y": OY * SCALE},
    "size": N,
    "cells": cells,
    "blocked": sorted([list(c) for c in blocked]),
    "spots": spots,
    "labels": labels,
    "lights": lights,
    "smoke": smoke,
    "water": water,
    "props": [{k: piece[k] for k in ("frame", "dimmedFrame", "at", "cells", "zone") if k in piece} for piece in pieces],
}
LAYOUT_FILE.parent.mkdir(parents=True, exist_ok=True)
LAYOUT_FILE.write_text(json.dumps(layout, separators=(",", ":")) + "\n")
print("wrote", IMAGE_DIR, LAYOUT_FILE, "props", len(pieces), "lights", len(lights), "smoke", len(smoke))
