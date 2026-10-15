'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A boolean kept in this browser only, for panel states such as open or closed.
 * The first render always uses `initial` so server and client markup agree; the
 * saved value is applied right after mount. Storage can be blocked or empty, in
 * which case the flag simply behaves like plain state.
 */
export function usePersistedFlag(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === '1' || saved === '0') setValue(saved === '1');
    } catch {
      // Storage is unavailable; keep the default.
    }
  }, [key]);

  const toggle = useCallback(() => {
    setValue((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Not saved, still applied for this visit.
      }
      return next;
    });
  }, [key]);

  return [value, toggle];
}
