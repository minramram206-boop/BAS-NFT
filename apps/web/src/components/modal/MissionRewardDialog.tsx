'use client';

import Link from 'next/link';
import React from 'react';
import { missionCopy } from '@/components/missions/missionCopy';
import { StatSwatch } from '@/components/ui/StatBar';
import { CheckIcon } from '@/components/ui/icons';
import { DAILY_MISSION_CREDITS } from '@/lib/data/missions';
import { statLabel } from '@/lib/format';
import { MESSAGES, formatMessage } from '@/messages';
import { useCloseReward, useMissions, useReward, useSetFocus } from '@/stores/selectors';

const copy = MESSAGES.missions;

/** What the player gets for a finished mission, with the way on to spending the credit. */
export const MissionRewardDialog: React.FC = () => {
  const reward = useReward();
  const missions = useMissions();
  const close = useCloseReward();
  const setFocus = useSetFocus();
  const mission = reward ? missions.find((item) => item.id === reward.missionId) : undefined;
  if (!reward || !mission) return null;

  const stat = statLabel(reward.stat);
  const values = { name: reward.citizenName, stat, count: reward.creditsReady, left: reward.leftToday, max: DAILY_MISSION_CREDITS };
  const ready = reward.creditsReady === 1 ? copy.rewardReadyOne : copy.rewardReadyMany;
  const left = reward.leftToday === 0 ? copy.rewardLeftNone : reward.leftToday === 1 ? copy.rewardLeftOne : copy.rewardLeftMany;

  return (
    <div role="presentation" onClick={close} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.completeTitle}
        onClick={(event) => event.stopPropagation()}
        className="bas-panel flex w-full max-w-sm flex-col gap-3 p-5 text-center"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#1b2a38] bg-[#3f9252] text-white">
          <CheckIcon size={26} />
        </span>
        <div className="font-heading text-[18px] tracking-wide">{copy.completeTitle}</div>
        <p className="m-0 text-[15px] leading-snug text-[#33485c]">
          {formatMessage(copy.rewardName, { name: reward.citizenName, mission: missionCopy(mission).title })}
        </p>

        <div className="flex flex-col gap-1.5 rounded-md border-2 border-[#1b2a38] bg-white p-3">
          <div className="flex items-center justify-center gap-2 font-heading text-[16px] tracking-wide">
            <StatSwatch stat={reward.stat} />
            {formatMessage(copy.rewardCredit, values)}
          </div>
          <div className="text-[14px] font-semibold text-[#33485c]">{formatMessage(copy.rewardPoints, { points: reward.points })}</div>
        </div>

        <p className="m-0 text-[14px] leading-snug text-[#22354a]">{formatMessage(ready, values)}</p>
        <p className="m-0 text-[14px] leading-snug text-[#5b6b7a]">{formatMessage(left, values)}</p>

        <div className="mt-1 grid grid-cols-2 gap-2">
          <Link
            href="/training"
            onClick={() => {
              setFocus({ training: reward.stat });
              close();
            }}
            className="bas-btn bas-btn-primary min-h-11"
          >
            {copy.rewardTrain}
          </Link>
          <button type="button" autoFocus onClick={close} className="bas-btn min-h-11">
            {copy.rewardKeep}
          </button>
        </div>
      </div>
    </div>
  );
};
