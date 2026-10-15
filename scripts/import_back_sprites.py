#!/usr/bin/env python3
"""Turn generated back-view portraits into the 128 px map sprites the city scene uses.

Each input is a portrait of one citizen seen from behind on a flat #FF00FF background. The
first number in the file name is the citizen id, so `3.png`, `3-back.png` and `back_03.png`
all belong to citizen 3.

For every image the script:
  1. removes the magenta background (and the pink fringe it leaves on the outline),
  2. lays it on the same canvas as the citizen's profile art, so framing and feet line up,
  3. crops and scales it exactly the way the front map sprite was made from that art
     (crop to the art's bounds, fit 128 px, centred, feet on the bottom edge),
  4. writes `apps/web/public/sprites/citizens/<id>-back.png`,
  5. adds `"spriteBack"` to the citizen in `content/en/citizens.json` (or the archive file).

Re-running with the same inputs only rewrites the PNGs.

Usage: python scripts/import_back_sprites.py <folder with the generated images>
Needs Pillow and NumPy.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps/web/public"
CONTENT = [ROOT / "content/en/citizens.json", ROOT / "content/en/citizens.archive.json"]
SIZE = 128
EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg"}

# A pixel is background when it is clearly magenta: strong red and blue, weak green.
HARD_MAGENTA = 90
# Edge pixels that lean this far toward magenta are fringe, not art.
FRINGE_MAGENTA = 40


def magenta_amount(rgb: np.ndarray) -> np.ndarray:
    red, green, blue = (rgb[..., i].astype(int) for i in range(3))
    return np.minimum(red, blue) - green


def key_out_magenta(image: Image.Image) -> Image.Image:
    data = np.array(image.convert("RGBA"))
    amount = magenta_amount(data[..., :3])
    clear = amount > HARD_MAGENTA
    # One pass of fringe removal: pale-magenta pixels that touch the cleared background.
    near = np.zeros_like(clear)
    near[1:, :] |= clear[:-1, :]
    near[:-1, :] |= clear[1:, :]
    near[:, 1:] |= clear[:, :-1]
    near[:, :-1] |= clear[:, 1:]
    clear |= near & (amount > FRINGE_MAGENTA)
    data[clear, 3] = 0
    return Image.fromarray(data, "RGBA")


def front_transform(portrait: Image.Image) -> tuple[float, int, int, tuple[int, int, int, int]]:
    """Scale and offsets that turn the profile art into its map sprite."""
    box = portrait.getbbox()
    if box is None:
        raise ValueError("profile art is empty")
    width, height = box[2] - box[0], box[3] - box[1]
    scale = SIZE / max(width, height)
    new_width, new_height = max(1, round(width * scale)), max(1, round(height * scale))
    return scale, (SIZE - new_width) // 2, SIZE - new_height, box


def to_sprite(back: Image.Image, portrait: Image.Image) -> Image.Image:
    scale, offset_x, offset_y, box = front_transform(portrait)
    canvas = back.resize(portrait.size, Image.LANCZOS)
    scaled = canvas.resize((round(canvas.width * scale), round(canvas.height * scale)), Image.BICUBIC)
    sprite = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sprite.paste(scaled, (offset_x - round(box[0] * scale), offset_y - round(box[1] * scale)), scaled)
    return sprite


def citizen_id(path: Path) -> int | None:
    match = re.search(r"\d+", path.stem)
    return int(match.group()) if match else None


def add_field(content_file: Path, citizen: int, field: str = "spriteBack", suffix: str = "back") -> bool:
    """Insert a sprite field after the citizen's "sprite" line, keeping the file's formatting."""
    raw = content_file.read_bytes().decode("utf-8")
    if not any(entry["id"] == citizen for entry in json.loads(raw)):
        return False
    newline = "\r\n" if "\r\n" in raw else "\n"
    path = f"/sprites/citizens/{citizen}.png"
    pattern = re.compile(rf'^([ \t]*)"sprite": "{re.escape(path)}",(\r?\n)', re.MULTILINE)
    value = f"/sprites/citizens/{citizen}-{suffix}.png"
    if f'"{field}": "{value}"' in raw:
        return True
    match = pattern.search(raw)
    if not match:
        raise SystemExit(f'{content_file.name}: no "sprite" line found for citizen {citizen}')
    line = f'{match.group(1)}"{field}": "{value}",{newline}'
    raw = raw[: match.end()] + line + raw[match.end() :]
    json.loads(raw)
    content_file.write_bytes(raw.encode("utf-8"))
    return True


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    folder = Path(sys.argv[1])
    inputs = sorted(path for path in folder.iterdir() if path.suffix.lower() in EXTENSIONS)
    if not inputs:
        print(f"no images found in {folder}")
        return 1

    seen: dict[int, Path] = {}
    imported = 0
    failures = 0
    for path in inputs:
        citizen = citizen_id(path)
        if citizen is None:
            print(f"skip   {path.name}: no citizen id in the file name")
            failures += 1
            continue
        if citizen in seen:
            print(f"skip   {path.name}: citizen {citizen} already taken from {seen[citizen].name}")
            failures += 1
            continue
        portrait_path = PUBLIC / f"characters/{citizen}.png"
        if not portrait_path.exists():
            print(f"skip   {path.name}: no profile art for citizen {citizen}")
            failures += 1
            continue
        seen[citizen] = path
        portrait = Image.open(portrait_path).convert("RGBA")
        sprite = to_sprite(key_out_magenta(Image.open(path)), portrait)
        target = PUBLIC / f"sprites/citizens/{citizen}-back.png"
        sprite.save(target, optimize=True)
        listed = any(add_field(file, citizen) for file in CONTENT)
        if not listed:
            print(f"skip   {path.name}: citizen {citizen} is not in the content files")
            target.unlink()
            failures += 1
            continue
        imported += 1
        print(f"ok     {path.name} -> {target.relative_to(ROOT)}")

    print(f"{imported} imported, {failures} skipped")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
