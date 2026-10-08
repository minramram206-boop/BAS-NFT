'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { BROADCAST } from '@/config/constants';

export interface DistrictStatusBarProps {
  /** `compact` matches the tighter dojo footer. */
  variant?: 'default' | 'compact' | undefined;
  className?: string | undefined;
}

/** Bottom status line shared by the district and dojo screens. */
export const DistrictStatusBar: React.FC<DistrictStatusBarProps> = ({
  variant = 'default',
  className,
}) => {
  const compact = variant === 'compact';

  return (
    <footer
      className={cn(
        'flex w-full flex-shrink-0 select-none items-center justify-center gap-3 border-t font-heading font-bold',
        compact
          ? 'border-[#8ba6be] pt-1 pb-0.5 text-[9px] text-[#233f5b] md:text-[11px]'
          : 'border-[#95aaba] pt-1 pb-0.5 text-[10px] text-[#102232] md:text-xs',
        className,
      )}
    >
      <span className={cn('text-base', compact && 'text-[#3b5d80]')}>🛡</span>
      <span className={cn('flex-1', compact ? 'h-[1.5px] bg-[#9bb2c6]' : 'h-px bg-[#95aaba]')} />
      <span className={cn(compact && 'tracking-wider')}>{BROADCAST.statusBar}</span>
      <span className={cn('flex-1', compact ? 'h-[1.5px] bg-[#9bb2c6]' : 'h-px bg-[#95aaba]')} />
      <span className={cn('text-base', compact && 'text-[#3b5d80]')}>🛡</span>
    </footer>
  );
};
