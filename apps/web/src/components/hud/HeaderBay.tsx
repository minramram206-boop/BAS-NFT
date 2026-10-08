'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { HeaderSeam } from './HeaderSeam';

export interface HeaderBayProps {
  children: React.ReactNode;
  className?: string | undefined;
  /** Render a seam divider after this bay. */
  seamAfter?: boolean | undefined;
}

/** One segment of the arcade header bar, optionally followed by a seam. */
export const HeaderBay: React.FC<HeaderBayProps> = ({ children, className, seamAfter = true }) => (
  <>
    <div className={cn('flex h-full items-center', className)}>{children}</div>
    {seamAfter ? <HeaderSeam /> : null}
  </>
);
