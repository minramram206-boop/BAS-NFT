'use client';

import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizens, useOwnedIds, useSelectCitizen, useSelectedCitizenId } from '@/stores/selectors';

/** Row of the wallet's citizens; the chosen one is the citizen the screen acts for. */
export const CitizenSwitcher: React.FC<{ label: string; className?: string }> = ({ label, className }) => {
  const owned = useOwnedIds();
  const citizens = useCitizens();
  const selectedId = useSelectedCitizenId();
  const select = useSelectCitizen();
  const mine = owned
    .map((id) => citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is CitizenRecord => citizen !== undefined);

  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="flex items-center gap-1.5">
        <PixelIcon src="/icons/icon_citizens_group.png" className="h-6" />
        <span className="bas-label text-[13px] text-[#e3ecf4]">{label}</span>
      </span>
      {mine.map((citizen) => {
        const active = citizen.id === selectedId;
        return (
          <button
            key={citizen.id}
            type="button"
            aria-pressed={active}
            aria-label={formatMessage(MESSAGES.a11y.selectCitizen, { name: citizen.name })}
            onClick={() => select(citizen.id)}
            className={cn(
              'bas-chip flex h-11 items-center gap-2 rounded-md pl-1 pr-3 font-heading text-[12px] tracking-wide',
              active
                ? 'border-[3px] border-[#f7d23d] bg-white text-[#1a2734]'
                : 'border-2 border-[#1b2a38] bg-[#c5d5e5] text-[#1a2734]',
            )}
          >
            <img src={citizen.sprite} alt="" width={34} height={34} className="h-[34px] w-[34px]" />
            {citizen.name.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
};
