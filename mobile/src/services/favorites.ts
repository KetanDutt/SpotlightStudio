/** Portable favorites backup/merge import; no account and no image files included. */
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { favoritesBackup, parseFavoritesBackup } from '../core/storage-utils';
import type { MediaResult } from './media';
import { utf8Bytes } from './catalog-cache';
import { cacheActivity, createExportFile, pinCacheFile } from './cache';

const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function exportFavorites(favorites: Iterable<string>): Promise<MediaResult<string>> {
  let done: (() => void) | undefined;
  let unpin: (() => void) | undefined;
  try {
    done = cacheActivity();
    if (!await Sharing.isAvailableAsync()) return { ok: false, error: 'File sharing is unavailable. Use the web gallery for browser backups.' };
    const text = JSON.stringify(favoritesBackup(favorites), null, 2);
    const expectedBytes = utf8Bytes(text);
    if (expectedBytes > MAX_BACKUP_BYTES) throw new Error('The backup exceeds the 2 MB import limit.');
    const file = createExportFile('spotlight-favorites.json', expectedBytes);
    unpin = pinCacheFile(file.uri);
    file.create({ overwrite: true });
    file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Back up favorites' });
    return { ok: true, value: file.uri };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  } finally { unpin?.(); done?.(); }
}

export async function importFavorites(): Promise<MediaResult<string[] | null>> {
  let done: (() => void) | undefined;
  try {
    done = cacheActivity();
    const { result } = await File.pickFileAsync({ mimeTypes: ['application/json'] });
    if (!result) return { ok: true, value: null }; // Picker canceled.
    if (Array.isArray(result)) throw new Error('Choose one favorites backup file.');
    if (!Number.isFinite(result.size) || result.size > MAX_BACKUP_BYTES) throw new Error('Choose a backup no larger than 2 MB.');
    const text = await result.text();
    if (utf8Bytes(text) > MAX_BACKUP_BYTES) throw new Error('Choose a backup no larger than 2 MB.');
    return { ok: true, value: parseFavoritesBackup(JSON.parse(text)) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  } finally { done?.(); }
}
