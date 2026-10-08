'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface HeaderSeamProps {
  className?: string | undefined;
}

/**
 * Retro seam divider: connects flush from the top border to the bottom border
 * of the header bar, with the characteristic curved notch flares.
 */
export const HeaderSeam: React.FC<HeaderSeamProps> = ({ className }) => (
  <div
    className={cn('relative flex h-full w-[12px] flex-shrink-0 select-none items-center justify-center', className)}
    aria-hidden="true"
  >
    <SeamNotch position="top" />

    <div className="h-full w-[2px] bg-[#768e9f] shadow-[1px_0_0_rgba(255,255,255,0.95)]" />

    <SeamNotch position="bottom" />
  </div>
);

const NOTCH_DARK_PATHS = {
  top: 'M0 0 C3.5 0 5 3.5 5 7 L6 7 C6 3.5 7.5 0 11 0 Z',
  bottom: 'M5 0 C5 3.5 3.5 7 0 7 L11 7 C7.5 7 6 3.5 6 0 Z',
} as const;

const NOTCH_LIGHT_PATHS = {
  top: 'M6 7 C6 3.5 7.5 0 12 0 L11 0 C7.5 0 6 3.5 6 7 Z',
  bottom: 'M6 0 C6 3.5 7.5 7 12 7 L11 7 C7.5 7 6 3.5 6 0 Z',
} as const;

const SeamNotch: React.FC<{ position: 'top' | 'bottom' }> = ({ position }) => (
  <svg
    className={cn('pointer-events-none absolute left-1/2 h-[7px] w-3 -translate-x-1/2', position)}
    width="12"
    height="7"
    viewBox="0 0 12 7"
    fill="none"
    aria-hidden="true"
  >
    <path d={NOTCH_DARK_PATHS[position]} fill="#768e9f" />
    <path d={NOTCH_LIGHT_PATHS[position]} fill="#ffffff" opacity="0.9" />
  </svg>
);
