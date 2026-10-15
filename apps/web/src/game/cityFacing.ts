/**
 * Which view of a person to show, and whether it is mirrored, for the way they walk on screen.
 *
 * People are drawn in three views: seen from the front (walking down), from behind (walking up)
 * and from the side. The side view looks to the right and is mirrored when heading left.
 * Sideways movement wins when it is longer than the vertical part; a diagonal counts as vertical.
 * Someone who stands still keeps the look they had.
 */

export type WalkView = 'front' | 'back' | 'side';

export interface WalkLook {
  view: WalkView;
  flip: boolean;
}

/** How a person looks before they have moved: facing the viewer. */
export const INITIAL_WALK_LOOK: WalkLook = { view: 'front', flip: false };

const MIN_MOVE = 1e-3;

export function walkLookFor(direction: { x: number; y: number }, previous: WalkLook): WalkLook {
  const ax = Math.abs(direction.x);
  const ay = Math.abs(direction.y);
  if (ax < MIN_MOVE && ay < MIN_MOVE) return previous;
  if (ax > ay) return { view: 'side', flip: direction.x < 0 };
  return { view: direction.y < 0 ? 'back' : 'front', flip: false };
}
