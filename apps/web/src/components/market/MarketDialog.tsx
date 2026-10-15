'use client';

import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Frame of the market's dialogs. It is drawn on the page body, above the screen's
 * header and tab bar, and closes on Escape or a click on the dim backdrop.
 * The error and result messages (`PixelModal`) open above it.
 */
export const MarketDialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setHost(document.body);
  }, []);

  React.useEffect(() => {
    if (!host) return undefined;
    // A field with autofocus has already taken the focus; otherwise it goes to the dialog itself.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host, onClose]);

  if (!host) return null;
  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-[52] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="bas-panel flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto p-4 font-pixel text-[#1a2734] outline-none md:p-5"
      >
        <div className="border-b border-[#8ba5ba] pb-2 text-center font-heading text-[15px] font-bold tracking-wide">{title}</div>
        {children}
      </div>
    </div>,
    host,
  );
};
