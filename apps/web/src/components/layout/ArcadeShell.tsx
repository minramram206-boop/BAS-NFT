'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { PixelModal } from '@/components/modal/PixelModal';

export interface ArcadeShellProps {
  /** Header bar rendered flush at the top of the screen. */
  header: React.ReactNode;
  /** Main floor area. */
  children: React.ReactNode;
  /** Status line rendered at the bottom of the floor area. */
  footer?: React.ReactNode | undefined;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}

/**
 * Arcade cabinet chrome shared by every route: bezel, recessed screen,
 * header slot, floor area, and the global modal outlet.
 */
export const ArcadeShell: React.FC<ArcadeShellProps> = ({
  header,
  children,
  footer,
  className,
  bodyClassName,
}) => (
  <main className={cn('bas-arcade-bezel m-0 flex h-full w-full flex-col overflow-hidden select-none', className)}>
    <div className="bas-arcade-screen flex h-full w-full flex-col justify-between overflow-hidden p-0">
      {header}

      <div
        className={cn(
          'flex w-full min-h-0 flex-1 flex-col justify-between gap-2 overflow-hidden p-2 md:p-2.5',
          bodyClassName,
        )}
      >
        {children}
        {footer}
      </div>
    </div>

    <PixelModal />
  </main>
);
