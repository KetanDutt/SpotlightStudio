import { useEffect, useState } from 'react';

/**
 * Debounce a fast-changing value (the search box) so filtering 7,500 wallpapers only runs
 * after the user stops typing.  Keeps the input itself perfectly responsive.
 */
export function useDebouncedValue<T>(value: T, delayMs = 220): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}
