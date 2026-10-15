import {
  DAILY_MISSION_LIMIT,
  isDistrictOpen,
  type MissionSpec,
  type MissionStepSpec,
  type StatName,
  type StatScores,
} from './catalog.js';
import { MissionError } from './errors.js';

/** The walk speed of the web scene is about 570 ms per cell; this is the floor with plenty of slack. */
export const MIN_MS_PER_CELL = 250;
/** Shortest time any step can take after the previous one. */
export const MIN_STEP_MS = 1_000;

export interface StartContext {
  readonly mission: MissionSpec;
  readonly stat: StatName;
  readonly scores: StatScores;
  /** Missions this citizen already finished today. */
  readonly doneToday: readonly string[];
  readonly hasSession: boolean;
  readonly seasonOpen: boolean;
  readonly eventOpen: boolean;
}

/** Throws the first rule a start breaks. The order matches the web preview. */
export function assertCanStart(context: StartContext): void {
  const { mission } = context;
  if (!context.seasonOpen) throw new MissionError('season-closed');
  if (!mission.rewards.includes(context.stat)) throw new MissionError('invalid-stat');
  if (mission.event && !context.eventOpen) throw new MissionError('mission-closed');
  if (!isDistrictOpen(context.scores, mission.district)) throw new MissionError('district-locked');
  if (context.hasSession) throw new MissionError('citizen-busy');
  if (context.doneToday.includes(mission.id)) throw new MissionError('mission-cooldown');
  if (context.doneToday.length >= DAILY_MISSION_LIMIT) throw new MissionError('daily-limit');
}

/** What the client says it did for the current step. */
export type StepProof =
  | { readonly kind: 'goto' }
  | { readonly kind: 'talk'; readonly answer: number }
  | { readonly kind: 'puzzle'; readonly order: readonly number[] };

/** Reads a request body into a proof, or `undefined` when it is not one. */
export function parseProof(value: unknown): StepProof | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const proof = value as Record<string, unknown>;
  if (proof.kind === 'goto') return { kind: 'goto' };
  if (proof.kind === 'talk' && Number.isInteger(proof.answer)) return { kind: 'talk', answer: proof.answer as number };
  if (
    proof.kind === 'puzzle' &&
    Array.isArray(proof.order) &&
    proof.order.length <= 16 &&
    proof.order.every((entry) => Number.isInteger(entry))
  ) {
    return { kind: 'puzzle', order: proof.order as number[] };
  }
  return undefined;
}

function distanceBetween(from: readonly [number, number], to: readonly [number, number]): number {
  return Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
}

/**
 * Checks one step of a mission. Talk and puzzle steps are checked against the
 * answer key. A walk cannot be seen from here, so it is only held to the time
 * the trip must take: the client that reports arrival too early is refused.
 */
export function checkStep(
  mission: MissionSpec,
  index: number,
  proof: StepProof,
  elapsedMs: number,
): void {
  const step: MissionStepSpec | undefined = mission.steps[index];
  if (!step) throw new MissionError('wrong-step');
  if (proof.kind !== step.kind) throw new MissionError('wrong-step');

  let minimum = MIN_STEP_MS;
  if (step.kind === 'goto') {
    const previous = mission.steps[index - 1];
    if (previous?.kind === 'goto') {
      minimum = Math.max(minimum, distanceBetween(previous.cell, step.cell) * MIN_MS_PER_CELL);
    }
  }
  if (elapsedMs < minimum) throw new MissionError('too-fast');

  if (step.kind === 'talk' && proof.kind === 'talk') {
    if (proof.answer < 0 || proof.answer >= step.options || proof.answer !== step.answer) {
      throw new MissionError('wrong-answer');
    }
  }
  if (step.kind === 'puzzle' && proof.kind === 'puzzle') {
    const inOrder = proof.order.length === step.pieces && proof.order.every((piece, position) => piece === position);
    if (!inOrder) throw new MissionError('wrong-order');
  }
}
