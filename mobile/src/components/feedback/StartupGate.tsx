/** A hung native storage read must never leave the splash screen on indefinitely. */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { RecoveryScreen } from './AppRecoveryBoundary';

const ReadyContext = createContext<() => void>(() => {});
const RestartContext = createContext<() => void>(() => {});
export const useAppRestart = () => useContext(RestartContext);
export const useAppStartupReady = () => useContext(ReadyContext);
export const STARTUP_DEADLINE_MS = 8000;

export function StartupGate({ children }: { children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportReady = useCallback(() => {
    ready.current = true;
    if (timer.current) clearTimeout(timer.current);
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  const restart = useCallback(() => {
    ready.current = false;
    setTimedOut(false);
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    if (ready.current) return;
    timer.current = setTimeout(() => {
      setTimedOut(true);
      void SplashScreen.hideAsync().catch(() => undefined);
    }, STARTUP_DEADLINE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [revision]);
  if (timedOut) return <RecoveryScreen message="Startup is taking too long. Device storage or a native service may not be responding."
    onRetry={restart} />;
  return <RestartContext.Provider value={restart}><ReadyContext.Provider value={reportReady}>
    <React.Fragment key={revision}>{children}</React.Fragment>
  </ReadyContext.Provider></RestartContext.Provider>;
}
