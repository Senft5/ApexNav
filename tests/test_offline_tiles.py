"""Offline areas (web/offline_tiles.js, IDEAS F-02): which tiles an area needs, capped; which map requests go through the
offline protocol."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const O = require(process.argv[1] + '/web/offline_tiles.js');
const small = O.plan(35.6, -83.5, 10), big = O.plan(35.6, -83.5, 60);
const z14 = small.map.filter(([z]) => z === 14).length;
console.log(JSON.stringify({ small: { r: small.radiusKm, map: small.map.length, dem: small.dem.length, z14 }, big: { r: big.radiusKm, n: big.map.length + big.dem.length },
  tile: O.transform('https://tiles.openfreemap.org/planet/20251022/14/4300/6500.pbf', 'Tile'), style: O.transform('https://tiles.openfreemap.org/styles/liberty', 'Style'),
  sprite: O.transform('https://tiles.openfreemap.org/sprites/ofm_f384/ofm.png', 'SpriteImage') ?? null, other: O.transform('https://valhalla1.openstreetmap.de/route', 'Unknown') ?? null }));
"""


def test_area_plan_and_protocol():
    out = json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)
    s = out["small"]
    assert s["r"] == 10 and 100 < s["z14"] < 200 and s["dem"] >= 3
    assert out["big"]["n"] <= 2500 and out["big"]["r"] < 60, "too big an area shrinks to fit"
    assert out["tile"]["url"].startswith("apexc://https://tiles.openfreemap.org/") and out["style"]["url"].startswith("apexc://")
    assert out["sprite"] is None and out["other"] is None, "only map tiles, the style, its source and fonts"


def test_saving_an_area_keeps_its_graph_tiles():
    """Own routing offline (docs/OWN_ROUTING.md): Save area also keeps the area's road-network tiles
    (web/graph_tiles.js prefetchArea, IndexedDB), and the page loads the tile reader for it."""
    src = open(os.path.join(ROOT, "web", "offline_tiles.js")).read()
    assert "root.ApexGraphTiles.prefetchArea({ s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon })" in src
    assert '<script src="graph_tiles.js" defer></script>' in open(os.path.join(ROOT, "web", "index.html")).read()
    # a saved route keeps the network along it too (graph_tiles.js prefetchAlong), so a reroute with no signal has roads
    assert "root.ApexGraphTiles.prefetchAlong(along.lat, along.lon)" in src


RECENT = r"""
const O = require(process.argv[1] + '/web/offline_tiles.js');
const day = 86400000, now = 100 * day;
const recs = Array.from({ length: O.RECENT_MAX + 3 }, (_, i) => ({ url: 't' + i, at: i, recent: true, areas: [] }));
recs.push({ url: 'area', at: -5, recent: true, areas: ['a1'] }, { url: 'style', at: -9 });
console.log(JSON.stringify({ drop: O.overflow(recs), under: O.overflow(recs.slice(0, 10)),
  fresh: O.servable({ recent: true, at: now - 2 * day }, now), old: O.servable({ recent: true, at: now - (O.RECENT_DAYS + 1) * day }, now),
  oldArea: O.servable({ recent: false, areas: ['a1'], at: 0 }, now), oldStyle: O.servable({ at: 0 }, now), none: O.servable(null, now) }));
"""


