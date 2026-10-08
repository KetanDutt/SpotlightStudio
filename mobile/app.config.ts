/** Store builds are HTTPS-only. Insecure LAN development is an explicit, separate variant. */
import type { ConfigContext, ExpoConfig } from 'expo/config';

const URL_KEYS = ['EXPO_PUBLIC_CATALOG_URL', 'EXPO_PUBLIC_IMAGE_BASE', 'EXPO_PUBLIC_API_URL'] as const;
export type AppVariant = 'development' | 'preview' | 'production';

export function releaseConfig(config: ExpoConfig, env: Readonly<Record<string, string | undefined>> = process.env): ExpoConfig {
  const variant = env.APP_VARIANT ?? 'production';
  if (!['development', 'preview', 'production'].includes(variant)) throw new Error('APP_VARIANT must be development, preview or production.');
  if (env.EAS_BUILD_PROFILE === 'production' && variant !== 'production') throw new Error('The production EAS profile requires APP_VARIANT=production.');
  const development = variant === 'development';
  for (const key of URL_KEYS) {
    const value = env[key]?.trim();
    if (!value) continue;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`${key} must be an absolute HTTP(S) URL.`); }
    if (!['https:', ...(development ? ['http:'] : [])].includes(url.protocol) || !url.hostname ||
        url.username || url.password || url.hash || /[\s\x00-\x1f\x7f]/.test(value) ||
        (key !== 'EXPO_PUBLIC_CATALOG_URL' && url.search)) {
      // Name the setting, not its value: URLs must not accidentally log embedded secrets.
      throw new Error(`${key} must use ${development ? 'HTTP(S)' : 'HTTPS'}, with no credentials, fragment or invalid base query.`);
    }
  }
  return {
    ...config,
    name: development ? 'Spotlight Studio Dev' : config.name,
    scheme: development ? 'spotlightstudiodev' : config.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: development ? `${config.ios?.bundleIdentifier}.dev` : config.ios?.bundleIdentifier,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: development
          ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
          : { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false },
      },
    },
    android: { ...config.android, allowBackup: false,
      package: development ? `${config.android?.package}.dev` : config.android?.package },
    extra: { ...config.extra, appVariant: variant, allowInsecureDevelopmentTraffic: development, nativeBridgeVersion: '0.3.0' },
    // Expo's withMod chain runs last-registered first: install this finalizer FIRST.
    plugins: [['./plugins/with-native-safety.cjs', { allowCleartext: development }],
      ['expo-dev-client', { addGeneratedScheme: development }], ...(config.plugins ?? [])],
  };
}

export default ({ config }: ConfigContext): ExpoConfig => releaseConfig(config as ExpoConfig);
