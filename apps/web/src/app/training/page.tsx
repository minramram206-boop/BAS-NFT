'use client';

import React from 'react';
import Link from 'next/link';
import { GlobalHud } from '@/components/hud/GlobalHud';
import { TrainingHeroStage } from '@/components/training/TrainingHeroStage';
import { TrainingStatsCard } from '@/components/training/TrainingStatsCard';
import { TrainingKeyActions } from '@/components/training/TrainingKeyActions';
import { AvatarSelectionStrip } from '@/components/training/AvatarSelectionStrip';
import { PixelModal } from '@/components/modal/PixelModal';
import { HeaderSeam } from '@/components/hud/HeaderSeam';

export default function TrainingPage() {
  return (
    <main className="w-full h-full m-0 bas-arcade-bezel flex flex-col overflow-hidden select-none">
      <div className="w-full h-full bas-arcade-screen p-0 flex flex-col justify-between overflow-hidden">
        {/* Top Header Bar matching Mockup (Flush Mepet ke Atas & Samping) */}
        <header className="w-full h-11 md:h-12 flex-shrink-0 bg-gradient-to-b from-[#d0e2f0] via-[#c2d5e5] to-[#b0c7db] border-b-2 border-[#142434] flex items-stretch justify-between shadow-[inset_0_1.5px_0_#ffffff,0_1.5px_0_rgba(255,255,255,0.7)] select-none p-0">
          <div className="flex items-stretch h-full">
            <div className="flex items-center gap-2.5 md:gap-3 px-3 md:px-4 h-full">
              <div className="w-7 h-8 md:w-8 md:h-9 bg-[#234d7d] border-2 border-[#102235] rounded-b-lg flex items-center justify-center shadow-[inset_0_1px_0_#6da5df]">
                <span className="text-white text-sm md:text-base font-bold">⚔</span>
              </div>
              <span className="font-heading text-sm md:text-base lg:text-[17px] font-extrabold text-[#091827] tracking-wider whitespace-nowrap leading-none">
                TRAINING DOJO
              </span>
            </div>

            <HeaderSeam />
          </div>

          {/* Bay Tengah: Dojo Telemetry & Guidance Marquee */}
          <div className="flex-1 min-w-0 h-full flex items-center justify-between px-2.5 md:px-4 gap-2.5 md:gap-3 overflow-hidden select-none">
            <div className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#102235]/10 border border-[#102235]/20 text-[#102235] font-mono text-[9px] md:text-[10px] font-bold flex-shrink-0 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span>DOJO SIMULATION</span>
            </div>

            <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden">
              <div className="animate-arcade-marquee text-[#14283d] font-mono text-[10px] md:text-[11px] font-bold tracking-wider">
                <span className="text-amber-700 font-extrabold mr-2">⚔ DRILL ACTIVE:</span>
                <span>SELECT ANY CITIZEN BELOW &bull; CLICK STAT BUTTON TO TRAIN INT / ALN / CMP &bull; MAX STAT 20 PER CITIZEN &bull; BAS ARCADE VERIFIED 🛡</span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-1 font-mono text-[9px] text-[#34526d] font-bold flex-shrink-0">
              <span className="text-amber-600">●</span>
              <span>SYNCHRONIZED</span>
            </div>
          </div>

          <div className="flex items-stretch h-full flex-shrink-0">
            <HeaderSeam />
            <div className="flex items-center gap-2 px-3 h-full">
              <Link
                href="/"
                className="bg-[#244b7a] hover:bg-[#2d5c94] border-2 border-[#102235] text-white font-heading text-[10px] md:text-xs font-bold px-3 py-1 rounded-lg shadow-[inset_0_1px_0_#6fa7e4,0_2px_0_#102235] active:translate-y-0.5 transition-all flex items-center gap-1.5"
              >
                <span>🏰</span>
                <span>KEMBALI KE DISTRICT 01</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Content Area with grid floor below header */}
        <div className="w-full flex-1 min-h-0 p-1.5 md:p-2 flex flex-col justify-between gap-1.5 overflow-hidden">
          {/* Upper Section: Hero Stage Left, Stats Right */}
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2.5 items-stretch">
            <TrainingHeroStage />
            <TrainingStatsCard />
          </div>

          {/* Keyboard Action Buttons */}
          <div className="flex-shrink-0">
            <TrainingKeyActions />
          </div>

          {/* Full Avatar Selection Strip */}
          <div className="flex-shrink-0">
            <AvatarSelectionStrip />
          </div>

          {/* Bottom District Status Line */}
          <footer className="w-full flex-shrink-0 pt-1 pb-0.5 border-t border-[#8ba6be] flex items-center justify-center gap-3 font-heading text-[9px] md:text-[11px] font-bold text-[#233f5b]">
            <span className="text-[#3b5d80]">🛡</span>
            <div className="flex-1 h-[1.5px] bg-[#9bb2c6]" />
            <span className="tracking-wider">◇ DISTRICT ONLINE &bull; PROGRAM: Bas1...7SoL &bull; SOLANA VERIFIED ◇</span>
            <div className="flex-1 h-[1.5px] bg-[#9bb2c6]" />
            <span className="text-[#3b5d80]">🛡</span>
          </footer>
        </div>
      </div>

      {/* Global Interactive Modal */}
      <PixelModal />
    </main>
  );
}
