/**
 * Rotation UI – observes the root-owned scheduler and exposes a "run now"
 * action that performs exactly the same work the background task would.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { getCapabilities } from '../core/platform';
import { nativeSetterSupported } from '../services/wallpaper-controller';
import type { RotationSettings } from '../core/types';
import { runRotationOnce, getRotationSchedule, watchRotationSchedule } from '../services/rotation';
import { usePreferences } from '../providers/PreferencesProvider';

export interface RotationController {
  settings: RotationSettings;
  /** True when the platform can rotate automatically (Android + native module). */
  supported: boolean;
  /** Human-readable scheduler state (registration result, restrictions…). */
  status: string;
  /** True while "Rotate now" runs. */
  running: boolean;
  lastResult: string;
  update: (patch: Partial<RotationSettings>) => void;
  rotateNow: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export function useRotation(): RotationController {
  const { rotation, updateRotation } = usePreferences();
  const { message: status } = useSyncExternalStore(watchRotationSchedule, getRotationSchedule, getRotationSchedule);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState('');
  const alive = useRef(true);
  const rotating = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const rotateNow = useCallback(async () => {
    if (rotating.current) return;
    rotating.current = true;
    setRunning(true);
    setLastResult('');
    try {
      const result = await runRotationOnce({ force: true, settings: rotation });
      if (!alive.current) return;
      setLastResult(result.message);
      // Reflect the bookkeeping the run wrote (last run, counter) in the UI.
      if (result.status === 'applied' && result.bookkeeping) {
        updateRotation(result.bookkeeping);
      } else if (result.status === 'failed') {
        updateRotation({ lastRunError: result.message });
      }
    } catch {
      if (alive.current) setLastResult('Rotation could not finish. Check device storage and retry.');
    } finally {
      rotating.current = false;
      if (alive.current) setRunning(false);
    }
  }, [rotation, updateRotation]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      updateRotation({ enabled });
      // The root scheduler is the owner; never register twice here.
    },
    [updateRotation],
  );

  return {
    settings: rotation,
    supported: getCapabilities().canRotateAutomatically && nativeSetterSupported(),
    status,
    running,
    lastResult,
    update: updateRotation,
    rotateNow,
    setEnabled,
  };
}
