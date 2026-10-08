#!/usr/bin/env node
/** Validate the resolved mods, not merely app.json: dependency plugins also change policy. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { BLOCKED } = require('../plugins/with-native-safety.cjs');

const root = resolve(__dirname, '..');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
const eas = require('../eas.json');
const cli = require.resolve('expo/bin/cli');
const result = spawnSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], {
  cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, APP_VARIANT: 'production', EXPO_OFFLINE: '1', CI: '1' },
});

try {
  if (process.env.APP_VARIANT && process.env.APP_VARIANT !== 'production') {
    throw new Error('Set APP_VARIANT=production (or unset it) before a production verification/build.');
  }
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stderr || 'Expo config inspection failed.\n');
    throw result.error ?? new Error('Could not resolve production configuration.');
  }
  const config = JSON.parse(result.stdout);
  assert.equal(config.version, pkg.version, 'App/package versions must agree.');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(config.extra.appVariant, 'production');
  assert.equal(config.extra.allowInsecureDevelopmentTraffic, false);
  assert.ok(Number.isInteger(config.android.versionCode) && config.android.versionCode > 0);
  assert.match(config.ios.buildNumber, /^\d+$/);
  assert.equal(eas.build.production.developmentClient, false);
  assert.equal(eas.build.production.distribution, 'store');
  assert.equal(eas.build.production.env.APP_VARIANT, 'production');
  assert.equal(eas.build.production.android.buildType, 'app-bundle');

  const mods = config._internal.modResults;
  const manifest = mods.android.manifest.manifest;
  const app = manifest.application[0].$;
  assert.equal(app['android:usesCleartextTraffic'], 'false', 'Production must not allow cleartext.');
  assert.equal(app['android:allowBackup'], 'false');
  const declared = manifest['uses-permission'];
  for (const permission of [...BLOCKED, 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION']) {
    assert.ok(declared.some(entry => entry.$['android:name'] === permission && entry.$['tools:node'] === 'remove'), `Must block ${permission}.`);
    assert.ok(!declared.some(entry => entry.$['android:name'] === permission && entry.$['tools:node'] !== 'remove'), `Must not request ${permission}.`);
  }
  const write = declared.filter(entry => entry.$['android:name'] === 'android.permission.WRITE_EXTERNAL_STORAGE');
  assert.equal(write.length, 1);
  assert.equal(write[0].$['android:maxSdkVersion'], '29', 'Legacy write consent must not apply to Android 11+.');
  for (const key of ['android.enableMinifyInReleaseBuilds', 'android.enableShrinkResourcesInReleaseBuilds']) {
    assert.equal(mods.android.gradleProperties.find(entry => entry.key === key)?.value, 'true', `Missing ${key}.`);
  }
  assert.equal(mods.android.gradleProperties.find(entry => entry.key === 'EX_DEV_CLIENT_NETWORK_INSPECTOR')?.value, 'false');

  const plist = mods.ios.infoPlist;
  assert.equal(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.equal(plist.NSAppTransportSecurity.NSAllowsLocalNetworking, false);
  for (const key of ['UIBackgroundModes', 'BGTaskSchedulerPermittedIdentifiers', 'NSPhotoLibraryUsageDescription',
    'NSBonjourServices', 'NSLocalNetworkUsageDescription']) assert.equal(plist[key], undefined, `Unexpected iOS ${key}.`);
  assert.ok(plist.NSPhotoLibraryAddUsageDescription?.length > 30);
  assert.equal(mods.ios.podfileProperties.EX_DEV_CLIENT_NETWORK_INSPECTOR, 'false');
  assert.equal(config.ios.privacyManifests.NSPrivacyTracking, false);
  assert.deepEqual(config.ios.privacyManifests.NSPrivacyCollectedDataTypes, []);
  assert.equal(mods.ios.podfileProperties['apple.privacyManifestAggregationEnabled'], 'true');

  const bridge = config.extra.nativeBridgeVersion;
  assert.match(readFileSync(resolve(root, 'modules/wallpaper/android/build.gradle'), 'utf8'), new RegExp(`versionName "${bridge.replaceAll('.', '\\.')}"`));
  assert.match(readFileSync(resolve(root, 'modules/wallpaper/ios/SpotlightWallpaper.podspec'), 'utf8'), new RegExp(`s.version\\s*= '${bridge.replaceAll('.', '\\.')}';?`));
  process.stdout.write(`Production config verified: app ${pkg.version}, bridge ${bridge}, HTTPS-only, scoped Photos, Android-only rotation.\n`);
  process.stdout.write('This is not store certification. Native compilation, signed/device QA, dependency audit and publishing approvals remain separate gates.\n');
} catch (error) {
  process.stderr.write(`Release configuration failed: ${error.message}\n`);
  process.exitCode = 1;
}
