/** Exactly one scheduler owner, mounted at app root even if Settings is never opened. */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePreferences } from '../providers/PreferencesProvider';
import { readRotationSettings, syncRotationTask, ROTATION_DEFAULTS } from '../services/rotation';

export function useRotationScheduler() {
  const { rotation, updateRotation } = usePreferences();
  const { enabled, intervalMinutes } = rotation;
  const latestSchedule = useRef({ enabled, intervalMinutes });
  useEffect(() => {
    latestSchedule.current = { enabled, intervalMinutes };
    void syncRotationTask({ ...ROTATION_DEFAULTS, enabled, intervalMinutes });
  }, [enabled, intervalMinutes]);
  useEffect(() => {
    let alive = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      void readRotationSettings().then(latest => {
        if (!alive) return;
        // A headless worker may have changed bookkeeping since this UI hydrated.
        void syncRotationTask({ ...latest, ...latestSchedule.current });
        updateRotation({ lastRunAt: latest.lastRunAt, lastWallpaperId: latest.lastWallpaperId,
          lastRunError: latest.lastRunError, runCount: latest.runCount });
      });
    });
    return () => { alive = false; subscription.remove(); };
  }, [updateRotation]);
}
