'use client';

import Image from 'next/image';
import React from 'react';
import { cn } from '@/lib/utils/cn';

interface PixelSpriteBaseProps {
  /** Public asset path of the sprite. */
  src: string;
  /** Accessible name; leave empty for a purely decorative sprite. */
  alt?: string | undefined;
  className?: string | undefined;
  /** Classes applied to the image element itself. */
  imageClassName?: string | undefined;
  priority?: boolean | undefined;
  title?: string | undefined;
}

interface FilledSpriteProps extends PixelSpriteBaseProps {
  /** Stretch to the parent box; the parent must be positioned. */
  fill: true;
  sizes?: string | undefined;
}

interface SizedSpriteProps extends PixelSpriteBaseProps {
  fill?: false | undefined;
  /** Intrinsic pixel width of the asset. */
  width: number;
  /** Intrinsic pixel height of the asset. */
  height: number;
}

export type PixelSpriteProps = FilledSpriteProps | SizedSpriteProps;

/**
 * Character and stage sprites.
 *
 * Pixel art must never be resampled, so images are served unoptimized and
 * rendered with nearest-neighbour scaling. Routing every sprite through
 * `next/image` keeps that policy and the layout hints in one place.
 */
export const PixelSprite: React.FC<PixelSpriteProps> = (props) => {
  const { src, alt = '', className, imageClassName, priority = false, title } = props;
  const sizing = props.fill
    ? props.sizes
      ? { fill: true as const, sizes: props.sizes }
      : { fill: true as const }
    : { width: props.width, height: props.height };

  return (
    <span className={cn('relative block', className)} title={title}>
      <Image
        src={src}
        alt={alt}
        priority={priority}
        unoptimized
        className={cn('object-contain', imageClassName)}
        style={{ imageRendering: 'pixelated' }}
        {...sizing}
      />
    </span>
  );
};
