/**
 * Rotation hook – keeps the OS scheduler and the settings in sync and exposes a "run now"
 * action that performs exactly the same work the background task would.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getCapabilities } from '../core/platform';
import type { RotationSettings } from '../core/types';
import { runRotationOnce, syncRotationTask } from '../services/rotation';
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
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState('');
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // The OS registration follows the settings; `syncRotationTask` is idempotent.
  useEffect(() => {
    let cancelled = false;
    void syncRotationTask(rotation).then((result) => {
      if (!cancelled && alive.current) setStatus(result.message);
    });
    return () => {
      cancelled = true;
    };
    // Only the properties the scheduler cares about – not `lastRunAt` (that would loop).
  }, [rotation, rotation.enabled, rotation.intervalMinutes]);

  const rotateNow = useCallback(async () => {
    setRunning(true);
    setLastResult('');
    try {
      const result = await runRotationOnce({ force: true, settings: { ...rotation, enabled: true } });
      if (!alive.current) return;
      setLastResult(result.message);
      // Reflect the bookkeeping the run wrote (last run, counter) in the UI.
      if (result.status === 'applied') {
        updateRotation({
          lastRunAt: Date.now(),
          lastWallpaperId: result.wallpaperId ?? rotation.lastWallpaperId,
          runCount: rotation.runCount + 1,
          lastRunError: '',
        });
      } else if (result.status === 'failed') {
        updateRotation({ lastRunError: result.message });
      }
    } finally {
      if (alive.current) setRunning(false);
    }
  }, [rotation, updateRotation]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      updateRotation({ enabled });
      const result = await syncRotationTask({ ...rotation, enabled });
      if (alive.current) setStatus(result.message);
    },
    [rotation, updateRotation],
  );

  return {
    settings: rotation,
    supported: getCapabilities().canRotateAutomatically,
    status,
    running,
    lastResult,
    update: updateRotation,
    rotateNow,
    setEnabled,
  };
}
