/** Kept in the bundle so the policy is readable without a network connection. */
export const PRIVACY_UPDATED = '8 October 2026';
export const PRIVACY_SECTIONS = [
  {
    title: 'No account, advertising or analytics',
    body: 'Spotlight Studio does not require an account and does not include app analytics, advertising, tracking or crash-report uploads. Favorites, searches, action history, theme and rotation settings are kept on this device. There is no cloud sync.',
  },
  {
    title: 'Network requests',
    body: 'The app downloads a catalog, thumbnails and selected full-size images from GitHub by default, or from the server configured in the build. Those hosts receive normal connection information, such as your IP address, request time and requested URL, and may keep their own logs. Opening source pages or documentation contacts the selected website. Store builds require HTTPS; explicit development builds may use HTTP on a test network.',
  },
  {
    title: 'Photos and wallpaper',
    body: 'Photos saving happens only when you choose Save. On iOS, add-only permission is requested, not permission to read your gallery. New saves normally appear in Photos / Recent; an app album is optional only if you already granted full read access to a previous build. Android 11 and newer save using MediaStore without gallery-read permission; Android 7–10 need legacy write consent. Android wallpaper changes require a native build and may be restricted by device policy. iOS wallpaper application is manual. Background rotation is Android-only and must be enabled by you.',
  },
  {
    title: 'Sharing, clipboard and backups',
    body: 'Sharing sends the image or JSON/CSV file you select to the app you choose. Copy link writes only the public wallpaper link to your clipboard. Favorites import reads only the backup file you choose in the system picker. A favorites backup contains image identifiers, not the images. Keep exported backups outside the app if you want to retain them.',
  },
  {
    title: 'Storage and deletion',
    body: 'App-owned original downloads are limited to 256 MiB. Old temporary downloads and exports are cleaned up after 24 hours; active operations are protected. The image-display SDK has a separate thumbnail/image cache. Clear cache removes app downloads and asks the SDK to clear its image cache; favorites and saved Photos are kept. Reset app data removes local preferences and the app cache, stops rotation and reloads the app. It never deletes Photos. Removing the app normally removes its private data; OS backups, device transfers, Photos sync and copies shared elsewhere follow your device and recipient settings.',
  },
  {
    title: 'Limits and contact',
    body: 'The app cannot silently set an iOS wallpaper, guarantee exact Android background timing, undo a system save/apply already started, or control another service’s privacy policy. Wallpapers remain the property of their original photographers. Ask privacy questions through the Spotlight Studio repository contact channel; do not attach private backups, device identifiers or secrets to a public issue.',
  },
] as const;
