'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBasStore } from '@/stores/useBasStore';

export const GlobalHud: React.FC = () => {
  const pathname = usePathname();
  const {
    supplyCount,
    tokensBurned,
    sfxEnabled,
    toggleSfx,
    isLoggedIn,
    walletAddress,
    toggleLogin,
  } = useBasStore();

  const isDistrict = pathname === '/' || pathname === '';
  const isTraining = pathname.startsWith('/training');

  return (
    <header className="w-full bg-[#182330] border-2 border-[#33485e] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
      {/* Brand Left */}
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
          <h1 className="font-heading text-sm md:text-base font-bold text-[#c9dbed] tracking-wider">
            BAS &bull; DISTRICT 01
          </h1>
        </Link>

        {/* View Switch Tabs */}
        <div className="flex items-center gap-1.5 ml-2 md:ml-4">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-md font-heading text-xs font-semibold transition-all border ${
              isDistrict
                ? 'bg-[#4a759e] border-[#8bb6de] text-white shadow-inner'
                : 'bg-[#253648] border-[#48637e] text-[#bcd0e4] hover:bg-[#344c66]'
            }`}
          >
            🏰 DISTRICT 01
          </Link>
          <Link
            href="/training"
            className={`px-3 py-1.5 rounded-md font-heading text-xs font-semibold transition-all border ${
              isTraining
                ? 'bg-[#4a759e] border-[#8bb6de] text-white shadow-inner'
                : 'bg-[#253648] border-[#48637e] text-[#bcd0e4] hover:bg-[#344c66]'
            }`}
          >
            ⚔ TRAINING DOJO
          </Link>
        </div>
      </div>

      {/* Live Ticker Center */}
      <div className="hidden lg:flex items-center gap-2 font-heading text-xs text-[#a3bed7]">
        <div className="bg-[#121b24] px-3 py-1 rounded-md border border-[#2b3c4f]">
          📦 SUPPLY: <strong className="text-white">{supplyCount}/100</strong>
        </div>
        <div className="bg-[#121b24] px-3 py-1 rounded-md border border-[#2b3c4f]">
          🔥 BURN: <strong className="text-amber-400">{tokensBurned} $DIST</strong>
        </div>
      </div>

      {/* Controls Right */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSfx}
          className="bg-[#253648] hover:bg-[#344c66] border border-[#48637e] text-[#bcd0e4] font-heading text-xs px-3 py-1.5 rounded-md transition-colors"
        >
          {sfxEnabled ? '🔊 SFX ON' : '🔇 SFX OFF'}
        </button>

        <button
          onClick={toggleLogin}
          className="bg-[#d4a75e] hover:bg-[#e3b870] border-2 border-[#573f1d] text-[#3b2409] font-heading text-xs font-bold px-3.5 py-1.5 rounded-md shadow-[0_2px_0_#573f1d] active:translate-y-0.5 transition-transform"
        >
          {isLoggedIn ? `🟢 ${walletAddress}` : '🚪 LOGIN'}
        </button>
      </div>
    </header>
  );
};
