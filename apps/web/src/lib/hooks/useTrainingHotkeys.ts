'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { StatKey } from '@bas/content';
import { BACK_TO_DISTRICT_HOTKEY, STAT_META } from '@/config/constants';
import { useTrainStat } from '@/stores/selectors';

/** Keys of the stats that expose a dojo drill hotkey. */
const DRILL_STATS = (Object.keys(STAT_META) as StatKey[]).filter((stat) => STAT_META[stat].hotkey);

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Dojo keyboard shortcuts: each drill stat hotkey trains that stat and
 * {@link BACK_TO_DISTRICT_HOTKEY} returns to District 01.
 */
export function useTrainingHotkeys(enabled = true): void {
  const router = useRouter();
  const trainStat = useTrainStat();

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const drill = DRILL_STATS.find((stat) => STAT_META[stat].hotkey === event.key);
      if (drill) {
        event.preventDefault();
        trainStat(drill);
        return;
      }

      if (event.key === BACK_TO_DISTRICT_HOTKEY) {
        event.preventDefault();
        router.push('/');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, router, trainStat]);
}
