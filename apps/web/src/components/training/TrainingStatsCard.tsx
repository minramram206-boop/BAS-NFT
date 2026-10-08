'use client';

import React from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const TrainingStatsCard: React.FC = () => {
  const { citizens, selectedCitizenId } = useBasStore();
  const activeCitizen = citizens.find((c) => c.id === selectedCitizenId) || citizens[0];

  if (!activeCitizen) return null;

  return (
    <div className="bg-[#bdcddc] border-2 border-[#182635] rounded-xl p-3.5 shadow-[inset_0_1.5px_0_#fff] flex flex-col justify-between gap-3 h-full">
      {/* Title Bar matching ActiveAgentCard Tab style */}
      <div className="bg-[#284a6e] border border-[#142639] rounded-lg py-1.5 px-3 flex items-center justify-between font-heading text-xs font-bold text-white shadow-[inset_0_1px_0_#5a8cc1]">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-300">★</span>
          <span>AGENT ATTRIBUTES</span>
        </div>
        <span className="text-[10px] text-sky-200">{activeCitizen.code}</span>
      </div>

      {/* Attributes Numbers in pale ice container */}
      <div className="bg-[#edf5fa] border-2 border-[#7e99ab] rounded-lg p-2.5 flex flex-col gap-2 shadow-inner">
        <div className="flex items-center justify-between border-b border-[#c8dbe9] pb-1.5">
          <div className="flex items-center gap-2 font-heading text-xs font-bold text-[#102232]">
            <span className="text-sm">📖</span>
            <span>INTELLIGENCE (INT)</span>
          </div>
          <span className="font-heading text-base font-bold text-[#286396]">
            {activeCitizen.intelligence}
          </span>
        </div>

        <div className="flex items-center justify-between border-b border-[#c8dbe9] pb-1.5">
          <div className="flex items-center gap-2 font-heading text-xs font-bold text-[#102232]">
            <span className="text-sm">⚖</span>
            <span>ALIGNMENT (ALN)</span>
          </div>
          <span className="font-heading text-base font-bold text-[#8e6822]">
            {activeCitizen.alignment}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading text-xs font-bold text-[#102232]">
            <span className="text-sm">💚</span>
            <span>COMPOSURE (CMP)</span>
          </div>
          <span className="font-heading text-base font-bold text-[#378b4b]">
            {activeCitizen.composure}
          </span>
        </div>
      </div>

      {/* Parchment Scroll Note */}
      <div className="bg-[#eedcb9] border border-[#6d542b] rounded-lg p-2.5 flex items-center gap-2 shadow-xs">
        <span className="text-base">📜</span>
        <p className="font-pixel text-[11px] md:text-xs font-semibold text-[#4a3315] leading-snug">
          Menaikkan stat mengkonsumsi 1 Burn Token $DIST per sesi latihan.
        </p>
      </div>
    </div>
  );
};