def test_recent_tiles_are_kept_capped_and_refreshed():
    """Native speed: the tiles last seen are kept so a launch draws the map from the phone. The oldest go beyond RECENT_MAX,
    never one a saved area holds or the style; a recent one is fetched again after RECENT_DAYS (served only when offline)."""
    out = json.loads(subprocess.run([NODE, "-e", RECENT, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["drop"] == ["t0", "t1", "t2"] and out["under"] == []
    assert out["fresh"] and not out["old"] and out["oldArea"] and out["oldStyle"] and not out["none"]


PARTIAL = r"""
const enc = (o) => new TextEncoder().encode(JSON.stringify(o)).buffer;
let room = Infinity, kept = 0, mode = 'ok';
const store = new Map();
globalThis.indexedDB = { open() {
  const r = {}; setTimeout(() => { r.result = { transaction() {
    const t = {};
    t.objectStore = () => ({
      get(url) { const g = {}; setTimeout(() => { g.result = store.get(url); g.onsuccess && g.onsuccess(); }); return g; },
      put(v) { setTimeout(() => { if (kept >= room) { t.error = new Error('QuotaExceededError'); t.onerror && t.onerror(); } else { kept++; store.set(v.url, v); t.oncomplete && t.oncomplete(); } }); },
    });
    return t;
  } }; r.onsuccess(); });
  return r;
} };
const ls = new Map();
globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
let n = 0;
globalThis.fetch = async (url) => {
  const body = /style/.test(url) ? enc({ sources: { v: { type: 'vector', url: 'https://t.test/planet' } }, layers: [] })
    : /planet$/.test(url) ? enc({ tiles: ['https://t.test/{z}/{x}/{y}.pbf'] }) : new ArrayBuffer(10);
  if (/\.pbf$/.test(url) || /\.png|webp/.test(url)) {
    n++;
    if (n % 7 === 0) return { ok: false, status: 404 };                        // the sea: fine
    if (mode === 'signal' && n % 2 === 0) throw new TypeError('Failed to fetch'); // the signal goes
  }
  return { ok: true, status: 200, arrayBuffer: async () => body };
};
const O = require(process.argv[1] + '/web/offline_tiles.js');
(async () => {
  const run = (id) => O.download({ lat: 39.1, lon: -84.5, radiusKm: 3, styleUrl: 'https://t.test/style', id }).then((a) => ({ missing: a.missing ?? 0, full: !!a.full, tiles: a.tiles, share: O.keptShare(a) }), (e) => ({ threw: e.message }));
  const ok = await run('a1');
  mode = 'signal'; n = 0; const signal = await run('a2');
  mode = 'ok'; n = 0; room = kept + 10; const full = await run('a3');
  room = kept; const none = await run('a4');
  console.log(JSON.stringify({ ok, signal, full, none, old: O.keptShare({ tiles: 100 }) }));
})();
"""


def test_a_partly_kept_area_says_so():
    """A full phone or a signal lost mid-save: the area records the tiles it couldn't keep (`missing`, `full` when out of
    room), so Your data says "only N% kept" and offers Update, instead of passing a partial map off as whole. A tile the
    server hasn't got (the sea, HTTP 404) isn't missing; a style the phone can't keep fails the save."""
    out = json.loads(subprocess.run([NODE, "-e", PARTIAL, ROOT], capture_output=True, text=True, check=True).stdout)
    assert out["ok"]["missing"] == 0 and out["ok"]["share"] == 1, "404s (the sea) are fine"
    assert out["signal"]["missing"] > 0 and not out["signal"]["full"] and out["signal"]["share"] < 1
    assert out["full"]["missing"] > 0 and out["full"]["full"]
    assert out["none"] == {"threw": "not kept"}, "no room even for the style: the save fails"
    assert out["old"] == 1, "an older record without the count reads as whole"
    src = open(os.path.join(ROOT, "web", "cockpit.js")).read()
    assert "only ${part}. Press Update to finish it." in src and "const redo = age.stale || !!part;" in src


PACKS = r"""
const O = require(process.argv[1] + '/web/offline_tiles.js');
const disc = O.packOf({ id: 'a1', at: '2026-11-14T00:00:00Z', lat: 39.1, lon: -84.5, radiusKm: 25 });
// a straight route 55 km long, its line thinned to two points (lineOf): walked every 500 m, so no stretch is skipped
const route = O.packOf({ id: 'route_x', at: 't', alongKm: 1.5, line: [[39.0, -84.6], [39.5, -84.6]] });
const inSq = (lat, lon) => route.squares.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
let covered = true; for (let k = 0; k <= 100; k++) { const lat = 39.0 + k * 0.005; if (!inSq(lat, -84.6) || !inSq(lat, -84.6 + 1.4 / 86.5) || !inSq(lat, -84.6 - 1.4 / 86.5)) covered = false; }
const old = O.packOf({ id: 'r2', at: 't', box: [39, -84.6, 39.5, -84.5] });
console.log(JSON.stringify({ disc, n: route.squares.length, covered, bounds: route.bounds, old, none: [O.packOf(null), O.packOf({ id: 'z' }), O.packOf({ lat: 1, lon: 1, radiusKm: 2 })] }));
"""


def test_the_car_map_is_told_what_to_keep():
    """CarPlay's MapLibre Native map can't read the page's IndexedDB: the shell keeps its own offline pack per saved area
    (CarPlay/ApexCarOffline.swift), from packOf: a disc's box, a route's corridor as z13 squares covering 1.5 km either side."""
    out = json.loads(subprocess.run([NODE, "-e", PACKS, ROOT], capture_output=True, text=True, check=True).stdout)
    d = out["disc"]
    assert d["id"] == "a1" and d["at"] == "2026-11-14T00:00:00Z" and d["bounds"][0] < 39.1 < d["bounds"][2] and d["bounds"][1] < -84.5 < d["bounds"][3]
    assert abs((d["bounds"][2] - d["bounds"][0]) * 110.54 - 50) < 0.5, "the disc's square, 25 km each way"
    assert out["covered"] and 10 < out["n"] < 80, "the whole corridor, a few dozen squares, not the box"
    assert out["bounds"] == [39.0, -84.6, 39.5, -84.6]
    assert out["old"] == {"id": "r2", "at": "t", "bounds": [39, -84.6, 39.5, -84.5]}, "an older route record: its box"
    assert out["none"] == [None, None, None]
    src = open(os.path.join(ROOT, "web", "offline_tiles.js")).read()
    assert "postMessage({ cmd: 'offlinePacks', packs: packs() })" in src and "tellShell(); }" in src, "every change to the list, and Delete offline data"
    assert "ApexOfflineTiles.tellShell()" in open(os.path.join(ROOT, "web", "cockpit.js")).read(), "and at launch"
    app, car = open(os.path.join(ROOT, "ApexNavApp.swift")).read(), open(os.path.join(ROOT, "CarPlay", "ApexCarPlay.swift")).read()
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarOffline.swift")).read()
    assert 'cmd == "offlinePacks"' in app and "ApexCarOffline.shared.carConnected()" in car
    assert "MLNShapeOfflineRegion" in swift and "MLNTilePyramidOfflineRegion" in swift and "styleURL = " not in swift and "ApexNativeCarMap.styleURL" in swift
    assert "path: CarPlay/ApexCarOffline.swift" in open(os.path.join(ROOT, "project.yml")).read()


def test_your_data_counts_the_car_maps_copy():
    swift = open(os.path.join(ROOT, "CarPlay", "ApexCarOffline.swift")).read()
    assert '"type": "carOffline", "bytes"' in swift and ".MLNOfflinePackProgressChanged" in swift
    assert "ApexCarOffline.shared.toPage = " in open(os.path.join(ROOT, "ApexNavApp.swift")).read()
    assert "msg.type === 'carOffline'" in open(os.path.join(ROOT, "web", "cockpit.js")).read()
