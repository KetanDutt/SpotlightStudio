// Unit tests for static/js/core.js – run with:  node --test tests/js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const core = createRequire(import.meta.url)("../../static/js/core.js");

const HASH = "dfffe373d9c78e79e0d6a28ac186d8c5";

function row(id, over = {}) {
  return {
    id, filename: `peapix/${String(id).padStart(32, "0")}.jpg`, title: `Title ${id}`, source: "peapix",
    source_url: "https://img/x.jpg", page_url: `https://p/${id}`, width: 3840, height: 2160, file_size: 1000 + id,
    tags: "nature,lake", date_spotted: "2026-01-01", downloaded_at: "2026-10-01T00:00:00+00:00",
    quality: "4K / UHD", ...over,
  };
}

test("placeholder titles are detected", () => {
  for (const t of [HASH, HASH.toUpperCase(), "", null, undefined, "Windows Spotlight", " windows spotlight wallpaper "]) {
    assert.equal(core.isPlaceholderTitle(t), true, String(t));
  }
  for (const t of ["Lake Pehoe, Chile", "Beach 2024", "a1b2c3"]) assert.equal(core.isPlaceholderTitle(t), false, t);
});

test("text helpers", () => {
  assert.equal(core.foldText("Galápagos Ünïcode"), "galapagos unicode");
  assert.deepEqual(core.tokenize("  Lake  CHILE lake "), ["lake", "chile"]);
  assert.equal(core.tokenize("a b c d e f g h i j k").length, 8);
  assert.deepEqual(core.splitTags(" Lake, lake ,NATURE,, Palm  Tree "), ["lake", "nature", "palm tree"]);
  assert.deepEqual(core.splitTags(""), []);
  assert.equal(core.titleCase("national park-rocky"), "National Park-Rocky");
  assert.equal(core.slugify("Symphony of the Stones, Garni Gorge!"), "symphony-of-the-stones-garni-gorge");
  assert.equal(core.slugify("!!!"), "wallpaper");
  assert.ok(core.slugify("x".repeat(200)).length <= 60);
});

test("formatting helpers", () => {
  assert.equal(core.fmtInt(7458), "7,458");
  assert.equal(core.fmtBytes(0), "–");
  assert.equal(core.fmtBytes(512), "512 B");
  assert.equal(core.fmtBytes(2048), "2.0 KB");
  assert.equal(core.fmtBytes(5 * 1024 * 1024), "5.00 MB");
  assert.equal(core.fmtDate("2025-05-14"), "May 14, 2025");
  assert.equal(core.fmtDate("2025-01-01"), "Jan 1, 2025");   // never shifted by the local timezone
  assert.equal(core.fmtDate(""), "");
  assert.equal(core.fmtDate("weird"), "weird");
  assert.equal(core.parseDateTs("2025-05-14"), Date.UTC(2025, 4, 14));
  assert.equal(core.parseDateTs("nope"), 0);
  const now = Date.parse("2026-10-03T12:00:00Z");
  assert.equal(core.fmtRelative("2026-10-03T11:59:50Z", now), "just now");
  assert.equal(core.fmtRelative("2026-10-03T09:00:00Z", now), "3 hours ago");
  assert.equal(core.fmtRelative("2026-10-02T12:00:00Z", now), "yesterday");
  assert.equal(core.fmtRelative("", now), "");
  assert.equal(core.fmtDuration(5), "5s");
  assert.equal(core.fmtDuration(125), "2m 5s");
  assert.equal(core.fmtDuration(7500), "2h 5m");
});

test("quality classes", () => {
  assert.deepEqual([3840, 2560, 1920, 1280, 640].map(core.qualityClass), ["4k", "2k", "fhd", "hd", "sd"]);
});

