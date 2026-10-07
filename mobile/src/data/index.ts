/**
 * Catalog bundled with the app.
 *
 * `catalog.json` is a copy of `data/wallpapers.json` from the Spotlight Studio repository —
 * the same file the web showcase loads.  Bundling it means the very first launch shows a
 * full gallery even with no connection, and that the Android background task can always
 * rotate (it cannot wait for a network request).
 *
 * Regenerate with:  `npm run sync:catalog`  (see scripts/sync-catalog.mjs)
 */
import type { RawWallpaper } from '../core/types';

// `require` (instead of an ESM import) keeps TypeScript from inferring a gigantic literal
// type for the ~4 MB file – the rows are validated at runtime by the catalog provider.
export const bundledCatalog: RawWallpaper[] = require('./catalog.json') as RawWallpaper[];
