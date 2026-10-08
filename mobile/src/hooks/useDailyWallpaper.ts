/** Keep the UTC daily pick current across midnight and app suspension. */
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import type { Catalog } from '../core/types';
import { dailyWallpaper } from '../core/utils';

export function useDailyWallpaper(catalog: Catalog | null) {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const update = () => setDay(new Date().toISOString().slice(0, 10));
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const timer = setTimeout(update, midnight - now.getTime() + 100);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [day]);
  return useMemo(() => dailyWallpaper(catalog, new Date(`${day}T00:00:00Z`)), [catalog, day]);
}