test("catalog model: titles, tags, search blob, counts", () => {
  const raws = [
    row(1, { title: "Lake Pehoe, Galápagos", tags: "lake,chile" }),
    row(2, { title: HASH, tags: "outdoors,nature,chile,mammal,silhouette", source: "win10spotlight", width: 1920 }),
    row(3, { title: HASH, tags: "nature,outdoors", date_spotted: "" }),
    ...Array.from({ length: 40 }, (_, i) => row(10 + i, { tags: "nature,outdoors" })),
  ];
  const cat = core.buildCatalog(raws);
  assert.equal(cat.total, 43);
  const [one, two, three] = cat.items;
  assert.equal(one.title, "Lake Pehoe, Galápagos");
  assert.equal(one.generated, false);
  assert.ok(one.search.includes("galapagos"));                   // diacritics folded
  assert.equal(two.generated, true);
  assert.equal(two.title, "Chile · Mammal · Silhouette");          // rare tags only, generic ones dropped
  assert.ok(!two.search.includes(HASH));                           // hashes never pollute search
  assert.equal(three.title, "Spotlight wallpaper");                // nothing informative, no date
  assert.equal(cat.qualityCounts["4k"], 42);
  assert.equal(cat.sourceCounts.win10spotlight, 1);
  assert.equal(cat.byId.get(2), two);
  assert.equal(cat.byKey.get(two.key), two);
  assert.equal(cat.tagCount.get("chile"), 2);
  assert.deepEqual(raws[1].title, HASH);                           // raw rows are never mutated
  assert.equal(core.buildCatalog(null).total, 0);
  assert.deepEqual(core.topTags(cat, 2).map((t) => t[0]), ["nature", "outdoors"]);
  assert.deepEqual(core.topTags(cat, 5, [one]).map((t) => t[0]), ["chile", "lake"]);
});

test("generated title falls back to the date", () => {
  const cat = core.buildCatalog([row(1, { title: HASH, tags: "", date_spotted: "2018-11-27" })]);
  assert.equal(cat.items[0].title, "Spotlight wallpaper · Nov 27, 2018");
});

function sampleCatalog() {
  return core.buildCatalog([
    row(1, { title: "Banana beach", tags: "beach,sea", date_spotted: "2026-03-01", width: 1920, file_size: 500 }),
    row(2, { title: "apple orchard", tags: "farm", date_spotted: "2026-01-01", width: 3840, file_size: 900 }),
    row(3, { title: HASH, tags: "desert", date_spotted: "", width: 3840, file_size: 900, source: "win10spotlight" }),
    row(4, { title: "Cherry lake", tags: "lake,sea", date_spotted: "2026-02-01", width: 1280, file_size: 100, source: "win10spotlight" }),
  ]);
}
const ids = (list) => list.map((i) => i.id);
const S = (over) => ({ ...core.DEFAULT_STATE, ...over });

test("sorting: unknown dates and placeholder titles are always last, ties are stable", () => {
  const cat = sampleCatalog();
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "newest" }))), [1, 4, 2, 3]);
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "oldest" }))), [2, 4, 1, 3]);
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "resolution" }))), [3, 2, 1, 4]);   // tie → bigger file → id desc
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "size" }))), [3, 2, 1, 4]);
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "title" }))), [2, 1, 4, 3]);        // case-insensitive, hash last
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "title-desc" }))), [4, 1, 2, 3]);
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "added" }))), [4, 3, 2, 1]);
  assert.deepEqual(ids(core.filterAndSort(cat, S({ sort: "bogus" }))), [1, 4, 2, 3]);       // unknown key → default
});

test("filtering: search terms, source, quality, tag, favorites", () => {
  const cat = sampleCatalog();
  const f = (over, favs) => ids(core.filterAndSort(cat, S({ sort: "oldest", ...over }), favs));
  assert.deepEqual(f({ q: "sea" }), [4, 1]);
  assert.deepEqual(f({ q: "SEA lake" }), [4]);                  // AND semantics, any order
  assert.deepEqual(f({ q: "2026-01" }), [2]);                    // matches the date
  assert.deepEqual(f({ q: "nothing-matches" }), []);
  assert.deepEqual(f({ source: "win10spotlight" }), [4, 3]);
  assert.deepEqual(f({ quality: "4k" }), [2, 3]);
  assert.deepEqual(f({ tag: "sea" }), [4, 1]);
  assert.deepEqual(f({ tag: "se" }), []);                        // exact tag, not substring
  assert.deepEqual(f({ fav: true }, new Set([cat.items[1].key, cat.items[3].key])), [2, 4]);
  assert.deepEqual(f({ fav: true }, new Set()), []);
  assert.deepEqual(f({ source: "win10spotlight", q: "lake" }), [4]);
});

