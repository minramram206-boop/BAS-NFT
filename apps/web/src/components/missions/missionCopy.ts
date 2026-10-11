import type { MissionDefinition, MissionStep } from '@/lib/data/types';
import { MESSAGES, formatMessage } from '@/messages';

/** Copy of one step; which fields are set depends on the step kind. */
export interface StepCopy {
  title: string;
  hint?: string;
  prompt?: string;
  options?: string[];
  pieces?: string[];
}

export interface MissionCopy {
  title: string;
  body: string;
  steps: StepCopy[];
}

const CATALOG = MESSAGES.missions.catalog as Record<string, MissionCopy>;

export function missionCopy(mission: Pick<MissionDefinition, 'id'>): MissionCopy {
  return CATALOG[mission.id] ?? { title: mission.id, body: '', steps: [] };
}

/** What the player has to do for a step, in one line. */
export function stepInstruction(step: MissionStep, text: StepCopy | undefined, name: string): string {
  if (step.kind === 'goto') return text?.hint ?? formatMessage(MESSAGES.missions.stepGoto, { name });
  return step.kind === 'talk' ? MESSAGES.missions.stepTalk : MESSAGES.missions.stepPuzzle;
}
