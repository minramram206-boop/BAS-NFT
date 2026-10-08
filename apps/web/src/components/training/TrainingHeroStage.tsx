'use client';

import React from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const TrainingHeroStage: React.FC = () => {
  const { citizens, selectedCitizenId, trainingLog } = useBasStore();
  const activeCitizen = citizens.find((c) => c.id === selectedCitizenId) || citizens[0];

  if (!activeCitizen) return null;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Upper Hero Stage Card */}
      <div className="bg-[#bdcddc] border-2 border-[#182635] rounded-xl p-3 flex flex-col items-center gap-2 shadow-[inset_0_1.5px_0_#fff]">
        {/* Recessed Grid Stage */}
        <div className="w-full h-44 md:h-52 bg-[#edf5fa] border-2 border-[#7e99ab] rounded-lg relative flex items-center justify-center overflow-hidden shadow-inner bg-[linear-gradient(#dce9f3_1px,transparent_1px),linear-gradient(90deg,#dce9f3_1px,transparent_1px)] bg-[size:16px_16px]">
          {/* Shadow Oval */}
          <div className="absolute bottom-4 w-28 h-6 bg-[radial-gradient(ellipse_at_center,rgba(24,38,53,0.45)_0%,rgba(24,38,53,0)_70%)] rounded-full z-0" />

          {/* Hero Sprite with Bobbing */}
          <img
            src={activeCitizen.image}
            alt={activeCitizen.name}
            className="max-h-[85%] max-w-[85%] object-contain relative z-10 filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)] animate-[hero-idle-bob_2.4s_ease-in-out_infinite_alternate]"
          />
        </div>

        {/* Parchment Ribbon Banner */}
        <div className="bg-[#ebd6ae] border-2 border-[#6d542b] rounded-md px-5 py-1 font-heading text-xs md:text-sm font-bold text-[#4a3416] shadow-[0_2px_0_rgba(0,0,0,0.25)] text-shadow-sm">
          {activeCitizen.name.toUpperCase()}
        </div>
      </div>

      {/* Large Dialogue Speech Bubble with Pointer Tail */}
      <div className="relative bg-[#edf5fa] border-2 border-[#182635] rounded-xl p-4 shadow-[0_3px_0_rgba(0,0,0,0.18)]">
        {/* Arrow pointer pointing towards the stage */}
        <div className="absolute -top-2 left-10 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-[#edf5fa] z-10" />
        <div className="absolute -top-2.5 left-10 w-0 h-0 border-l-[9px] border-l-transparent border-r-[9px] border-r-transparent border-b-[9px] border-b-[#182635] z-0" />

        <div
          className="font-pixel text-xs md:text-sm font-bold text-[#102232] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: trainingLog }}
        />
      </div>
    </div>
  );
};
