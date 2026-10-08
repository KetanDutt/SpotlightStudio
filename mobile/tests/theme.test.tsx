import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYS, getJson } from '../src/services/storage';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { PALETTES, TOUCH_TARGET, durations, navigation } from '../src/theme/tokens';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(part => {
    const n = parseInt(part, 16) / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

for (const [name, colors] of Object.entries(PALETTES)) {
  it(`${name}: normal-size semantic text meets WCAG AA on base and opaque surfaces`, () => {
    for (const bg of [colors.bg, colors.surface, colors.surfaceAlt]) {
      for (const fg of [colors.text, colors.textMuted, colors.textFaint, colors.accent]) {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
}

it('touch, navigation clearance and motion tokens retain their shared contract', () => {
  expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  expect(navigation.contentInset).toBeGreaterThan(navigation.height + navigation.inset);
  expect(durations).toEqual({ fast: 150, normal: 260, slow: 380 });
});

function PreferencesProbe() {
  const { reduceMotion, reduceTransparency } = useTheme();
  return <Text>{`${reduceMotion}/${reduceTransparency}`}</Text>;
}

it('subscribes to motion/transparency changes and removes listeners', async () => {
  const callbacks: Record<string, (value: boolean) => void> = {};
  const remove = jest.fn();
  const subscribe = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event: string, callback: unknown) => {
    callbacks[event] = callback as (value: boolean) => void;
    return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
  });
  const motion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const transparency = jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
  try {
    const view = await render(<ThemeProvider><PreferencesProbe /></ThemeProvider>);
    expect(view.getByText('true/true')).toBeTruthy();
    await act(async () => { callbacks.reduceMotionChanged(false); callbacks.reduceTransparencyChanged(false); });
    expect(view.getByText('false/false')).toBeTruthy();
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  } finally {
    subscribe.mockRestore(); motion.mockRestore(); transparency.mockRestore();
  }
});


it('StrictMode theme toggles persist once per intent, including two changes in one tick', async () => {
  await AsyncStorage.clear();
  function Wrapper({ children }: { children: React.ReactNode }) { return <React.StrictMode><ThemeProvider>{children}</ThemeProvider></React.StrictMode>; }
  const { result } = await renderHook(() => useTheme(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  const write = jest.mocked(AsyncStorage.setItem); write.mockClear();
  await act(async () => { result.current.toggle(); result.current.toggle(); });
  expect(result.current.preference).toBe('light');
  expect(await getJson(KEYS.theme, 'auto')).toBe('light');
  expect(write.mock.calls.filter(([key]) => key === KEYS.theme)).toHaveLength(2);
});

it('makes theme persistence failures visible without undoing the active appearance', async () => {
  const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
  await waitFor(() => expect(result.current.ready).toBe(true));
  const write = jest.mocked(AsyncStorage.setItem);
  const original = write.getMockImplementation()!;
  write.mockRejectedValueOnce(new Error('disk full'));
  try {
    await act(async () => { result.current.setPreference('dark'); });
    expect(result.current.preference).toBe('dark');
    expect(result.current.storageError).toMatch(/could not be saved/);
    await act(async () => { result.current.setPreference('auto'); });
    expect(result.current.storageError).toBeNull();
  } finally { write.mockImplementation(original); }
});
