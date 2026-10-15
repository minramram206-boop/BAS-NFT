/**
 * Pixel art for the townsfolk who walk the city without being citizens.
 *
 * Each person is drawn in code, one pixel at a time, in three views (front, back and side,
 * facing right) and three poses (standing and one stride on each foot). The city scene mirrors
 * the side view for people walking left. Drawing into a plain pixel buffer keeps this module free
 * of Phaser and the DOM, so it can run anywhere.
 */

export type WalkView = 'front' | 'back' | 'side';
export type WalkFrame = 0 | 1 | 2;

export const VILLAGER_VIEWS: readonly WalkView[] = ['front', 'back', 'side'];
export const VILLAGER_FRAMES: readonly WalkFrame[] = [0, 1, 2];
/** Size of one drawn pose in pixels; the feet stand on the bottom row. */
export const VILLAGER_W = 24;
export const VILLAGER_H = 46;

type Hair = 'short' | 'long' | 'bun' | 'cap';
type Accent = 'none' | 'vest' | 'apron' | 'scarf';

export interface VillagerLook {
  skin: number;
  hair: number;
  hairStyle: Hair;
  /** Colour of the cap when `hairStyle` is `cap`. */
  cap: number;
  top: number;
  accent: Accent;
  accentColor: number;
  /** Trousers, or the skirt when `dress` is set. */
  bottom: number;
  dress: boolean;
  shoes: number;
}

export const VILLAGER_LOOKS: readonly VillagerLook[] = [
  { skin: 0xf0c8a0, hair: 0x3a2a20, hairStyle: 'short', cap: 0, top: 0xc0504a, accent: 'none', accentColor: 0, bottom: 0x3a3a52, dress: false, shoes: 0x2a2420 },
  { skin: 0xd8a070, hair: 0x202028, hairStyle: 'long', cap: 0, top: 0x4a7ac0, accent: 'none', accentColor: 0, bottom: 0x6a4a7a, dress: true, shoes: 0x3a2a30 },
  { skin: 0xa8744c, hair: 0x202028, hairStyle: 'short', cap: 0, top: 0x5aa062, accent: 'vest', accentColor: 0x3a6a40, bottom: 0x4a4034, dress: false, shoes: 0x2a2420 },
  { skin: 0xf4d4b4, hair: 0xd0b060, hairStyle: 'cap', cap: 0x8a3a30, top: 0xd0a040, accent: 'none', accentColor: 0, bottom: 0x3a4a6a, dress: false, shoes: 0x3a2a20 },
  { skin: 0xf0c8a0, hair: 0xa04a30, hairStyle: 'bun', cap: 0, top: 0x8a5ab0, accent: 'apron', accentColor: 0xe8e0d0, bottom: 0x5a3a6a, dress: true, shoes: 0x2a2420 },
  { skin: 0xd8a070, hair: 0x6a4a30, hairStyle: 'short', cap: 0, top: 0x4aa0a8, accent: 'scarf', accentColor: 0xd0503a, bottom: 0x3a3a52, dress: false, shoes: 0x2a2420 },
  { skin: 0xa8744c, hair: 0x202028, hairStyle: 'cap', cap: 0x3a5a8a, top: 0xe0e0e0, accent: 'none', accentColor: 0, bottom: 0x4a4a58, dress: false, shoes: 0x2a2a30 },
  { skin: 0xf4d4b4, hair: 0x3a2a20, hairStyle: 'long', cap: 0, top: 0xc0504a, accent: 'scarf', accentColor: 0xe0d8b0, bottom: 0x2a3040, dress: false, shoes: 0x3a2a20 },
  { skin: 0xf0c8a0, hair: 0x6a4a30, hairStyle: 'short', cap: 0, top: 0x8a7a5a, accent: 'vest', accentColor: 0x5a4a30, bottom: 0x2a3040, dress: false, shoes: 0x2a2420 },
];

const OUTLINE = 0x1c1824;
const BELT = 0x3a2a20;
const BUCKLE = 0xd8b048;
const EYE = 0x24202c;
const WHITE = 0xf4f0e8;

function shade(color: number, factor: number): number {
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 255) * factor)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

