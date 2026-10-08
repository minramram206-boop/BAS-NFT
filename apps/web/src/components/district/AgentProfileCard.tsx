'use client';

import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { STAT_ORDER } from '@/config/constants';
import { MESSAGES } from '@/messages';
import { PixelSprite } from '@/components/ui/PixelSprite';
import { StatMeter } from '@/components/ui/StatMeter';
import { TrainStatButton } from '@/components/ui/TrainStatButton';

export interface AgentProfileCardProps {
  citizen: CitizenRecord;
}

const TAB_CLASS =
  'flex items-center gap-1.5 rounded-lg border-2 border-[#182635] bg-[#284a6e] px-2.5 py-0.5 text-white shadow-xs';
const NAME_PILL_CLASS =
  'w-full truncate rounded border border-[#182635] bg-[#ffffff] px-1 py-0.5 text-center font-heading text-[10px] font-bold text-[#102232] shadow-xs md:text-[11px]';

/** Active agent profile: portrait, registration badge, stat meters, and drills. */
export const AgentProfileCard: React.FC<AgentProfileCardProps> = ({ citizen }) => (
  <section className="relative flex w-full flex-col gap-2 rounded-xl border-2 border-[#182635] bg-[#c8dbe9] p-2 shadow-[inset_0_1px_0_#fff] md:gap-2.5 md:p-2.5">
    <header className="flex items-center justify-between border-b border-[#a6bfd4] pb-1.5">
      <span className={TAB_CLASS}>
        <span className="text-xs text-white">★</span>
        <span className="font-heading text-xs font-bold tracking-wider">{MESSAGES.district.agentLabel}</span>
      </span>
      <span className="flex items-center gap-2 font-heading text-[10px] font-bold text-[#102232]">
        <span>{citizen.role}</span>
        <span>{MESSAGES.district.codeLabel} <span className="font-pixel text-xs">{citizen.code}</span></span>
      </span>
    </header>

    <div className="grid grid-cols-1 items-center gap-2.5 md:grid-cols-[110px_1fr] lg:grid-cols-[120px_1fr]">
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-18 w-18 items-center justify-center rounded-lg border-2 border-[#7e99ab] bg-[#ffffff] p-1 shadow-xs md:h-20 md:w-20">
          <PixelSprite
            src={citizen.image}
            alt={citizen.name}
            width={160}
            height={160}
            className="flex max-h-full max-w-full items-center justify-center overflow-hidden"
            imageClassName="drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
          />
        </div>

        <div className={NAME_PILL_CLASS}>
          {citizen.name} {citizen.code}
        </div>

        <div
          className={`w-full rounded px-1 py-0.5 text-center font-heading text-[9px] font-bold text-white shadow-xs ${
            citizen.registered
              ? 'border border-[#1b4a24] bg-[#4ea25d]'
              : 'border border-[#5a2e0a] bg-[#cb7933]'
          }`}
        >
          {citizen.registered ? MESSAGES.district.registered : MESSAGES.district.notRegistered}
        </div>
      </div>

      <div className="flex w-full flex-col justify-between gap-1.5">
        <div className="grid grid-cols-3 gap-2 rounded-lg border-2 border-[#182635] bg-[#edf5fa] p-2 shadow-inner">
          {STAT_ORDER.map((stat, index) => (
            <StatMeter
              key={stat}
              stat={stat}
              value={citizen[stat]}
              className={index < STAT_ORDER.length - 1 ? 'border-r border-[#a6bfd4] pr-2' : undefined}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 rounded-md border border-[#182635] bg-[#ffffff] px-2 py-0.5 shadow-xs">
          <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-[#182635] font-heading text-[9px] font-bold text-white">
            !
          </span>
          <span className="font-pixel text-[11px] font-semibold text-[#102232] md:text-xs">
            {MESSAGES.district.previewUpgradeNotice}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 md:gap-2">
          {STAT_ORDER.map((stat) => (
            <TrainStatButton key={stat} stat={stat} />
          ))}
        </div>
      </div>
    </div>
  </section>
);
