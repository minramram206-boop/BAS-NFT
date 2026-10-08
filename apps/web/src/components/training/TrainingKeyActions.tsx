'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useBasStore } from '@/stores/useBasStore';

export const TrainingKeyActions: React.FC = () => {
  const router = useRouter();
  const { trainStat } = useBasStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '1') {
        trainStat('intelligence');
      } else if (e.key === '2') {
        trainStat('alignment');
      } else if (e.key === '3') {
        router.push('/');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [trainStat, router]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3 w-full">
      {/* 1. Latih Intelligence Button */}
      <button
        onClick={(e) => trainStat('intelligence', e.currentTarget)}
        className="group relative flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-gradient-to-b from-[#5588b9] via-[#4374a3] to-[#33618d] border-2 border-[#183248] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#183248] active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)] transition-all cursor-pointer"
      >
        <span className="w-6 h-6 rounded-md bg-white/20 border border-white/40 flex items-center justify-center font-heading text-xs font-bold text-white shadow-xs">
          1
        </span>
        <div className="flex flex-col items-start leading-none">
          <span className="font-heading text-xs font-bold text-white tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
            📖 LATIH INTELLIGENCE
          </span>
          <span className="text-[9px] font-heading text-sky-200 mt-0.5">
            +1 INT &bull; -1 $DIST
          </span>
        </div>
      </button>

      {/* 2. Latih Alignment Button */}
      <button
        onClick={(e) => trainStat('alignment', e.currentTarget)}
        className="group relative flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-gradient-to-b from-[#c89955] via-[#b38541] to-[#9c7130] border-2 border-[#432c12] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#432c12] active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)] transition-all cursor-pointer"
      >
        <span className="w-6 h-6 rounded-md bg-white/20 border border-white/40 flex items-center justify-center font-heading text-xs font-bold text-white shadow-xs">
          2
        </span>
        <div className="flex flex-col items-start leading-none">
          <span className="font-heading text-xs font-bold text-white tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
            ⚖ LATIH ALIGNMENT
          </span>
          <span className="text-[9px] font-heading text-amber-200 mt-0.5">
            +1 ALN &bull; -1 $DIST
          </span>
        </div>
      </button>

      {/* 3. Kembali ke Kota Button */}
      <Link
        href="/"
        className="group relative flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-gradient-to-b from-[#69ad6f] via-[#569e5d] to-[#438a49] border-2 border-[#1a381e] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6),0_3px_0_#1a381e] active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.6)] transition-all cursor-pointer text-center"
      >
        <span className="w-6 h-6 rounded-md bg-white/20 border border-white/40 flex items-center justify-center font-heading text-xs font-bold text-white shadow-xs">
          3
        </span>
        <div className="flex flex-col items-start leading-none">
          <span className="font-heading text-xs font-bold text-white tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
            🏰 KEMBALI KE KOTA
          </span>
          <span className="text-[9px] font-heading text-emerald-100 mt-0.5">
            District 01 Hub
          </span>
        </div>
      </Link>
    </div>
  );
};
