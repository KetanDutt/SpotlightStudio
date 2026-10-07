/**
 * Catalog export – CSV rendering, JSON shape, the file that ends up in the cache directory
 * and the hand-off to the system share sheet.  `expo-file-system` is the shared in-memory
 * double; `expo-sharing` is mocked globally in `jest.setup.ts`.
 */
jest.mock('expo-file-system', () => jest.requireActual('./mocks').fileSystemMock());

import * as Sharing from 'expo-sharing';

import { buildCatalog } from '../src/core/utils';
import type { Wallpaper } from '../src/core/types';
import {
  CSV_COLUMNS,
  catalogToCsv,
  catalogToJson,
  describeExport,
  exportCatalogCsv,
  exportCatalogJson,
  exportFilename,
} from '../src/services/export';
import { cloneRows } from './fixtures';

const fs = jest.requireMock('expo-file-system') as ReturnType<typeof import('./mocks').fileSystemMock>;

const catalog = buildCatalog(cloneRows());
/** A row with every CSV hazard: a comma, a quote and a newline. */
const awkward: Wallpaper = {
  ...catalog.items[0]!,
  raw: {
    ...catalog.items[0]!.raw,
    title: 'He said "hi", then\nleft',
    tags: 'alps,matterhorn',
  },
};

const FIXED_DATE = new Date(2026, 9, 7, 18, 30); // 2026-10-07 18:30 local

beforeEach(() => {
  fs.__reset();
  jest.clearAllMocks();
});

describe('catalogToCsv', () => {
  it('writes a header, one row per wallpaper, CRLF endings and a BOM', () => {
    const csv = catalogToCsv(catalog.items);
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(catalog.items.length + 1);
    expect(lines[1]).toContain('peapix/one.jpg');
  });

  it('quotes delimiters, quotes and newlines', () => {
    const csv = catalogToCsv([awkward]);
    expect(csv).toContain('"He said ""hi"", then\nleft"');
    // The tags column keeps its comma because it is quoted.
    expect(csv).toContain('"alps,matterhorn"');
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    const hostile: Wallpaper = {
      ...awkward,
      raw: { ...awkward.raw, title: '=HYPERLINK("http://evil.example","click")', tags: '+1-555' },
    };
    const csv = catalogToCsv([hostile]);
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.example"",""click"")"');
    expect(csv).toContain('\'+1-555');
  });

  it('handles an empty catalog', () => {
    expect(catalogToCsv([])).toBe(`\uFEFF${CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('catalogToJson', () => {
  it('mirrors the shape of data/wallpapers.json', () => {
    const rows = JSON.parse(catalogToJson(catalog.items)) as { id: number; filename: string; tags: string }[];
    expect(rows).toHaveLength(cloneRows().length);
    expect(rows[0]).toMatchObject({ id: 101, filename: 'peapix/one.jpg' });
    expect(typeof rows[0]!.tags).toBe('string');
  });
});

describe('exportFilename', () => {
  it('stamps the local date and time', () => {
    expect(exportFilename('csv', FIXED_DATE)).toBe('spotlight-studio-catalog-20261007-1830.csv');
    expect(exportFilename('json', FIXED_DATE)).toMatch(/\.json$/);
  });
});

describe('exportCatalogCsv', () => {
  it('writes the file into the cache and offers it to the share sheet', async () => {
    const result = await exportCatalogCsv(catalog.items, FIXED_DATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe('spotlight-studio-catalog-20261007-1830.csv');
    expect(result.value.rows).toBe(catalog.items.length);
    expect(result.value.uri.startsWith('file:///cache/')).toBe(true);

    const written = fs.__files.get(result.value.uri);
    expect(written?.content.startsWith('\uFEFF')).toBe(true);
    expect(result.value.size).toBe(written?.content.length);

    expect(Sharing.shareAsync).toHaveBeenCalledWith(result.value.uri, expect.objectContaining({ mimeType: 'text/csv' }));
  });

  it('still returns the file when the device has no share sheet', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    const result = await exportCatalogCsv(catalog.items, FIXED_DATE);
    expect(result.ok).toBe(true);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing', async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('share sheet dismissed'));
    const result = await exportCatalogCsv(catalog.items, FIXED_DATE);
    expect(result).toEqual({ ok: false, error: 'share sheet dismissed' });
  });
});

describe('exportCatalogJson', () => {
  it('exports JSON with the right MIME type', async () => {
    const result = await exportCatalogJson(catalog.items, FIXED_DATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('spotlight-studio-catalog-20261007-1830.json');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(result.value.uri, expect.objectContaining({ mimeType: 'application/json' }));
  });
});

describe('describeExport', () => {
  it('summarises size and rows for the toast', () => {
    const summary = describeExport({ uri: 'file:///cache/x.csv', name: 'x.csv', size: 2048, rows: 3 });
    expect(summary).toContain('3 rows');
    expect(summary).toMatch(/KB/);
  });

  it('uses the singular for one row', () => {
    expect(describeExport({ uri: 'x', name: 'x', size: 10, rows: 1 })).toContain('1 row');
  });
});
