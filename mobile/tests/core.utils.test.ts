/**
 * The pure core: search, sorting, pagination, formatting and the catalog model.
 * These tests are the contract the mobile app shares with `static/js/core.js`.
 */
import {
  DEFAULT_STATE,
  buildCatalog,
  comparator,
  decodeState,
  downloadFilename,
  encodeState,
  filterAndSort,
  fmtBytes,
  fmtDate,
  fmtInt,
  fmtWallpaperSize,
  generatedTitle,
  isPlaceholderTitle,
  paginate,
  parseDateTs,
  qualityClass,
  qualityLabel,
  slugify,
  splitTags,
  titleCase,
  tokenize,
  topTags,
} from '../src/core/utils';
import { cloneRows } from './fixtures';

const catalog = buildCatalog(cloneRows());

/**
 * The real generated-title rule ignores tags used by more than 12 % of the library, so a
 * six-row fixture cannot exercise it – pad the catalog with filler rows here.
 */
function wideCatalog(extra = 6) {
  const filler = Array.from({ length: extra }, (_value, index) => ({
    id: 500 + index,
    filename: `filler/${index}.jpg`,
    title: `Filler ${index}`,
    source: 'peapix',
    width: 1920,
    height: 1080,
    file_size: 1000,
    tags: 'nature,sky',
    date_spotted: '2019-01-01',
    downloaded_at: '2019-01-02T00:00:00+00:00',
  }));
  return buildCatalog([...cloneRows(), ...filler]);
}

describe('text helpers', () => {
  it('detects placeholder titles (hashes and generic site names)', () => {
    expect(isPlaceholderTitle('f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f')).toBe(true);
    expect(isPlaceholderTitle('Windows Spotlight')).toBe(true);
    expect(isPlaceholderTitle('untitled')).toBe(true);
    expect(isPlaceholderTitle('Matterhorn at Sunrise')).toBe(false);
    // 32 hex chars (the Win10 spotlight file names) count as placeholders too.
    expect(isPlaceholderTitle('dfffe373d9c78e79e0d6a28ac186d8c5')).toBe(true);
  });

  it('folds diacritics and case for search', () => {
    expect(tokenize('  Galápagos   ISLANDS galápagos ')).toEqual(['galapagos', 'islands']);
    expect(tokenize('')).toEqual([]);
  });

  it('splits and normalises tags', () => {
    expect(splitTags(' Alps , switzerland ,Alps,  SUNRISE ')).toEqual(['alps', 'switzerland', 'sunrise']);
    expect(splitTags('')).toEqual([]);
  });

  it('title-cases and slugifies', () => {
    expect(titleCase('northern lights')).toBe('Northern Lights');
    expect(titleCase('são-paulo')).toBe('São-Paulo');
    expect(slugify('Matterhorn at Sunrise (4K)')).toBe('matterhorn-at-sunrise-4k');
    expect(slugify('')).toBe('wallpaper');
  });
});

describe('formatting', () => {
  it('formats numbers, sizes and dates', () => {
    expect(fmtInt(7476)).toBe('7,476');
    expect(fmtBytes(0)).toBe('–');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(4_200_000)).toBe('4.01 MB');
    expect(parseDateTs('2024-01-15')).toBe(Date.UTC(2024, 0, 15));
    expect(parseDateTs('')).toBe(0);
    expect(fmtDate('2024-01-15')).toBe('Jan 15, 2024');
    expect(fmtDate('not a date')).toBe('not a date');
    expect(fmtWallpaperSize(3840, 2160)).toBe('3840 × 2160 · 8.29 MP');
    expect(fmtWallpaperSize(8000, 4500)).toBe('8000 × 4500 · 36.0 MP');
    expect(fmtWallpaperSize(0, 0)).toBe('Unknown size');
  });

  it('maps widths to the quality vocabulary of the backend', () => {
    expect(qualityClass(3840)).toBe('4k');
    expect(qualityClass(2560)).toBe('2k');
    expect(qualityClass(1920)).toBe('fhd');
    expect(qualityClass(1280)).toBe('hd');
    expect(qualityClass(800)).toBe('sd');
    expect(qualityLabel(3840)).toBe('4K / UHD');
  });

  it('builds a readable download file name', () => {
    const item = catalog.byId.get(101)!;
    expect(downloadFilename(item)).toBe('matterhorn-at-sunrise-101.jpg');
  });
});

