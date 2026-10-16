import React from 'react';
import { cn } from '@/lib/utils/cn';

/** One label and value line of a receipt panel, with a dashed rule under it. */
export const ReceiptRow: React.FC<{ label: string; value: React.ReactNode; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#9fb3c6] py-1.5 last:border-0 lg:flex-1 lg:items-center">
    <span className="text-[15px] text-[#33485c]">{label}</span>
    <span className={cn('text-right text-[15px]', strong ? 'font-heading text-[15px]' : 'font-semibold')}>{value}</span>
  </div>
);
