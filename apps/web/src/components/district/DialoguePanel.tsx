'use client';

import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { UI } from '@/config/constants';
import { MESSAGES, formatMessage } from '@/messages';

export interface DialoguePanelProps {
  citizen: CitizenRecord;
}

/** Preview dialogue panel for the selected citizen. */
export const DialoguePanel: React.FC<DialoguePanelProps> = ({ citizen }) => {
  const speech = citizen.registered
    ? formatMessage(MESSAGES.district.registeredSpeech, { name: citizen.name })
    : MESSAGES.district.unregisteredSpeech;

  const detail = citizen.registered
    ? formatMessage(MESSAGES.district.registeredDetail, {
        id: citizen.id,
        insight: citizen.intelligence,
        bond: citizen.alignment,
        craft: citizen.compute,
      })
    : MESSAGES.district.unregisteredHint;

  return (
    <section className="flex min-h-[140px] flex-1 flex-col justify-between rounded-xl border-2 border-[#1c2d3d] bg-[#dbe6f0] p-4 shadow-[inset_0_0_0_1.5px_#8ea8be,inset_0_2px_4px_rgba(255,255,255,0.7),0_2px_0_rgba(20,36,52,0.3)] md:p-5">
      <header className="flex items-center justify-between border-b border-[#a9c0d4] pb-2">
        <span className="flex items-center gap-2 font-pixel text-base font-bold leading-none text-[#0c1b2a] md:text-lg">
          <span>{MESSAGES.district.localCitizenTitle}</span>
          <span className="text-xs text-[#0c1b2a] md:text-sm" aria-hidden="true">▼</span>
        </span>
        <span className="flex items-center gap-1.5 rounded bg-[#102235]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#102235]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          <span>{MESSAGES.district.onlineLabel}</span>
        </span>
      </header>

      <div className="flex flex-1 flex-col justify-center py-2.5">
        <p className="font-pixel text-base font-bold leading-relaxed text-[#0c1b2a] md:text-lg lg:text-[19px]">
          &ldquo;{speech}&rdquo;
        </p>
        <p className="mt-1.5 font-pixel text-xs leading-normal text-[#37526d] md:text-sm">
          {detail}
        </p>
      </div>

      <footer className="flex items-center justify-between border-t border-[#a9c0d4] pt-2 font-pixel text-[11px] text-[#4d6980] md:text-xs">
        <span>💬 {MESSAGES.district.interaction}</span>
        <span className="font-bold text-amber-800">{MESSAGES.district.chooseAction} ▼</span>
      </footer>
    </section>
  );
};
