/*!
 * Spotlight Studio – app.js
 *
 * UI layer.  One data path serves both modes:
 *   • web      – static GitHub-Pages showcase: loads data/wallpapers.json
 *   • desktop  – FastAPI backend present (desktop window or `--server`): loads /api/catalog,
 *                shows the crawler console and desktop-only actions
 * Filtering / sorting / paging / URL handling live in core.js (unit-tested).
 *
 * Security: every piece of scraped text is written with textContent / DOM APIs – there is
 * no innerHTML on data and the CSP forbids inline scripts, so a hostile title cannot run code.
 */
(() => {
  "use strict";

  const C = window.SpotlightCore;
  if (!C) {
    console.error("Spotlight Studio: core.js failed to load.");
    return;
  }

  /* ═══════════════════════════ small helpers ═══════════════════════════ */

  const $ = (id) => document.getElementById(id);
  const metaContent = (name) => (document.querySelector(`meta[name="${name}"]`) || {}).content || "";
  const VERSION = metaContent("app-version");
  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`spotlight:${key}`);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`spotlight:${key}`, JSON.stringify(value));
      } catch (_) { /* private mode / quota – preferences simply are not persisted */ }
    },
  };

  /** Tiny hyperscript: h("div", {class: "x", text: "hi", dataset: {id: 1}}, child, …). */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key === "style") for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
        else el.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  /* ═══════════════════════════ icons (static, trusted markup) ═══════════════════════════ */

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "chevron-up": '<path d="m18 15-6-6-6 6"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.2" fill="currentColor" stroke="none"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    keyboard: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M8 13h8"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  };
  const SVG_NS = "http://www.w3.org/2000/svg";

  function icon(name, size) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 18));
    svg.setAttribute("height", String(size || 18));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[name] || ""; // constants above only – never user data
    return svg;
  }

  function setIcon(el, name, size) {
    el.dataset.icon = name;
    el.replaceChildren(icon(name, size || Number(el.dataset.size) || 18));
  }

  function hydrateIcons(root) {
    for (const el of (root || document).querySelectorAll("[data-icon]")) {
      if (!el.firstChild) setIcon(el, el.dataset.icon);
    }
  }

  /* ═══════════════════════════ state ═══════════════════════════ */

  const app = {
    mode: "web",
    forcedApp: "",
    imageOpts: { local: false, base: C.DEFAULT_IMAGE_BASE },
    raw: [],
    catalog: null,
    catalogVersion: 0,
    state: Object.assign({}, C.DEFAULT_STATE),
    favorites: new Set(store.get("favorites", [])),
    favVersion: 0,
    cache: { key: "", list: [] },
    info: null,
    gallerySig: "",
    tagsExpanded: false,
    pageDirty: false,
    status: null,
    health: null,
    lastSignature: "",
    lastCatalogLoad: 0,
    reloading: false,
    lb: { item: null, list: [], index: -1, pushed: false, token: 0 },
  };

  const SOURCE_LABELS = C.SOURCE_LABELS;
  const SOURCE_SHORT = { peapix: "Peapix", win10spotlight: "Win10" };

  /* ═══════════════════════════ toasts ═══════════════════════════ */

  function toast(message, type, ms) {
    const kind = type || "info";
    const box = $("toasts");
    while (box.children.length >= 4) box.firstChild.remove();
    const el = h("div", { class: `toast is-${kind}` },
      h("span", { dataset: { icon: kind === "success" ? "check" : kind === "error" ? "alert" : "info" } }),
      h("span", { text: message }));
    hydrateIcons(el);
    box.append(el);
    const leave = () => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 260); };
    setTimeout(leave, ms || (kind === "error" ? 6000 : 3600));
    el.addEventListener("click", leave);
  }

  /* ═══════════════════════════ boot ═══════════════════════════ */

  async function fetchWithTimeout(url, ms, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, Object.assign({ signal: ctrl.signal }, options || {}));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Desktop mode == a Spotlight Studio backend answers on this origin. */
  async function detectMode() {
    const params = new URLSearchParams(location.search);
    app.forcedApp = params.get("app") || "";
    if (app.forcedApp === "web") return "web";
    if (!/^https?:$/.test(location.protocol)) return "web";
    if (app.forcedApp !== "desktop" && /\.github\.io$/i.test(location.hostname)) return "web";
    try {
      const res = await fetchWithTimeout("/api/status", 1800, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && "engine_status" in data) {
          app.status = data;
          return "desktop";
        }
      }
    } catch (_) { /* static host: no backend */ }
    return "web";
  }

  function setupImageSource() {
    if (app.mode === "desktop") {
      app.imageOpts = { local: true, base: "" };
    } else {
      app.imageOpts = { local: false, base: C.deriveImageBase(location, metaContent("image-base")) };
    }
  }

  async function loadCatalog() {
    const url = app.mode === "desktop" ? "/api/catalog" : "data/wallpapers.json";
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`The catalog request failed (HTTP ${res.status}).`);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error("The catalog has an unexpected format.");
    app.raw = raw;
    app.catalog = C.buildCatalog(raw);
    app.catalogVersion += 1;
    app.cache = { key: "", list: [] };
    app.lastCatalogLoad = Date.now();
  }

  function showSkeleton() {
    const box = $("state-loading");
    box.replaceChildren(...Array.from({ length: 12 }, () => h("div", { class: "sk" })));
    box.hidden = false;
  }

  function showError(message) {
    $("state-loading").hidden = true;
    $("gallery").hidden = true;
    $("state-empty").hidden = true;
    $("pagination").replaceChildren();
    $("error-text").textContent = message || "Check your connection and try again.";
    $("state-error").hidden = false;
    $("results-sub").textContent = "Could not load wallpapers";
  }

  async function boot() {
    hydrateIcons();
    $("gallery").setAttribute("role", "list");
    showSkeleton();
    initTheme();
    bindUI();

    // Static host? start downloading the catalog right away, in parallel with setup.
    const onPages = /\.github\.io$/i.test(location.hostname) && !/[?&]app=desktop/.test(location.search);
    app.mode = onPages ? "web" : await detectMode();
    if (onPages) app.forcedApp = new URLSearchParams(location.search).get("app") || "";
    document.body.classList.toggle("is-desktop", app.mode === "desktop");
    setupImageSource();

    // Restore state: saved display prefs < URL.
    const prefs = store.get("prefs", {});
    const fromUrl = C.decodeState(location.search);
    const urlHas = new URLSearchParams(location.search);
    app.state = Object.assign({}, C.DEFAULT_STATE, {
      view: C.VIEWS.includes(prefs.view) ? prefs.view : C.DEFAULT_STATE.view,
      per: C.PAGE_SIZES.includes(prefs.per) ? prefs.per : C.DEFAULT_STATE.per,
    }, fromUrl);
    if (!urlHas.has("view") && C.VIEWS.includes(prefs.view)) app.state.view = prefs.view;
    if (!urlHas.has("per") && C.PAGE_SIZES.includes(prefs.per)) app.state.per = prefs.per;

    buildSelects();
    $("version-label").textContent = VERSION ? `Spotlight Studio v${VERSION}` : "Spotlight Studio";
    $("foot-version").textContent = VERSION ? `v${VERSION}` : "";
    $("brand-sub").textContent = app.mode === "desktop" ? "Desktop app" : "Wallpaper gallery";

    if (app.mode === "desktop") {
      cleanupServiceWorkers();
      initCrawlerControls();
      applyStatus(app.status);
      pollStatusLoop();
      loadHealth();
    } else {
      registerServiceWorker();
    }

    try {
      await loadCatalog();
    } catch (err) {
      showError(err.message);
      return;
    }
    $("state-loading").hidden = true;
    if (app.mode === "desktop" && app.status) app.lastSignature = app.status.library_signature || "";
    render();
    handleDeepLinks();
  }

  function handleDeepLinks() {
    const params = new URLSearchParams(location.search);
    if (params.get("random") === "1" || location.hash === "#random") {
      history.replaceState(null, "", cleanUrl());
      openRandom();
      return;
    }
    syncFromHash();
  }

  /* ═══════════════════════════ service worker ═══════════════════════════ */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
    });
  }

  /** The desktop app is always online and updates in place: drop any stale worker/caches. */
  function cleanupServiceWorkers() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister())).catch(() => {});
    }
    if (window.caches) {
      caches.keys().then((keys) => keys.filter((k) => k.startsWith("spotlight")).forEach((k) => caches.delete(k))).catch(() => {});
    }
  }

  /* ═══════════════════════════ theme ═══════════════════════════ */

  const THEME_ORDER = ["auto", "light", "dark"];
  const THEME_ICON = { auto: "monitor", light: "sun", dark: "moon" };

  function resolveTheme(pref) {
    if (pref !== "auto") return pref;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyTheme(pref) {
    const theme = resolveTheme(pref);
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#eef2f8" : "#07080d");
    setIcon($("theme-icon"), THEME_ICON[pref]);
    $("btn-theme").title = `Theme: ${pref}`;
    $("btn-theme").setAttribute("aria-label", `Theme: ${pref} (click to change)`);
  }

  /** The preference is stored as a bare string because theme-init.js reads it before any JSON helper exists. */
  function currentThemePref() {
    try {
      const value = localStorage.getItem("spotlight:theme");
      return THEME_ORDER.includes(value) ? value : "auto";
    } catch (_) {
      return "auto";
    }
  }

  function initTheme() {
    applyTheme(currentThemePref());
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (currentThemePref() === "auto") applyTheme("auto");
    });
  }

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(currentThemePref()) + 1) % THEME_ORDER.length];
    try { localStorage.setItem("spotlight:theme", next); } catch (_) { /* not persisted */ }
    applyTheme(next);
    toast(`Theme: ${next}`, "info", 1600);
  }

  /* ═══════════════════════════ filtering & render ═══════════════════════════ */

  function getFiltered() {
    const key = `${C.filterKey(app.state, app.favVersion)}|${app.catalogVersion}`;
    if (app.cache.key !== key) app.cache = { key, list: C.filterAndSort(app.catalog, app.state, app.favorites) };
    return app.cache.list;
  }

  function activeFilterCount() {
    const s = app.state;
    return [s.source, s.quality, s.tag, s.fav].filter(Boolean).length;
  }

  function render() {
    if (!app.catalog) return;
    const list = getFiltered();
    const info = C.paginate(list, app.state.page, app.state.per);
    app.state.page = info.page;
    app.info = info;
    renderHeader(info);
    renderActiveFilters();
    renderFilterChips(list);
    renderGallery(info);
    renderPagination(info);
    renderLibrary();
    syncControls();
    syncURL();
  }

  function renderHeader(info) {
    const s = app.state;
    const total = app.catalog.total;
    let title = "All wallpapers";
    if (s.fav) title = "Your favorites";
    else if (s.q) title = `Results for “${s.q}”`;
    else if (s.tag) title = `#${s.tag}`;
    else if (s.source) title = SOURCE_LABELS[s.source] || s.source;
    $("results-title").textContent = title;
    $("results-sub").textContent = info.total
      ? `Showing ${C.fmtInt(info.from)}–${C.fmtInt(info.to)} of ${C.fmtInt(info.total)}${info.total !== total ? ` (library: ${C.fmtInt(total)})` : ""}`
      : "No matching wallpapers";
    document.title = s.q || s.tag || s.fav
      ? `${title} · Spotlight Studio`
      : `Spotlight Studio — ${C.fmtInt(total)} Windows Spotlight wallpapers`;
    const n = activeFilterCount();
    const badge = $("filters-count");
    badge.hidden = n === 0;
    badge.textContent = String(n);
  }

  function renderActiveFilters() {
    const s = app.state;
    const pills = [];
    const add = (key, label) => pills.push(
      h("button", { class: "pill-x", type: "button", dataset: { clear: key }, "aria-label": `Remove filter: ${label}` },
        h("span", { text: label }), h("span", { dataset: { icon: "x", size: 12 } })));
    if (s.q) add("q", `Search: ${s.q}`);
    if (s.source) add("source", SOURCE_LABELS[s.source] || s.source);
    if (s.quality) add("quality", C.QUALITY_LABELS[s.quality] || s.quality);
    if (s.tag) add("tag", `#${s.tag}`);
    if (s.fav) add("fav", "Favorites");
    if (pills.length > 1) pills.push(h("button", { class: "pill-clear", type: "button", dataset: { clear: "all" }, text: "Clear all" }));
    const box = $("active-filters");
    box.replaceChildren(...pills);
    hydrateIcons(box);
  }

  function chip(label, count, pressed, dataset) {
    // `pressed === null` renders a plain (non-toggle) chip.
    return h("button", { class: "chip", type: "button", "aria-pressed": pressed === null ? null : pressed ? "true" : "false", dataset },
      h("span", { text: label }), count == null ? null : h("small", { text: C.fmtInt(count) }));
  }

  function renderFilterChips(list) {
    const cat = app.catalog;
    const s = app.state;

    const sources = C.SOURCES.filter((src) => cat.sourceCounts[src]);
    $("source-chips").replaceChildren(
      chip("All", cat.total, !s.source, { filter: "source", value: "" }),
      ...sources.map((src) => chip(SOURCE_LABELS[src], cat.sourceCounts[src], s.source === src, { filter: "source", value: src })));

    const qualities = C.QUALITIES.filter((q) => cat.qualityCounts[q]);
    $("quality-chips").replaceChildren(
      chip("Any", null, !s.quality, { filter: "quality", value: "" }),
      ...qualities.map((q) => chip(C.QUALITY_LABELS[q], cat.qualityCounts[q], s.quality === q, { filter: "quality", value: q })));

    const limit = app.tagsExpanded ? 48 : 14;
    const tags = C.topTags(cat, limit + 1, list).filter((t) => t[0] !== s.tag);
    const shown = tags.slice(0, limit);
    const chips = [];
    if (s.tag) chips.push(chip(`#${s.tag}`, null, true, { filter: "tag", value: "" }));
    chips.push(...shown.map(([tag, count]) => chip(tag, count, false, { filter: "tag", value: tag })));
    if (!chips.length) chips.push(h("span", { class: "hint", text: "No tags for this selection." }));
    $("tag-chips").replaceChildren(...chips);
    const more = $("tags-more");
    more.hidden = tags.length <= 14;
    more.textContent = app.tagsExpanded ? "Fewer" : "More";
  }

  function renderLibrary() {
    const cat = app.catalog;
    $("lib-total").textContent = C.fmtInt(cat.total);
    $("lib-updated").textContent = cat.newestAdded ? `Updated ${C.fmtRelative(new Date(cat.newestAdded).toISOString())}` : "";
    const rows = C.SOURCES.filter((src) => cat.sourceCounts[src]).map((src) => {
      const count = cat.sourceCounts[src];
      const fill = h("div", { class: `lib-fill ${src}` });
      fill.style.width = `${Math.max(2, (count / Math.max(1, cat.total)) * 100).toFixed(1)}%`;
      return h("div", { class: "lib-row" },
        h("div", { class: "lib-row-head" },
          h("span", {}, h("i", { class: `swatch ${src}` }), SOURCE_LABELS[src]),
          h("span", { text: `${C.fmtInt(count)} · ${((count / Math.max(1, cat.total)) * 100).toFixed(0)}%` })),
        h("div", { class: "lib-track" }, fill));
    });
    $("lib-bars").replaceChildren(...rows);
  }

  /* ── gallery ───────────────────────────────────────────────────────── */

  function imgUrl(item, thumb) {
    return C.imageUrl(app.imageOpts, item.raw.filename, thumb);
  }

  function cardSubtitle(item) {
    const w = item.raw;
    const parts = [SOURCE_SHORT[item.source] || item.source, w.date_spotted ? C.fmtDate(w.date_spotted) : ""];
    if (app.state.view === "list") parts.push(`${w.width}×${w.height}`, C.fmtBytes(w.file_size));
    return parts.filter(Boolean).join(" · ");
  }

  function onThumbError(img, item) {
    if (img.dataset.fallback) {
      img.classList.add("is-broken");
      img.classList.add("is-loaded");
      return;
    }
    img.dataset.fallback = "1"; // thumbnail missing → try the full image once
    img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    img.addEventListener("error", () => onThumbError(img, item), { once: true });
    img.src = imgUrl(item, false);
  }

  function buildCard(item, index) {
    const isFav = app.favorites.has(item.key);
    const img = h("img", {
      class: "card-img", alt: "", width: 480, height: 270, decoding: "async",
      loading: index < 8 ? "eager" : "lazy", fetchpriority: index < 4 ? "high" : "auto",
    });
    img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    img.addEventListener("error", () => onThumbError(img, item), { once: true });
    img.src = imgUrl(item, true);

    const badges = h("span", { class: "card-badges" });
    if (item.q === "4k" || item.q === "2k") badges.append(h("span", { class: `badge q-${item.q}`, text: C.QUALITY_LABELS[item.q] }));

    const card = h("article", { class: "card", role: "listitem", dataset: { id: item.id, key: item.key } },
      h("button", { class: "card-main", type: "button", dataset: { act: "open" }, "aria-label": `Open ${item.title}`, title: item.title },
        h("span", { class: "card-media" }, img),
        h("span", { class: "card-caption" },
          h("span", { class: `card-title${item.generated ? " is-generated" : ""}`, text: item.title }),
          h("span", { class: "card-sub", text: cardSubtitle(item) }))),
      badges,
      h("button", {
        class: "card-fav", type: "button", dataset: { act: "fav" }, "aria-pressed": isFav ? "true" : "false",
        "aria-label": isFav ? "Remove from favorites" : "Add to favorites", title: "Favorite",
      }, h("span", { dataset: { icon: "heart", size: 16 } })));
    if (app.mode === "desktop") {
      card.append(h("button", { class: "card-setwp", type: "button", dataset: { act: "setwp" }, title: "Set as desktop wallpaper" },
        h("span", { dataset: { icon: "monitor", size: 14 } }), "Set"));
    }
    card.style.setProperty("--i", String(Math.min(index, 14)));
    hydrateIcons(card);
    if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
    return card;
  }

  function renderGallery(info) {
    const gallery = $("gallery");
    const empty = info.total === 0;
    $("state-loading").hidden = true;
    $("state-error").hidden = true;
    $("state-empty").hidden = !empty;
    gallery.hidden = empty;
    if (empty) {
      renderEmptyState();
      app.gallerySig = "";
      gallery.replaceChildren();
      return;
    }
    const sig = `${app.state.view}|${info.items.map((i) => `${i.id}:${i.title}`).join("|")}`;
    if (sig === app.gallerySig) return syncFavoriteButtons(); // identical page → keep the DOM (no flicker)
    app.gallerySig = sig;
    gallery.classList.toggle("is-list", app.state.view === "list");
    const frag = document.createDocumentFragment();
    info.items.forEach((item, i) => frag.append(buildCard(item, i)));
    gallery.replaceChildren(frag);
  }

  function renderEmptyState() {
    const s = app.state;
    const total = app.catalog.total;
    const startBtn = $("empty-start");
    startBtn.hidden = true;
    $("empty-reset").hidden = false;
    if (total === 0) {
      $("empty-title").textContent = "Your library is empty";
      $("empty-text").textContent = app.mode === "desktop"
        ? "Start the crawler to download Windows Spotlight wallpapers."
        : "The catalog does not contain any wallpapers yet.";
      $("empty-reset").hidden = true;
      startBtn.hidden = app.mode !== "desktop";
    } else if (s.fav && !app.favorites.size) {
      $("empty-title").textContent = "No favorites yet";
      $("empty-text").textContent = "Tap the heart on any wallpaper to keep it here.";
    } else {
      $("empty-title").textContent = "No wallpapers found";
      $("empty-text").textContent = "Try different search terms or clear a filter.";
    }
  }

  function renderPagination(info) {
    const nav = $("pagination");
    if (info.pages <= 1) {
      nav.replaceChildren();
      return;
    }
    const btn = (label, page, opts) => h("button", Object.assign({
      class: "pg", type: "button", dataset: { page }, "aria-label": opts.aria || `Page ${page}`,
    }, opts.current ? { "aria-current": "page" } : {}, opts.disabled ? { disabled: true } : {}), label);
    const parts = [btn("‹", info.page - 1, { aria: "Previous page", disabled: info.page === 1 })];
    for (const p of C.pageNumbers(info.page, info.pages)) {
      parts.push(p === "…" ? h("span", { class: "pg-gap", text: "…", "aria-hidden": "true" })
        : btn(String(p), p, { current: p === info.page }));
    }
    parts.push(btn("›", info.page + 1, { aria: "Next page", disabled: info.page === info.pages }));
    nav.replaceChildren(...parts);
  }

  function goPage(page) {
    if (!app.info) return;
    const target = C.clamp(page, 1, app.info.pages);
    if (target === app.state.page) return;
    app.state.page = target;
    render();
    scrollToResults();
  }

  function scrollToResults() {
    const top = $("results-bar").getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  /* ── controls sync ─────────────────────────────────────────────────── */

  function buildSelects() {
    const sort = $("sort");
    sort.replaceChildren(...Object.entries(C.SORTS).map(([key, spec]) => h("option", { value: key, text: spec.label })));
    const per = $("per-page");
    per.replaceChildren(...C.PAGE_SIZES.map((n) => h("option", { value: n, text: `${n} per page` })));
  }

  function syncControls() {
    const s = app.state;
    if ($("search").value !== s.q && document.activeElement !== $("search")) $("search").value = s.q;
    $("search-clear").hidden = !$("search").value;
    $("sort").value = s.sort;
    $("per-page").value = String(s.per);
    for (const [id, view] of [["view-grid", "grid"], ["view-list", "list"]]) {
      const active = s.view === view;
      $(id).classList.toggle("is-active", active);
      $(id).setAttribute("aria-pressed", String(active));
    }
    $("btn-favs").setAttribute("aria-pressed", String(s.fav));
    $("fav-count").textContent = String(app.favorites.size);
    $("fav-count").hidden = app.favorites.size === 0;
  }

  function syncURL() {
    const params = new URLSearchParams(C.encodeState(app.state));
    if (app.forcedApp) params.set("app", app.forcedApp);
    const qs = params.toString();
    const url = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, "", url);
  }

  function cleanUrl() {
    const params = new URLSearchParams(C.encodeState(app.state));
    if (app.forcedApp) params.set("app", app.forcedApp);
    const qs = params.toString();
    return `${location.pathname}${qs ? `?${qs}` : ""}`;
  }

  function persistPrefs() {
    store.set("prefs", { view: app.state.view, per: app.state.per });
  }

  /** Merge into the state and re-render; any filter change returns to page 1 unless told otherwise. */
  function patchState(patch, keepPage) {
    Object.assign(app.state, patch);
    if (!keepPage && !("page" in patch)) app.state.page = 1;
    render();
  }

  /* ═══════════════════════════ favorites ═══════════════════════════ */

  function toggleFavorite(item) {
    if (!item) return;
    const key = item.key;
    const adding = !app.favorites.has(key);
    if (adding) app.favorites.add(key);
    else app.favorites.delete(key);
    app.favVersion += 1;
    store.set("favorites", [...app.favorites]);
    syncFavoriteButtons();
    $("fav-count").textContent = String(app.favorites.size);
    $("fav-count").hidden = app.favorites.size === 0;
    toast(adding ? "Added to favorites" : "Removed from favorites", "info", 1500);
    if (app.state.fav && !adding && !app.lb.item) render();
  }

  function syncFavoriteButtons() {
    for (const card of $("gallery").children) {
      const on = app.favorites.has(card.dataset.key);
      const btn = card.querySelector(".card-fav");
      if (!btn) continue;
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Remove from favorites" : "Add to favorites");
    }
    if (app.lb.item) {
      const on = app.favorites.has(app.lb.item.key);
      $("lb-fav").setAttribute("aria-pressed", String(on));
      $("lb-fav").setAttribute("aria-label", on ? "Remove from favorites" : "Add to favorites");
    }
  }

  function toggleFavoritesView() {
    if (!app.state.fav && !app.favorites.size) {
      toast("No favorites yet – tap the heart on a wallpaper.", "info");
      return;
    }
    patchState({ fav: !app.state.fav });
  }

  /* ═══════════════════════════ lightbox ═══════════════════════════ */

  const lb = {
    dlg: $("lightbox"), img: $("lb-img"), stage: $("lb-stage"),
  };

  function hashUrl(id) {
    return `${cleanUrl()}#w=${id}`;
  }

  function niceFilename(item) {
    const ext = (item.raw.filename.split(".").pop() || "jpg").toLowerCase();
    return `${C.slugify(item.placeholder ? item.title : item.raw.title)}-${item.raw.width}x${item.raw.height}.${ext}`;
  }

  function openLightbox(item, list, opts) {
    if (!item) return;
    const index = list.indexOf(item);
    app.lb.list = index >= 0 ? list : [item];
    app.lb.index = Math.max(0, index);
    showLightboxItem(item);
    if (!lb.dlg.open) lb.dlg.showModal();
    if (!(opts && opts.push === false) && C.parseHash(location.hash) !== item.id) {
      history.pushState({ lb: 1 }, "", hashUrl(item.id));
      app.lb.pushed = true;
    }
  }

  function showLightboxItem(item) {
    const w = item.raw;
    const token = ++app.lb.token;
    app.lb.item = item;

    const title = $("lb-title");
    title.textContent = item.title;
    title.classList.toggle("is-generated", item.generated);
    $("lb-sub").textContent = [SOURCE_LABELS[item.source] || item.source, w.date_spotted ? C.fmtDate(w.date_spotted) : "",
      item.generated ? "Title generated from tags" : ""].filter(Boolean).join(" · ");
    $("lb-counter").textContent = app.lb.list.length > 1 ? `${C.fmtInt(app.lb.index + 1)} / ${C.fmtInt(app.lb.list.length)}` : "";

    const meta = [
      ["Resolution", `${w.width} × ${w.height}`],
      ["Quality", C.QUALITY_LABELS[item.q] || w.quality],
      ["File size", C.fmtBytes(w.file_size)],
    ];
    if (item.addedTs) meta.push(["Added", C.fmtRelative(new Date(item.addedTs).toISOString())]);
    $("lb-meta").replaceChildren(...meta.map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v }))));

    $("lb-tags").replaceChildren(...item.tags.map((t) => chip(`#${t}`, null, null, { lbTag: t })));

    const full = imgUrl(item, false);
    const download = $("lb-download");
    download.href = full;
    download.setAttribute("download", niceFilename(item));
    if (app.imageOpts.local) {
      download.removeAttribute("target");
    } else {
      download.setAttribute("target", "_blank"); // cross-origin: `download` is ignored, never navigate away
      download.setAttribute("rel", "noopener noreferrer");
    }
    const source = $("lb-source");
    const pageUrl = C.safeHttpUrl(w.page_url); // scraped data: never trust the scheme
    source.hidden = !pageUrl;
    if (pageUrl) source.href = pageUrl;
    else source.removeAttribute("href");

    $("lb-prev").disabled = app.lb.index <= 0;
    $("lb-next").disabled = app.lb.index >= app.lb.list.length - 1;
    syncFavoriteButtons();

    // Progressive loading: instantly show the (cached) thumbnail, then swap in the full image.
    lb.stage.classList.add("is-loading");
    lb.img.classList.remove("is-failed");
    lb.img.classList.add("is-preview");
    lb.img.alt = item.title;
    lb.img.src = imgUrl(item, true);
    const loader = new Image();
    loader.decoding = "async";
    loader.onload = () => {
      if (token !== app.lb.token) return;
      lb.img.src = full;
      lb.img.classList.remove("is-preview");
      lb.stage.classList.remove("is-loading");
      preloadNeighbours();
    };
    loader.onerror = () => {
      if (token !== app.lb.token) return;
      lb.stage.classList.remove("is-loading");
      lb.img.classList.add("is-failed");
      toast("The full-resolution image could not be loaded.", "error");
    };
    loader.src = full;
  }

  function preloadNeighbours() {
    for (const delta of [1, -1]) {
      const next = app.lb.list[app.lb.index + delta];
      if (next) new Image().src = imgUrl(next, false);
    }
  }

  function stepLightbox(delta) {
    const next = app.lb.index + delta;
    if (next < 0 || next >= app.lb.list.length) return;
    app.lb.index = next;
    const item = app.lb.list[next];
    showLightboxItem(item);
    history.replaceState(history.state, "", hashUrl(item.id));
    if (app.lb.list === app.cache.list) {
      const page = Math.floor(next / app.state.per) + 1; // keep the gallery page in sync (applied on close)
      if (page !== app.state.page) {
        app.state.page = page;
        app.pageDirty = true;
      }
    }
  }

  function closeLightbox() {
    if (!lb.dlg.open) return;
    if (app.lb.pushed && history.state && history.state.lb) {
      app.lb.pushed = false;
      history.back(); // popstate → syncFromHash closes the dialog
      return;
    }
    lb.dlg.close();
    if (C.parseHash(location.hash) != null) history.replaceState(null, "", cleanUrl());
  }

  function onLightboxClosed() {
    app.lb.token += 1;
    app.lb.item = null;
    lb.img.removeAttribute("src");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (app.pageDirty) {
      app.pageDirty = false;
      render();
    }
  }

  function syncFromHash() {
    if (!app.catalog) return;
    const id = C.parseHash(location.hash);
    if (id == null) {
      if (lb.dlg.open) lb.dlg.close();
      return;
    }
    const item = app.catalog.byId.get(id);
    if (!item) {
      toast("That wallpaper is no longer in the catalog.", "info");
      history.replaceState(null, "", cleanUrl());
      return;
    }
    if (!lb.dlg.open || app.lb.item !== item) openLightbox(item, getFiltered(), { push: false });
  }

  function openRandom() {
    if (!app.catalog || !app.catalog.total) return toast("No wallpapers to shuffle yet.", "info");
    const list = getFiltered();
    const pool = list.length ? list : app.catalog.items;
    openLightbox(pool[Math.floor(Math.random() * pool.length)], pool);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (lb.stage.requestFullscreen) lb.stage.requestFullscreen().catch(() => toast("Fullscreen is not available here.", "info"));
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage, "success");
    } catch (_) {
      const area = h("textarea", { "aria-hidden": "true" });
      area.style.setProperty("position", "fixed");
      area.style.setProperty("opacity", "0");
      area.value = text;
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_e) { ok = false; }
      area.remove();
      toast(ok ? okMessage : "Copy is not available in this browser.", ok ? "success" : "error");
    }
  }

  function permalink(item) {
    return `${location.origin}${location.pathname}#w=${item.id}`;
  }

  function bindLightbox() {
    lb.dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeLightbox(); });
    lb.dlg.addEventListener("close", onLightboxClosed);
    lb.dlg.addEventListener("click", (e) => { if (e.target === lb.dlg || e.target === lb.stage) closeLightbox(); });
    $("lb-close").addEventListener("click", closeLightbox);
    $("lb-prev").addEventListener("click", () => stepLightbox(-1));
    $("lb-next").addEventListener("click", () => stepLightbox(1));
    $("lb-fullscreen").addEventListener("click", toggleFullscreen);
    $("lb-fav").addEventListener("click", () => toggleFavorite(app.lb.item));
    $("lb-copy").addEventListener("click", () => app.lb.item && copyText(permalink(app.lb.item), "Link copied to clipboard"));
    $("lb-copy-image").addEventListener("click", () => {
      if (!app.lb.item) return;
      const url = new URL(imgUrl(app.lb.item, false), location.href).href;
      copyText(url, "Image URL copied to clipboard");
    });
    $("lb-setwp").addEventListener("click", () => app.lb.item && setWallpaper(app.lb.item.id));
    $("lb-tags").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lb-tag]");
      if (!btn) return;
      closeLightbox();
      patchState({ tag: btn.dataset.lbTag, q: "" });
      scrollToResults();
    });

    // Swipe left / right on touch screens.
    let start = null;
    lb.stage.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") start = { x: e.clientX, y: e.clientY }; });
    lb.stage.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepLightbox(dx < 0 ? 1 : -1);
    });
    lb.stage.addEventListener("pointercancel", () => { start = null; });

    window.addEventListener("popstate", syncFromHash);
    window.addEventListener("hashchange", syncFromHash);
  }

  /* ═══════════════════════════ desktop: crawler console ═══════════════════════════ */

  const MODE_HINTS = {
    quick: "Scans the newest pages only – takes seconds.",
    full: "Scans every gallery page and resumes any backlog.",
    repair: "Fills in missing titles and tags of stored wallpapers.",
  };

  async function api(path, options) {
    const res = await fetch(path, options);
    let body = null;
    try { body = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) throw new Error((body && body.detail && (typeof body.detail === "string" ? body.detail : "Invalid request")) || `Request failed (HTTP ${res.status})`);
    return body;
  }

  function initCrawlerControls() {
    const saved = store.get("crawl", {});
    $("crawl-source").value = ["both", "peapix", "win10spotlight"].includes(saved.source) ? saved.source : "both";
    const hasLibrary = app.status && app.status.library_count > 0;
    $("crawl-mode").value = ["quick", "full", "repair"].includes(saved.mode) ? saved.mode : hasLibrary ? "quick" : "full";
    const refreshHint = () => { $("crawl-mode-hint").textContent = MODE_HINTS[$("crawl-mode").value]; };
    refreshHint();
    $("crawl-mode").addEventListener("change", () => { refreshHint(); persistCrawl(); });
    $("crawl-source").addEventListener("change", async () => {
      persistCrawl();
      if (app.status && app.status.engine_status === "running") await control("start", true); // live switch
    });
    $("btn-start").addEventListener("click", () => control("start"));
    $("btn-pause").addEventListener("click", () => control("pause"));
    $("btn-stop").addEventListener("click", () => control("stop"));
    $("empty-start").addEventListener("click", () => control("start"));
  }

  function persistCrawl() {
    store.set("crawl", { source: $("crawl-source").value, mode: $("crawl-mode").value });
  }

  async function control(action, quiet) {
    try {
      let url = `/api/control/${action}`;
      if (action === "start") url += `?source=${encodeURIComponent($("crawl-source").value)}&mode=${encodeURIComponent($("crawl-mode").value)}`;
      const res = await api(url, { method: "POST" });
      if (!quiet) {
        const messages = {
          start: res.result === "resumed" ? "Crawler resumed" : "Crawler started",
          pause: "Crawler paused – the queue is kept",
          stop: "Stopping – unfinished work is kept for next time",
        };
        toast(messages[action], "info", 2200);
      }
      await pollStatusOnce();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function applyStatus(s) {
    if (!s) return;
    app.status = s;
    const state = s.engine_status;
    const pill = $("status-pill");
    pill.className = `status-pill is-${state}`;
    $("status-text").textContent = state === "running" && s.active_source !== "both"
      ? `Running · ${SOURCE_LABELS[s.active_source] || s.active_source}` : state;
    $("crawler-phase").textContent = s.phase || (state === "running" ? "Working…" : "Idle");

    const run = s.run || {};
    $("st-new").textContent = C.fmtInt((run.downloaded || 0) + (run.replaced || 0));
    $("st-dupes").textContent = C.fmtInt(run.duplicates || 0);
    $("st-errors").textContent = C.fmtInt(run.errors || 0);
    $("st-errors").classList.toggle("has-errors", (run.errors || 0) > 0);
    $("st-speed").textContent = state === "running" && s.rate_per_sec > 0 ? `${s.rate_per_sec.toFixed(1)}/s` : "–";
    $("st-queue").textContent = C.fmtInt(s.download_queue_remaining || 0);
    $("st-pages").textContent = C.fmtInt(s.scrape_queue_remaining || 0);

    const active = state === "running" || state === "paused" || state === "stopping";
    const bar = $("progress-bar");
    bar.style.width = `${active ? s.progress_pct : (run.result === "completed" ? 100 : 0)}%`;
    $("progress").setAttribute("aria-valuenow", String(s.progress_pct || 0));
    $("progress").classList.toggle("is-active", state === "running");

    $("btn-start").disabled = state === "running" || state === "stopping";
    $("btn-start-label").textContent = state === "paused" ? "Resume" : "Start";
    $("btn-pause").disabled = state !== "running";
    $("btn-stop").disabled = state === "stopped" || state === "stopping";
    $("crawl-mode").disabled = active;

    const last = $("last-run");
    if (s.last_run && !active) {
      const lr = s.last_run;
      const what = lr.mode === "repair" ? `${lr.repaired} repaired` : `+${lr.downloaded} new`;
      last.textContent = `Last run ${C.fmtRelative(lr.at)} · ${lr.mode} · ${what}${lr.result !== "completed" ? ` · ${lr.result}` : ""}`;
      last.hidden = false;
    } else {
      last.hidden = true;
    }
    $("brand-sub").textContent = active ? `Crawler ${state}` : "Desktop app";

    if (s.library_signature && s.library_signature !== app.lastSignature) maybeReloadCatalog(s.library_signature);
  }

  async function maybeReloadCatalog(signature) {
    if (app.reloading || !app.catalog) return;
    const wait = 6000 - (Date.now() - app.lastCatalogLoad);
    if (wait > 0 && app.status && app.status.engine_status === "running") return; // throttle while crawling
    app.reloading = true;
    try {
      await loadCatalog();
      app.lastSignature = signature;
      if (!lb.dlg.open) render();
      else app.pageDirty = true;
    } catch (_) { /* try again on the next poll */ } finally {
      app.reloading = false;
    }
  }

  let pollTimer = 0;
  async function pollStatusOnce() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) applyStatus(await res.json());
    } catch (_) { /* server restarting – keep polling */ }
  }

  function pollStatusLoop() {
    clearTimeout(pollTimer);
    const tick = async () => {
      if (!document.hidden) await pollStatusOnce();
      const state = app.status ? app.status.engine_status : "stopped";
      pollTimer = setTimeout(tick, document.hidden ? 8000 : state === "stopped" ? 4000 : 1500);
    };
    pollTimer = setTimeout(tick, 1500);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pollStatusOnce(); });
  }

  async function loadHealth() {
    try {
      app.health = await api("/api/health");
      if (app.health.lfs_pointers_detected && !sessionStorage.getItem("spotlight:lfs-dismissed")) $("lfs-banner").hidden = false;
    } catch (_) { /* optional */ }
    $("lfs-dismiss").addEventListener("click", () => {
      $("lfs-banner").hidden = true;
      try { sessionStorage.setItem("spotlight:lfs-dismissed", "1"); } catch (_) { /* ignore */ }
    });
  }

  async function setWallpaper(id) {
    try {
      await api(`/api/wallpapers/${id}/set-wallpaper`, { method: "POST" });
      toast("Desktop wallpaper updated", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  /* ═══════════════════════════ export, menu, dialogs ═══════════════════════════ */

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Exported ${filename}`, "success");
  }

  function exportCatalog(kind) {
    if (app.mode === "desktop") {
      const a = h("a", { href: `/api/export/${kind}`, download: `spotlight_wallpapers.${kind}` });
      document.body.append(a);
      a.click();
      a.remove();
      return;
    }
    if (!app.raw.length) return toast("The catalog is not loaded yet.", "error");
    if (kind === "json") downloadBlob(new Blob([JSON.stringify(app.raw, null, 2)], { type: "application/json" }), "spotlight_wallpapers.json");
    else downloadBlob(new Blob([C.toCsv(app.raw)], { type: "text/csv;charset=utf-8" }), "spotlight_wallpapers.csv");
  }

  function setMenu(open) {
    $("menu").hidden = !open;
    $("btn-menu").setAttribute("aria-expanded", String(open));
    if (open) $("menu").querySelector(".menu-item:not([hidden])").focus();
  }

  function openDialog(id) {
    if (id === "dlg-about") {
      $("about-version").textContent = VERSION ? `v${VERSION}` : "–";
      $("about-mode").textContent = app.mode === "desktop" ? "Desktop app (live library)" : "Static web catalog";
      $("about-count").textContent = app.catalog ? C.fmtInt(app.catalog.total) : "–";
      $("about-updated").textContent = app.catalog && app.catalog.newestAdded
        ? new Date(app.catalog.newestAdded).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "–";
    }
    const dlg = $(id);
    if (!dlg.open) dlg.showModal();
  }

  /* ═══════════════════════════ UI bindings ═══════════════════════════ */

  function setSidebar(open) {
    $("sidebar").classList.toggle("is-open", open);
    $("scrim").hidden = !open;
    $("filters-toggle").setAttribute("aria-expanded", String(open));
  }

  function bindUI() {
    bindLightbox();

    // Search
    const search = $("search");
    const apply = C.debounce(() => patchState({ q: search.value.trim() }), 160);
    search.addEventListener("input", () => { $("search-clear").hidden = !search.value; apply(); });
    $("search-clear").addEventListener("click", () => { search.value = ""; patchState({ q: "" }); search.focus(); });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (search.value) { search.value = ""; patchState({ q: "" }); } else search.blur(); }
      if (e.key === "Enter") { apply.cancel(); patchState({ q: search.value.trim() }); }
    });

    // Top bar
    $("btn-shuffle").addEventListener("click", openRandom);
    $("btn-favs").addEventListener("click", toggleFavoritesView);
    $("btn-theme").addEventListener("click", cycleTheme);
    $("btn-menu").addEventListener("click", (e) => { e.stopPropagation(); setMenu($("menu").hidden); });
    $("menu").addEventListener("click", (e) => {
      const item = e.target.closest("[data-action]");
      if (!item && !e.target.closest("a")) return;
      setMenu(false);
      if (!item) return;
      const action = item.dataset.action;
      if (action === "export-json") exportCatalog("json");
      else if (action === "export-csv") exportCatalog("csv");
      else if (action === "shortcuts") openDialog("dlg-shortcuts");
      else if (action === "about") openDialog("dlg-about");
    });
    document.addEventListener("click", (e) => { if (!$("menu").hidden && !e.target.closest(".menu-wrap")) setMenu(false); });

    // Dialog close buttons + backdrop click
    for (const dlg of document.querySelectorAll("dialog.modal")) {
      dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
    }

    // Results bar
    $("sort").addEventListener("change", (e) => patchState({ sort: e.target.value }));
    $("per-page").addEventListener("change", (e) => { patchState({ per: Number(e.target.value) }); persistPrefs(); });
    $("view-grid").addEventListener("click", () => { patchState({ view: "grid" }, true); persistPrefs(); });
    $("view-list").addEventListener("click", () => { patchState({ view: "list" }, true); persistPrefs(); });
    $("btn-reset").addEventListener("click", resetFilters);
    $("empty-reset").addEventListener("click", resetFilters);
    $("error-retry").addEventListener("click", () => { showSkeleton(); $("state-error").hidden = true; retryLoad(); });
    $("tags-more").addEventListener("click", () => { app.tagsExpanded = !app.tagsExpanded; render(); });

    // Filter chips & active-filter pills (delegated)
    $("sidebar").addEventListener("click", (e) => {
      const chipEl = e.target.closest("[data-filter]");
      if (!chipEl) return;
      const key = chipEl.dataset.filter;
      const value = chipEl.dataset.value;
      patchState({ [key]: key === "tag" && value === app.state.tag ? "" : value });
    });
    $("active-filters").addEventListener("click", (e) => {
      const pill = e.target.closest("[data-clear]");
      if (!pill) return;
      const key = pill.dataset.clear;
      if (key === "all") resetFilters();
      else patchState({ [key]: key === "fav" ? false : "" });
    });

    // Gallery (delegated)
    $("gallery").addEventListener("click", (e) => {
      const target = e.target.closest("[data-act]");
      if (!target) return;
      const item = app.catalog.byId.get(Number(target.closest(".card").dataset.id));
      if (!item) return;
      if (target.dataset.act === "open") openLightbox(item, getFiltered());
      else if (target.dataset.act === "fav") toggleFavorite(item);
      else if (target.dataset.act === "setwp") setWallpaper(item.id);
    });
    $("pagination").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-page]");
      if (btn && !btn.disabled) goPage(Number(btn.dataset.page));
    });

    // Mobile filter drawer
    $("filters-toggle").addEventListener("click", () => setSidebar(!$("sidebar").classList.contains("is-open")));
    $("sidebar-close").addEventListener("click", () => setSidebar(false));
    $("scrim").addEventListener("click", () => setSidebar(false));

    // Scroll effects
    const toTop = $("to-top");
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        $("topbar").classList.toggle("is-scrolled", window.scrollY > 8);
        toTop.hidden = window.scrollY < 900;
        ticking = false;
      });
    }, { passive: true });
    toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }));

    document.addEventListener("keydown", onKeyDown);
  }

  async function retryLoad() {
    try {
      await loadCatalog();
      $("state-loading").hidden = true;
      render();
      handleDeepLinks();
    } catch (err) {
      showError(err.message);
    }
  }

  function resetFilters() {
    app.state = Object.assign({}, C.DEFAULT_STATE, { view: app.state.view, per: app.state.per });
    $("search").value = "";
    render();
    setSidebar(false);
  }

  function onKeyDown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing) return; // the search box handles its own Escape/Enter
    if (e.key === "Escape") {
      if ($("sidebar").classList.contains("is-open")) setSidebar(false);
      else if (!$("menu").hidden) setMenu(false);
      return;
    }
    if (document.querySelector("dialog.modal[open]")) return; // native dialogs own the keyboard
    const inViewer = lb.dlg.open;
    switch (e.key) {
      case "/":
        if (inViewer) return;
        e.preventDefault();
        $("search").focus();
        $("search").select();
        break;
      case "?":
        openDialog("dlg-shortcuts");
        break;
      case "r": case "R":
        openRandom();
        break;
      case "f": case "F":
        if (inViewer) toggleFavorite(app.lb.item);
        else toggleFavoritesView();
        break;
      case "ArrowLeft":
        if (inViewer) stepLightbox(-1);
        else if (app.info) goPage(app.info.page - 1);
        break;
      case "ArrowRight":
        if (inViewer) stepLightbox(1);
        else if (app.info) goPage(app.info.page + 1);
        break;
      case "c": case "C":
        if (inViewer && app.lb.item) copyText(permalink(app.lb.item), "Link copied to clipboard");
        break;
      case "d": case "D":
        if (inViewer) $("lb-download").click();
        break;
      case "Enter":
        if (inViewer && (t === document.body || t === lb.dlg || t === lb.stage || t === lb.img)) toggleFullscreen();
        break;
      default:
    }
  }

  boot().catch((err) => {
    console.error(err);
    showError(err && err.message ? err.message : String(err));
  });
})();
