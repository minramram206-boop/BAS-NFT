'use client';

import React, { useState } from 'react';
import { MissionStepDialog } from '@/components/missions/MissionStepDialog';
import { missionCopy, stepInstruction } from '@/components/missions/missionCopy';
import { StatSwatch } from '@/components/ui/StatBar';
import { CheckIcon, TargetIcon } from '@/components/ui/icons';
import { currentStepOf } from '@/lib/data/missions';
import { statLabel } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useAbandonMission,
  useAdvanceMission,
  useBusy,
  useMissionProgress,
  useMissions,
  useRequestFocus,
  useSelectedCitizen,
} from '@/stores/selectors';

const copy = MESSAGES.missions;

/** The mission the selected citizen is playing: current step, what to do, and the step dialog. */
export const MissionTracker: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact = false }) => {
  const citizen = useSelectedCitizen();
  const missions = useMissions();
  const missionProgress = useMissionProgress();
  const advance = useAdvanceMission();
  const abandon = useAbandonMission();
  const focus = useRequestFocus();
  const busy = useBusy();
  const [dialog, setDialog] = useState(false);

  const playing = citizen ? currentStepOf({ missions, missionProgress }, citizen.id) : undefined;
  if (!citizen || !playing) return null;

  const { mission, progress, step, index } = playing;
  const text = missionCopy(mission);

  return (
    <section
      aria-label={copy.trackerTitle}
      className={cn(
        'bas-panel pointer-events-auto flex w-[340px] max-w-full flex-col p-3 md:p-4',
        compact ? 'gap-2' : 'gap-2.5',
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

      <div className={cn('rounded-md border-2 border-[#1b2a38] bg-white', compact ? 'p-2' : 'p-2.5')}>
        <div className="flex items-center gap-1.5 text-[13px] text-[#33485c]">
          {formatMessage(copy.trackerStep, { step: index + 1, steps: mission.steps.length })}
        </div>
        <div className="text-[15px] font-semibold leading-snug">{text.steps[index]?.title}</div>
        <div className="mt-0.5 text-[14px] leading-snug text-[#22354a]">
          {stepInstruction(step, text.steps[index], citizen.name)}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        {step.kind === 'goto' ? (
          <button type="button" onClick={focus} className="bas-btn bas-btn-primary">
            <TargetIcon size={14} />
            {copy.centerMap}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setDialog(true)} className="bas-btn bas-btn-primary">
            <CheckIcon size={14} />
            {step.kind === 'talk' ? copy.answer : copy.solve}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void abandon(mission.id)} className="bas-btn">
          {copy.abandon}
        </button>
      </div>

      {dialog && (
        <MissionStepDialog
          mission={mission}
          index={index}
          onClose={() => setDialog(false)}
          onSolved={() => {
            setDialog(false);
            void advance(mission);
          }}
        />
      )}
    </section>
  );
};