class Pixels {
  readonly data = new Uint8ClampedArray(VILLAGER_W * VILLAGER_H * 4);

  set(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= VILLAGER_W || y >= VILLAGER_H) return;
    const at = (y * VILLAGER_W + x) * 4;
    this.data[at] = (color >> 16) & 255;
    this.data[at + 1] = (color >> 8) & 255;
    this.data[at + 2] = color & 255;
    this.data[at + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let row = y; row < y + h; row += 1) for (let col = x; col < x + w; col += 1) this.set(col, row, color);
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= VILLAGER_W || y >= VILLAGER_H) return;
    this.data[(y * VILLAGER_W + x) * 4 + 3] = 0;
  }

  solid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= VILLAGER_W || y >= VILLAGER_H) return false;
    return (this.data[(y * VILLAGER_W + x) * 4 + 3] as number) > 0;
  }

  /** A one-pixel dark edge around everything drawn so far. */
  outline(): void {
    const edge: [number, number][] = [];
    for (let y = 0; y < VILLAGER_H; y += 1) {
      for (let x = 0; x < VILLAGER_W; x += 1) {
        if (this.solid(x, y)) continue;
        if (this.solid(x - 1, y) || this.solid(x + 1, y) || this.solid(x, y - 1) || this.solid(x, y + 1)) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, OUTLINE);
  }
}

/** How far a limb swings in each pose: the left side leads in pose 1, the right in pose 2. */
function swing(frame: WalkFrame, side: 0 | 1): number {
  if (frame === 0) return 0;
  return (frame === 1) === (side === 0) ? 1 : -1;
}

// --- front and back --------------------------------------------------------------------

function legsFrontBack(p: Pixels, look: VillagerLook, frame: WalkFrame): void {
  for (const side of [0, 1] as const) {
    const lift = swing(frame, side) === 1 ? 2 : 0;
    const x = side === 0 ? 7 : 12;
    if (look.dress) {
      p.rect(x + 1, 37, 3, 5 - lift, shade(look.skin, 0.94));
    } else {
      p.rect(x, 30, 5, 12 - lift, side === 0 ? look.bottom : shade(look.bottom, 0.86));
      p.rect(side === 0 ? 11 : 12, 30, 1, 12 - lift, shade(look.bottom, 0.7));
    }
    const shoeX = side === 0 ? 6 : 12;
    p.rect(shoeX, 42 - lift, 6, 3, look.shoes);
    p.rect(shoeX, 45 - lift, 6, 1, shade(look.shoes, 0.6));
  }
}

function bodyFrontBack(p: Pixels, look: VillagerLook, frame: WalkFrame, back: boolean): void {
  const torsoRows = look.dress ? 12 : 14;
  p.rect(6, 16, 12, torsoRows, look.top);
  p.clear(6, 16);
  p.clear(17, 16);
  p.rect(15, 17, 3, torsoRows - 1, shade(look.top, 0.86));
  if (look.dress) {
    p.rect(6, 28, 12, 4, look.bottom);
    p.rect(5, 32, 14, 5, look.bottom);
    p.rect(16, 28, 3, 9, shade(look.bottom, 0.82));
    p.rect(6, 27, 12, 1, shade(look.top, 0.72));
  } else {
    p.rect(6, 28, 12, 2, BELT);
    if (!back) p.set(12, 28, BUCKLE);
  }
  if (!back) {
    if (look.accent === 'vest') {
      p.rect(6, 17, 3, 11, look.accentColor);
      p.rect(15, 17, 3, 11, shade(look.accentColor, 0.86));
    } else if (look.accent === 'apron') {
      p.rect(8, 21, 8, look.dress ? 15 : 9, look.accentColor);
      p.rect(9, 16, 1, 5, look.accentColor);
      p.rect(14, 16, 1, 5, look.accentColor);
    } else if (look.accent === 'scarf') {
      p.rect(8, 15, 8, 2, look.accentColor);
      p.rect(11, 17, 2, 6, shade(look.accentColor, 0.86));
    }
    p.rect(10, 16, 4, 1, shade(look.skin, 0.88));
  } else if (look.accent === 'scarf') {
    p.rect(8, 15, 8, 2, look.accentColor);
  } else if (look.accent === 'apron') {
    p.rect(8, 22, 8, 1, look.accentColor);
  }
  for (const side of [0, 1] as const) {
    const x = side === 0 ? 3 : 18;
    const dy = swing(frame, side);
    p.rect(x, 17 + dy, 3, 10, shade(look.top, side === 0 ? 0.92 : 0.8));
    p.rect(x, 27 + dy, 3, 3, side === 0 ? look.skin : shade(look.skin, 0.9));
  }
  p.rect(10, 14, 4, 2, shade(look.skin, 0.88));
}

