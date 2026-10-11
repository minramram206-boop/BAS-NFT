'use client';

import React from 'react';
import { PixelModal } from '@/components/modal/PixelModal';
import { BottomNav } from './BottomNav';
import { ScreenTopBar } from './TopBar';

export interface ScreenShellProps {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Frame of every screen except the city: the city dimmed behind, a header,
 * a scrolling body and the phone tab bar.
 */
export const ScreenShell: React.FC<ScreenShellProps> = ({ title, subtitle, headerRight, children }) => (
  <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0c1622] font-pixel text-[#1a2734]">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
      style={{ backgroundImage: "url('/images/city/city-base.png')", imageRendering: 'pixelated' }}
    />
    <div className="relative z-10 shrink-0 p-2 md:p-4 md:pb-0">
      <ScreenTopBar title={title} {...(subtitle ? { subtitle } : {})} right={headerRight} />
    </div>
    <main className="relative z-10 min-h-0 flex-1 overflow-y-auto p-2 md:p-4">{children}</main>
    <div className="relative z-10">
      <BottomNav />
    </div>
    <PixelModal />
  </div>
);
