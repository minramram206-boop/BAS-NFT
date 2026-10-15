import React from 'react';
import { cn } from '@/lib/utils/cn';

const FLAP = 'absolute bottom-[-6px] top-[6px] z-0 w-8 border-2 border-[#5a4620] bg-[#c9b17a]';

/** A parchment banner with folded ends, used for the name under a portrait. */
export const Ribbon: React.FC<{ children: React.ReactNode; className?: string | undefined }> = ({
  children,
  className,
}) => (
  <div className={cn('relative flex w-fit max-w-full items-center', className)}>
    <span aria-hidden className={cn(FLAP, 'left-0 [clip-path:polygon(0_0,100%_0,100%_100%,0_100%,38%_50%)]')} />
    <span aria-hidden className={cn(FLAP, 'right-0 [clip-path:polygon(0_0,100%_0,62%_50%,100%_100%,0_100%)]')} />
    <div className="relative z-10 mx-5 min-w-0 border-2 border-[#5a4620] bg-district-parchment px-4 py-1 text-center font-heading text-[14px] uppercase tracking-wide text-[#3a2c12] shadow-[0_2px_0_#0b141c]">
      <span className="block truncate">{children}</span>
    </div>
  </div>
);
