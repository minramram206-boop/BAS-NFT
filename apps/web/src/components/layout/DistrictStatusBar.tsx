'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { statusBarMessage } from '@/config/constants';
import { MESSAGES } from '@/messages';
import { useDistrictTelemetry } from './DistrictTelemetryProvider';

export interface DistrictStatusBarProps {
  /** `compact` matches the tighter training footer. */
  variant?: 'default' | 'compact' | undefined;
  className?: string | undefined;
}

/** Bottom status line disclosing that the application is a local preview. */
export const DistrictStatusBar: React.FC<DistrictStatusBarProps> = ({
  variant = 'default',
  className,
}) => {
  const compact = variant === 'compact';
  const telemetry = useDistrictTelemetry();

  return (
    <footer
      className={cn(
        'flex w-full flex-shrink-0 flex-col items-center justify-center gap-0.5 border-t font-heading font-bold',
        compact
          ? 'border-[#8ba6be] pt-1 pb-0.5 text-[9px] text-[#233f5b] md:text-[10px]'
          : 'border-[#95aaba] pt-1 pb-0.5 text-[10px] text-[#102232] md:text-xs',
        className,
      )}
    >
      <div className="flex w-full items-center justify-center gap-2">
        <span className={cn('text-base', compact && 'text-[#3b5d80]')} aria-hidden="true">ⓘ</span>
        <span className={cn('flex-1', compact ? 'h-[1.5px] bg-[#9bb2c6]' : 'h-px bg-[#95aaba]')} />
        <span className={cn('text-center', compact && 'tracking-wide')}>
          {statusBarMessage(telemetry.networkLabel, telemetry.programShort)}
        </span>
        <span className={cn('flex-1', compact ? 'h-[1.5px] bg-[#9bb2c6]' : 'h-px bg-[#95aaba]')} />
        <span className={cn('text-base', compact && 'text-[#3b5d80]')} aria-hidden="true">ⓘ</span>
      </div>
      <p className="text-center font-pixel text-[8px] font-medium text-[#49657e] md:text-[9px]">
        {MESSAGES.status.footer}
      </p>
    </footer>
  );
};
