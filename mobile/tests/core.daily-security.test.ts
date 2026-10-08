import { buildCatalog, dailyWallpaper } from '../src/core/utils';
import { favoritesBackup, parseFavoritesBackup, validFavoriteKey } from '../src/core/storage-utils';
import { imageUrl, isFetchableUrl } from '../src/core/config';
import { cloneRows } from './fixtures';

// Execute the DOM-free JS directly, without Expo's Babel transform outside mobile/.
const fs = jest.requireActual('node:fs') as typeof import('node:fs');
const vm = jest.requireActual('node:vm') as typeof import('node:vm');
const scope = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(`${__dirname}/../../static/js/core.js`, 'utf8'), scope);
const web = scope.module.exports as { buildCatalog: typeof buildCatalog; dailyWallpaper: typeof dailyWallpaper;
  favoritesBackup: typeof favoritesBackup; parseFavoritesBackup: typeof parseFavoritesBackup };

describe('daily spotlight', () => {
  it('matches the web algorithm on every UTC day, even after metadata/order changes', () => {
    const rows = cloneRows();
    const catalog = buildCatalog(rows);
    for (let day = 1; day <= 40; day++) {
      const date = new Date(Date.UTC(2026, 9, day));
      const id = dailyWallpaper(catalog, date)?.id;
      expect(id).toBe(web.dailyWallpaper(web.buildCatalog(rows), date)?.id);
      expect(dailyWallpaper(buildCatalog([...rows].reverse()), date)?.id).toBe(id);
      expect(dailyWallpaper(buildCatalog(rows.map(row => ({ ...row, title: 'Upgraded title' }))), date)?.id).toBe(id);
    }
    expect(dailyWallpaper(catalog, new Date('2026-10-09T01:00:00+02:00'))?.id)
      .toBe(dailyWallpaper(catalog, new Date('2026-10-08T00:00:00Z'))?.id);
    expect(dailyWallpaper(buildCatalog([]))).toBeUndefined();
    expect(dailyWallpaper(catalog, new Date('invalid'))).toBeUndefined();
  });
});

describe('catalog/URL defenses', () => {
  it('drops traversal, ambiguous Unicode, duplicate IDs and duplicate paths', () => {
    const rows = cloneRows();
    const result = buildCatalog([...rows, null, { ...rows[0], id: 400, filename: '../secret.jpg' },
      { ...rows[0], id: 401, filename: 'a/%2e%2e/secret.jpg' }, { ...rows[0], id: 402, filename: 'a/\ud800.jpg' },
      { ...rows[0], id: 403 }, { ...rows[0], filename: 'different.jpg' }, { ...rows[0], id: '999', filename: 'a/x.jpg' }]);
    expect(result.total).toBe(rows.length);
    expect(validFavoriteKey('a/😀.jpg')).toBe(true);
    expect(buildCatalog([{ ...rows[0], source: '__proto__', width: Infinity }]).sourceCounts.__proto__).toBe(1);
    expect(buildCatalog([{ ...rows[0], width: Infinity }]).items[0].q).toBe('sd');
  });
  it('rejects credentials/non-http paths and encodes valid filenames', () => {
    for (const value of ['file:///secret', 'https://user:pass@example.com/x', 'https://', 'https://exa mple.com']) {
      expect(isFetchableUrl(value)).toBe(false);
    }
    expect(imageUrl('../secret.jpg')).toBe('');
    expect(imageUrl('a/%2e%2e.jpg')).toBe('');
    expect(imageUrl('a/\ud800.jpg')).toBe('');
    expect(imageUrl('a/Mount Fuji.jpg', false, 'https://mirror.example/gallery')).toBe('https://mirror.example/gallery/images/a/Mount%20Fuji.jpg');
    expect(imageUrl('a/x.jpg', false, 'https://mirror.example?redirect=x')).toBe('');
  });
});

describe('portable favorites', () => {
  it('round-trips the same version-1 format in both clients, retaining unknown keys', () => {
    const keys = ['peapix/one.jpg', 'unknown/future.jpg'];
    expect(parseFavoritesBackup(web.favoritesBackup(new Set(keys)))).toEqual(keys);
    expect(web.parseFavoritesBackup(favoritesBackup(keys))).toEqual(keys);
    expect(() => parseFavoritesBackup({ format: 'spotlight-favorites', version: 1, favorites: ['../bad'] })).toThrow(/valid/);
    expect(() => parseFavoritesBackup({ format: 'spotlight-favorites', version: 2, favorites: keys })).toThrow(/valid/);
  });
});
