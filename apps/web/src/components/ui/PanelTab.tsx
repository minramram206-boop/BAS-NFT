import React from 'react';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { cn } from '@/lib/utils/cn';

export interface PanelTabProps {
  children: React.ReactNode;
  /** Public path of a small pixel icon shown before the title. */
  icon?: string | undefined;
  className?: string | undefined;
}

/** The dark title tab at the top of a section, so every panel starts the same way. */
export const PanelTab: React.FC<PanelTabProps> = ({ children, icon, className }) => (
  <span
    className={cn(
      'inline-flex max-w-full items-center gap-2 self-start rounded-md border-2 border-[#0b141c] bg-[#2b4258] px-3 py-1 font-heading text-[12px] uppercase tracking-widest text-[#f2f6fa]',
      'shadow-[inset_0_2px_0_rgba(255,255,255,0.18)]',
      className,
    )}
  >
    {icon && <PixelIcon src={icon} className="h-4 shrink-0" />}
    <span className="truncate">{children}</span>
  </span>
);
