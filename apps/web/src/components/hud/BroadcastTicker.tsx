'use client';

import React from 'react';

export interface BroadcastTickerProps {
  /** Highlighted prefix of the broadcast, e.g. `⚡ LIVE BROADCAST:`. */
  tag: string;
  /** Scrolling message body. */
  message: string;
}

/** Endless retro marquee filling the free space of the header bar. */
export const BroadcastTicker: React.FC<BroadcastTickerProps> = ({ tag, message }) => (
  <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
    <div className="animate-arcade-marquee font-mono text-[10px] font-bold tracking-wider text-[#14283d] md:text-[11px]">
      <span className="mr-2 font-extrabold text-amber-700">{tag}</span>
      <span>{message}</span>
    </div>
  </div>
);
