'use client';

import React from 'react';
import { useCloseModal, useModalState } from '@/stores/selectors';
import { MESSAGES } from '@/messages';

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
    <div
      role="presentation"
      onClick={closeModal}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={modal.title}
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl border-[3px] border-[#1a2734] bg-[#c5d5e5] p-5 text-center shadow-2xl"
      >
        <div className="border-b border-[#8ba5ba] pb-2 font-heading text-sm font-bold text-[#1a2938]">
          {modal.title}
        </div>

        <p className="whitespace-pre-line font-pixel text-xs leading-relaxed text-[#27384a]">
          {modal.message}
        </p>

        <button
          type="button"
          onClick={closeModal}
          className="mt-2 self-center rounded-lg border-2 border-[#1a3854] bg-[#3b74a6] px-5 py-2 font-heading text-xs font-bold text-white shadow-[0_2px_0_#1a3854] transition-all hover:bg-[#2d5d86] active:translate-y-0.5"
        >
          {MESSAGES.actions.closeModal}
        </button>
      </div>
    </div>
  );
};
