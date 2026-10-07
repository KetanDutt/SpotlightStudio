#!/usr/bin/env node
/**
 * Copy the repository catalog into the app bundle.
 *
 *   node scripts/sync-catalog.mjs
 *
 * `src/data/catalog.json` is what makes the first launch (and the Android background task)
 * work without any network.  Run this after `python main.py --crawl … --sync-catalog` and
 * commit the result, exactly like the web showcase commits `data/wallpapers.json`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');

const source = resolve(repoRoot, 'data', 'wallpapers.json');
const target = resolve(appRoot, 'src', 'data', 'catalog.json');

if (!existsSync(source)) {
  console.error(`✖ ${source} does not exist. Run \`python main.py --sync-catalog\` first.`);
  process.exit(1);
}

const raw = readFileSync(source, 'utf8');

let rows;
try {
  rows = JSON.parse(raw);
} catch (error) {
  console.error(`✖ ${source} is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(rows) || rows.length === 0) {
  console.error(`✖ ${source} does not contain a JSON array of wallpapers.`);
  process.exit(1);
}

// Fail loudly on the Git-LFS pointer problem – a catalog full of placeholder rows is worse
// than no catalog at all.
const broken = rows.filter((row) => !row || typeof row.filename !== 'string' || !row.filename.includes('/'));
if (broken.length > rows.length * 0.05) {
  console.warn(`⚠ ${broken.length} of ${rows.length} rows look malformed – is Git LFS installed?`);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, raw);

const size = statSync(target).size;
console.log(`✔ ${rows.length} wallpapers copied to src/data/catalog.json (${(size / 1024 / 1024).toFixed(2)} MB)`);
