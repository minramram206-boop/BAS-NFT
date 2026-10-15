'use client';

import React from 'react';
import { MissionStepDialog } from '@/components/missions/MissionStepDialog';
import { missionCopy, stepInstruction } from '@/components/missions/missionCopy';
import { currentStepOf } from '@/lib/data/missions';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useAdvanceMission,
  useDismissMissionPrompt,
  useIsOwned,
  useMissionProgress,
  useMissionPrompt,
  useMissions,
  useRequestFocus,
  useRequestWalk,
  useSelectedCitizen,
} from '@/stores/selectors';

const copy = MESSAGES.missions;

/**
 * Opens the current step of the selected citizen's mission over the city: when a
 * mission starts, when the citizen reaches a stop, and for every talk or puzzle
 * step. Closing it keeps the step in the mission card, which can open it again.
 */
export const MissionPopup: React.FC = () => {
  const citizen = useSelectedCitizen();
  const missions = useMissions();
  const missionProgress = useMissionProgress();
  const prompt = useMissionPrompt();
  const dismiss = useDismissMissionPrompt();
  const advance = useAdvanceMission();
  const focus = useRequestFocus();
  const walk = useRequestWalk();
  const owned = useIsOwned(citizen?.id ?? -1);

  const playing = citizen ? currentStepOf({ missions, missionProgress }, citizen.id) : undefined;
  if (!citizen || !playing || !owned) return null;

  const { mission, step, index } = playing;
  const key = `${mission.id}:${index}`;
  if (prompt.dismissed === key) return null;
  const arrived = prompt.arrived === key;

  if (step.kind !== 'goto') {
    return (
      <MissionStepDialog
        mission={mission}
        index={index}
        arrived={arrived}
        onClose={() => dismiss(key)}
        onSubmit={async (proof) => {
          const outcome = await advance(mission, proof);
          if (outcome === 'ok') dismiss(key);
          return outcome;
        }}
      />
    );
  }

  const text = missionCopy(mission);
  const stepText = text.steps[index];
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={stepText?.title ?? text.title}
        className="bas-panel flex w-full max-w-md flex-col gap-3 p-5"
      >
        {arrived && (
          <span className="self-start rounded bg-[#3f9252] px-2 py-0.5 font-heading text-[12px] tracking-wide text-white">
            {copy.arrived}
          </span>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="font-heading text-[12px] tracking-wide text-[#7a4689]">{text.title}</span>
          <span className="text-[13px] text-[#33485c]">
            {formatMessage(copy.trackerStep, { step: index + 1, steps: mission.steps.length })}
          </span>
        </div>
        <div className="font-heading text-[17px] tracking-wide">{stepText?.title}</div>
        <p className="m-0 text-[15px] leading-relaxed text-[#22354a]">{stepInstruction(step, stepText, citizen.name)}</p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            dismiss(key);
            focus();
            walk();
          }}
          className="bas-btn bas-btn-primary self-end"
        >
          {copy.popupGo}
        </button>
      </div>
    </div>
  );
};
