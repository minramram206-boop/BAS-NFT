'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGE, STAGE_MOVE_KEYS } from '@/config/constants';

export interface StagePosition {
  x: number;
  y: number;
}

export interface StageWalkState {
  position: StagePosition;
  facingLeft: boolean;
  isWalking: boolean;
}

const { bounds, startPosition, walkStep, verticalScale, lerpFactor, arriveThreshold } = STAGE;

function clampToWalkableArea({ x, y }: StagePosition): StagePosition {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
  };
}

/**
 * Movement state of the citizen walking the 2.5D plaza.
 *
 * Extracted from the stage component so the stage only renders: keyboard
 * input, pointer targeting, walkable-area clamping, and the animation frame
 * interpolation all live here.
 */
export function useStageWalk(): StageWalkState & {
  moveToClientPoint: (clientX: number, clientY: number, box: DOMRect) => void;
} {
  const [position, setPosition] = useState<StagePosition>(startPosition);
  const [targetPosition, setTargetPosition] = useState<StagePosition>(startPosition);
  const [facingLeft, setFacingLeft] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const positionRef = useRef(position);
  positionRef.current = position;

  const walkTo = useCallback((next: StagePosition) => {
    const clamped = clampToWalkableArea(next);
    setPosition(clamped);
    setTargetPosition(clamped);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      const key = event.key;
      const current = positionRef.current;
      let moved = false;

      if ((STAGE_MOVE_KEYS.left as readonly string[]).includes(key)) {
        walkTo({ x: current.x - walkStep, y: current.y });
        setFacingLeft(true);
        moved = true;
      } else if ((STAGE_MOVE_KEYS.right as readonly string[]).includes(key)) {
        walkTo({ x: current.x + walkStep, y: current.y });
        setFacingLeft(false);
        moved = true;
      } else if ((STAGE_MOVE_KEYS.up as readonly string[]).includes(key)) {
        walkTo({ x: current.x, y: current.y - walkStep * verticalScale });
        moved = true;
      } else if ((STAGE_MOVE_KEYS.down as readonly string[]).includes(key)) {
        walkTo({ x: current.x, y: current.y + walkStep * verticalScale });
        moved = true;
      }

      if (moved) event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [walkTo]);

  /** Interpolate towards the target so walking looks continuous. */
  useEffect(() => {
    const timer = setInterval(() => {
      setPosition((current) => {
        const dx = targetPosition.x - current.x;
        const dy = targetPosition.y - current.y;

        if (Math.hypot(dx, dy) <= arriveThreshold) {
          setIsWalking(false);
          return targetPosition;
        }

        setIsWalking(true);
        return { x: current.x + dx * lerpFactor, y: current.y + dy * lerpFactor };
      });
    }, STAGE.frameIntervalMs);

    return () => clearInterval(timer);
  }, [targetPosition]);

  /** Convert a pointer position into stage units and walk there. */
  const moveToClientPoint = useCallback(
    (clientX: number, clientY: number, box: DOMRect) => {
      const stageX = (clientX - box.left) * (STAGE.width / box.width);
      const stageY = (clientY - box.top) * (STAGE.height / box.height);

      if (stageX < positionRef.current.x) setFacingLeft(true);
      else if (stageX > positionRef.current.x) setFacingLeft(false);

      setTargetPosition(clampToWalkableArea({ x: stageX, y: stageY }));
    },
    [],
  );

  return { position, facingLeft, isWalking, moveToClientPoint };
}
