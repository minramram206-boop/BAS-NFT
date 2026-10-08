'use client';

import React, { useEffect } from 'react';
import { useBasStore } from '@/stores/useBasStore';
import { CourtyardStage } from '@/components/district/CourtyardStage';
import { ActionButtonsHub } from '@/components/district/ActionButtonsHub';
import { CitizenRegistryGrid } from '@/components/district/CitizenRegistryGrid';
import { ActiveAgentCard } from '@/components/district/ActiveAgentCard';
import { TrainingHeroStage } from '@/components/training/TrainingHeroStage';
import { TrainingStatsCard } from '@/components/training/TrainingStatsCard';
import { TrainingKeyActions } from '@/components/training/TrainingKeyActions';
import { AvatarSelectionStrip } from '@/components/training/AvatarSelectionStrip';
import { PixelModal } from '@/components/modal/PixelModal';
import { HeaderSeam } from '@/components/hud/HeaderSeam';

export default function HomePage() {
  const {
    viewMode,
    setViewMode,
    supplyCount,
    tokensBurned,
    sfxEnabled,
    toggleSfx,
    isLoggedIn,
    walletAddress,
    toggleLogin,
  } = useBasStore();

  useEffect(() => {
    const handleHash = () => {
      if (typeof window !== 'undefined') {
        if (window.location.hash === '#training') {
          setViewMode('training');
        } else if (window.location.hash === '#district') {
          setViewMode('district');
        }
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [setViewMode]);

  return (
    <main className="w-full h-full m-0 bas-arcade-bezel flex flex-col overflow-hidden select-none">
      <div className="w-full h-full bas-arcade-screen p-0 flex flex-col justify-between overflow-hidden">
        {/* ======================================================== */}
        {/* HEADER BAR (Flush Mepet ke Atas & Samping Tanpa Celah)    */}
        {/* ======================================================== */}
        <header className="w-full h-11 md:h-12 flex-shrink-0 bg-gradient-to-b from-[#d0e2f0] via-[#c2d5e5] to-[#b0c7db] border-b-2 border-[#142434] flex items-stretch justify-between shadow-[inset_0_1.5px_0_#ffffff,0_1.5px_0_rgba(255,255,255,0.7)] select-none p-0">
          {/* Sisi Kiri: DISTRICT 01 Bay + Seam + SUPPLY 100 Bay + BURN */}
          <div className="flex items-stretch h-full min-w-0">
            {/* Bay 1: Crest Shield + DISTRICT 01 (Bold & Large matching Reference Mockup) */}
            <div className="flex items-center gap-2.5 md:gap-3 px-3 md:px-4 h-full">
              <img
                src="/icons/shield_crest.png"
                alt="District 01 Shield"
                className="h-8 md:h-9 w-auto object-contain image-rendering-pixelated drop-shadow-xs"
              />
              <span className="font-heading text-sm md:text-base lg:text-[17px] font-extrabold text-[#091827] tracking-wider whitespace-nowrap leading-none">
                DISTRICT 01
              </span>
            </div>

            {/* Pemisah Vertikal Nempel Penuh dengan Notch Lengkung */}
            <HeaderSeam />

            {/* Bay 2: Supply Crate + SUPPLY 100 */}
            <div className="flex items-center gap-2 px-3 md:px-4 h-full">
              <img
                src="/icons/supply_crate.png"
                alt="Supply Crate"
                className="h-7 md:h-8 w-auto object-contain image-rendering-pixelated drop-shadow-xs"
              />
              <span className="font-heading text-sm md:text-base font-extrabold text-[#091827] tracking-wider whitespace-nowrap leading-none">
                SUPPLY <strong className="text-[#06121f]">{supplyCount}</strong>
              </span>
            </div>

            {/* Pemisah Vertikal Nempel Penuh Konsisten */}
            <HeaderSeam />

            {/* Bay 3: BURN Token Tracker */}
            <div className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 h-full">
              <span className="text-sm md:text-base leading-none">🔥</span>
              <span className="font-heading text-xs md:text-sm lg:text-[15px] font-extrabold text-[#091827] tracking-wider whitespace-nowrap leading-none">
                BURN <strong className="text-amber-700">{tokensBurned} $DIST</strong>
              </span>
            </div>

            {/* Pemisah Vertikal Penutup Bay 3 */}
            <HeaderSeam />
          </div>

          {/* Bay Tengah: Live District Telemetry & Arcade Broadcast Ticker (Mengisi Area Kosong) */}
          <div className="flex-1 min-w-0 h-full flex items-center justify-between px-2.5 md:px-4 gap-2.5 md:gap-3 overflow-hidden select-none">
            {/* Solana Network Status Pill */}
            <div className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#102235]/10 border border-[#102235]/20 text-[#102235] font-mono text-[9px] md:text-[10px] font-bold flex-shrink-0 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>SOLANA MAINNET</span>
            </div>

            {/* Retro Pixel Ticker Teks Berjalan */}
            <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden">
              <div className="animate-arcade-marquee text-[#14283d] font-mono text-[10px] md:text-[11px] font-bold tracking-wider">
                <span className="text-amber-700 font-extrabold mr-2">⚡ LIVE BROADCAST:</span>
                <span>DISTRICT 01 ONLINE &bull; {100 - supplyCount}/100 CITIZENS ACTIVE &bull; BURN $DIST TO LEVEL UP STATS &bull; PREPARE FOR DOJO TRAINING &bull; PROGRAM Bas1...7SoL &bull; SOLANA VERIFIED 🛡</span>
              </div>
            </div>

            {/* Latency Ping */}
            <div className="hidden lg:flex items-center gap-1 font-mono text-[9px] text-[#34526d] font-bold flex-shrink-0">
              <span className="text-emerald-500">●</span>
              <span>24ms</span>
            </div>
          </div>

          {/* Sisi Kanan: Switcher + SFX + Pintu + LOGIN (Semua Dipisahkan Konsisten dengan HeaderSeam) */}
          <div className="flex items-stretch h-full flex-shrink-0">
            {/* Pemisah Pembuka Sisi Kanan */}
            <HeaderSeam />

            {/* Bay 4: Mode Switcher (DOJO) */}
            <div className="flex items-center px-2 md:px-2.5 h-full">
              <button
                onClick={() => setViewMode(viewMode === 'district' ? 'training' : 'district')}
                className="inline-flex items-center gap-1 bg-[#284a6e] hover:bg-[#345c88] border border-[#182635] text-white font-heading text-[10px] md:text-xs font-bold px-2 py-1 rounded-md transition-all shadow-xs cursor-pointer"
                title="Beralih Mode Tampilan"
              >
                {viewMode === 'district' ? '⚔ DOJO' : '🏰 DISTRICT'}
              </button>
            </div>

            {/* Pemisah Vertikal Antara Mode & Audio */}
            <HeaderSeam />

            {/* Bay 5: Audio Controls (SFX) */}
            <div className="flex items-center px-2 md:px-2.5 h-full">
              <button
                onClick={toggleSfx}
                className="inline-flex items-center bg-[#ffffff] hover:bg-[#eef5fa] border border-[#182635] text-[#102232] font-heading text-[10px] px-2 py-1 rounded-md transition-colors cursor-pointer"
                title="Toggle Audio 8-bit"
              >
                {sfxEnabled ? '🔊 ON' : '🔇 OFF'}
              </button>
            </div>

            {/* Pemisah Vertikal Menuju Pintu & Login */}
            <HeaderSeam />

            {/* Bay 6: Door Icon + Native Pixel LOGIN Button */}
            <div className="flex items-center gap-2.5 md:gap-3 px-3 md:px-4 h-full">
              {/* Door Icon */}
              <img
                src="/icons/door_icon.png"
                alt="Door"
                className="h-7 md:h-8 w-auto object-contain image-rendering-pixelated cursor-pointer hover:brightness-110"
              />

              {/* Native CSS Login Button matching mockup */}
              <button
                onClick={toggleLogin}
                className="bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] border-2 border-[#2b1a09] shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] rounded-md px-3 md:px-3.5 py-1 font-heading text-xs md:text-sm font-extrabold text-[#2a1a08] tracking-wider active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_#e8cd9c] hover:brightness-105 transition-all cursor-pointer whitespace-nowrap"
                title={isLoggedIn ? `Logged in: ${walletAddress}` : 'Login Wallet'}
              >
                {isLoggedIn ? walletAddress : 'LOGIN'}
              </button>
            </div>
          </div>
        </header>

        {/* ======================================================== */}
        {/* MAIN SCREEN FLOOR AREA (Padded Content & Footer)         */}
        {/* ======================================================== */}
        <div className="w-full flex-1 min-h-0 p-2 md:p-2.5 flex flex-col justify-between gap-2 overflow-hidden">
          {/* ======================================================== */}
          {/* VIEW 1: DISTRICT 01 (TRUE FULLSCREEN SIDE-BY-SIDE)       */}
          {/* ======================================================== */}
          {viewMode === 'district' && (
        <div className="w-full flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch animate-in fade-in duration-200">
          {/* SISI KIRI (5 / 12 COLS): PLAZA 2.5D + DIALOG & 3 TOMBOL AKSI */}
          <div className="lg:col-span-5 h-full min-h-0 flex flex-col justify-between gap-2.5">
            {/* Panggung Plaza Courtyard 2.5D (Tinggi Dibatasi & Proporsional) */}
            <div className="w-full relative flex-shrink-0">
              <CourtyardStage />
            </div>

            {/* Kotak Warga Setempat (Luas & Kaya Info) & 3 Tombol Aksi */}
            <div className="flex-1 min-h-0 w-full flex flex-col justify-end">
              <ActionButtonsHub />
            </div>
          </div>

          {/* SISI KANAN (7 / 12 COLS): PROFIL AGENT & REGISTRI 3x3 */}
          <div className="lg:col-span-7 h-full min-h-0 flex flex-col gap-2 md:gap-2.5">
            {/* Profil & Statistik Agent Aktif */}
            <div className="flex-shrink-0 w-full">
              <ActiveAgentCard />
            </div>

            {/* Grid Registri Warga 3x3 */}
            <div className="flex-1 min-h-0 w-full">
              <CitizenRegistryGrid />
            </div>
          </div>
        </div>
      )}

        {/* ======================================================== */}
        {/* VIEW 2: AGENT TRAINING DOJO                              */}
        {/* ======================================================== */}
        {viewMode === 'training' && (
          <div className="flex flex-col gap-3.5 animate-in fade-in duration-200">
            {/* Top Dojo Banner */}
            <div className="flex items-center justify-between bg-[#bdcddc] border-2 border-[#182635] rounded-xl px-4 py-2 shadow-[inset_0_1px_0_#fff]">
              <div className="flex items-center gap-2 font-heading text-xs md:text-sm font-bold text-[#102232]">
                <span className="text-amber-600">✧</span>
                <span>AGENT TRAINING DOJO</span>
                <span className="text-amber-600">✧</span>
              </div>

              <button
                onClick={() => setViewMode('district')}
                className="bg-[#284a6e] hover:bg-[#345c88] border border-[#182635] text-white px-3 py-1 rounded-md font-heading text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                🏰 KEMBALI KE DISTRICT 01
              </button>
            </div>

            {/* Upper Section: Hero Stage Left, Stats Right */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TrainingHeroStage />
              <TrainingStatsCard />
            </div>

            {/* Keyboard Action Buttons */}
            <TrainingKeyActions />

            {/* Full Avatar Selection Strip */}
            <AvatarSelectionStrip />
          </div>
        )}

      {/* ======================================================== */}
      {/* FOOTER STATUS LINE                                       */}
      {/* ======================================================== */}
      <footer className="w-full flex-shrink-0 pt-1 pb-0.5 border-t border-[#95aaba] flex items-center justify-center gap-3 font-heading text-[10px] md:text-xs font-bold text-[#102232] select-none">
        <span className="text-base">🛡</span>
        <div className="flex-1 h-px bg-[#95aaba]" />
        <span>◇ DISTRICT ONLINE &bull; PROGRAM: Bas1...7SoL &bull; SOLANA VERIFIED ◇</span>
        <div className="flex-1 h-px bg-[#95aaba]" />
        <span className="text-base">🛡</span>
      </footer>
        </div>
      </div>

      {/* Global Interactive Modal */}
      <PixelModal />
    </main>
  );
}
