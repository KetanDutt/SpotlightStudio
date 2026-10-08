import type { ExpoConfig } from 'expo/config';
import { releaseConfig } from '../app.config';
import { imageUrl, isFetchableUrl } from '../src/core/config';
import { PRIVACY_SECTIONS } from '../src/core/privacy';

const base = require('../app.json').expo as ExpoConfig;
const safety = require('../plugins/with-native-safety.cjs');

it('defaults to a HTTPS-only production build without an insecure environment opt-in', () => {
  const config = releaseConfig(base, {});
  expect(config.extra).toMatchObject({ appVariant: 'production', allowInsecureDevelopmentTraffic: false, nativeBridgeVersion: '0.3.0' });
  expect(config.android?.allowBackup).toBe(false);
  expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false });
  // Expo mods are reverse chained: the safety finalizer must register BEFORE dependency mods.
  expect(config.plugins?.[0]).toEqual(['./plugins/with-native-safety.cjs', { allowCleartext: false }]);
  expect(config.plugins?.[1]).toEqual(['expo-dev-client', { addGeneratedScheme: false }]);
});

it.each(['production', 'preview'])('rejects insecure, credential-bearing and malformed URLs in %s', variant => {
  for (const url of ['http://192.168.0.2:8765', 'file:///tmp/catalog', 'https://user:password@example.com',
    'https://example.com/#fragment', 'https://exa mple.com', 'not a URL']) {
    expect(() => releaseConfig(base, { APP_VARIANT: variant, EXPO_PUBLIC_API_URL: url })).toThrow(/EXPO_PUBLIC_API_URL/);
  }
  expect(() => releaseConfig(base, { APP_VARIANT: variant, EXPO_PUBLIC_IMAGE_BASE: 'https://example.com/?token=secret' })).toThrow(/EXPO_PUBLIC_IMAGE_BASE/);
  expect(releaseConfig(base, { APP_VARIANT: variant, EXPO_PUBLIC_CATALOG_URL: 'https://example.com/catalog?revision=1' }).extra?.allowInsecureDevelopmentTraffic).toBe(false);
});

it('requires an explicit development variant for LAN HTTP and rejects unknown variants', () => {
  const config = releaseConfig(base, { APP_VARIANT: 'development', EXPO_PUBLIC_API_URL: 'http://192.168.0.2:8765' });
  expect(config.extra?.allowInsecureDevelopmentTraffic).toBe(true);
  expect(config.name).toBe('Spotlight Studio Dev');
  expect(config.android?.package).toBe('com.ketandutt.spotlightstudio.dev');
  expect(config.ios?.bundleIdentifier).toBe('com.ketandutt.spotlightstudio.dev');
  expect(config.scheme).toBe('spotlightstudiodev');
  expect(config.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads).toBe(true);
  expect(() => releaseConfig(base, { APP_VARIANT: 'typo' })).toThrow(/APP_VARIANT/);
  expect(() => releaseConfig(base, { APP_VARIANT: 'development', EAS_BUILD_PROFILE: 'production' })).toThrow(/production EAS/);
});

it('enforces HTTPS at runtime even if a bad HTTP URL is present in a production bundle', () => {
  const runtime = globalThis as unknown as { __DEV__: boolean };
  const development = runtime.__DEV__;
  runtime.__DEV__ = false;
  try {
    expect(isFetchableUrl('http://192.168.0.2:8765')).toBe(false);
    expect(imageUrl('peapix/one.jpg', false, 'http://example.com')).toBe('');
    expect(isFetchableUrl('https://example.com/catalog')).toBe(true);
  } finally { runtime.__DEV__ = development; }
});

it('removes broad Android read/overlay permissions and bounds legacy write to API 29', () => {
  const manifest = { manifest: { $: {}, application: [{ $: { 'android:allowBackup': 'true', 'android:usesCleartextTraffic': 'true' } }],
    'uses-permission': [...safety.BLOCKED, 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW'].map((name: string) => ({ $: { 'android:name': name } })) } };
  const hardened = safety.hardenAndroid(manifest, false).manifest;
  expect(hardened.application[0].$).toMatchObject({ 'android:allowBackup': 'false', 'android:usesCleartextTraffic': 'false' });
  for (const name of safety.BLOCKED) expect(hardened['uses-permission']).toContainEqual({ $: { 'android:name': name, 'tools:node': 'remove' } });
  expect(hardened['uses-permission']).toContainEqual({ $: { 'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE', 'android:maxSdkVersion': '29' } });
  expect(safety.hardenAndroid(manifest, false)).toEqual({ manifest: hardened }); // idempotent
});

it('removes iOS read permission and dependency-injected background/local-network modes', () => {
  const plist = { NSPhotoLibraryUsageDescription: 'read', NSPhotoLibraryAddUsageDescription: 'add chosen wallpapers',
    UIBackgroundModes: ['fetch', 'processing'], BGTaskSchedulerPermittedIdentifiers: ['legacy'],
    NSBonjourServices: ['_expo._tcp'], NSLocalNetworkUsageDescription: 'dev', NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } };
  const result = safety.hardenIos(plist, false);
  expect(result.NSPhotoLibraryAddUsageDescription).toBe('add chosen wallpapers');
  for (const key of ['NSPhotoLibraryUsageDescription', 'UIBackgroundModes', 'BGTaskSchedulerPermittedIdentifiers', 'NSBonjourServices', 'NSLocalNetworkUsageDescription']) expect(result[key]).toBeUndefined();
  expect(result.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(false);
});

it('ships an offline notice that discloses host logs, permission scope and irreversible system actions', () => {
  const text = PRIVACY_SECTIONS.map(section => section.body).join('\n');
  expect(text).toMatch(/IP address/);
  expect(text).toMatch(/add-only/);
  expect(text).toMatch(/never deletes Photos/);
  expect(text).toMatch(/system save\/apply already started/);
});
