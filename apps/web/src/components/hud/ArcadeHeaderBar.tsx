'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { BroadcastTicker } from './BroadcastTicker';
import { StatusPill } from './StatusPill';

export interface ArcadeHeaderBarProps {
  /** Identity bays on the left, e.g. crest + district name + supply. */
  start: React.ReactNode;
  /** Controls on the right, e.g. mode switch, audio, login. */
  end: React.ReactNode;
  /** Telemetry pill shown before the ticker. */
  pillLabel: string;
  pillDotClassName?: string | undefined;
  /** Broadcast marquee content. */
  broadcastTag: string;
  broadcastMessage: string;
  /** Trailing telemetry text, hidden below `lg`. */
  trailing?: React.ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Shared arcade header chrome: gradient bar, flush seams, telemetry pill,
 * broadcast marquee, and right-aligned controls.
 * Both routes used to duplicate this markup.
 */
export const ArcadeHeaderBar: React.FC<ArcadeHeaderBarProps> = ({
  start,
  end,
  pillLabel,
  pillDotClassName,
  broadcastTag,
  broadcastMessage,
  trailing,
  className,
}) => (
  <header
    className={cn(
      'flex h-11 w-full flex-shrink-0 select-none items-stretch justify-between border-b-2 border-[#142434] bg-gradient-to-b from-[#d0e2f0] via-[#c2d5e5] to-[#b0c7db] p-0 shadow-[inset_0_1.5px_0_#ffffff,0_1.5px_0_rgba(255,255,255,0.7)] md:h-12',
      className,
    )}
  >
    <div className="flex h-full min-w-0 items-stretch">{start}</div>

    <div className="flex h-full min-w-0 flex-1 select-none items-center justify-between gap-2.5 overflow-hidden px-2.5 md:gap-3 md:px-4">
      <StatusPill label={pillLabel} dotClassName={pillDotClassName} />
      <BroadcastTicker tag={broadcastTag} message={broadcastMessage} />
      {trailing}
    </div>

    <div className="flex h-full flex-shrink-0 items-stretch">{end}</div>
  </header>
);

export interface HeaderTrailingMetaProps {
  children: React.ReactNode;
  dotClassName?: string | undefined;
}

/** Latency / sync readout at the far right of the header bar. */
export const HeaderTrailingMeta: React.FC<HeaderTrailingMetaProps> = ({
  children,
  dotClassName = 'text-emerald-500',
}) => (
  <span className="hidden flex-shrink-0 items-center gap-1 font-mono text-[9px] font-bold text-[#34526d] lg:flex">
    <span className={dotClassName}>●</span>
    <span>{children}</span>
  </span>
);
