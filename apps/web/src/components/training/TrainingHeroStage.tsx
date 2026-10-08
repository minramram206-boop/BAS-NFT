'use client';

import React from 'react';
import { useSelectedCitizen, useTrainingLog } from '@/stores/selectors';
import { PixelSprite } from '@/components/ui/PixelSprite';

/**
 * Dojo hero stage: the selected citizen on a recessed grid, a name ribbon,
 * and the training log bubble.
 */
export const TrainingHeroStage: React.FC = () => {
  const citizen = useSelectedCitizen();
  const trainingLog = useTrainingLog();

  if (!citizen) return null;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-[#182635] bg-[#bdcddc] p-3 shadow-[inset_0_1.5px_0_#fff]">
        <div className="relative flex h-44 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-[#7e99ab] bg-[#edf5fa] bg-[linear-gradient(#dce9f3_1px,transparent_1px),linear-gradient(90deg,#dce9f3_1px,transparent_1px)] bg-[size:16px_16px] shadow-inner md:h-52">
          <span className="absolute bottom-4 z-0 h-6 w-28 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(24,38,53,0.45)_0%,rgba(24,38,53,0)_70%)]" />

          <PixelSprite
            src={citizen.image}
            alt={citizen.name}
            width={256}
            height={256}
            className="z-10 flex max-h-[85%] max-w-[85%] items-center justify-center overflow-hidden"
            imageClassName="animate-[hero-idle-bob_2.4s_ease-in-out_infinite_alternate] drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)]"
            priority
          />
        </div>

        <div className="rounded-md border-2 border-[#6d542b] bg-[#ebd6ae] px-5 py-1 text-center font-heading text-xs font-bold text-[#4a3416] shadow-[0_2px_0_rgba(0,0,0,0.25)] text-shadow-sm md:text-sm">
          {citizen.name.toUpperCase()} · {citizen.role}
        </div>
      </div>

      <div className="relative rounded-xl border-2 border-[#182635] bg-[#edf5fa] p-4 shadow-[0_3px_0_rgba(0,0,0,0.18)]">
        <span className="absolute -top-2 left-10 z-10 h-0 w-0 border-l-[8px] border-r-[8px] border-b-[8px] border-l-transparent border-r-transparent border-b-[#edf5fa]" />
        <span className="absolute -top-2.5 left-10 z-0 h-0 w-0 border-l-[9px] border-r-[9px] border-b-[9px] border-l-transparent border-r-transparent border-b-[#182635]" />

        <p className="whitespace-pre-line font-pixel text-xs font-bold leading-relaxed text-[#102232] md:text-sm">
          {trainingLog}
        </p>
      </div>
    </div>
  );
};
