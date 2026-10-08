'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const CourtyardStage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { citizens, selectedCitizenId } = useBasStore();
  const activeCitizen = citizens.find((c) => c.id === selectedCitizenId) || citizens[0];

  // Character interactive position on the 2.5D courtyard stage (matching mockup: near left crates)
  const [pos, setPos] = useState({ x: 82, y: 92 });
  const [targetPos, setTargetPos] = useState({ x: 82, y: 92 });
  const [facingLeft, setFacingLeft] = useState(false);
  const [isWalking, setIsWalking] = useState(false);

  // Keyboard navigation on the stage (WASD / Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input field
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const step = 10;
      let nextX = pos.x;
      let nextY = pos.y;
      let moved = false;

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        nextX -= step;
        setFacingLeft(true);
        moved = true;
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        nextX += step;
        setFacingLeft(false);
        moved = true;
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        nextY -= step * 0.6;
        moved = true;
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        nextY += step * 0.6;
        moved = true;
      }

      if (moved) {
        e.preventDefault();
        // Constrain to walkable flagstone boundaries (avoid walls and crates)
        const clampedX = Math.max(70, Math.min(215, nextX));
        const clampedY = Math.max(105, Math.min(172, nextY));
        setPos({ x: clampedX, y: clampedY });
        setTargetPos({ x: clampedX, y: clampedY });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pos]);

  // Click on stage to walk to point
  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scaleX = 276 / rect.width;
    const scaleY = 224 / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Clamp to walkable flagstones
    const clampedX = Math.max(70, Math.min(215, clickX));
    const clampedY = Math.max(105, Math.min(172, clickY));

    if (clampedX < pos.x) setFacingLeft(true);
    else if (clampedX > pos.x) setFacingLeft(false);

    setTargetPos({ x: clampedX, y: clampedY });
  };

  // Smooth lerp to target position
  useEffect(() => {
    const interval = setInterval(() => {
      setPos((current) => {
        const dx = targetPos.x - current.x;
        const dy = targetPos.y - current.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 1) {
          setIsWalking(true);
          return {
            x: current.x + dx * 0.25,
            y: current.y + dy * 0.25,
          };
        } else {
          setIsWalking(false);
          return targetPos;
        }
      });
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, [targetPos]);

  return (
    <div
      ref={containerRef}
      onClick={handleStageClick}
      className="relative w-full h-[360px] md:h-[400px] lg:h-[430px] bg-[#9bb2c5] border-2 border-[#182635] rounded-xl overflow-hidden shadow-inner select-none cursor-pointer group mx-auto"
      title="Klik di ubin atau gunakan keyboard [W,A,S,D] / Arrow keys untuk menggerakkan warga di Plaza 2.5D"
    >
      {/* 1. Authentic Handcrafted Courtyard Pixel Art Stage */}
      <img
        src="/courtyard_stage_bg.png"
        alt="BAS Courtyard Plaza 2.5D"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ imageRendering: 'pixelated' }}
        loading="eager"
      />

      {/* 2. Dynamic Character with Drop Shadow */}
      <div
        className="absolute pointer-events-none transition-[left,top] duration-75 ease-out flex flex-col items-center justify-end"
        style={{
          left: `${(pos.x / 276) * 100}%`,
          top: `${(pos.y / 224) * 100}%`,
          transform: 'translate(-50%, -92%)',
          width: '24%',
          height: '35%',
          maxHeight: '120px',
        }}
      >
        {/* Soft Isometric Oval Shadow */}
        <div
          className="w-14 h-4 bg-[radial-gradient(ellipse_at_center,rgba(20,36,52,0.55)_0%,rgba(20,36,52,0)_75%)] rounded-full absolute -bottom-1 left-1/2 -translate-x-1/2 z-0"
        />

        {/* Dynamic Citizen Sprite */}
        {activeCitizen && (
          <img
            src={activeCitizen.image}
            alt={activeCitizen.name}
            className={`w-full h-full max-h-[110px] object-contain relative z-10 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)] transition-transform duration-100 ${
              facingLeft ? '-scale-x-100' : ''
            } ${isWalking ? 'animate-bounce' : 'animate-[hero-idle-bob_2.4s_ease-in-out_infinite_alternate]'}`}
            style={{ imageRendering: 'pixelated' }}
            loading="eager"
          />
        )}
      </div>

      {/* 3. Floating Status Badges matching mockup */}
      <div className="absolute top-2 left-2 bg-[#122230]/90 border border-[#274059] px-2 py-0.5 rounded text-[9px] font-heading font-extrabold text-[#74beff] shadow flex items-center gap-1.5 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-[#1ae27c] animate-pulse" />
        <span>PLAZA 2.5D</span>
      </div>

      <div className="absolute bottom-2 right-2 bg-[#122230]/90 border border-[#274059] px-2 py-0.5 rounded text-[9px] font-heading font-extrabold text-[#dfae3e] shadow pointer-events-none group-hover:text-amber-300 transition-colors">
        <span>WASD / KLIK</span>
      </div>
    </div>
  );
};
