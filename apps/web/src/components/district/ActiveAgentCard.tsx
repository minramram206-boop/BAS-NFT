'use client';

import React from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const ActiveAgentCard: React.FC = () => {
  const { citizens, selectedCitizenId, trainStat } = useBasStore();
  const activeCitizen = citizens.find((c) => c.id === selectedCitizenId) || citizens[0];

  if (!activeCitizen) return null;

  const renderBlocks = (val: number, colorClass: string) => {
    // Map score (0-20) to 5 visual segments
    const filled = Math.min(5, Math.max(1, Math.round((val / 20) * 5)));
    return (
      <div className="flex gap-1 items-center w-full mt-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-3 rounded-xs border border-[#182635] ${
              i < filled ? colorClass : 'bg-[#7e99ab]'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="relative w-full bg-[#c8dbe9] border-2 border-[#182635] rounded-xl p-2 md:p-2.5 shadow-[inset_0_1px_0_#fff] flex flex-col gap-2">
      {/* Top Tab Header: [★ AGENT] matching original mockup */}
      <div className="flex items-center justify-between border-b border-[#a6bfd4] pb-1.5">
        <div className="flex items-center gap-1.5 bg-[#284a6e] border-2 border-[#182635] text-white px-2.5 py-0.5 rounded-lg shadow-xs">
          <span className="text-white text-xs">★</span>
          <span className="font-heading text-xs font-bold tracking-wider">
            AGENT
          </span>
        </div>

        <div className="font-heading text-[11px] font-bold text-[#102232]">
          KODE: <span className="font-pixel text-xs">{activeCitizen.code}</span>
        </div>
      </div>

      {/* Main Body: Left Avatar Portrait vs Right Attributes & Actions */}
      <div className="grid grid-cols-1 md:grid-cols-[110px_1fr] lg:grid-cols-[120px_1fr] gap-2.5 items-center">
        {/* Left Column: Portrait & Badge */}
        <div className="flex flex-col items-center gap-1">
          {/* Avatar Box with clean white fill */}
          <div className="w-18 h-18 md:w-20 md:h-20 bg-[#ffffff] border-2 border-[#7e99ab] rounded-lg p-1 flex items-center justify-center shadow-xs">
            <img
              src={activeCitizen.image}
              alt={activeCitizen.name}
              className="max-w-full max-h-full object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Name Pill Capsule */}
          <div className="w-full text-center bg-[#ffffff] border border-[#182635] py-0.5 px-1 rounded font-heading text-[10px] md:text-[11px] font-bold text-[#102232] shadow-xs truncate">
            {activeCitizen.name} {activeCitizen.code}
          </div>

          {/* Status Badge Pill */}
          <div
            className={`w-full text-center py-0.5 px-1 rounded font-heading text-[9px] font-bold text-white shadow-xs ${
              activeCitizen.registered
                ? 'bg-[#4ea25d] border border-[#1b4a24]'
                : 'bg-[#cb7933] border border-[#5a2e0a]'
            }`}
          >
            {activeCitizen.registered ? 'TERDAFTAR' : 'BELUM TERDAFTAR'}
          </div>
        </div>

        {/* Right Column: 3 Horizontal Stat Meters, Banner, & 3 Authentic CSS Training Buttons */}
        <div className="flex flex-col justify-between gap-1.5 w-full">
          {/* Row 1: 3 Attribute Meters Side-by-Side in pale ice box */}
          <div className="grid grid-cols-3 gap-2 bg-[#edf5fa] border-2 border-[#182635] rounded-lg p-2 shadow-inner">
            {/* INT Meter */}
            <div className="flex flex-col border-r border-[#a6bfd4] pr-2 last:border-r-0">
              <div className="flex items-center justify-between font-heading text-xs font-bold text-[#102232]">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">🧠</span>
                  <span>INT</span>
                </div>
                <span className="text-sm md:text-base text-[#102232] font-bold">
                  {activeCitizen.intelligence}
                </span>
              </div>
              {renderBlocks(activeCitizen.intelligence, 'bg-[#3c76ad]')}
            </div>

            {/* ALN Meter */}
            <div className="flex flex-col border-r border-[#a6bfd4] pr-2 last:border-r-0">
              <div className="flex items-center justify-between font-heading text-xs font-bold text-[#102232]">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">🍃</span>
                  <span>ALN</span>
                </div>
                <span className="text-sm md:text-base text-[#102232] font-bold">
                  {activeCitizen.alignment}
                </span>
              </div>
              {renderBlocks(activeCitizen.alignment, 'bg-[#4ea059]')}
            </div>

            {/* CMP Meter */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between font-heading text-xs font-bold text-[#102232]">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">🤝</span>
                  <span>CMP</span>
                </div>
                <span className="text-sm md:text-base text-[#102232] font-bold">
                  {activeCitizen.composure}
                </span>
              </div>
              {renderBlocks(activeCitizen.composure, 'bg-[#8c5897]')}
            </div>
          </div>

          {/* Row 2: Token Burn Notice Pill matching mockup */}
          <div className="flex items-center gap-1.5 bg-[#ffffff] border border-[#182635] rounded-md px-2 py-0.5 shadow-xs">
            <span className="w-3.5 h-3.5 rounded-full bg-[#182635] text-white flex items-center justify-center font-heading text-[9px] font-bold shrink-0">
              !
            </span>
            <span className="font-pixel text-[11px] md:text-xs font-semibold text-[#102232]">
              skor naik hanya dengan burn token
            </span>
          </div>

          {/* Row 3: 3 Pure CSS Authentic Warm Tan Leather Training Action Buttons */}
          <div className="grid grid-cols-3 gap-1.5 md:gap-2">
            {/* LATIH INT */}
            <button
              onClick={(e) => trainStat('intelligence', e.currentTarget)}
              className="group flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] border-2 border-[#2b1a09] shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_#e8cd9c] hover:brightness-105 transition-all cursor-pointer"
              title="Latih Intelligence (+1 INT)"
            >
              <span className="text-xs drop-shadow-xs">📖</span>
              <span className="font-heading text-[10px] md:text-[11px] font-bold text-white tracking-wider drop-shadow-[0_1px_1px_rgba(20,10,5,0.95)]">
                LATIH INT
              </span>
            </button>

            {/* LATIH ALN */}
            <button
              onClick={(e) => trainStat('alignment', e.currentTarget)}
              className="group flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] border-2 border-[#2b1a09] shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_#e8cd9c] hover:brightness-105 transition-all cursor-pointer"
              title="Latih Alignment (+1 ALN)"
            >
              <span className="text-xs drop-shadow-xs">🍃</span>
              <span className="font-heading text-[10px] md:text-[11px] font-bold text-white tracking-wider drop-shadow-[0_1px_1px_rgba(20,10,5,0.95)]">
                LATIH ALN
              </span>
            </button>

            {/* LATIH CMP */}
            <button
              onClick={(e) => trainStat('composure', e.currentTarget)}
              className="group flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] border-2 border-[#2b1a09] shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_#e8cd9c] hover:brightness-105 transition-all cursor-pointer"
              title="Latih Composure (+1 CMP)"
            >
              <span className="text-xs drop-shadow-xs">🤝</span>
              <span className="font-heading text-[10px] md:text-[11px] font-bold text-white tracking-wider drop-shadow-[0_1px_1px_rgba(20,10,5,0.95)]">
                LATIH CMP
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
