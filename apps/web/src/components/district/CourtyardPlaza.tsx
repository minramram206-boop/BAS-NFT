'use client';

import React, { useRef } from 'react';
import type { CitizenRecord } from '@bas/content';
import { cn } from '@/lib/utils/cn';
import { STAGE } from '@/config/constants';
import { useStageWalk } from '@/lib/hooks/useStageWalk';
import { PixelSprite } from '@/components/ui/PixelSprite';

export interface CourtyardPlazaProps {
  citizen: CitizenRecord;
}

/**
 * District 01 plaza: hand-crafted 2.5D stage with the selected citizen
 * walking it. Click a flagstone or use WASD / arrow keys to move.
 */
export const CourtyardPlaza: React.FC<CourtyardPlazaProps> = ({ citizen }) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { position, facingLeft, isWalking, moveToClientPoint } = useStageWalk();

  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    moveToClientPoint(event.clientX, event.clientY, stage.getBoundingClientRect());
  };

  return (
    <div
      ref={stageRef}
      onClick={handleStageClick}
      title="Klik di ubin atau gunakan keyboard [W,A,S,D] / Arrow keys untuk menggerakkan warga di Plaza 2.5D"
      className="group relative mx-auto h-[360px] w-full cursor-pointer select-none overflow-hidden rounded-xl border-2 border-[#182635] bg-[#9bb2c5] shadow-inner md:h-[400px] lg:h-[430px]"
    >
      <PixelSprite
        src={STAGE.backgroundImage}
        alt="District 01 courtyard plaza"
        fill
        sizes="100vw"
        priority
        className="pointer-events-none absolute inset-0"
        imageClassName="object-cover"
      />

      {/* Citizen sprite with a soft isometric shadow */}
      <div
        className="pointer-events-none absolute flex flex-col items-center justify-end transition-[left,top] duration-75 ease-out"
        style={{
          left: `${(position.x / STAGE.width) * 100}%`,
          top: `${(position.y / STAGE.height) * 100}%`,
          transform: 'translate(-50%, -92%)',
          width: '24%',
          height: '35%',
          maxHeight: '120px',
        }}
      >
        <span className="absolute -bottom-1 left-1/2 z-0 h-4 w-14 -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(20,36,52,0.55)_0%,rgba(20,36,52,0)_75%)]" />

        <PixelSprite
          src={citizen.image}
          alt={citizen.name}
          width={256}
          height={256}
          className="relative z-10 h-full max-h-[110px] w-full overflow-hidden"
          imageClassName={cn(
            'h-full max-h-[110px] w-full drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]',
            facingLeft && '-scale-x-100',
            isWalking
              ? 'animate-bounce'
              : 'animate-[hero-idle-bob_2.4s_ease-in-out_infinite_alternate]',
          )}
        />
      </div>

      <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5 rounded border border-[#274059] bg-[#122230]/90 px-2 py-0.5 font-heading text-[9px] font-extrabold text-[#74beff] shadow">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1ae27c]" />
        <span>PLAZA 2.5D</span>
      </span>

      <span className="pointer-events-none absolute right-2 bottom-2 rounded border border-[#274059] bg-[#122230]/90 px-2 py-0.5 font-heading text-[9px] text-[#dfae3e] shadow transition-colors group-hover:text-amber-300">
        WASD / KLIK
      </span>
    </div>
  );
};
