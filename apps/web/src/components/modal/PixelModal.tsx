'use client';

import React from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const PixelModal: React.FC = () => {
  const { modal, closeModal } = useBasStore();

  if (!modal.isOpen) return null;

  return (
    <div
      onClick={closeModal}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#c5d5e5] border-3 border-[#1a2734] rounded-xl p-5 shadow-2xl text-center flex flex-col gap-3"
      >
        <div className="font-heading text-sm font-bold text-[#1a2938] border-b border-[#8ba5ba] pb-2">
          {modal.title}
        </div>
        <div
          className="font-pixel text-xs text-[#27384a] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: modal.message }}
        />
        <button
          onClick={closeModal}
          className="mt-2 bg-[#3b74a6] hover:bg-[#2d5d86] border-2 border-[#1a3854] text-white font-heading text-xs font-bold py-2 px-5 rounded-lg shadow-[0_2px_0_#1a3854] active:translate-y-0.5 transition-all self-center"
        >
          OK / TUTUP
        </button>
      </div>
    </div>
  );
};
