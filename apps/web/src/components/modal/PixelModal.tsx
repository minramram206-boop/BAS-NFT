'use client';

import React from 'react';
import { useCloseModal, useModalState } from '@/stores/selectors';
import { MESSAGES } from '@/messages';

const BUTTON =
  'rounded-lg border-2 border-[#1a3854] px-5 py-2.5 font-heading text-[13px] font-bold tracking-wide shadow-[0_2px_0_#1a3854] transition-all active:translate-y-0.5';
const PRIMARY_BUTTON = `${BUTTON} bg-[#3b74a6] text-white hover:bg-[#2d5d86]`;
const SECONDARY_BUTTON = `${BUTTON} bg-[#e3ecf4] text-[#1a2938] hover:bg-[#d3dde6]`;

/**
 * Frame of the short arcade messages: a title, the message and a Close
 * button, with one more button when the message leads somewhere. The global
 * modal and the market's notices both draw with it, so every message of that
 * kind looks the same.
 */
export const PixelMessageFrame: React.FC<{
  title: string;
  onClose: () => void;
  /** A second button, drawn first, for a message that leads somewhere. */
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}> = ({ title, onClose, action, children }) => (
  <div
    role="presentation"
    onClick={onClose}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      className="flex w-full max-w-sm flex-col gap-3 rounded-xl border-[3px] border-[#1a2734] bg-[#c5d5e5] p-5 text-center shadow-2xl"
    >
      <div className="border-b border-[#8ba5ba] pb-2 font-heading text-[16px] font-bold tracking-wide text-[#1a2938]">{title}</div>

      {children}

      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {action && (
          <button type="button" onClick={action.onClick} className={PRIMARY_BUTTON}>
            {action.label}
          </button>
        )}
        <button type="button" onClick={onClose} className={action ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
          {MESSAGES.actions.closeModal}
        </button>
      </div>
    </div>
  </div>
);

/**
 * Global arcade dialog.
 *
 * Messages are plain English text, never markup, wallet data or chain data.
 */
export const PixelModal: React.FC = () => {
  const modal = useModalState();
  const closeModal = useCloseModal();

  if (!modal.isOpen) return null;

  return (
    <PixelMessageFrame title={modal.title} onClose={closeModal}>
      <p className="whitespace-pre-line font-pixel text-[15px] leading-relaxed text-[#27384a]">{modal.message}</p>
    </PixelMessageFrame>
  );
};
