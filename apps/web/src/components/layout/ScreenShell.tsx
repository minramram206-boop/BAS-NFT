'use client';

import React from 'react';
import { MarketNotices } from '@/components/market/MarketNotices';
import { MissionRewardDialog } from '@/components/modal/MissionRewardDialog';
import { PixelModal } from '@/components/modal/PixelModal';
import { cn } from '@/lib/utils/cn';
import { BottomNav } from './BottomNav';
import { ScreenTopBar } from './TopBar';

export interface ScreenShellProps {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

/** One width for the header and the body, so their edges line up. */
const FRAME = 'mx-auto w-full max-w-[1400px]';

/**
 * Frame of every screen except the city: a plain backdrop, a header with the
 * places of the app, a scrolling body and the phone tab bar.
 */
export const ScreenShell: React.FC<ScreenShellProps> = ({ title, subtitle, headerRight, children }) => (
  <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0f1b26] font-pixel text-[#1a2734]">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    />
    <div className="relative z-10 shrink-0 p-2 md:p-4 md:pb-0">
      <div className={FRAME}>
        <ScreenTopBar title={title} {...(subtitle ? { subtitle } : {})} right={headerRight} />
      </div>
    </div>
    <main className="relative z-10 min-h-0 flex-1 overflow-y-auto p-2 md:p-4">
      <div className={cn(FRAME, 'flex min-h-full flex-col')}>{children}</div>
    </main>
    <div className="relative z-10">
      <BottomNav />
    </div>
    <MissionRewardDialog />
    <PixelModal />
    <MarketNotices />
  </div>
);

/**
 * The body of a screen: a left column about the citizen and the page itself on
 * the right. On narrow screens the column sits above the page. The column stays
 * in view while the page scrolls, as long as the window is tall enough to hold it.
 */
export const ScreenColumns: React.FC<{ side: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  side,
  children,
  className,
}) => (
  <div className={cn('grid gap-3 md:gap-4 lg:grid-cols-[320px_minmax(0,1fr)]', className)}>
    <aside className="min-w-0 lg:self-start lg:[@media(min-height:820px)]:sticky lg:[@media(min-height:820px)]:top-0">{side}</aside>
    <div className="flex min-w-0 flex-col gap-3 md:gap-4">{children}</div>
  </div>
);