describe('catalog model', () => {
  it('enriches rows without mutating them', () => {
    const rows = cloneRows();
    const built = buildCatalog(rows);
    expect(built.total).toBe(6);
    expect(rows[1].title).toMatch(/^f0e1/); // raw row untouched
    expect(built.byKey.get('peapix/one.jpg')?.title).toBe('Matterhorn at Sunrise');
    expect(built.byKey.get('peapix/one.jpg')?.generated).toBe(false);
    expect(built.byId.get(102)?.generated).toBe(true);
    expect(built.tagCount.get('nature')).toBe(4);
    expect(built.qualityCounts['4k']).toBe(2);
    expect(built.sourceCounts['peapix']).toBe(4);
  });

  it('generates a title from the rarest tags and keeps their original order', () => {
    const item = wideCatalog().byId.get(102)!;
    expect(item.generated).toBe(true);
    // "japan", "kyoto" and "temple" are rare; "nature" is used by too much of the library.
    expect(item.title).toBe('Japan · Kyoto · Temple');
    expect(item.title).not.toContain('Nature');
  });

  it('notes that a small library has no informative tags at all', () => {
    // 4 of 6 rows use "nature" – with such a small library every tag looks generic.
    expect(catalog.byId.get(102)?.generated).toBe(true);
    expect(catalog.byId.get(102)?.title).toBe('Spotlight wallpaper · Nov 2, 2023');
  });

  it('falls back to a dated placeholder when every tag is generic', () => {
    const built = buildCatalog([
      { id: 1, filename: 'x/y.jpg', title: '', source: 'peapix', width: 1920, height: 1080, file_size: 1, tags: 'nature,nature', date_spotted: '2024-02-02' },
    ]);
    expect(built.items[0].title).toBe('Spotlight wallpaper · Feb 2, 2024');
  });

  it('handles an empty or invalid catalog', () => {
    expect(buildCatalog(null).total).toBe(0);
    expect(buildCatalog(undefined).items).toEqual([]);
    expect(generatedTitle({ tags: [], raw: { date_spotted: undefined } } as never, new Map())).toBe('Spotlight wallpaper');
  });

  it('computes the most used tags', () => {
    const top = topTags(catalog, 3);
    expect(top[0][0]).toBe('nature');
    expect(top[0][1]).toBe(4);
    expect(top).toHaveLength(3);
    // Scoped to a pool: inside the Peapix-only subset nothing changes for "nature".
    const pool = topTags(catalog, 2, catalog.items.filter((i) => i.source === 'peapix'));
    expect(pool[0][0]).toBe('nature');
  });
});

describe('filtering and sorting', () => {
  it('sorts newest first by default and puts unknown dates last', () => {
    const sorted = filterAndSort(catalog, { ...DEFAULT_STATE, sort: 'newest' });
    expect(sorted[0].id).toBe(105); // 2024-03-09
    expect(sorted[sorted.length - 1].id).toBe(104); // no date
  });

  it('sorts by resolution, size and title', () => {
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, sort: 'resolution' })[0].raw.width).toBe(3840);
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, sort: 'size' })[0].raw.file_size).toBe(5_000_000);
    // Generated titles always sort last, regardless of the alphabet.
    const byTitle = filterAndSort(catalog, { ...DEFAULT_STATE, sort: 'title' });
    expect(byTitle[0].generated).toBe(false);
    expect(byTitle[byTitle.length - 1].generated).toBe(true);
  });

  it('filters by source, quality, tag and search terms', () => {
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, source: 'win10spotlight' })).toHaveLength(2);
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, quality: '4k' })).toHaveLength(2);
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, tag: 'japan' })).toHaveLength(1);
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, q: 'aurora norway' })).toHaveLength(1);
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, q: 'nothinghere' })).toHaveLength(0);
    // Multiple terms must all match.
    expect(filterAndSort(catalog, { ...DEFAULT_STATE, q: 'japan iceland' })).toHaveLength(0);
  });

  it('treats favourites as a set of file names', () => {
    const favorites = new Set(['peapix/one.jpg', 'peapix/five.jpg']);
    const list = filterAndSort(catalog, { ...DEFAULT_STATE, fav: true }, favorites);
    expect(list.map((item) => item.key).sort()).toEqual(['peapix/five.jpg', 'peapix/one.jpg']);
  });

  it('never mutates the catalog while sorting', () => {
    const before = catalog.items.map((item) => item.id);
    filterAndSort(catalog, { ...DEFAULT_STATE, sort: 'title-desc' });
    expect(catalog.items.map((item) => item.id)).toEqual(before);
  });

  it('exposes a stable comparator for a sort key', () => {
    const compare = comparator('size');
    expect(compare(catalog.byId.get(105)!, catalog.byId.get(103)!)).toBeLessThan(0);
  });
});

describe('pagination', () => {
  it('slices the list and reports the range', () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(page.items).toEqual([3, 4]);
    expect(page.from).toBe(3);
    expect(page.to).toBe(4);
    expect(page.pages).toBe(3);
  });

  it('clamps out-of-range pages and empty lists', () => {
    expect(paginate([1, 2, 3], 99, 2).page).toBe(2);
    const empty = paginate<number>([], 1, 24);
    expect(empty.pages).toBe(1);
    expect(empty.from).toBe(0);
  });
});

describe('url state', () => {
  it('serialises only non-default values', () => {
    expect(encodeState({ ...DEFAULT_STATE })).toEqual({});
    expect(encodeState({ ...DEFAULT_STATE, q: 'aurora', tag: 'norway', view: 'list', fav: true })).toEqual({
      q: 'aurora',
      tag: 'norway',
      view: 'list',
      fav: '1',
    });
  });

  it('parses and validates parameters', () => {
    const state = decodeState({ q: '  aurora  ', source: 'peapix', quality: '4k', tag: 'NORWAY', sort: 'size', view: 'list', cols: '3', fav: '1' });
    expect(state).toMatchObject({ q: '  aurora  ', source: 'peapix', quality: '4k', tag: 'norway', sort: 'size', view: 'list', cols: 3, fav: true });
  });

  it('falls back to defaults for hostile input', () => {
    const state = decodeState({ source: 'evil', quality: 'ultra', sort: 'drop table', view: 'nope', cols: '99' });
    expect(state).toMatchObject({ source: '', quality: '', sort: 'newest', view: 'grid', cols: 2, fav: false });
    expect(decodeState({}).q).toBe('');
    expect(decodeState({ q: 'x'.repeat(500) }).q).toHaveLength(120);
  });
});
