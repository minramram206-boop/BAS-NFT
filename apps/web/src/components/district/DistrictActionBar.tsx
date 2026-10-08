'use client';

import React from 'react';
import Link from 'next/link';
import { REGISTRY_SECTION_ID } from '@/config/constants';
import { MESSAGES } from '@/messages';
import { useMintCitizen } from '@/stores/selectors';
import { cn } from '@/lib/utils/cn';
import { PixelIcon } from '@/components/ui/PixelIcon';

interface PlazaAction {
  key: 'mint' | 'registry' | 'dojo';
  label: string;
  icon: string;
  iconAlt: string;
  buttonClass: string;
}

const ACTION_BUTTON_BASE =
  'group relative flex min-h-[66px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg px-1 py-2.5 transition-all active:translate-y-0.5 hover:brightness-105 md:min-h-[74px] md:py-3';

const ACTION_LABEL_CLASS =
  'pixel-text-outlined font-heading text-[10px] font-black uppercase leading-none tracking-wider md:text-xs';

const ICON_CLASS = 'h-7 md:h-8';
const ICON_EFFECT_CLASS = 'transition-transform group-hover:scale-110';

const PLAZA_ACTIONS: readonly PlazaAction[] = [
  {
    key: 'mint',
    label: MESSAGES.district.mintAction,
    icon: '/icons/icon_mint_egg.png',
    iconAlt: MESSAGES.district.mintIconAlt,
    buttonClass:
      'border-2 border-[#182b1b] bg-[#5c9053] shadow-[inset_0_0_0_1.5px_#a4ca8c,0_2.5px_0_#142416] active:shadow-[inset_0_0_0_1.5px_#a4ca8c,0_1px_0_#142416]',
  },
  {
    key: 'registry',
    label: MESSAGES.district.registryAction,
    icon: '/icons/icon_citizens_group.png',
    iconAlt: MESSAGES.district.registryIconAlt,
    buttonClass:
      'border-2 border-[#142233] bg-[#446f9e] shadow-[inset_0_0_0_1.5px_#88a8ce,0_2.5px_0_#101c2b] active:shadow-[inset_0_0_0_1.5px_#88a8ce,0_1px_0_#101c2b]',
  },
  {
    key: 'dojo',
    label: MESSAGES.district.trainingAction,
    icon: '/icons/icon_upgrade_arrow.png',
    iconAlt: MESSAGES.district.trainingIconAlt,
    buttonClass:
      'border-2 border-[#332111] bg-[#9b7145] text-center shadow-[inset_0_0_0_1.5px_#d7b87f,0_2.5px_0_#24170b] active:shadow-[inset_0_0_0_1.5px_#d7b87f,0_1px_0_#24170b]',
  },
];

/** The three plaza actions: mint a citizen, jump to the registry, open the dojo. */
export const DistrictActionBar: React.FC = () => {
  const mintCitizen = useMintCitizen();

  const scrollToRegistry = () => {
    document.getElementById(REGISTRY_SECTION_ID)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="grid grid-cols-3 gap-2 md:gap-2.5">
      {PLAZA_ACTIONS.map((action) => {
        const className = cn(ACTION_BUTTON_BASE, action.buttonClass);
        const icon = (
          <PixelIcon
            src={action.icon}
            alt={action.iconAlt}
            className={ICON_CLASS}
            effectClassName={ICON_EFFECT_CLASS}
          />
        );
        const label = <span className={ACTION_LABEL_CLASS}>{action.label}</span>;

        if (action.key === 'dojo') {
          return (
            <Link key={action.key} href="/training" className={className}>
              {icon}
              {label}
            </Link>
          );
        }

        return (
          <button
            key={action.key}
            type="button"
            onClick={action.key === 'mint' ? mintCitizen : scrollToRegistry}
            className={className}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
};
