'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface StatusPillProps {
  label: string;
  /** Colour of the pulsing indicator dot. */
  dotClassName?: string | undefined;
  className?: string | undefined;
}

/** Small telemetry pill shown in the middle bay of the header bar. */
export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  dotClassName = 'bg-emerald-500',
  className,
}) => (
  <span
    className={cn(
      'hidden flex-shrink-0 items-center gap-1.5 rounded border border-[#102235]/20 bg-[#102235]/10 px-2 py-0.5 font-mono text-[9px] font-bold text-[#102235] shadow-xs sm:inline-flex',
      className,
    )}
  >
    <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full', dotClassName)} />
    <span>{label}</span>
  </span>
);
