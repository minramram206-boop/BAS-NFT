import { STAT_MAX } from './constants.js';

/** Clamp a raw stat score into the protocol range. */
export function clampStatScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(STAT_MAX, Math.max(0, Math.trunc(score)));
}
