import type { StatKey } from '@bas/content';
import { DISTRICT_RULES } from '@/lib/data/districts';
import type { DistrictId } from '@/lib/data/types';
import layout from './cityLayout.json';

/**
 * The mock city grid produced by `scripts/mock-city/generate_city.py`.
 * Cells are `[gx, gy]`; the map image is drawn so cell (0, 0) has its top
 * corner at `layout.origin`.
 */

export type Cell = readonly [number, number];
export type Zone = DistrictId | 'road';
export type Scores = Readonly<Record<StatKey, number>>;

export const MAP_WIDTH = layout.image.width;
export const MAP_HEIGHT = layout.image.height;
const HALF_W = layout.tile.width / 2;
const HALF_H = layout.tile.height / 2;
const SIZE = layout.size;
/** Half the size of one ground tile in world pixels. */
export const HALF_TILE_W = HALF_W;
export const HALF_TILE_H = HALF_H;
const ORIGIN = layout.origin;

const BLOCKED = new Set(layout.blocked.map(([gx, gy]) => key(gx as number, gy as number)));
const CELLS = layout.cells as Zone[][];

function key(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function zoneOf(cell: Cell): Zone | undefined {
  return CELLS[cell[1]]?.[cell[0]];
}

/** World position of the middle of a cell, where a citizen stands. */
export function cellCenter(cell: Cell): { x: number; y: number } {
  const [gx, gy] = cell;
  return { x: ORIGIN.x + (gx - gy) * HALF_W, y: ORIGIN.y + (gx + gy) * HALF_H + HALF_H };
}

/** Cell under a world position, or `undefined` off the island. */
export function cellAt(x: number, y: number): Cell | undefined {
  const dx = (x - ORIGIN.x) / HALF_W;
  const dy = (y - ORIGIN.y) / HALF_H;
  const gx = Math.floor((dx + dy) / 2);
  const gy = Math.floor((dy - dx) / 2);
  return gx >= 0 && gy >= 0 && gx < SIZE && gy < SIZE ? [gx, gy] : undefined;
}

export function canEnter(zone: Zone | undefined, scores: Scores): boolean {
  if (!zone) return false;
  if (zone === 'road') return true;
  const rule = DISTRICT_RULES[zone];
  return rule.unlockScore === 0 || rule.stats.some((stat) => scores[stat] >= rule.unlockScore);
}

export function isWalkable(cell: Cell, scores: Scores): boolean {
  return !BLOCKED.has(key(cell[0], cell[1])) && canEnter(zoneOf(cell), scores);
}

/** Shortest 4-neighbour path from `from` to `to`, both included; `[]` when unreachable. */
export function findPath(from: Cell, to: Cell, scores: Scores): Cell[] {
  if (!isWalkable(to, scores)) return [];
  const start = key(from[0], from[1]);
  const goal = key(to[0], to[1]);
  const previous = new Map<string, string | null>([[start, null]]);
  const queue: Cell[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as Cell;
    const currentKey = key(current[0], current[1]);
    if (currentKey === goal) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next: Cell = [current[0] + dx, current[1] + dy];
      const nextKey = key(next[0], next[1]);
      if (previous.has(nextKey) || !isWalkable(next, scores)) continue;
      previous.set(nextKey, currentKey);
      queue.push(next);
    }
  }
  if (!previous.has(goal)) return [];
  const path: Cell[] = [];
  for (let at: string | null = goal; at !== null; at = previous.get(at) ?? null) {
    const [gx, gy] = at.split(',').map(Number);
    path.unshift([gx as number, gy as number]);
  }
  return path;
}

/** Free cells near the middle of a district, used as schedule stops. */
export function spotsOf(district: DistrictId): Cell[] {
  return ((layout.spots as Record<string, number[][]>)[district] ?? []).map(
    ([gx, gy]) => [gx, gy] as Cell,
  );
}

/** World position for a district name label, above its middle. */
export function labelPosition(district: DistrictId): { x: number; y: number } {
  const [gx, gy] = (layout.labels as Record<string, number[]>)[district] ?? [0, 0];
  const { x, y } = cellCenter([gx as number, gy as number]);
  return { x, y: y - 64 };
}

/** A building, tree, lamp or wall drawn as its own image so citizens can walk behind it. */
export interface Prop {
  /** `[x, y, width, height]` inside `city-props.png`. */
  readonly frame: readonly [number, number, number, number];
  /** The same prop greyed out, for districts that can be locked. */
  readonly dimmedFrame?: readonly [number, number, number, number];
  /** World position of the image's top-left corner. */
  readonly at: readonly [number, number];
  /** Footprint `[gx, gy, width, depth]` in cells. */
  readonly cells: readonly [number, number, number, number];
  readonly zone: Zone;
}

export const PROPS = layout.props as unknown as readonly Prop[];

/** Painter's order of a prop: its front corner, `gx + gy + width + depth`. */
export function propOrder(prop: Prop): number {
  const [gx, gy, w, d] = prop.cells;
  return gx + gy + w + d;
}

/**
 * True when a citizen standing on `cell` is behind `prop` on screen: north or
 * west of its front faces, and not on the prop's own cells (a lamp post).
 */
export function isBehind(cell: Cell, prop: Prop): boolean {
  const [gx, gy, w, d] = prop.cells;
  const [cx, cy] = cell;
  const inside = cx >= gx && cx < gx + w && cy >= gy && cy < gy + d;
  return !inside && cx < gx + w && cy < gy + d;
}
