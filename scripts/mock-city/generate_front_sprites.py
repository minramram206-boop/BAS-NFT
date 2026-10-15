#!/usr/bin/env python3
"""Draw the straight-on front view of the ten active citizens' map sprites.

The map sprite of a citizen (`<id>.png`) is a three-quarter portrait that looks to the right.
That reads well when the citizen walks sideways, but walking down the screen needs a figure
that faces the viewer. Each front sprite here is drawn from shapes: a symmetric head, a pair of
eyes looking ahead, the nose and mouth in the middle, and the clothes, in the colours of the
portrait. Things a citizen holds (the drink, the mug, the gas bottle, the wheat) are copied from
the portrait so they keep their original look.

This is placeholder art made in code, like the rest of the mock city (D-0024). Artist-made front
sprites replace it: write the same file names and the scene picks them up.

Writes `apps/web/public/sprites/citizens/<id>-front.png` and adds `"spriteFront"` to each
citizen in `content/en/citizens.json`. Output is deterministic.

Usage: python scripts/mock-city/generate_front_sprites.py
Needs Pillow, NumPy and SciPy.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
SPRITES = ROOT / "apps/web/public/sprites/citizens"
sys.path.insert(0, str(ROOT / "scripts"))
from import_back_sprites import CONTENT, add_field  # noqa: E402

SIZE = 128
OUTLINE = (20, 16, 20)
GROUND_SHADOW = (176, 186, 196)

YELLOW = (253, 214, 52)
YELLOW_DARK = (222, 164, 24)


def shifted(mask, dx, dy):
    """The mask moved by (dx, dy); pixels that leave the canvas are dropped."""
    out = np.zeros_like(mask)
    out[max(dy, 0) : SIZE + min(dy, 0), max(dx, 0) : SIZE + min(dx, 0)] = mask[
        max(-dy, 0) : SIZE + min(-dy, 0), max(-dx, 0) : SIZE + min(-dx, 0)
    ]
    return out


def ellipse(cx, cy, rx, ry):
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    return ((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2 <= 1


def poly(points):
    image = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(image).polygon([tuple(p) for p in points], fill=255)
    return np.array(image) > 0


def box(x0, y0, x1, y1):
    mask = np.zeros((SIZE, SIZE), bool)
    mask[y0:y1, x0:x1] = True
    return mask


def stroke(points, width):
    """A thick polyline with round ends."""
    image = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(image).line([tuple(p) for p in points], fill=255, width=width)
    mask = np.array(image) > 0
    for x, y in (points[0], points[-1]):
        mask |= ellipse(x, y, width / 2, width / 2)
    return mask


def load(citizen):
    return np.array(Image.open(SPRITES / f"{citizen}.png").convert("RGBA"))


class Canvas:
    def __init__(self):
        self.im = np.zeros((SIZE, SIZE, 4), np.uint8)

    def put(self, mask, color):
        self.im[mask] = (*color, 255)

    def solid(self, mask, fill, shade=None, width=3, light=(4, 3)):
        """A shape with a dark outline, a flat fill and an optional shaded lower-right edge."""
        inner = ndi.binary_erosion(mask, iterations=width, border_value=0)
        self.put(mask & ~inner, OUTLINE)
        self.put(inner, fill)
        if shade is not None:
            self.put(inner & ~shifted(inner, -light[0], -light[1]), shade)

    def copy(self, source, region, dx=0, dy=0):
        """Copy the opaque pixels of `region` (x0, y0, x1, y1) of another sprite, moved by (dx, dy)."""
        x0, y0, x1, y1 = region
        mask = box(x0, y0, x1, y1) & (source[..., 3] > 0)
        ys, xs = np.where(mask)
        ty, tx = ys + dy, xs + dx
        inside = (ty >= 0) & (ty < SIZE) & (tx >= 0) & (tx < SIZE)
        self.im[ty[inside], tx[inside]] = source[ys[inside], xs[inside]]

    def save(self, path):
        Image.fromarray(self.im, "RGBA").save(path, optimize=True)


def eyes(c, cx, cy, gap, r, rim=2, pupil=(3, 4), look=0, white=(255, 255, 255), shade=(206, 222, 232), glasses=True, lid=None):
    """Two round eyes looking straight ahead; `lid` is (skin colour, rows) for heavy upper lids."""
    rows = np.mgrid[0:SIZE, 0:SIZE][0]
    for side in (-1, 1):
        x = cx + side * gap
        outer = ellipse(x, cy, r, r)
        inner = ndi.binary_erosion(outer, iterations=rim)
        c.put(outer & ~inner, OUTLINE)
        c.put(inner, white)
        c.put(inner & ~shifted(inner, -2, -2), shade)
        px = x + look
        c.put(ellipse(px, cy + 1.5, pupil[0], pupil[1]) & inner, (24, 20, 28))
        c.put(box(int(px - 2), int(cy - 1), int(px), int(cy + 1)) & inner, (255, 255, 255))
        if lid is not None:
            skin, count = lid
            top = inner & (rows < cy - r + rim + count)
            c.put(top, skin)
            edge = top & ~shifted(top, 0, -1)
            c.put(edge | shifted(edge, 0, -1), OUTLINE)
    if glasses:
        c.put(stroke([(cx - gap + r - 1, cy - 1), (cx + gap - r + 1, cy - 1)], 2), OUTLINE)


def nose(c, cx, cy, rx, ry, fill, shade):
    outer = ellipse(cx, cy, rx, ry)
    inner = ndi.binary_erosion(outer, iterations=2)
    c.put(inner, fill)
    c.put(inner & ~shifted(inner, -2, -2), shade)
    c.put(outer & ~inner & (np.mgrid[0:SIZE, 0:SIZE][0] >= cy), OUTLINE)


def mouth(c, x0, x1, y, droop=2, width=2):
    c.put(stroke([(x0, y), ((x0 + x1) / 2, y + droop), (x1, y)], width), OUTLINE)


def boots(c, xs, fill, shade, top=117):
    for x in xs:
        c.solid(poly([(x - 9, 127), (x - 8, top), (x + 5, top), (x + 9, top + 7), (x + 9, 127)]), fill, shade, width=2)


def hand(c, x, y, skin, shade):
    c.solid(ellipse(x, y, 7, 7), skin, shade, width=2)


def f1():
    c, portrait = Canvas(), load(1)
    skin, skin_d = (254, 246, 218), (226, 208, 170)
    gold, gold_d = (244, 190, 30), (190, 126, 20)
    c.put(ellipse(64, 123, 40, 4), GROUND_SHADOW)
    boots(c, (50, 78), (196, 120, 30), (140, 84, 20), top=112)
    c.solid(ellipse(64, 40, 42, 44), gold, gold_d)  # hood
    c.solid(poly([(22, 66), (40, 58), (88, 58), (106, 66), (112, 96), (112, 116), (16, 116), (16, 96)]), gold, gold_d)
    c.put(stroke([(64, 64), (64, 114)], 2), OUTLINE)
    for side in (-1, 1):
        c.solid(stroke([(64 + side * 40, 68), (64 + side * 46, 100)], 17), gold, gold_d)
        hand(c, 64 + side * 46, 104, skin, skin_d)
    c.solid(ellipse(64, 40, 31, 34), skin, skin_d)
    eyes(c, 64, 36, 14, 10, lid=(skin, 4))
    nose(c, 64, 52, 9, 7, skin, skin_d)
    mouth(c, 54, 74, 66, droop=-2)
    c.copy(portrait, (104, 62, 126, 98), dx=-12, dy=16)  # the beer, in the right hand
    c.copy(portrait, (76, 98, 128, 128), dx=-66, dy=-4)  # the wheat, in the left
    return c


def f13():
    c, portrait = Canvas(), load(13)
    cream, shade = (253, 252, 234), (226, 220, 192)
    c.solid(ellipse(64, 62, 56, 60), cream, shade)
    eyes(c, 64, 36, 22, 15, rim=3, pupil=(4, 6), lid=(cream, 4))
    nose(c, 64, 57, 11, 9, cream, shade)
    mouth(c, 36, 92, 76, droop=0, width=3)
    c.copy(portrait, (80, 78, 127, 114), dx=-39, dy=4)  # what they are eating
    return c


def f3():
    c, portrait = Canvas(), load(3)
    skin, skin_d = (254, 230, 167), (236, 196, 130)
    c.solid(poly([(4, 127), (4, 100), (14, 80), (38, 68), (90, 68), (114, 80), (124, 100), (124, 127)]), YELLOW, YELLOW_DARK)
    c.solid(ellipse(64, 70, 37, 14), (236, 184, 30), (200, 140, 20))  # hood
    c.solid(ellipse(64, 38, 30, 35), skin, skin_d)
    eyes(c, 64, 34, 14, 10, lid=(skin, 3))
    nose(c, 64, 50, 9, 7, skin, skin_d)
    mouth(c, 55, 73, 63, droop=-2)
    for x in (56, 72):
        c.put(stroke([(x, 80), (x - 1 if x < 64 else x + 1, 96)], 2), (250, 245, 225))  # drawstrings
    c.copy(portrait, (62, 86, 94, 128), dx=-14, dy=0)  # the drink
    hand(c, 50, 108, skin, skin_d)
    hand(c, 78, 108, skin, skin_d)
    return c


def f12():
    c = Canvas()
    skin, skin_d = (253, 236, 208), (232, 208, 170)
    robe, robe_d = (254, 246, 224), (226, 210, 176)
    scarf, scarf_d = (176, 132, 84), (128, 90, 52)
    c.solid(poly([(10, 127), (12, 100), (24, 82), (46, 72), (82, 72), (104, 82), (116, 100), (118, 127)]), robe, robe_d)
    c.solid(ellipse(64, 76, 38, 12), scarf, scarf_d)
    c.solid(poly([(78, 78), (96, 78), (98, 112), (80, 112)]), scarf, scarf_d, width=2)
    for x in (82, 88, 94):
        c.put(stroke([(x, 112), (x, 118)], 2), scarf_d)  # fringe
    c.solid(ellipse(64, 40, 36, 38), skin, skin_d)
    eyes(c, 64, 36, 15, 11, lid=(skin, 3))
    nose(c, 64, 54, 9, 7, skin, skin_d)
    mouth(c, 54, 74, 66, droop=-2)
    for x in (34, 94):
        hand(c, x, 112, skin, skin_d)
    return c


def f19():
    c = Canvas()
    skin, skin_d = (254, 243, 200), (232, 214, 168)
    blue, blue_d = (74, 128, 178), (46, 92, 140)
    c.solid(poly([(6, 124), (8, 94), (20, 74), (46, 66), (82, 66), (108, 74), (120, 94), (122, 124)]), blue, blue_d)
    c.solid(poly([(50, 68), (78, 68), (82, 124), (46, 124)]), skin, skin_d, width=2)  # shirt under the open jacket
    for x in (30, 98):
        c.put(stroke([(x, 80), (x, 118)], 2), blue_d)  # seams
    c.solid(ellipse(64, 70, 28, 9), blue, blue_d)  # collar
    c.solid(ellipse(64, 38, 33, 37), skin, skin_d)
    eyes(c, 64, 34, 14, 13, rim=3, pupil=(5, 7), glasses=False)
    nose(c, 64, 52, 6, 5, skin, skin_d)
    c.put(ellipse(64, 63, 10, 8), (46, 20, 30))  # open mouth
    c.put(ellipse(64, 67, 6, 4) & ellipse(64, 63, 9, 7), (210, 90, 90))  # tongue
    return c


def f4():
    c = Canvas()
    skin, skin_d = (253, 236, 200), (232, 200, 158)
    coat_d = (214, 156, 20)
    c.put(ellipse(64, 123, 38, 4), GROUND_SHADOW)
    for x in (52, 76):
        c.solid(box(x - 5, 104, x + 5, 120), skin, skin_d, width=2)  # legs
    boots(c, (52, 76), (176, 120, 40), (130, 88, 28))
    c.solid(poly([(28, 62), (42, 54), (86, 54), (100, 62), (104, 92), (108, 112), (20, 112), (24, 92)]), YELLOW, coat_d)
    c.put(stroke([(64, 60), (64, 110)], 2), OUTLINE)
    for y in (74, 86, 98):
        c.put(ellipse(70, y, 2.6, 2.6), (84, 56, 24))  # buttons
    for side in (-1, 1):
        c.solid(stroke([(64 + side * 34, 66), (64 + side * 41, 94)], 15), YELLOW, coat_d)
        hand(c, 64 + side * 42, 100, skin, skin_d)
    c.solid(ellipse(64, 56, 26, 9), (240, 190, 40), coat_d)  # folded hood
    c.solid(ellipse(64, 30, 28, 31), skin, skin_d)
    eyes(c, 64, 28, 13, 9, lid=(skin, 3))
    nose(c, 64, 41, 8, 6, skin, skin_d)
    mouth(c, 54, 74, 53, droop=-2)
    return c


def f2():
    c, portrait = Canvas(), load(2)
    cream, shade = (254, 250, 237), (228, 220, 198)
    strap, hose = (40, 52, 64), (40, 44, 52)
    c.copy(portrait, (92, 50, 128, 128))  # the gas bottle
    c.solid(ellipse(56, 56, 50, 54), cream, shade)
    eyes(c, 56, 32, 17, 12, pupil=(4, 5), lid=(cream, 2))
    nose(c, 56, 50, 8, 6, cream, shade)
    c.put(stroke([(41, 64), (9, 60)], 3), strap)
    c.put(stroke([(71, 64), (103, 60)], 3), strap)
    c.put(stroke([(62, 78), (70, 98), (86, 108), (97, 106)], 3), hose)
    c.solid(ellipse(56, 66, 16, 13), (150, 200, 220), (110, 160, 190), width=2)  # breathing mask
    c.put(ellipse(56, 68, 6, 5), (24, 24, 30))
    return c


def f8():
    c, portrait = Canvas(), load(8)
    body, body_d = (253, 234, 200), (228, 200, 158)
    c.solid(poly([(14, 127), (16, 100), (30, 82), (96, 82), (110, 100), (112, 127)]), body, body_d)
    c.solid(ellipse(60, 52, 44, 48), body, body_d)
    eyes(c, 60, 36, 15, 10, lid=(body, 3))
    nose(c, 60, 52, 9, 7, body, body_d)
    mouth(c, 48, 72, 68, droop=-2)
    for x0, x1 in ((40, 46), (80, 74)):
        c.put(stroke([(x0, 82), (x1, 100)], 2), (120, 80, 40))  # cord of the badge
    c.copy(portrait, (8, 94, 40, 122), dx=38)  # name badge
    c.copy(portrait, (66, 66, 114, 116), dx=14)  # mug
    c.copy(portrait, (100, 0, 128, 66))  # steam
    return c


def f11():
    c = Canvas()
    head, head_d = (254, 248, 230), (228, 220, 196)
    jacket, jacket_d = (58, 60, 66), (36, 38, 42)
    c.solid(poly([(8, 124), (10, 94), (22, 76), (46, 68), (82, 68), (106, 76), (118, 94), (120, 124)]), jacket, jacket_d)
    c.solid(poly([(52, 70), (76, 70), (80, 124), (48, 124)]), head, head_d, width=2)  # shirt
    for x in (22, 106):
        hand(c, x, 116, head, head_d)
    c.solid(ellipse(64, 72, 28, 9), jacket, jacket_d)  # collar
    c.solid(ellipse(64, 38, 34, 38), head, head_d)
    eyes(c, 64, 36, 16, 12, rim=3, pupil=(4, 5), lid=(head, 3))
    nose(c, 64, 54, 8, 6, head, head_d)
    mouth(c, 54, 74, 66, droop=2)
    return c


def f18():
    c = Canvas()
    body, body_d = (253, 238, 196), (226, 204, 158)
    cap, cap_d = (112, 72, 48), (80, 50, 32)
    c.solid(poly([(18, 127), (22, 100), (36, 84), (92, 84), (106, 100), (110, 127)]), body, body_d)
    c.solid(ellipse(64, 54, 42, 46), body, body_d)
    nose(c, 64, 62, 10, 8, body, body_d)
    mouth(c, 48, 80, 78, droop=0)
    c.solid(box(20, 38, 108, 52), (30, 24, 28), width=2)  # goggle strap
    eyes(c, 64, 46, 17, 13, rim=4, pupil=(4, 6), glasses=False)
    c.solid(ellipse(64, 28, 42, 28) & box(0, 0, SIZE, 40), cap, cap_d)
    for side in (-1, 1):
        c.solid(poly([(64 + side * 40, 30), (64 + side * 26, 36), (64 + side * 24, 74), (64 + side * 36, 80), (64 + side * 44, 62)]), cap, cap_d)  # ear flaps
    c.put(stroke([(22, 18), (106, 18)], 2), cap_d)
    return c


RECIPES = {1: f1, 13: f13, 3: f3, 12: f12, 19: f19, 4: f4, 2: f2, 8: f8, 11: f11, 18: f18}


def main() -> int:
    for citizen, draw in RECIPES.items():
        draw().save(SPRITES / f"{citizen}-front.png")
        if not any(add_field(file, citizen, "spriteFront", "front") for file in CONTENT):
            raise SystemExit(f"citizen {citizen} is not in the content files")
        print(f"ok  {citizen}-front.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
