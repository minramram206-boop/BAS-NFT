'use client';

import React from 'react';
import { missionCopy, stepInstruction } from '@/components/missions/missionCopy';
import { StatSwatch } from '@/components/ui/StatBar';
import { CheckIcon, TargetIcon } from '@/components/ui/icons';
import { currentStepOf } from '@/lib/data/missions';
import { statLabel } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useAbandonMission,
  useBusy,
  useIsOwned,
  useMissionProgress,
  useMissions,
  useReopenMissionPrompt,
  useRequestFocus,
  useRequestWalk,
  useSelectedCitizen,
} from '@/stores/selectors';

const copy = MESSAGES.missions;

/** The mission the selected citizen is playing: current step, what to do, and the step dialog. */
export const MissionTracker: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact = false }) => {
  const citizen = useSelectedCitizen();
  const missions = useMissions();
  const missionProgress = useMissionProgress();
  const abandon = useAbandonMission();
  const focus = useRequestFocus();
  const walk = useRequestWalk();
  const busy = useBusy();
  const owned = useIsOwned(citizen?.id ?? -1);
  const reopen = useReopenMissionPrompt();

  const playing = citizen ? currentStepOf({ missions, missionProgress }, citizen.id) : undefined;
  // Another player's mission is not the viewer's to steer.
  if (!citizen || !playing || !owned) return null;

  const { mission, progress, step, index } = playing;
  const text = missionCopy(mission);

  return (
    <section
      aria-label={copy.trackerTitle}
      className={cn(
        'bas-panel pointer-events-auto flex w-[320px] max-w-full flex-col p-3',
        'gap-2',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-[#1a2734] px-1.5 py-0.5 font-heading text-[11px] tracking-wide text-[#f7d23d]">
          {copy.trackerTitle}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#33485c]">
          <StatSwatch stat={progress.stat} />
          {formatMessage(copy.creditFor, { stat: statLabel(progress.stat) })}
        </span>
      </div>
      {!compact && <div className="font-heading text-[15px] leading-tight tracking-wide">{text.title}</div>}

      <ol className="m-0 flex list-none gap-1 p-0" aria-label={formatMessage(copy.trackerStep, { step: index + 1, steps: mission.steps.length })}>
        {mission.steps.map((_, stepIndex) => (
          <li
            key={stepIndex}
            className={cn(
              'h-2 flex-1 rounded-sm border border-[#1b2a38]',
              stepIndex < index ? 'bg-[#3f9252]' : stepIndex === index ? 'bg-[#f7d23d]' : 'bg-[#c3d0dc]',
            )}
          />
        ))}
      </ol>

      <div className="rounded-md border-2 border-[#1b2a38] bg-white p-2">
        <div className="flex items-center gap-1.5 text-[13px] text-[#33485c]">
          {formatMessage(copy.trackerStep, { step: index + 1, steps: mission.steps.length })}
        </div>
        <div className="text-[15px] font-semibold leading-snug">{text.steps[index]?.title}</div>
        <div className="mt-0.5 text-[14px] leading-snug text-[#22354a]">
          {stepInstruction(step, text.steps[index], citizen.name)}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 md:[&_.bas-btn]:min-h-10">
        {step.kind === 'goto' ? (
          <button
            type="button"
            onClick={() => {
              focus();
              walk();
            }}
            className="bas-btn bas-btn-primary"
          >
            <TargetIcon size={14} />
            {copy.walkThere}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={reopen} className="bas-btn bas-btn-primary">
            <CheckIcon size={14} />
            {step.kind === 'talk' ? copy.answer : copy.solve}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void abandon(mission.id)} className="bas-btn">
          {copy.abandon}
        </button>
      </div>

    </section>
  );
};