function headFront(p: Pixels, look: VillagerLook): void {
  const { skin, hair } = look;
  p.rect(7, 5, 10, 9, skin);
  p.clear(7, 13);
  p.clear(16, 13);
  p.rect(6, 9, 1, 2, shade(skin, 0.86));
  p.rect(17, 9, 1, 2, shade(skin, 0.8));
  if (look.hairStyle === 'cap') {
    p.rect(8, 1, 8, 1, look.cap);
    p.rect(7, 2, 10, 4, look.cap);
    p.rect(6, 6, 12, 1, shade(look.cap, 0.7));
    p.rect(7, 7, 1, 2, hair);
    p.rect(16, 7, 1, 2, hair);
  } else {
    p.rect(8, 2, 8, 1, hair);
    p.rect(7, 3, 10, 3, hair);
    p.rect(7, 6, 1, 3, hair);
    p.rect(16, 6, 1, 3, hair);
    p.rect(9, 3, 3, 1, shade(hair, 1.4));
    if (look.hairStyle === 'long') {
      p.rect(6, 5, 2, 12, hair);
      p.rect(16, 5, 2, 12, shade(hair, 0.85));
    }
    if (look.hairStyle === 'bun') p.rect(10, 1, 4, 2, hair);
  }
  p.rect(8, 8, 3, 1, shade(hair, 0.8));
  p.rect(13, 8, 3, 1, shade(hair, 0.8));
  p.set(9, 9, WHITE);
  p.set(10, 9, EYE);
  p.set(13, 9, EYE);
  p.set(14, 9, WHITE);
  p.set(12, 10, shade(skin, 0.9));
  p.set(12, 11, shade(skin, 0.78));
  p.rect(11, 12, 2, 1, shade(skin, 0.62));
}

function headBack(p: Pixels, look: VillagerLook): void {
  const { skin, hair } = look;
  p.rect(7, 5, 10, 9, shade(skin, 0.92));
  p.clear(7, 13);
  p.clear(16, 13);
  if (look.hairStyle === 'cap') {
    p.rect(8, 1, 8, 1, look.cap);
    p.rect(7, 2, 10, 5, look.cap);
    p.rect(7, 6, 10, 1, shade(look.cap, 0.7));
    p.rect(7, 7, 10, 4, hair);
    p.rect(9, 3, 3, 1, shade(look.cap, 1.3));
  } else {
    p.rect(8, 2, 8, 1, hair);
    p.rect(7, 3, 10, 9, hair);
    p.clear(7, 11);
    p.clear(16, 11);
    p.rect(9, 3, 3, 1, shade(hair, 1.4));
    p.rect(11, 5, 1, 5, shade(hair, 0.8));
    if (look.hairStyle === 'long') {
      p.rect(6, 4, 12, 13, hair);
      p.clear(6, 4);
      p.clear(17, 4);
      p.clear(6, 16);
      p.clear(17, 16);
      p.rect(11, 6, 1, 10, shade(hair, 0.8));
    }
    if (look.hairStyle === 'bun') p.rect(10, 1, 4, 2, hair);
  }
}

// --- side (facing right) ---------------------------------------------------------------

