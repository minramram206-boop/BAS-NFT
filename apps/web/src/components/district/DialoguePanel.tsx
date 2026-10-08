'use client';

import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { UI } from '@/config/constants';

export interface DialoguePanelProps {
  citizen: CitizenRecord;
}

const UNREGISTERED_SPEECH = 'kamu belum terdaftar';
const UNREGISTERED_HINT =
  'Gunakan tombol MINT CITIZEN di bawah untuk mendaftarkan avatar warga baru ke dalam Solana ledger.';

/** RPG dialogue box of the plaza, showing the selected citizen's status. */
export const DialoguePanel: React.FC<DialoguePanelProps> = ({ citizen }) => {
  const speech = citizen.registered
    ? `${citizen.name} is verified & registered in ${UI.districtName}.`
    : UNREGISTERED_SPEECH;

  const detail = citizen.registered
    ? `Status Terverifikasi • ID: #${citizen.id} • INT ${citizen.intelligence} | ALN ${citizen.alignment} | CMP ${citizen.composure}`
    : UNREGISTERED_HINT;

  return (
    <section className="flex min-h-[140px] flex-1 flex-col justify-between rounded-xl border-2 border-[#1c2d3d] bg-[#dbe6f0] p-4 shadow-[inset_0_0_0_1.5px_#8ea8be,inset_0_2px_4px_rgba(255,255,255,0.7),0_2px_0_rgba(20,36,52,0.3)] md:p-5">
      <header className="flex items-center justify-between border-b border-[#a9c0d4] pb-2">
        <span className="flex items-center gap-2 font-pixel text-base font-bold leading-none text-[#0c1b2a] md:text-lg">
          <span>Warga Setempat</span>
          <span className="text-xs text-[#0c1b2a] md:text-sm">▼</span>
        </span>
        <span className="flex items-center gap-1.5 rounded bg-[#102235]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#102235]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span>{UI.districtName}</span>
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
        <span>💬 Interaksi Plaza Courtyard</span>
        <span className="font-bold text-amber-800">Pilih aksi di bawah ▼</span>
      </footer>
    </section>
  );
};
