'use client';

import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { useCitizens, useSelectCitizen, useSelectedCitizenId } from '@/stores/selectors';
import { cn } from '@/lib/utils/cn';
import { PixelSprite } from '@/components/ui/PixelSprite';

/** Horizontal strip used in the dojo to switch the active citizen. */
export const AvatarSelectionStrip: React.FC = () => {
  const citizens = useCitizens();
  const selectedCitizenId = useSelectedCitizenId();
  const selectCitizen = useSelectCitizen();

  return (
    <section className="w-full rounded-xl border-2 border-[#182635] bg-[#bdcddc] p-3 shadow-[inset_0_1.5px_0_#fff]">
      <header className="mb-2 flex items-center justify-between font-heading text-[11px] font-bold text-[#102232]">
        <span>GANTI AGENT LAINNYA:</span>
        <span className="text-[9px] text-[#3c5671]">KLIK UNTUK MEMILIH</span>
      </header>

      <div className="scrollbar-thin flex items-center gap-2 overflow-x-auto pb-1">
        {citizens.map((citizen) => (
          <AvatarButton
            key={citizen.id}
            citizen={citizen}
            isActive={citizen.id === selectedCitizenId}
            onSelect={selectCitizen}
          />
        ))}
      </div>
    </section>
  );
};

interface AvatarButtonProps {
  citizen: CitizenRecord;
  isActive: boolean;
  onSelect: (id: number) => void;
}

const AvatarButton: React.FC<AvatarButtonProps> = ({ citizen, isActive, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(citizen.id)}
    aria-pressed={isActive}
    title={`${citizen.name} (${citizen.role})`}
    className={cn(
      'flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 bg-white transition-all',
      isActive
        ? 'border-[#234d7d] shadow-[0_0_8px_rgba(35,77,125,0.4)] ring-2 ring-[#234d7d]'
        : 'border-[#7e99ab] hover:border-[#234d7d]',
    )}
  >
    <PixelSprite
      src={citizen.avatar || citizen.image}
      alt={citizen.name}
      width={120}
      height={57}
      className="flex h-9 w-9 items-center justify-center overflow-hidden"
      imageClassName="drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
    />
  </button>
);
