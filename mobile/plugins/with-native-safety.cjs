/* Register first so reverse-chained Expo mods finalize policy AFTER dependency plugins. */
const { withAndroidManifest, withInfoPlist, withGradleProperties, withPodfileProperties } = require('expo/config-plugins');

const BLOCKED = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.ACCESS_MEDIA_LOCATION',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
];

function hardenAndroid(manifest, allowCleartext) {
  const root = manifest.manifest;
  const blocked = allowCleartext ? BLOCKED : [...BLOCKED, 'android.permission.SYSTEM_ALERT_WINDOW'];
  root.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  root['uses-permission'] = (root['uses-permission'] ?? []).filter(entry =>
    !blocked.includes(entry.$['android:name']) && entry.$['android:name'] !== 'android.permission.WRITE_EXTERNAL_STORAGE');
  for (const permission of blocked) {
    root['uses-permission'].push({ $: { 'android:name': permission, 'tools:node': 'remove' } });
  }
  // SDK 57's legacy add-only saver needs WRITE below Android 11. Never request it on 11+.
  root['uses-permission'].push({ $: { 'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE', 'android:maxSdkVersion': '29' } });
  const app = root.application?.[0];
  if (!app) throw new Error('Native safety: Android application is missing.');
  app.$['android:allowBackup'] = 'false';
  app.$['android:usesCleartextTraffic'] = allowCleartext ? 'true' : 'false';
  // Required for the SDK legacy saver on Android 10 only; ignored with scoped storage on 11+.
  app.$['android:requestLegacyExternalStorage'] = 'true';
  return manifest;
}

function hardenIos(plist, allowCleartext) {
  delete plist.NSPhotoLibraryUsageDescription; // Add-only save; never request full gallery read.
  delete plist.UIBackgroundModes;             // Wallpaper rotation is Android-only.
  delete plist.BGTaskSchedulerPermittedIdentifiers;
  if (!allowCleartext) {
    delete plist.NSBonjourServices;
    delete plist.NSLocalNetworkUsageDescription;
  }
  plist.PHPhotoLibraryPreventAutomaticLimitedAccessAlert = true;
  plist.NSAppTransportSecurity = allowCleartext
    ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
    : { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false };
  return plist;
}

module.exports = function withNativeSafety(config, { allowCleartext = false } = {}) {
  config = withAndroidManifest(config, result => {
    result.modResults = hardenAndroid(result.modResults, allowCleartext);
    return result;
  });
  config = withGradleProperties(config, result => {
    result.modResults = result.modResults.filter(entry => entry.key !== 'EX_DEV_CLIENT_NETWORK_INSPECTOR');
    result.modResults.push({ type: 'property', key: 'EX_DEV_CLIENT_NETWORK_INSPECTOR', value: allowCleartext ? 'true' : 'false' });
    return result;
  });
  config = withPodfileProperties(config, result => {
    result.modResults.EX_DEV_CLIENT_NETWORK_INSPECTOR = allowCleartext ? 'true' : 'false';
    return result;
  });
  return withInfoPlist(config, result => {
    result.modResults = hardenIos(result.modResults, allowCleartext);
    return result;
  });
};
module.exports.hardenAndroid = hardenAndroid;
module.exports.hardenIos = hardenIos;
module.exports.BLOCKED = BLOCKED;