test("filter key ignores paging but tracks everything that changes the list", () => {
  const base = core.filterKey(S({}), 0);
  assert.equal(core.filterKey(S({ page: 5, per: 96, view: "list" }), 0), base);
  for (const over of [{ q: "x" }, { source: "peapix" }, { quality: "4k" }, { tag: "t" }, { sort: "oldest" }]) {
    assert.notEqual(core.filterKey(S(over), 0), base);
  }
  assert.notEqual(core.filterKey(S({ fav: true }), 0), core.filterKey(S({ fav: false }), 0));  // regression: F after reload
  assert.notEqual(core.filterKey(S({ fav: true }), 1), core.filterKey(S({ fav: true }), 2));
  assert.equal(core.filterKey(S({}), 1), core.filterKey(S({}), 2));       // favorites version only matters in fav mode
});

test("pagination", () => {
  const list = Array.from({ length: 50 }, (_, i) => i);
  const p2 = core.paginate(list, 2, 24);
  assert.deepEqual([p2.page, p2.pages, p2.from, p2.to, p2.items.length], [2, 3, 25, 48, 24]);
  assert.equal(core.paginate(list, 99, 24).page, 3);                      // clamped
  assert.equal(core.paginate(list, 0, 24).page, 1);
  assert.deepEqual([core.paginate([], 1, 24).from, core.paginate([], 1, 24).to, core.paginate([], 1, 24).pages], [0, 0, 1]);
  assert.deepEqual(core.pageNumbers(1, 1), [1]);
  assert.deepEqual(core.pageNumbers(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(core.pageNumbers(10, 20), [1, "…", 8, 9, 10, 11, 12, "…", 20]);
  assert.deepEqual(core.pageNumbers(2, 20), [1, 2, 3, 4, "…", 20]);
  assert.deepEqual(core.pageNumbers(20, 20), [1, "…", 18, 19, 20]);
  assert.deepEqual(core.pageNumbers(4, 6), [1, 2, 3, 4, 5, 6]);            // no ellipsis for a single hidden page
  assert.deepEqual(core.pageNumbers(1, 7), [1, 2, 3, "…", 7]);
});

test("URL state round-trips and rejects hostile input", () => {
  assert.equal(core.encodeState(core.DEFAULT_STATE), "");
  const state = S({ q: "lake chile", source: "peapix", quality: "4k", tag: "sea", sort: "oldest", page: 3, per: 48, view: "list", fav: true });
  const query = core.encodeState(state);
  assert.deepEqual(core.decodeState(query), state);
  assert.deepEqual(core.decodeState("?" + query), state);
  const hostile = core.decodeState("?source=evil&quality=ultra&sort=__proto__&page=-4&per=9999&view=<script>&q=" + "x".repeat(500) + "&fav=yes");
  assert.deepEqual({ ...hostile, q: hostile.q.length }, { ...core.DEFAULT_STATE, q: 120 });
  assert.equal(core.decodeState("?sort=constructor").sort, "newest");
  assert.equal(core.decodeState("?page=abc").page, 1);
  assert.equal(core.parseHash("#w=123"), 123);
  assert.equal(core.parseHash("w=7"), 7);
  for (const bad of ["#w=abc", "#w=", "#x=1", "", "#w=1234567890123"]) assert.equal(core.parseHash(bad), null, bad);
});

test("image URLs: GitHub base is derived from the Pages URL", () => {
  assert.equal(core.deriveImageBase({ hostname: "alice.github.io", pathname: "/Wallies/index.html" }), "https://github.com/alice/Wallies/blob/main");
  assert.equal(core.deriveImageBase({ hostname: "alice.github.io", pathname: "/" }), core.DEFAULT_IMAGE_BASE);
  assert.equal(core.deriveImageBase({ hostname: "gallery.example.com", pathname: "/x" }), core.DEFAULT_IMAGE_BASE);
  assert.equal(core.deriveImageBase({ hostname: "x.github.io", pathname: "/r/" }, "https://cdn.example/base/"), "https://cdn.example/base");
  const web = { base: "https://github.com/a/b/blob/main/" };
  assert.equal(core.imageUrl(web, "peapix/x.jpg", true), "https://github.com/a/b/blob/main/images/thumbs/peapix/x.jpg?raw=true");
  assert.equal(core.imageUrl(web, "peapix/x.jpg", false), "https://github.com/a/b/blob/main/images/peapix/x.jpg?raw=true");
  assert.equal(core.imageUrl({ local: true }, "peapix/x.jpg", true), "/images/thumbs/peapix/x.jpg");
});

test("only absolute http(s) URLs may become links", () => {
  assert.equal(core.safeHttpUrl("https://peapix.com/spotlight/5"), "https://peapix.com/spotlight/5");
  assert.equal(core.safeHttpUrl("http://example.com/a b"), "http://example.com/a%20b");
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x",
    "//evil.com/x", "/relative/path", "", null, undefined, "not a url", "file:///etc/passwd"]) {
    assert.equal(core.safeHttpUrl(bad), "", String(bad));
  }
});

