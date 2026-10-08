jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(async () => undefined) }));

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { AppRecoveryBoundary } from '../src/components/feedback/AppRecoveryBoundary';
import { STARTUP_DEADLINE_MS, StartupGate, useAppRestart, useAppStartupReady } from '../src/components/feedback/StartupGate';

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

it('recovers a failed provider with no theme/router dependency and remounts it on retry', async () => {
  let broken = true;
  function ProviderFailure() { if (broken) throw new Error('provider failed'); return <Text>Recovered app</Text>; }
  const expectedLog = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const screen = await render(<AppRecoveryBoundary><ProviderFailure /></AppRecoveryBoundary>);
    expect(screen.getByText('Let’s try that again')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    broken = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Retry app startup' }));
    expect(screen.getByText('Recovered app')).toBeTruthy();
  } finally { expectedLog.mockRestore(); }
});

it('hides the splash and exposes retry rather than waiting forever on native storage', async () => {
  jest.useFakeTimers();
  let ready = false;
  let mounts = 0;
  const cleanup = jest.fn();
  function Bootstrap() {
    const report = useAppStartupReady();
    useEffect(() => { mounts++; if (ready) report(); return cleanup; }, [report]);
    return <Text>App startup</Text>;
  }
  const screen = await render(<StartupGate><Bootstrap /></StartupGate>);
  await act(async () => { await jest.advanceTimersByTimeAsync(STARTUP_DEADLINE_MS + 1); });
  expect(screen.getByText(/Startup is taking too long/)).toBeTruthy();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
  ready = true;
  await fireEvent.press(screen.getByRole('button', { name: 'Retry app startup' }));
  expect(screen.getByText('App startup')).toBeTruthy();
  expect(mounts).toBe(2);
  await act(async () => { await jest.advanceTimersByTimeAsync(STARTUP_DEADLINE_MS + 1); });
  expect(screen.queryByText(/Startup is taking too long/)).toBeNull();
});

it('allows a successful Settings reset to remount all providers and cancel the new splash timer', async () => {
  let restart: () => void = () => {};
  let mounts = 0;
  function App() {
    const reset = useAppRestart();
    const report = useAppStartupReady();
    useEffect(() => { restart = reset; mounts++; report(); }, [report, reset]);
    return <Text>App ready</Text>;
  }
  const screen = await render(<StartupGate><App /></StartupGate>);
  await waitFor(() => expect(mounts).toBe(1));
  await act(async () => { restart(); });
  expect(screen.getByText('App ready')).toBeTruthy();
  expect(mounts).toBe(2);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(2);
});
