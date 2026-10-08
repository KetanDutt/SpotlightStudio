/*!
 * Spotlight Studio – core.js
 *
 * Pure, DOM-free logic shared by both UI modes (static GitHub-Pages showcase and
 * desktop app).  Everything here is deterministic and unit-tested with
 * `node --test tests/js` – see docs/FRONTEND.md.
 *
 * Exposed as `window.SpotlightCore` in the browser and via `module.exports` in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SpotlightCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ───────────────────────────── constants ───────────────────────────── */

  const DEFAULT_IMAGE_BASE = "https://github.com/KetanDutt/SpotlightStudio/blob/main";

  /** Combined sort + order choices shown in the UI (key → backend field/direction). */
  const SORTS = {
    newest: { sort: "date_spotted", order: "DESC", label: "Newest first" },
    oldest: { sort: "date_spotted", order: "ASC", label: "Oldest first" },
    added: { sort: "downloaded_at", order: "DESC", label: "Recently added" },
    resolution: { sort: "width", order: "DESC", label: "Highest resolution" },
    size: { sort: "file_size", order: "DESC", label: "Largest file" },
    title: { sort: "title", order: "ASC", label: "Title A–Z" },
    "title-desc": { sort: "title", order: "DESC", label: "Title Z–A" },
  };

  const PAGE_SIZES = [12, 24, 48, 96];
  const VIEWS = ["grid", "list"];
  const SOURCES = ["peapix", "win10spotlight"];
  const QUALITIES = ["4k", "2k", "fhd", "hd", "sd"];
  const QUALITY_LABELS = { "4k": "4K", "2k": "2K", fhd: "Full HD", hd: "HD", sd: "SD" };
  const SOURCE_LABELS = { peapix: "Peapix", win10spotlight: "Windows 10 Spotlight" };

  const DEFAULT_STATE = Object.freeze({
    q: "",
    source: "",
    quality: "",
    tag: "",
    sort: "newest",
    page: 1,
    per: 24,
    view: "grid",
    fav: false,
  });

  /* ───────────────────────────── text helpers ───────────────────────────── */

  const HASH_TITLE = /^[0-9a-f]{32,64}$/i;
  const GENERIC_TITLES = new Set([
    "", "untitled", "windows spotlight", "windows spotlight wallpaper", "windows spotlight image",
    "windows spotlight images", "windows10spotlight", "spotlight wallpaper", "spotlight gallery",
  ]);
  /** Tags used by more than this share of the library say nothing about a picture. */
  const GENERIC_TAG_SHARE = 0.12;

  /** True for titles that carry no information (file hashes, generic site names). */
  function isPlaceholderTitle(title) {
    const text = String(title == null ? "" : title).trim();
    return HASH_TITLE.test(text) || GENERIC_TITLES.has(text.toLowerCase());
  }

  /** Lower-case and strip diacritics so "Galápagos" matches "galapagos". */
  function foldText(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  /** Search query → unique folded terms (all of them must match). */
  function tokenize(query, limit) {
    const seen = new Set();
    const out = [];
    for (const part of foldText(query).split(/\s+/)) {
      if (part && !seen.has(part)) {
        seen.add(part);
        out.push(part);
        if (out.length >= (limit || 8)) break;
      }
    }
    return out;
  }

  function splitTags(raw) {
    if (!raw) return [];
    const seen = new Set();
    const out = [];
    for (const piece of String(raw).split(",")) {
      const tag = piece.replace(/\s+/g, " ").trim().toLowerCase();
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
    return out;
  }

  function titleCase(text) {
    return String(text).replace(/(^|[\s\-/])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
  }

  function slugify(text, maxLength) {
    const slug = foldText(text)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug.slice(0, maxLength || 60).replace(/-+$/, "") || "wallpaper";
  }

  /* ───────────────────────────── formatting ───────────────────────────── */

  function fmtInt(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function fmtBytes(bytes) {
    const n = Number(bytes);
    if (!n || n < 0) return "–";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  /** `YYYY-MM-DD` → timestamp (UTC midnight); 0 when unknown / invalid. */
  function parseDateTs(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!m) return 0;
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(ts) ? 0 : ts;
  }

  /** `2025-05-14` → "May 14, 2025" (timezone safe).  Unknown formats are returned as-is. */
  function fmtDate(value, locale) {
    const ts = parseDateTs(value);
    if (!ts) return value ? String(value) : "";
    return new Date(ts).toLocaleDateString(locale || "en-US", {
      year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
  }

  /** "3 minutes ago" style text (falls back to a date for old timestamps). */
  function fmtRelative(iso, now) {
    const then = Date.parse(iso || "");
    if (!then) return "";
    const seconds = Math.round(((now == null ? Date.now() : now) - then) / 1000);
    const abs = Math.abs(seconds);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    if (abs < 45) return "just now";
    const units = [["minute", 60], ["hour", 3600], ["day", 86400], ["week", 604800], ["month", 2592000], ["year", 31536000]];
    let chosen = units[0];
    for (const unit of units) if (abs >= unit[1]) chosen = unit;
    return rtf.format(-Math.round(seconds / chosen[1]), chosen[0]);
  }

  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  /* ───────────────────────────── catalog model ───────────────────────────── */

  function qualityClass(width) {
    const w = Number(width) || 0;
    if (w >= 3840) return "4k";
    if (w >= 2560) return "2k";
    if (w >= 1920) return "fhd";
    if (w >= 1280) return "hd";
    return "sd";
  }

  /**
   * Human title built from the most *informative* tags when the real title is a placeholder.
   * Tags are *selected* by rarity (generic ones like "nature" say nothing) but *displayed* in
   * their original order, which reads more naturally ("Chile · Mammal · Silhouette").
   */
  function generatedTitle(item, tagShare) {
    const picks = item.tags
      .filter((t) => (tagShare.get(t) || 0) < GENERIC_TAG_SHARE)
      .sort((a, b) => (tagShare.get(a) || 0) - (tagShare.get(b) || 0))
      .slice(0, 3)
      .sort((a, b) => item.tags.indexOf(a) - item.tags.indexOf(b))
      .map(titleCase);
    if (picks.length) return picks.join(" · ");
    const date = fmtDate(item.raw.date_spotted);
    return date ? `Spotlight wallpaper · ${date}` : "Spotlight wallpaper";
  }

  /**
   * Turn raw catalog rows into the view model used by the UI.
   * Raw rows are never mutated, so exports stay faithful to the source data.
   */
  function buildCatalog(rawItems) {
    const seenIds = new Set();
    const seenKeys = new Set();
    const rows = (Array.isArray(rawItems) ? rawItems : []).filter((row) => {
      if (!row || typeof row !== "object" || !Number.isSafeInteger(row.id) || row.id < 1 ||
          !validFavoriteKey(row.filename) || seenIds.has(row.id) || seenKeys.has(row.filename)) return false;
      seenIds.add(row.id);
      seenKeys.add(row.filename);
      return true;
    });
    const tagCount = new Map();
    const items = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const tags = splitTags(raw.tags);
      for (const tag of tags) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      items[i] = { raw, id: raw.id, key: raw.filename, tags };
    }
    const total = items.length || 1;
    const tagShare = new Map();
    for (const [tag, count] of tagCount) tagShare.set(tag, count / total);

    const qualityCounts = Object.create(null);
    const sourceCounts = Object.create(null);
    let newestAdded = 0;
    for (const item of items) {
      const raw = item.raw;
      item.source = raw.source || "";
      item.placeholder = isPlaceholderTitle(raw.title);
      item.title = item.placeholder ? generatedTitle(item, tagShare) : String(raw.title).trim();
      item.generated = item.placeholder;
      item.q = qualityClass(raw.width);
      item.dateTs = parseDateTs(raw.date_spotted);
      item.addedTs = Date.parse(raw.downloaded_at || "") || 0;
      item.search = foldText(
        [item.placeholder ? "" : raw.title, item.tags.join(" "), raw.date_spotted,
          raw.source === "peapix" ? "peapix" : "windows 10 spotlight win10"].join(" ")
      );
      qualityCounts[item.q] = (qualityCounts[item.q] || 0) + 1;
      sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
      if (item.addedTs > newestAdded) newestAdded = item.addedTs;
    }

    const byId = new Map();
    const byKey = new Map();
    for (const item of items) {
      byId.set(item.id, item);
      byKey.set(item.key, item);
    }
    return { items, byId, byKey, tagCount, tagShare, qualityCounts, sourceCounts, newestAdded, total: items.length };
  }

  /**
   * A daily pick shared by web and native clients (UTC day, stable public IDs).
   * Highest salted FNV-1a score wins: one pass, no sort, independent of catalog
   * ordering or metadata edits. Adding/removing rows may change today's pick.
   */
  function dailyWallpaper(catalog, now = new Date()) {
    if (!catalog || !Number.isFinite(now.getTime())) return undefined;
    const day = now.toISOString().slice(0, 10);
    let winner, best = -1;
    for (const item of catalog.items) {
      const key = `${day}|${item.id}`;
      let hash = 2166136261;
      for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
      // Avalanche the sequential IDs so neighbouring IDs are not favoured.
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
      const score = (hash ^ (hash >>> 16)) >>> 0;
      if (score > best || (score === best && item.id < winner.id)) {
        winner = item;
        best = score;
      }
    }
    return winner;
  }

  /** Most used tags as `[tag, count]` pairs – library wide, or within `pool` (a filtered list). */
  function topTags(catalog, limit, pool) {
    let counts = catalog.tagCount;
    if (pool) {
      counts = new Map();
      for (const item of pool) for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit || 24);
  }

  /* ───────────────────────────── filtering & sorting ───────────────────────────── */

  const collator = typeof Intl !== "undefined" ? new Intl.Collator("en", { sensitivity: "base", numeric: true }) : null;

  function compareText(a, b) {
    return collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
  }

  /** Comparator for a SORTS key.  Unknown dates / generated titles always sort last. */
  function comparator(sortKey) {
    const spec = SORTS[sortKey] || SORTS[DEFAULT_STATE.sort];
    const dir = spec.order === "ASC" ? 1 : -1;
    const tie = (a, b) => b.id - a.id;
    switch (spec.sort) {
      case "date_spotted":
        return (a, b) => {
          if (!a.dateTs !== !b.dateTs) return a.dateTs ? -1 : 1;
          return (a.dateTs - b.dateTs) * dir || tie(a, b);
        };
      case "downloaded_at":
        return (a, b) => (a.addedTs - b.addedTs) * dir || tie(a, b);
      case "width":
        return (a, b) => (a.raw.width - b.raw.width) * dir || (a.raw.file_size - b.raw.file_size) * dir || tie(a, b);
      case "file_size":
        return (a, b) => (a.raw.file_size - b.raw.file_size) * dir || tie(a, b);
      case "title":
        return (a, b) => {
          if (a.placeholder !== b.placeholder) return a.placeholder ? 1 : -1;
          return compareText(a.title, b.title) * dir || tie(a, b);
        };
      default:
        return tie;
    }
  }

  /** Apply the filter part of the state, then sort.  `favorites` is a Set of filenames. */
  function filterAndSort(catalog, state, favorites) {
    let list = catalog.items;
    if (state.source) list = list.filter((i) => i.source === state.source);
    if (state.quality) list = list.filter((i) => i.q === state.quality);
    if (state.tag) list = list.filter((i) => i.tags.includes(state.tag));
    if (state.fav) list = list.filter((i) => favorites && favorites.has(i.key));
    const terms = tokenize(state.q);
    if (terms.length) list = list.filter((i) => terms.every((t) => i.search.includes(t)));
    const out = list.slice();
    out.sort(comparator(state.sort));
    return out;
  }

  /** Key identifying the *filter* part of a state (page/per/view do not change the list). */
  function filterKey(state, favVersion) {
    // `fav` must be part of the key on its own: favVersion is 0 until the first heart is toggled.
    return JSON.stringify([state.q, state.source, state.quality, state.tag, state.sort, state.fav ? 1 : 0, state.fav ? favVersion : 0]);
  }

  function paginate(list, page, perPage) {
    const per = Math.max(1, perPage | 0);
    const pages = Math.max(1, Math.ceil(list.length / per));
    const current = Math.min(Math.max(1, page | 0), pages);
    const start = (current - 1) * per;
    return {
      items: list.slice(start, start + per),
      page: current,
      pages,
      total: list.length,
      from: list.length ? start + 1 : 0,
      to: Math.min(list.length, start + per),
    };
  }

  /** `[1, '…', 4, 5, 6, '…', 20]` style page list (an ellipsis never hides a single page). */
  function pageNumbers(current, total, delta) {
    const d = delta == null ? 2 : delta;
    if (total <= 1) return [1];
    let from = Math.max(2, current - d);
    let to = Math.min(total - 1, current + d);
    if (from === 3) from = 2;
    if (to === total - 2) to = total - 1;
    const pages = [1];
    if (from > 2) pages.push("…");
    for (let p = from; p <= to; p++) pages.push(p);
    if (to < total - 1) pages.push("…");
    pages.push(total);
    return pages;
  }

  /* ───────────────────────────── URL state ───────────────────────────── */

  /** Serialise only the non-default parts of the state (short, shareable URLs). */
  function encodeState(state) {
    const params = new URLSearchParams();
    const s = Object.assign({}, DEFAULT_STATE, state);
    if (s.q) params.set("q", s.q);
    if (s.source) params.set("source", s.source);
    if (s.quality) params.set("quality", s.quality);
    if (s.tag) params.set("tag", s.tag);
    if (s.sort !== DEFAULT_STATE.sort) params.set("sort", s.sort);
    if (s.page > 1) params.set("page", String(s.page));
    if (s.per !== DEFAULT_STATE.per) params.set("per", String(s.per));
    if (s.view !== DEFAULT_STATE.view) params.set("view", s.view);
    if (s.fav) params.set("fav", "1");
    return params.toString();
  }

  /** Parse + validate a query string; unknown / malicious values fall back to defaults. */
  function decodeState(search) {
    const p = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    const state = Object.assign({}, DEFAULT_STATE);
    state.q = (p.get("q") || "").slice(0, 120);
    if (SOURCES.includes(p.get("source"))) state.source = p.get("source");
    if (QUALITIES.includes(p.get("quality"))) state.quality = p.get("quality");
    state.tag = (p.get("tag") || "").slice(0, 60).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SORTS, p.get("sort"))) state.sort = p.get("sort");
    const page = parseInt(p.get("page"), 10);
    if (page >= 1 && page < 100000) state.page = page;
    const per = parseInt(p.get("per"), 10);
    if (PAGE_SIZES.includes(per)) state.per = per;
    if (VIEWS.includes(p.get("view"))) state.view = p.get("view");
    state.fav = p.get("fav") === "1";
    return state;
  }

  /** `#w=123` → 123 (otherwise null). */
  function parseHash(hash) {
    const m = /^#?w=(\d{1,9})$/.exec(String(hash || ""));
    return m ? parseInt(m[1], 10) : null;
  }

  /* ───────────────────────────── images ───────────────────────────── */

  /**
   * Where wallpapers are served from in the static showcase.  GitHub Pages cannot serve
   * Git-LFS objects, so images are loaded through `github.com/<owner>/<repo>/blob/…?raw=true`.
   * The owner/repo are derived from the Pages URL so forks work without editing code.
   */
  function deriveImageBase(loc, override) {
    if (override && safeHttpUrl(override)) return safeHttpUrl(override).replace(/\/+$/, "");
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec((loc && loc.hostname) || "");
    if (m) {
      const repo = String(loc.pathname || "").split("/")[1] || "";
      if (repo) return `https://github.com/${m[1]}/${repo}/blob/main`;
    }
    return DEFAULT_IMAGE_BASE;
  }

  function imageUrl(opts, filename, thumb) {
    if (!validFavoriteKey(filename)) return "";
    const encoded = filename.split("/").map(encodeURIComponent).join("/");
    const path = `images/${thumb ? "thumbs/" : ""}${encoded}`;
    if (opts.local) return `/${path}`;
    return `${String(opts.base).replace(/\/+$/, "")}/${path}?raw=true`;
  }

  /** Only absolute http(s) URLs may become links – never `javascript:`, `data:` or relative tricks. */
  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value == null ? "" : value));
      return (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username && !url.password ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  /* ───────────────────────────── export ───────────────────────────── */

  const CSV_COLUMNS = ["id", "filename", "title", "source", "source_url", "page_url", "width", "height",
    "file_size", "tags", "date_spotted", "downloaded_at", "quality"];

  /** Neutralise spreadsheet formulas (CSV injection) and quote the cell. */
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toCsv(rows, columns) {
    const cols = columns || CSV_COLUMNS;
    const lines = [cols.map(csvCell).join(",")];
    for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(","));
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  }

  /* ───────────────────────────── favorites backup ───────────────────────────── */

  const MAX_FAVORITES = 20000;
  function validFavoriteKey(key) {
    if (typeof key !== "string" || !key.length || key.length > 512 ||
        /[:\\%?#\x00-\x1f\x7f]/.test(key) || key.startsWith("/") ||
        !key.split("/").every((part) => part && part !== "." && part !== "..")) return false;
    try { encodeURIComponent(key); return true; } catch (_) { return false; } // reject unpaired UTF-16
  }

  /** Defensive local-storage read: invalid JSON shapes must not break startup. */
  function normalizeFavorites(value) {
    return Array.isArray(value) ? [...new Set(value.filter(validFavoriteKey))].slice(0, MAX_FAVORITES) : [];
  }

  function favoritesBackup(favorites) {
    return { format: "spotlight-favorites", version: 1, favorites: normalizeFavorites([...favorites]) };
  }

  /** Strict import, tolerant local storage. Unknown catalog keys are kept for later. */
  function parseFavoritesBackup(value) {
    if (!value || value.format !== "spotlight-favorites" || value.version !== 1 ||
        !Array.isArray(value.favorites) || value.favorites.length > MAX_FAVORITES ||
        !value.favorites.every(validFavoriteKey)) {
      throw new Error("Choose a valid Spotlight Studio favorites backup (version 1).");
    }
    return normalizeFavorites(value.favorites);
  }

  /* ───────────────────────────── misc ───────────────────────────── */

  function debounce(fn, ms) {
    let timer = null;
    const wrapped = function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  return {
    DEFAULT_IMAGE_BASE, SORTS, PAGE_SIZES, VIEWS, SOURCES, QUALITIES, QUALITY_LABELS, SOURCE_LABELS,
    DEFAULT_STATE, CSV_COLUMNS, MAX_FAVORITES, normalizeFavorites, favoritesBackup, parseFavoritesBackup,
    isPlaceholderTitle, foldText, tokenize, splitTags, titleCase, slugify,
    fmtInt, fmtBytes, fmtDate, fmtRelative, fmtDuration, parseDateTs,
    qualityClass, buildCatalog, dailyWallpaper, topTags, comparator, filterAndSort, filterKey, paginate, pageNumbers,
    encodeState, decodeState, parseHash,
    deriveImageBase, imageUrl, safeHttpUrl, csvCell, toCsv, debounce, clamp,
  };
});
