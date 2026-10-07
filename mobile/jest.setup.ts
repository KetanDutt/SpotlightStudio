/**
 * Jest setup – runs before every test file (see `jest` in package.json).
 *
 * Keeps the native surface deterministic: storage, haptics and the media library are
 * mocked so unit tests exercise the app logic, not the platform.
 */

// React 19 / test-renderer requires the act environment flag; React Native Testing Library
// reads it to decide whether state updates must be wrapped.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// In-memory AsyncStorage (the official jest mock).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })),
  openURLAsync: jest.fn(async () => undefined),
}));

// Silence two known-noise sources from the React test renderer: the animation warnings
// (nothing animates in tests) and the act() notice for state updates that providers perform
// from async storage reads before `waitFor` starts observing.
const IGNORED = /useNativeDriver|Animated: `useNativeDriver`|not configured to support act|not wrapped in act/;

jest.spyOn(console, 'warn').mockImplementation((message, ...rest) => {
  if (typeof message === 'string' && IGNORED.test(message)) return;
  console.info(message, ...rest);
});

jest.spyOn(console, 'error').mockImplementation((message, ...rest) => {
  if (typeof message === 'string' && IGNORED.test(message)) return;
  console.info(message, ...rest);
});
