'use client';

import React from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const AvatarSelectionStrip: React.FC = () => {
  const { citizens, selectedCitizenId, selectCitizen } = useBasStore();

  return (
    <div className="w-full bg-[#bdcddc] border-2 border-[#182635] rounded-xl p-3 shadow-[inset_0_1.5px_0_#fff]">
      <div className="text-[11px] font-heading font-bold text-[#102232] mb-2 flex items-center justify-between">
        <span>GANTI AGENT LAINNYA:</span>
        <span className="text-[9px] text-[#3c5671]">KLIK UNTUK MEMILIH</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {citizens.map((citizen) => {
          const isActive = citizen.id === selectedCitizenId;
          return (
            <button
              key={citizen.id}
              onClick={() => selectCitizen(citizen.id)}
              className={`w-11 h-11 flex-shrink-0 bg-white border-2 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                isActive
                  ? 'border-[#234d7d] ring-2 ring-[#234d7d] shadow-[0_0_8px_rgba(35,77,125,0.4)]'
                  : 'border-[#7e99ab] hover:border-[#234d7d]'
              }`}
              title={`${citizen.name} (${citizen.role})`}
            >
              <img
                src={citizen.avatar || citizen.image}
                alt={citizen.name}
                className="w-9 h-9 object-contain filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
