'use client';

import React from 'react';

interface HeaderSeamProps {
  className?: string;
}

/**
 * Authentic Retro Seam Divider matching reference mockup (media_1791241488258.png).
 * Connects flush from top border to bottom border with characteristic curved notch flares.
 */
export const HeaderSeam: React.FC<HeaderSeamProps> = ({ className = '' }) => {
  return (
    <div
      className={`relative w-[12px] h-full flex-shrink-0 flex items-center justify-center select-none ${className}`}
      aria-hidden="true"
    >
      {/* Top Notch Flare (connecting flush to top border) */}
      <svg
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[12px] h-[7px] pointer-events-none"
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
      >
        <path d="M0 0 C3.5 0 5 3.5 5 7 L6 7 C6 3.5 7.5 0 11 0 Z" fill="#768e9f" />
        <path d="M6 7 C6 3.5 7.5 0 12 0 L11 0 C7.5 0 6 3.5 6 7 Z" fill="#ffffff" opacity="0.9" />
      </svg>

      {/* 2px Full-Height Vertical Seam Line (Dark Slate Groove + Crisp White Rim Highlight) */}
      <div className="w-[2px] h-full bg-[#768e9f] shadow-[1px_0_0_rgba(255,255,255,0.95)]" />

      {/* Bottom Notch Flare (connecting flush to bottom border) */}
      <svg
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[12px] h-[7px] pointer-events-none"
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
      >
        <path d="M5 0 C5 3.5 3.5 7 0 7 L11 7 C7.5 7 6 3.5 6 0 Z" fill="#768e9f" />
        <path d="M6 0 C6 3.5 7.5 7 12 7 L11 7 C7.5 7 6 3.5 6 0 Z" fill="#ffffff" opacity="0.9" />
      </svg>
    </div>
  );
};
