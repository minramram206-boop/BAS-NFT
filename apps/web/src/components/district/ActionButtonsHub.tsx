'use client';

import React from 'react';
import Link from 'next/link';
import { useBasStore } from '@/stores/useBasStore';

export const ActionButtonsHub: React.FC = () => {
  const { citizens, selectedCitizenId, mintCitizen } = useBasStore();
  const activeCitizen = citizens.find((c) => c.id === selectedCitizenId) || citizens[0];

  const speechText = activeCitizen?.registered
    ? `${activeCitizen.name} is verified & registered in District 01.`
    : 'kamu belum terdaftar';

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5 w-full select-none">
      {/* Speech Dialogue Box matching mockup 1:1: double rim border, generous RPG dialogue height */}
      <div className="flex-1 min-h-[140px] bg-[#dbe6f0] border-2 border-[#1c2d3d] rounded-xl shadow-[inset_0_0_0_1.5px_#8ea8be,inset_0_2px_4px_rgba(255,255,255,0.7),0_2px_0_rgba(20,36,52,0.3)] p-4 md:p-5 flex flex-col justify-between">
        {/* Header Bar: Speaker Name + Arrow Indicator + Status Tag */}
        <div className="flex items-center justify-between border-b border-[#a9c0d4] pb-2">
          <div className="flex items-center gap-2 font-pixel text-base md:text-lg font-bold text-[#0c1b2a] leading-none">
            <span>Warga Setempat</span>
            <span className="text-xs md:text-sm text-[#0c1b2a]">▼</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#102235]/10 text-[10px] font-mono font-bold text-[#102235]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>DISTRICT 01</span>
          </div>
        </div>

        {/* Main Dialogue Speech Body */}
        <div className="flex-1 flex flex-col justify-center py-2.5">
          <p className="font-pixel text-base md:text-lg lg:text-[19px] font-bold text-[#0c1b2a] leading-relaxed">
            &ldquo;{speechText}&rdquo;
          </p>
          <p className="font-pixel text-xs md:text-sm text-[#37526d] mt-1.5 leading-normal">
            {activeCitizen?.registered
              ? `Status Terverifikasi • ID: #${activeCitizen.id} • INT ${activeCitizen.intelligence} | ALN ${activeCitizen.alignment} | CMP ${activeCitizen.composure}`
              : 'Gunakan tombol MINT CITIZEN di bawah untuk mendaftarkan avatar warga baru ke dalam Solana ledger.'}
          </p>
        </div>

        {/* Footer Interaction Bar */}
        <div className="pt-2 border-t border-[#a9c0d4] flex items-center justify-between font-pixel text-[11px] md:text-xs text-[#4d6980]">
          <span>💬 Interaksi Plaza Courtyard</span>
          <span className="text-amber-800 font-bold">Pilih aksi di bawah ▼</span>
        </div>
      </div>

      {/* 3 Action Buttons matching mockup 1:1 with double border rim, authentic icons, & outlined white text */}
      <div className="grid grid-cols-3 gap-2 md:gap-2.5">
        {/* 1. MINT CITIZEN Button */}
        <button
          onClick={mintCitizen}
          className="group relative flex flex-col items-center justify-center gap-1.5 py-2.5 md:py-3 px-1 min-h-[66px] md:min-h-[74px] rounded-lg bg-[#5c9053] border-2 border-[#182b1b] shadow-[inset_0_0_0_1.5px_#a4ca8c,0_2.5px_0_#142416] active:translate-y-0.5 active:shadow-[inset_0_0_0_1.5px_#a4ca8c,0_1px_0_#142416] hover:brightness-105 transition-all cursor-pointer"
        >
          {/* Authentic Egg with green gem */}
          <img
            src="/icons/icon_mint_egg.png"
            alt="Mint Citizen"
            className="h-7 md:h-8 w-auto object-contain image-rendering-pixelated drop-shadow-xs group-hover:scale-110 transition-transform"
          />
          <span className="font-heading text-[10px] md:text-xs font-black pixel-text-outlined tracking-wider uppercase leading-none">
            MINT CITIZEN
          </span>
        </button>

        {/* 2. LIHAT WARGA Button */}
        <button
          onClick={() => {
            const regEl = document.getElementById('citizen-registry-section');
            if (regEl) regEl.scrollIntoView({ behavior: 'smooth' });
          }}
          className="group relative flex flex-col items-center justify-center gap-1.5 py-2.5 md:py-3 px-1 min-h-[66px] md:min-h-[74px] rounded-lg bg-[#446f9e] border-2 border-[#142233] shadow-[inset_0_0_0_1.5px_#88a8ce,0_2.5px_0_#101c2b] active:translate-y-0.5 active:shadow-[inset_0_0_0_1.5px_#88a8ce,0_1px_0_#101c2b] hover:brightness-105 transition-all cursor-pointer"
        >
          {/* Authentic 3 citizens group icon */}
          <img
            src="/icons/icon_citizens_group.png"
            alt="Lihat Warga"
            className="h-7 md:h-8 w-auto object-contain image-rendering-pixelated drop-shadow-xs group-hover:scale-110 transition-transform"
          />
          <span className="font-heading text-[10px] md:text-xs font-black pixel-text-outlined tracking-wider uppercase leading-none">
            LIHAT WARGA
          </span>
        </button>

        {/* 3. UPGRADE Button (routes to Dojo) */}
        <Link
          href="/training"
          className="group relative flex flex-col items-center justify-center gap-1.5 py-2.5 md:py-3 px-1 min-h-[66px] md:min-h-[74px] rounded-lg bg-[#9b7145] border-2 border-[#332111] shadow-[inset_0_0_0_1.5px_#d7b87f,0_2.5px_0_#24170b] active:translate-y-0.5 active:shadow-[inset_0_0_0_1.5px_#d7b87f,0_1px_0_#24170b] hover:brightness-105 transition-all cursor-pointer text-center"
        >
          {/* Authentic 3D cream up arrow */}
          <img
            src="/icons/icon_upgrade_arrow.png"
            alt="Upgrade"
            className="h-7 md:h-8 w-auto object-contain image-rendering-pixelated drop-shadow-xs group-hover:scale-110 transition-transform"
          />
          <span className="font-heading text-[10px] md:text-xs font-black pixel-text-outlined tracking-wider uppercase leading-none">
            UPGRADE
          </span>
        </Link>
      </div>
    </div>
  );
};
