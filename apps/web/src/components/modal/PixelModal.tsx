'use client';

import React from 'react';
import { useCloseModal, useModalState } from '@/stores/selectors';
import { MESSAGES } from '@/messages';

/**
 * Frame of the short arcade messages: a title, the message and one Close
 * button. The global modal and the market's notices both draw with it, so
 * every message of that kind looks the same.
 */
export const PixelMessageFrame: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
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

      <button
        type="button"
        onClick={onClose}
        className="mt-2 self-center rounded-lg border-2 border-[#1a3854] bg-[#3b74a6] px-5 py-2.5 font-heading text-[13px] font-bold tracking-wide text-white shadow-[0_2px_0_#1a3854] transition-all hover:bg-[#2d5d86] active:translate-y-0.5"
      >
        {MESSAGES.actions.closeModal}
      </button>
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