test("CSV export is injection safe and quoted", () => {
  const csv = core.toCsv([{ id: 1, title: '=HYPERLINK("x")', tags: 'a,"b"', filename: "f" }], ["id", "title", "tags"]);
  assert.ok(csv.startsWith("\ufeff"));
  const [header, line] = csv.slice(1).trim().split("\r\n");
  assert.equal(header, '"id","title","tags"');
  assert.equal(line, `"1","'=HYPERLINK(""x"")","a,""b"""`);
  assert.equal(core.csvCell(null), '""');
  for (const evil of ["+1", "-1", "@x", "\tx"]) assert.ok(core.csvCell(evil).startsWith(`"'`));
});

test("debounce and clamp", async () => {
  let calls = 0;
  const bounced = core.debounce(() => { calls += 1; }, 20);
  bounced(); bounced(); bounced();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1);
  bounced(); bounced.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 1);
  assert.deepEqual([core.clamp(5, 0, 3), core.clamp(-1, 0, 3), core.clamp(2, 0, 3)], [3, 0, 2]);
});

test("performance: a 7.5k item catalog builds and filters quickly", () => {
  const raws = Array.from({ length: 7500 }, (_, i) => row(i + 1, {
    title: i % 2 ? HASH : `Wallpaper ${i}`, tags: `t${i % 50},t${i % 7},nature`, date_spotted: `2026-0${(i % 9) + 1}-01`,
  }));
  const t0 = performance.now();
  const cat = core.buildCatalog(raws);
  const list = core.filterAndSort(cat, S({ q: "t7 nature", sort: "title" }));
  const elapsed = performance.now() - t0;
  assert.ok(list.length > 0);
  assert.ok(elapsed < 1500, `took ${elapsed.toFixed(0)}ms`);
});

 test("favorite backups round trip, merge-compatible keys and reject malformed data", () => {
  const keys = ["peapix/a.jpg", "win10spotlight/b.jpg"];
  assert.deepEqual(core.parseFavoritesBackup(JSON.parse(JSON.stringify(core.favoritesBackup(new Set(keys))))), keys);
  assert.deepEqual(core.normalizeFavorites([...keys, keys[0], null, 3, "../secret", "https://evil/a"]), keys);
  for (const value of [null, {}, 42, "oops"]) assert.deepEqual(core.normalizeFavorites(value), []);
  for (const value of [null, {}, { version: 2, format: "spotlight-favorites", favorites: keys },
    { version: 1, format: "spotlight-favorites", favorites: ["../a"] },
    { version: 1, format: "spotlight-favorites", favorites: Array(20001).fill("a.jpg") }]) {
    assert.throws(() => core.parseFavoritesBackup(value), /backup/);
  }
});


test("catalog tolerates malformed rows and refuses traversal/duplicate keys", () => {
  const catalog = core.buildCatalog([null, {}, row(1), row(1), row(2, { filename: "../data/secrets" }),
    row(3, { filename: row(1).filename }), row(4, { id: "4" }), row(5)]);
  assert.equal(catalog.total, 2);
  assert.deepEqual(catalog.items.map(item => item.id), [1, 5]);
});
