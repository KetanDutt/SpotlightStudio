/**
 * Catalog export – turns the in-memory catalog into a file the user can keep or send
 * somewhere else: JSON (the exact shape of `data/wallpapers.json`, so it can be fed back
 * into the crawler) and CSV (flat, spreadsheet-friendly).
 *
 * The file lands in the cache directory and is handed to the system share sheet; nothing is
 * uploaded.  Both functions resolve to a result object instead of throwing, because the UI
 * has to show a message either way.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { Wallpaper } from '../core/types';
import { fmtBytes } from '../core/utils';

/** Column order of the CSV export – documented in `docs/MOBILE.md`. */
export const CSV_COLUMNS = [
  'id',
  'title',
  'source',
  'quality',
  'width',
  'height',
  'file_size',
  'tags',
  'date_spotted',
  'downloaded_at',
  'page_url',
  'filename',
] as const;

export interface ExportedFile {
  uri: string;
  name: string;
  /** Bytes written (the CSV gets a UTF-8 BOM, hence the +3). */
  size: number;
  rows: number;
}

export type ExportResult = { ok: true; value: ExportedFile } | { ok: false; error: string };

function ok(value: ExportedFile): ExportResult {
  return { ok: true, value };
}

function fail(error: unknown): ExportResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error ?? 'Unknown error') };
}

/**
 * Neutralise spreadsheet formulas and quote the cell when it needs it.
 *
 * The rule is the same one `static/js/core.js` and the server use: a cell that starts with
 * `= + - @ TAB CR` gets a leading apostrophe, so a scraped title like `=HYPERLINK(…)` is
 * exported as text and never executed by Excel or Numbers.
 */
function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render the catalog as CSV.  A UTF-8 BOM is prepended so Excel opens non-ASCII titles
 * (accented credits, emoji) correctly; every editor that does not want it can strip it.
 */
export function catalogToCsv(items: Wallpaper[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const item of items) {
    const raw = item.raw;
    lines.push(
      [
        raw.id,
        raw.title,
        raw.source,
        raw.quality ?? item.q,
        raw.width,
        raw.height,
        raw.file_size,
        raw.tags,
        raw.date_spotted ?? '',
        raw.downloaded_at ?? '',
        raw.page_url ?? '',
        raw.filename,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** The catalog in the exact layout of the committed `data/wallpapers.json`. */
export function catalogToJson(items: Wallpaper[]): string {
  return JSON.stringify(items.map((item) => item.raw));
}

/** `spotlight-studio-catalog-20261007-1830.csv` – sortable and collision-free. */
export function exportFilename(extension: 'json' | 'csv', now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `spotlight-studio-catalog-${stamp}.${extension}`;
}

async function writeAndShare(
  contents: string,
  fileName: string,
  mimeType: string,
  uti: string,
  dialogTitle: string,
  rows: number,
  now: Date,
): Promise<ExportResult> {
  try {
    const file = new File(Paths.cache, fileName);
    if (!file.exists) file.create();
    file.write(contents);
    if (!file.exists) return fail('The export file could not be written.');

    if (!(await Sharing.isAvailableAsync())) {
      // The file is still there – the UI points the user at it instead of failing silently.
      return ok({ uri: file.uri, name: fileName, size: file.size, rows });
    }
    await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle });
    return ok({ uri: file.uri, name: fileName, size: file.size, rows });
  } catch (error) {
    return fail(error);
  }
}

export async function exportCatalogCsv(items: Wallpaper[], now = new Date()): Promise<ExportResult> {
  const csv = catalogToCsv(items);
  return writeAndShare(
    csv,
    exportFilename('csv', now),
    'text/csv',
    'public.comma-separated-values-text',
    'Spotlight Studio catalog (CSV)',
    items.length,
    now,
  );
}

export async function exportCatalogJson(items: Wallpaper[], now = new Date()): Promise<ExportResult> {
  const json = catalogToJson(items);
  return writeAndShare(
    json,
    exportFilename('json', now),
    'application/json',
    'public.json',
    'Spotlight Studio catalog (JSON)',
    items.length,
    now,
  );
}

/** Human-readable summary the screens show after an export ("412 rows · 1.2 MB"). */
export function describeExport(result: ExportedFile): string {
  return `${fmtBytes(result.size)} · ${result.rows.toLocaleString()} row${result.rows === 1 ? '' : 's'}`;
}
