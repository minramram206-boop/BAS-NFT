import React from 'react';
import { cn } from '@/lib/utils/cn';

/** A choice among a few fixed values, such as a duration, pressed when chosen. */
export const Chip: React.FC<{ pressed: boolean; onClick: () => void; children: React.ReactNode }> = ({ pressed, onClick, children }) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      'bas-chip min-h-10 flex-1 rounded-md border-2 border-[#1b2a38] px-2 font-heading text-[11px]',
      pressed ? 'bg-[#f7d23d]' : 'bg-[#c5d5e5]',
    )}
  >
    {children}
  </button>
);

/** A line of explanation in a market dialog; `strong` for one that concerns the wallet directly. */
export const Note: React.FC<{ children: React.ReactNode; strong?: boolean }> = ({ children, strong }) => (
  <p className={strong ? 'm-0 text-[14px] font-semibold leading-snug text-[#1d6b34]' : 'm-0 text-[14px] leading-snug text-[#33485c]'}>
    {children}
  </p>
);
