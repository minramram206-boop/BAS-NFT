'use client';

import { useEffect, useState } from 'react';

/**
 * The time in unix seconds, updated every second, for countdowns. It is `null`
 * on the first render so the server and the browser draw the same markup.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
