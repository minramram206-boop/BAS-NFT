'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface PixelIconProps {
  /** Public asset path, e.g. `/icons/shield_crest.png`. */
  src: string;
  /** Accessible name; leave empty for a purely decorative sprite. */
  alt?: string | undefined;
  /** Size and spacing classes applied to the image. */
  className?: string | undefined;
  /** Extra state classes, e.g. a group-hover scale. */
  effectClassName?: string | undefined;
  loading?: 'eager' | 'lazy' | undefined;
  title?: string | undefined;
}

/**
 * Pixel-art sprite rendered with nearest-neighbour scaling and a soft drop shadow.
 * Centralises the repeated `image-rendering` / `drop-shadow-xs` markup.
 */
export const PixelIcon: React.FC<PixelIconProps> = ({
  src,
  alt = '',
  className,
  effectClassName,
  loading = 'eager',
  title,
}) => (
  <img
    src={src}
    alt={alt}
    title={title}
    loading={loading}
    className={cn(
      'w-auto object-contain drop-shadow-xs',
      className,
      effectClassName,
    )}
    style={{ imageRendering: 'pixelated' }}
  />
);