function legsSide(p: Pixels, look: VillagerLook, frame: WalkFrame): void {
  const reach = frame === 0 ? 0 : 3;
  const forward = frame === 1 ? 1 : -1;
  const legs: { off: number; tone: number }[] = [
    { off: -forward * reach, tone: 0.75 },
    { off: forward * reach, tone: 1 },
  ];
  for (const { off, tone } of legs) {
    const mid = Math.trunc(off / 2);
    const color = look.dress ? shade(look.skin, 0.94 * tone) : shade(look.bottom, tone);
    if (!look.dress) {
      p.rect(9, 30, 5, 4, color);
      p.rect(9 + mid, 34, 5, 4, color);
      p.rect(9 + off, 38, 5, 4, color);
    } else {
      p.rect(10, 37, 3, 2, color);
      p.rect(10 + mid, 39, 3, 1, color);
      p.rect(10 + off, 40, 3, 2, color);
    }
    p.rect(9 + off, 42, 6, 3, shade(look.shoes, tone));
    p.rect(9 + off, 45, 6, 1, shade(look.shoes, 0.6 * tone));
  }
}

function bodySide(p: Pixels, look: VillagerLook, frame: WalkFrame): void {
  const torsoRows = look.dress ? 12 : 14;
  p.rect(8, 16, 8, torsoRows, look.top);
  p.clear(8, 16);
  p.clear(15, 16);
  p.rect(8, 17, 2, torsoRows - 1, shade(look.top, 0.82));
  if (look.dress) {
    p.rect(8, 28, 8, 4, look.bottom);
    p.rect(7, 32, 10, 5, look.bottom);
    p.rect(7, 28, 2, 9, shade(look.bottom, 0.82));
    p.rect(8, 27, 8, 1, shade(look.top, 0.72));
  } else {
    p.rect(8, 28, 8, 2, BELT);
  }
  if (look.accent === 'vest') p.rect(11, 17, 5, 11, look.accentColor);
  if (look.accent === 'apron') p.rect(13, 21, 3, look.dress ? 15 : 9, look.accentColor);
  if (look.accent === 'scarf') {
    p.rect(9, 15, 7, 2, look.accentColor);
    p.rect(8, 17, 2, 5, shade(look.accentColor, 0.86));
  }
  const reach = frame === 0 ? 0 : frame === 1 ? -3 : 3;
  p.rect(10 + reach, 17, 3, 10, shade(look.top, 0.92));
  p.rect(10 + reach, 27, 3, 3, look.skin);
  p.rect(10, 14, 4, 2, shade(look.skin, 0.88));
}

function headSide(p: Pixels, look: VillagerLook): void {
  const { skin, hair } = look;
  p.rect(8, 5, 9, 9, skin);
  p.clear(16, 13);
  p.clear(8, 13);
  p.rect(17, 10, 1, 2, shade(skin, 0.92));
  p.rect(10, 9, 2, 2, shade(skin, 0.8));
  if (look.hairStyle === 'cap') {
    p.rect(8, 1, 8, 1, look.cap);
    p.rect(7, 2, 10, 4, look.cap);
    p.rect(15, 5, 5, 2, shade(look.cap, 0.7));
    p.rect(7, 6, 4, 4, hair);
  } else {
    p.rect(8, 2, 8, 1, hair);
    p.rect(7, 3, 10, 3, hair);
    p.rect(7, 6, 4, 5, hair);
    p.rect(14, 6, 3, 1, hair);
    p.rect(9, 3, 3, 1, shade(hair, 1.4));
    if (look.hairStyle === 'long') {
      p.rect(6, 5, 5, 13, hair);
      p.clear(6, 17);
    }
    if (look.hairStyle === 'bun') p.rect(6, 2, 4, 3, hair);
  }
  p.rect(13, 8, 3, 1, shade(hair, 0.8));
  p.set(13, 9, WHITE);
  p.set(14, 9, EYE);
  p.rect(15, 12, 2, 1, shade(skin, 0.62));
}

/** One pose of one person as RGBA pixels, `VILLAGER_W` by `VILLAGER_H`. */
export function renderVillager(look: VillagerLook, view: WalkView, frame: WalkFrame): Uint8ClampedArray<ArrayBuffer> {
  const p = new Pixels();
  if (view === 'side') {
    legsSide(p, look, frame);
    bodySide(p, look, frame);
    headSide(p, look);
  } else {
    legsFrontBack(p, look, frame);
    bodyFrontBack(p, look, frame, view === 'back');
    if (view === 'back') headBack(p, look);
    else headFront(p, look);
  }
  p.outline();
  return p.data;
}
