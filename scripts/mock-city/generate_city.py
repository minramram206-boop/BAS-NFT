"""Generate the mock isometric city used until the final tileset exists (D-0021, D-0024).

Outputs, all committed:
  apps/web/public/images/city/city-base.png         the ground only, nothing dimmed
  apps/web/public/images/city/city-props.png        buildings, trees, lamps and walls packed in one sheet
  apps/web/public/images/city/lock-<district>.png   dimmed ground of one district, transparent elsewhere
  apps/web/src/game/cityLayout.json                  grid, districts, blocked cells, spots, labels and props

Props are separate from the ground so the scene can sort them against the
citizens: someone walking behind a house is hidden by it instead of being
drawn on its roof.

Requires Pillow. Run from the repository root:
  python3 scripts/mock-city/generate_city.py
"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
IMAGE_DIR = ROOT / "apps/web/public/images/city"
LAYOUT_FILE = ROOT / "apps/web/src/game/cityLayout.json"

W, H = 640, 400          # drawn at half size, scaled x2 on export
TW, TH = 24, 12          # tile diamond at half size
OX, OY = 320, 64         # half-size position of the top corner of cell (0, 0)
N = 26
SCALE = 2
GATE = {(19, 20), (20, 19)}
LOCKABLE = ("watch", "frontier", "summit")
DISTRICTS = ("plaza", "archive", "hearth", "forge", "watch", "frontier", "summit")
ZONE_IDS = {name: index + 1 for index, name in enumerate(("road",) + DISTRICTS)}
random.seed(7)


def iso(gx, gy):
    return OX + (gx - gy) * TW / 2, OY + (gx + gy) * TH / 2


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3])


def zone(gx, gy):
    if 9 <= gx <= 14 and 9 <= gy <= 14:
        return "plaza"
    if gx + gy >= 40:
        return "frontier"
    if gx in (11, 12) or gy in (11, 12):
        return "road"
    if gx <= 3 and gy <= 3:
        return "summit"
    if gx < 11 and gy < 11:
        return "archive"
    if gx > 12 and gy < 11:
        return "forge"
    if gx < 11 and gy > 12:
        return "hearth"
    return "watch"


GROUND = {
    "plaza": (196, 201, 204), "road": (150, 140, 128), "archive": (104, 150, 92),
    "hearth": (112, 162, 88), "forge": (132, 120, 98), "watch": (108, 140, 94),
    "frontier": (196, 168, 112), "summit": (150, 168, 140),
}

img = Image.new("RGB", (W, H), (22, 38, 44))
ids = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(img)
di = ImageDraw.Draw(ids)
blocked = set()


def poly(points, fill, outline, zone_name):
    d.polygon(points, fill=fill, outline=outline)
    di.polygon(points, fill=ZONE_IDS[zone_name], outline=ZONE_IDS[zone_name])


def rect(box, fill, outline, zone_name):
    d.rectangle(box, fill=fill, outline=outline)
    di.rectangle(box, fill=ZONE_IDS[zone_name], outline=ZONE_IDS[zone_name])


def ellipse(box, fill, outline, zone_name):
    d.ellipse(box, fill=fill, outline=outline)
    di.ellipse(box, fill=ZONE_IDS[zone_name], outline=ZONE_IDS[zone_name])


for _ in range(1400):
    d.point((random.randrange(W), random.randrange(H)), fill=(28, 48, 52))

for gy in range(N):
    for gx in range(N):
        z = zone(gx, gy)
        base = GROUND[z]
        col = shade(base, random.choice((0.96, 1.0, 1.0, 1.04)))
        if z == "plaza" and (gx + gy) % 2:
            col = shade(base, 0.93)
        x, y = iso(gx, gy)
        poly([(x, y), (x + TW / 2, y + TH / 2), (x, y + TH), (x - TW / 2, y + TH / 2)], col, shade(base, 0.86), z)

for i in range(N):
    for gx, gy in ((i, N - 1), (N - 1, i)):
        x, y = iso(gx, gy)
        z = zone(gx, gy)
        if gy == N - 1:
            poly([(x - TW / 2, y + TH / 2), (x, y + TH), (x, y + TH + 10), (x - TW / 2, y + TH / 2 + 10)], (70, 58, 46), None, z)
        if gx == N - 1:
            poly([(x, y + TH), (x + TW / 2, y + TH / 2), (x + TW / 2, y + TH / 2 + 10), (x, y + TH + 10)], (88, 72, 56), None, z)

drawables = []
OUTLINE = (34, 30, 40)


def wall(gx, gy):
    blocked.add((gx, gy))

    def draw():
        x, y = iso(gx + 0.5, gy + 0.5)
        for box in ([x - 6, y - 10, x + 6, y + 2], [x - 6, y - 13, x - 3, y - 10], [x + 3, y - 13, x + 6, y - 10]):
            rect(box, (150, 150, 158), (70, 72, 84), "road")
    drawables.append(((gx, gy, 1, 1), "road", draw))


for gx in range(14, N):
    gy = 39 - gx
    if 13 <= gy < N and (gx, gy) not in GATE:
        wall(gx, gy)


def box(gx, gy, w, dep, h, wall_c, roof, windows=True, chimney=False, flag=None):
    z = zone(gx + w // 2, gy + dep // 2)
    for cx in range(gx, gx + w):
        for cy in range(gy, gy + dep):
            blocked.add((cx, cy))

    def draw():
        top, right, bottom, left = iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + dep), iso(gx, gy + dep)
        lf = [left, bottom, (bottom[0], bottom[1] - h), (left[0], left[1] - h)]
        rf = [bottom, right, (right[0], right[1] - h), (bottom[0], bottom[1] - h)]
        rt = [(p[0], p[1] - h) for p in (top, right, bottom, left)]
        poly(lf, shade(wall_c, 0.78), OUTLINE, z)
        poly(rf, wall_c, OUTLINE, z)
        poly(rt, roof, OUTLINE, z)
        if windows:
            for a, b, n in ((left, bottom, dep), (bottom, right, w)):
                for k in range(1, int(n * 2)):
                    if k % 2:
                        fx = a[0] + (b[0] - a[0]) * k / (n * 2)
                        fy = a[1] + (b[1] - a[1]) * k / (n * 2)
                        rect([fx - 1, fy - h * 0.62, fx + 1, fy - h * 0.62 + 3], (255, 220, 120), None, z)
        if chimney:
            cx, cy = rt[0][0] + 4, rt[0][1] + 4
            rect([cx - 2, cy - 10, cx + 2, cy], (90, 70, 60), OUTLINE, z)
            ellipse([cx - 4, cy - 18, cx + 3, cy - 11], (190, 190, 196), None, z)
        if flag:
            fx, fy = rt[0][0], rt[0][1] + 6
            d.line([fx, fy, fx, fy - 14], fill=OUTLINE)
            di.line([fx, fy, fx, fy - 14], fill=ZONE_IDS[z])
            rect([fx + 1, fy - 14, fx + 7, fy - 10], flag, None, z)
    drawables.append(((gx, gy, w, dep), z, draw))


def tree(gx, gy, c=(56, 120, 64)):
    z = zone(gx, gy)
    blocked.add((gx, gy))

    def draw():
        x, y = iso(gx + 0.5, gy + 0.5)
        rect([x - 1, y - 4, x + 1, y + 2], (92, 64, 44), None, z)
        ellipse([x - 6, y - 14, x + 6, y - 3], c, shade(c, 0.6), z)
        ellipse([x - 4, y - 18, x + 3, y - 10], shade(c, 1.15), shade(c, 0.6), z)
    drawables.append(((gx, gy, 1, 1), z, draw))


def lamp(gx, gy):
    z = zone(gx, gy)

    def draw():
        x, y = iso(gx + 0.5, gy + 0.5)
        d.line([x, y, x, y - 12], fill=(40, 40, 52))
        di.line([x, y, x, y - 12], fill=ZONE_IDS[z])
        rect([x - 2, y - 15, x + 2, y - 12], (255, 214, 110), (40, 40, 52), z)
    drawables.append(((gx, gy, 1, 1), z, draw))


def fountain():
    for cell in ((11, 11), (11, 12), (12, 11), (12, 12)):
        blocked.add(cell)

    def draw():
        x, y = iso(12, 12)
        ellipse([x - 16, y - 8, x + 16, y + 8], (150, 156, 168), (60, 64, 80), "plaza")
        ellipse([x - 12, y - 6, x + 12, y + 6], (92, 156, 210), None, "plaza")
        rect([x - 2, y - 14, x + 2, y], (170, 176, 188), (60, 64, 80), "plaza")
        ellipse([x - 5, y - 18, x + 5, y - 12], (140, 196, 236), None, "plaza")
    drawables.append(((11, 11, 2, 2), "plaza", draw))


def board():
    blocked.add((9, 9))

    def draw():
        x, y = iso(10, 10)
        rect([x - 1, y - 2, x + 1, y + 4], (80, 56, 40), None, "plaza")
        rect([x - 9, y - 16, x + 9, y - 2], (150, 104, 62), (54, 36, 26), "plaza")
        for k in range(3):
            rect([x - 6 + k * 5, y - 13, x - 3 + k * 5, y - 7], (236, 214, 170), None, "plaza")
    drawables.append(((9, 9, 1, 1), "plaza", draw))


fountain()
board()
box(5, 5, 3, 3, 26, (176, 168, 150), (62, 104, 156), flag=(240, 210, 90))
box(8, 2, 2, 2, 18, (168, 160, 146), (70, 112, 162))
box(2, 7, 2, 2, 16, (168, 160, 146), (70, 112, 162))
box(7, 7, 2, 1, 12, (180, 170, 152), (84, 124, 170))
box(0, 0, 3, 3, 34, (226, 222, 210), (150, 60, 66), flag=(250, 220, 90))
box(2, 14, 2, 2, 16, (220, 196, 160), (176, 84, 60), chimney=True)
box(5, 14, 2, 2, 14, (226, 206, 168), (196, 110, 70))
box(2, 18, 2, 2, 16, (220, 196, 160), (170, 80, 66), chimney=True)
box(7, 17, 3, 2, 18, (236, 214, 176), (210, 140, 70))
box(14, 2, 3, 2, 22, (150, 128, 108), (96, 74, 62), chimney=True)
box(18, 3, 2, 3, 20, (156, 134, 110), (110, 84, 66), chimney=True)
box(15, 6, 2, 2, 14, (164, 140, 116), (128, 96, 72))
box(21, 7, 2, 2, 16, (150, 128, 108), (96, 74, 62), chimney=True)
box(17, 17, 2, 2, 40, (164, 164, 172), (84, 88, 104), windows=False, flag=(200, 70, 70))
box(14, 19, 2, 2, 14, (156, 156, 166), (96, 100, 116))
for gx, gy in ((21, 22), (23, 19), (19, 24), (24, 23)):
    box(gx, gy, 1, 1, random.choice((6, 9, 12)), (176, 156, 120), (150, 132, 100), windows=False)
for gx, gy in ((6, 21), (8, 21), (4, 22), (1, 22), (9, 14), (5, 17), (4, 2), (1, 9), (9, 5), (14, 9),
               (20, 1), (23, 5), (16, 15), (21, 14), (10, 23)):
    tree(gx, gy)
for gx, gy in ((22, 20), (20, 22)):
    tree(gx, gy, (120, 132, 72))
for gx, gy in ((10, 9), (14, 10), (9, 14), (14, 14), (11, 5), (12, 18), (5, 11), (18, 12)):
    lamp(gx, gy)

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


# --- props: each drawable alone on a transparent layer, packed into one sheet ---
ground_draw, ground_ids = d, di
pieces = []
for (fx, fy, fw, fd), z, fn in sorted(drawables, key=lambda t: sum(t[0])):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    di = ImageDraw.Draw(Image.new("L", (W, H), 0))
    fn()
    bbox = layer.getbbox()
    if not bbox:
        continue
    piece = layer.crop(bbox)
    piece = piece.resize((piece.width * SCALE, piece.height * SCALE), Image.NEAREST)
    entry = {"image": piece, "at": [bbox[0] * SCALE, bbox[1] * SCALE], "cells": [fx, fy, fw, fd], "zone": z}
    if z in LOCKABLE:
        entry["dimmed"] = dim(piece)
    pieces.append(entry)
d, di = ground_draw, ground_ids

SHEET_WIDTH = 512
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

# --- export -------------------------------------------------------------------
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
sheet.save(IMAGE_DIR / "city-props.png", optimize=True)
big = img.resize((W * SCALE, H * SCALE), Image.NEAREST)
big.save(IMAGE_DIR / "city-base.png", optimize=True)
big_ids = ids.resize((W * SCALE, H * SCALE), Image.NEAREST)
dimmed = dim(big)
for name in LOCKABLE:
    mask = big_ids.point(lambda v, z=ZONE_IDS[name]: 255 if v == z else 0)
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
    spots[name] = [list(c) for c in free[:4]]
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
    "props": [{k: piece[k] for k in ("frame", "dimmedFrame", "at", "cells", "zone") if k in piece} for piece in pieces],
}
LAYOUT_FILE.parent.mkdir(parents=True, exist_ok=True)
LAYOUT_FILE.write_text(json.dumps(layout, separators=(",", ":")) + "\n")
print("wrote", IMAGE_DIR, LAYOUT_FILE)
